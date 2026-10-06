import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { loadModule, plain, readProjectFile } from "./test-support/module-loader.mjs";

const ACCOUNT = "whoop-test-account";
const TOKEN = { accessToken: "initial-access", refreshToken: "initial-refresh", expiresAt: 0, scope: "offline read:cycles" };
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const untilAborted = (signal) => new Promise((resolve, reject) => {
  if (signal.aborted) reject(signal.reason);
  else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
});

async function fixture(fetchResponse, { expired = true, fakeTimeouts = false } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readProjectFile("migrations/0001_accounts.sql"));
  sqlite.exec(readProjectFile("migrations/0002_password_auth.sql"));
  sqlite.exec(readProjectFile("migrations/0004_whoop_connections.sql"));
  sqlite.prepare("INSERT INTO accounts(id,email) VALUES (?,?)").run(ACCOUNT, "whoop-test@example.com");
  const operations = [], requests = [], timeoutControllers = [], logs = [];
  const cookieJar = new Map();
  const hooks = { beforeRead: null };
  const database = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async first() {
          operations.push("read");
          if (hooks.beforeRead) await hooks.beforeRead();
          return statement.get(...args) ?? null;
        },
        async run() {
          operations.push((sql.includes("auth_rate_limits") ? "LEASE_" : "") + sql.trim().split(/\s/)[0]);
          const value = statement.run(...args);
          return { meta: { changes: Number(value.changes) } };
        },
      };
    },
  };
  const loadWhoop = () => loadModule("lib/whoop-core.ts", {
    "@/lib/database": { getDatabase: () => database },
    "./upstream-response": loadModule("lib/upstream-response.ts"),
    "next/headers": { cookies: async () => ({
      get: (name) => cookieJar.has(name) ? { value: cookieJar.get(name) } : undefined,
      set: (name, value) => cookieJar.set(name, value),
    }) },
  }, {
    URLSearchParams,
    console: { info: (...values) => logs.push(values) },
    process: { env: {
      WHOOP_CLIENT_ID: "test-client", WHOOP_CLIENT_SECRET: "test-client-secret",
      WHOOP_REDIRECT_URI: "https://example.com/callback",
      WHOOP_COOKIE_SECRET: "test-encryption-secret-more-than-thirty-two-characters",
    } },
    ...(fakeTimeouts ? { AbortSignal: {
      any: (signals) => AbortSignal.any(signals),
      timeout: (ms) => {
        const controller = new AbortController();
        timeoutControllers.push({ ms, controller });
        return controller.signal;
      },
    } } : {}),
    fetch: async (url, options) => {
      const request = { url: new URL(url), options };
      requests.push(request);
      return fetchResponse(request);
    },
  });
  const whoop = loadWhoop();
  await whoop.writeWhoopTokens(ACCOUNT, { ...TOKEN, expiresAt: expired ? 0 : Date.now() + 3_600_000 });
  operations.length = 0;
  const row = () => sqlite.prepare("SELECT * FROM whoop_connections WHERE account_id = ?").get(ACCOUNT);
  return { whoop, loadWhoop, sqlite, requests, operations, timeoutControllers, hooks, row, cookieJar, logs };
}

test("expired access refreshes exactly once before five parallel reads and encrypts rotated tokens", { timeout: 1500 }, async () => {
  const allStarted = deferred();
  const pending = [];
  let refreshes = 0;
  const qa = await fixture(({ url, options }) => {
    if (url.pathname.endsWith("/token")) {
      refreshes += 1;
      assert.equal(options.body.get("refresh_token"), TOKEN.refreshToken);
      return Response.json({ access_token: "rotated-access", refresh_token: "rotated-refresh", expires_in: 3600 });
    }
    assert.equal(options.headers.Authorization, "Bearer rotated-access");
    const gate = deferred();
    pending.push({ gate, path: url.pathname });
    if (pending.length === 5) allStarted.resolve();
    return gate.promise;
  });
  try {
    const read = qa.whoop.getRecentWhoopMetrics(ACCOUNT);
    await allStarted.promise;
    assert.equal(refreshes, 1);
    assert.equal(pending.length, 5);
    for (const { gate, path } of pending) gate.resolve(Response.json(path.endsWith("/body")
      ? { user_id: "private-person", height_meter: 1.7 }
      : { records: [{ id: "private-record", user_id: "private-person", score: { strain: 4 } }] }));
    const metrics = await read;
    assert.equal(JSON.stringify(metrics).includes("private-"), false);
    const tokens = await qa.whoop.readWhoopTokens(ACCOUNT);
    assert.equal(tokens.accessToken, "rotated-access");
    assert.equal(tokens.refreshToken, "rotated-refresh");
    assert.equal(qa.row().token_ciphertext.includes("rotated-access"), false);
    assert.equal(qa.operations.filter((operation) => operation === "UPDATE").length, 1);
    assert.equal(qa.operations.includes("DELETE"), false);
  } finally { qa.sqlite.close(); }
});

test("already cancelled metrics do not read storage, refresh or fetch metrics", async () => {
  const qa = await fixture(() => { throw new Error("fetch must not run"); });
  try {
    const controller = new AbortController();
    controller.abort(new DOMException("Cancelled", "AbortError"));
    await assert.rejects(qa.whoop.getRecentWhoopMetrics(ACCOUNT, { signal: controller.signal }), { name: "AbortError" });
    assert.deepEqual(qa.operations, []);
    assert.equal(qa.requests.length, 0);
    assert.ok(qa.row());
  } finally { qa.sqlite.close(); }
});

test("cancellation while loading stored expired tokens does not begin a refresh", async () => {
  const loaded = deferred(), release = deferred();
  const qa = await fixture(({ options }) => untilAborted(options.signal));
  try {
    qa.hooks.beforeRead = () => { loaded.resolve(); return release.promise; };
    const controller = new AbortController();
    const read = qa.whoop.getRecentWhoopMetrics(ACCOUNT, { signal: controller.signal });
    await loaded.promise;
    controller.abort(new DOMException("Cancelled", "AbortError"));
    release.resolve();
    await assert.rejects(read, { name: "AbortError" });
    assert.equal(qa.requests.length, 0);
    assert.ok(qa.row());
    assert.equal(qa.operations.includes("DELETE"), false);
  } finally { qa.sqlite.close(); }
});

test("a refresh timeout keeps the normal grant and starts no metric reads", { timeout: 1500 }, async () => {
  const refreshStarted = deferred();
  const qa = await fixture(({ options }) => { refreshStarted.resolve(); return untilAborted(options.signal); }, { fakeTimeouts: true });
  try {
    const original = qa.row().token_ciphertext;
    const read = qa.whoop.getRecentWhoopMetrics(ACCOUNT);
    await refreshStarted.promise;
    assert.deepEqual(qa.timeoutControllers.map(({ ms }) => ms), [15_000, 10_000]);
    qa.timeoutControllers.find(({ ms }) => ms === 10_000).controller.abort(new DOMException("Timed out", "TimeoutError"));
    await assert.rejects(read, { name: "TimeoutError" });
    assert.equal(qa.requests.length, 1);
    assert.equal(qa.row().token_ciphertext, original);
    assert.equal(qa.operations.includes("DELETE"), false);
  } finally { qa.sqlite.close(); }
});

test("refresh server failure keeps the grant while an explicitly invalid grant clears it", async () => {
  for (const [status, body, revoked] of [[503, "unavailable", false], [400, "invalid_grant", true]]) {
    const qa = await fixture(() => new Response(body, { status }));
    try {
      const original = qa.row().token_ciphertext;
      await assert.rejects(qa.whoop.getRecentWhoopMetrics(ACCOUNT), (error) => revoked
        ? error.name === "WhoopReauthorizationRequiredError" : error.status === 503);
      assert.equal(qa.requests.length, 1);
      assert.equal(Boolean(qa.row()), !revoked);
      if (!revoked) assert.equal(qa.row().token_ciphertext, original);
      assert.equal(qa.operations.includes("DELETE"), revoked);
    } finally { qa.sqlite.close(); }
  }
});

test("malformed successful refresh is not proof that the stored grant was revoked", async () => {
  const qa = await fixture(() => Response.json({ access_token: "incomplete-response" }));
  try {
    const original = qa.row().token_ciphertext;
    await assert.rejects(qa.whoop.getRecentWhoopMetrics(ACCOUNT));
    assert.equal(qa.requests.length, 1);
    assert.equal(qa.row()?.token_ciphertext, original);
    assert.equal(qa.operations.includes("DELETE"), false);
  } finally { qa.sqlite.close(); }
});

test("cancelling five in-flight reads aborts every read and retains the grant", { timeout: 1500 }, async () => {
  const allStarted = deferred();
  const active = [], cancelled = [];
  const qa = await fixture(({ url, options }) => {
    active.push(url.pathname);
    options.signal.addEventListener("abort", () => cancelled.push(url.pathname), { once: true });
    if (active.length === 5) allStarted.resolve();
    return untilAborted(options.signal);
  }, { expired: false });
  try {
    const original = qa.row().token_ciphertext;
    const controller = new AbortController();
    const read = qa.whoop.getRecentWhoopMetrics(ACCOUNT, { signal: controller.signal });
    await allStarted.promise;
    controller.abort(new DOMException("Cancelled", "AbortError"));
    await assert.rejects(read, { name: "AbortError" });
    assert.equal(cancelled.length, 5);
    assert.equal(qa.requests.length, 5);
    assert.equal(qa.row().token_ciphertext, original);
    assert.equal(qa.operations.includes("DELETE"), false);
  } finally { qa.sqlite.close(); }
});

test("pagination stops at four unique pages and stops repeated page tokens", async () => {
  const counts = new Map();
  const qa = await fixture(({ url }) => {
    const count = (counts.get(url.pathname) ?? 0) + 1;
    counts.set(url.pathname, count);
    if (url.pathname.endsWith("/body")) return Response.json({ height_meter: 1.7 });
    return Response.json({
      records: [{ id: "private-record", score: { page: count } }],
      ...(url.pathname.endsWith("/cycle") ? { next_token: `next-${count}` }
        : url.pathname.endsWith("/recovery") ? { next_token: "repeated" } : {}),
    });
  }, { expired: false });
  try {
    const metrics = await qa.whoop.getRecentWhoopMetrics(ACCOUNT);
    assert.equal(counts.get("/developer/v2/cycle"), 4);
    assert.equal(counts.get("/developer/v2/recovery"), 2);
    assert.equal(qa.requests.some(({ url }) => url.pathname.endsWith("/token")), false);
    assert.deepEqual(plain(metrics.cycles.map(({ score }) => score.page)), [1, 2, 3, 4]);
    assert.equal(JSON.stringify(metrics).includes("private-record"), false);
  } finally { qa.sqlite.close(); }
});

test("WHOOP null final-page cursors preserve successful summary readings and stop pagination", async () => {
  const qa = await fixture(({ url }) => {
    const pathname = url.pathname;
    if (pathname.endsWith("/cycle")) return Response.json({
      records: [{ score_state: "SCORED", step_count: 123, score: { strain: 4 } }],
      next_token: url.searchParams.has("nextToken") ? null : "last-page",
    });
    if (pathname.endsWith("/recovery")) return Response.json({
      records: [{ score_state: "SCORED", score: { recovery_score: 65 } }], next_token: null,
    });
    return Response.json({ records: [{ score_state: "SCORED", score: {
      stage_summary: { total_light_sleep_time_milli: 3_600_000 },
    } }], next_token: null });
  }, { expired: false });
  try {
    const snapshot = await qa.whoop.getRecentWhoopSummary(ACCOUNT);
    assert.equal(snapshot.syncStatus, "synced");
    assert.deepEqual(plain(snapshot.failedMetrics), []);
    assert.equal(snapshot.summary.recoveryScore, 65);
    assert.equal(snapshot.summary.sleepMinutes, 60);
    assert.equal(snapshot.summary.cycleSteps, 123);
    assert.equal(qa.requests.length, 4);
    assert.equal(qa.requests.filter(({ url }) => url.searchParams.has("nextToken")).length, 1);
  } finally { qa.sqlite.close(); }
});

test("empty WHOOP collections with null cursors are successful empty data without reauthorization", async () => {
  const qa = await fixture(() => Response.json({ records: [], next_token: null }), { expired: false });
  try {
    const snapshot = await qa.whoop.getRecentWhoopSummary(ACCOUNT);
    assert.equal(snapshot.syncStatus, "empty");
    assert.equal(snapshot.summary.recoveryScore, null);
    assert.deepEqual(plain(snapshot.failedMetrics), []);
    assert.equal(qa.requests.length, 3);
    assert.ok(qa.row());
  } finally { qa.sqlite.close(); }
});

test("non-string WHOOP pagination cursors still fail validation and preserve authorization", async () => {
  const qa = await fixture(() => Response.json({ records: [], next_token: 123 }), { expired: false });
  try {
    await assert.rejects(qa.whoop.getRecentWhoopSummary(ACCOUNT), (error) =>
      error.code === "WHOOP_SYNC_FAILED" && error.failures.length === 3 &&
      error.failures.every(({ code }) => code === "WHOOP_INVALID_RESPONSE"));
    assert.ok(qa.row());
  } finally { qa.sqlite.close(); }
});

test("summary reads only displayed domains and retains scored records when newest records are pending", async () => {
  const qa = await fixture(({ url }) => {
    const pathname = url.pathname;
    assert.ok(!pathname.endsWith("/body") && !pathname.endsWith("/workout"));
    if (pathname.endsWith("/recovery")) return Response.json({ records: [
      { score_state: "PENDING_SCORE" },
      { score_state: "SCORED", created_at: "2026-10-02T08:00:00Z", score: { recovery_score: 65 } },
    ] });
    if (pathname.endsWith("/sleep")) return Response.json({ records: [{ score_state: "SCORED", end: "2026-10-02T07:00:00Z",
      score: { sleep_performance_percentage: 80, stage_summary: { total_light_sleep_time_milli: 60_000 } },
    }] });
    return Response.json({ records: [{ score_state: "SCORED", step_count: 123, score: { strain: 4 } }] });
  }, { expired: false });
  try {
    const snapshot = await qa.whoop.getRecentWhoopSummary(ACCOUNT);
    assert.equal(qa.requests.length, 3);
    assert.equal(snapshot.syncStatus, "synced");
    assert.equal(snapshot.summary.recoveryScore, 65);
    assert.equal(snapshot.summary.sleepMinutes, 1);
    assert.equal(snapshot.summary.cycleSteps, 123);
    assert.equal(snapshot.summary.measuredAt, "2026-10-02T08:00:00Z");
    assert.ok(snapshot.retrievedAt);
  } finally { qa.sqlite.close(); }
});

test("optional domain errors preserve good WHOOP records and disclose partial coverage", async () => {
  const qa = await fixture(({ url }) => url.pathname.endsWith("/body") || url.pathname.endsWith("/workout")
    ? new Response("private-provider-health-or-token-detail", { status: url.pathname.endsWith("/body") ? 404 : 503 })
    : Response.json({ records: [{ score_state: "SCORED", score: { strain: 4 } }] }), { expired: false });
  try {
    const snapshot = await qa.whoop.getRecentWhoopMetrics(ACCOUNT);
    assert.equal(snapshot.syncStatus, "partial");
    assert.deepEqual(plain(snapshot.failedMetrics), ["workout", "body_measurements"]);
    assert.equal(snapshot.cycles.length, 1);
    assert.equal(snapshot.recoveries.length, 1);
    assert.equal(snapshot.sleeps.length, 1);
    assert.equal(snapshot.body_measurements, null);
    assert.equal(qa.requests.length, 5);
    assert.ok(!JSON.stringify(qa.logs).includes("private-"));
    assert.ok(!JSON.stringify(qa.logs).includes("Bearer"));
    for (const [, entry] of qa.logs) assert.deepEqual(Object.keys(entry).sort(), ["code", "path", "status"]);
  } finally { qa.sqlite.close(); }
});

test("partial recovery failure does not erase sleep and empty successful responses are distinguished", async () => {
  for (const empty of [false, true]) {
    const qa = await fixture(({ url }) => !empty && url.pathname.endsWith("/recovery")
      ? new Response("forbidden", { status: 403 })
      : Response.json({ records: !empty && url.pathname.endsWith("/sleep")
        ? [{ score_state: "SCORED", score: { sleep_performance_percentage: 80 } }] : [] }), { expired: false });
    try {
      const snapshot = await qa.whoop.getRecentWhoopSummary(ACCOUNT);
      assert.equal(snapshot.syncStatus, empty ? "empty" : "partial");
      assert.deepEqual(plain(snapshot.failedMetrics), empty ? [] : ["recovery"]);
      assert.equal(snapshot.summary.recoveryScore, null);
      assert.equal(snapshot.summary.sleepPerformance, empty ? null : 80);
      assert.ok(qa.row());
    } finally { qa.sqlite.close(); }
  }
});

test("all core failures stay failures even when auxiliary data exists, without deleting authorization", async () => {
  const qa = await fixture(({ url }) => url.pathname.endsWith("/body") ? Response.json({})
    : new Response("private-failure-detail", { status: 503 }), { expired: false });
  try {
    await assert.rejects(qa.whoop.getRecentWhoopMetrics(ACCOUNT), (error) => error.code === "WHOOP_SYNC_FAILED" &&
      error.failures.some((failure) => failure.metric === "recovery" && failure.status === 503));
    assert.ok(qa.row());
    assert.ok(!JSON.stringify(qa.logs).includes("private-"));
  } finally { qa.sqlite.close(); }
});

test("independent Worker modules share the D1 refresh lease and rotate once", { timeout: 1500 }, async () => {
  const started = deferred(), complete = deferred();
  const qa = await fixture(() => { started.resolve(); return complete.promise; });
  try {
    const first = qa.whoop.getValidWhoopAccessToken(ACCOUNT);
    await started.promise;
    const otherWorker = qa.loadWhoop();
    const second = otherWorker.getValidWhoopAccessToken(ACCOUNT);
    complete.resolve(Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 }));
    assert.deepEqual(await Promise.all([first, second]), ["new-access", "new-access"]);
    assert.equal(qa.requests.length, 1);
    assert.equal(qa.sqlite.prepare("SELECT COUNT(*) AS count FROM auth_rate_limits").get().count, 0);
    assert.equal((await qa.whoop.readWhoopTokens(ACCOUNT)).refreshToken, "new-refresh");
  } finally { qa.sqlite.close(); }
});

test("old cookies cannot resurrect a disconnected D1 authorization", async () => {
  const qa = await fixture(() => { throw new Error("No WHOOP call expected"); }, { expired: false });
  try {
    const oldCookies = new Map(qa.cookieJar);
    await qa.whoop.clearWhoopTokens(ACCOUNT);
    for (const [key, value] of oldCookies) qa.cookieJar.set(key, value);
    assert.equal(await qa.loadWhoop().readWhoopTokens(ACCOUNT), null);
    assert.equal(qa.row(), undefined);
    assert.equal(qa.requests.length, 0);
  } finally { qa.sqlite.close(); }
});

test("a refresh finishing after disconnect cannot recreate the connection", async () => {
  const started = deferred(), complete = deferred();
  const qa = await fixture(() => { started.resolve(); return complete.promise; });
  try {
    const refresh = qa.whoop.getValidWhoopAccessToken(ACCOUNT);
    await started.promise;
    await qa.whoop.clearWhoopTokens(ACCOUNT);
    complete.resolve(Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 }));
    assert.equal(await refresh, null);
    assert.equal(qa.row(), undefined);
    assert.equal(await qa.whoop.readWhoopTokens(ACCOUNT), null);
  } finally { qa.sqlite.close(); }
});

test("a stale rejected refresh never clears a newly authorized grant", async () => {
  const started = deferred(), complete = deferred();
  const qa = await fixture(() => { started.resolve(); return complete.promise; });
  try {
    const refresh = qa.whoop.getValidWhoopAccessToken(ACCOUNT);
    await started.promise;
    await qa.whoop.writeWhoopTokens(ACCOUNT, { ...TOKEN, accessToken: "new-session-access", refreshToken: "new-session-refresh", expiresAt: Date.now() + 3_600_000 });
    complete.resolve(new Response("invalid_grant", { status: 400 }));
    assert.equal(await refresh, "new-session-access");
    assert.equal((await qa.whoop.readWhoopTokens(ACCOUNT)).refreshToken, "new-session-refresh");
  } finally { qa.sqlite.close(); }
});

test("concurrent 401 access responses cause one controlled refresh rather than a reauthorization loop", { timeout: 1500 }, async () => {
  const qa = await fixture(({ url, options }) => url.pathname.endsWith("/token")
    ? Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 })
    : options.headers.Authorization === "Bearer initial-access" ? new Response("unauthorized", { status: 401 })
      : Response.json(url.pathname.endsWith("/body") ? {} : { records: [] }), { expired: false });
  try {
    const snapshot = await qa.whoop.getRecentWhoopMetrics(ACCOUNT);
    assert.equal(snapshot.syncStatus, "synced");
    assert.equal(qa.requests.filter(({ url }) => url.pathname.endsWith("/token")).length, 1);
    assert.ok(qa.row());
    assert.equal((await qa.whoop.readWhoopTokens(ACCOUNT)).accessToken, "new-access");
  } finally { qa.sqlite.close(); }
});

test("OAuth client errors and unreadable server ciphertext are not evidence of revoked user consent", async () => {
  const qa = await fixture(() => new Response("invalid_client", { status: 401 }));
  try {
    await assert.rejects(qa.whoop.getValidWhoopAccessToken(ACCOUNT), { code: "WHOOP_REFRESH_FAILED", status: 401 });
    assert.ok(qa.row());
    qa.sqlite.prepare("UPDATE whoop_connections SET token_ciphertext = ? WHERE account_id = ?").run("bad-ciphertext", ACCOUNT);
    await assert.rejects(qa.whoop.readWhoopTokens(ACCOUNT), { code: "WHOOP_TOKEN_UNREADABLE" });
    assert.ok(qa.row());
  } finally { qa.sqlite.close(); }
});
