import assert from "node:assert/strict";
import { test } from "node:test";
import { planEventStream } from "./plan-response.ts";

test("long-running generation emits immediate connection, heartbeats, progress and the original result", async () => {
  const request = new AbortController();
  const result = { source: "live", plan: { adjustments: [] } };
  let complete;
  let aborts = 0;
  const pending = new Promise((resolve) => { complete = resolve; });
  const response = planEventStream(async (progress) => {
    progress({ stage: "local_info", message: "正在检索目的地" });
    await pending;
    progress({ stage: "flyai_planning" });
    return Response.json(result);
  }, () => { aborts += 1; complete(); }, request.signal, 10);
  assert.equal(response.headers.get("Content-Type"), "text/event-stream; charset=utf-8");
  assert.match(response.headers.get("Cache-Control"), /no-store/);
  const reader = response.body.getReader();
  const first = await reader.read();
  assert.equal(new TextDecoder().decode(first.value), ": connected\n\n");
  let text = "";
  const deadline = setTimeout(() => request.abort(), 5000);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
      if ((text.match(/: keepalive/g) ?? []).length >= 2) complete();
    }
  } finally {
    clearTimeout(deadline);
    complete();
    request.abort();
  }
  assert.equal(aborts, 0, "completed generation must not be cancelled");
  assert.ok((text.match(/: keepalive/g) ?? []).length >= 2);
  assert.match(text, /event: progress\ndata: {"stage":"local_info","message":"正在检索目的地"}/);
  assert.match(text, /event: result/);
  const last = text.trim().split("\n\n").at(-1);
  assert.deepEqual(JSON.parse(last.split("\ndata: ")[1]), result);
});

test("a generation failure keeps the diagnostic payload in an error event", async () => {
  const failure = { error: "请求失败", diagnostic: { stage: "local_info", code: "AccessDenied", status: 403 } };
  const response = planEventStream(async () => Response.json(failure, { status: 502 }), () => {}, new AbortController().signal);
  const text = await response.text();
  assert.match(text, /event: error/);
  assert.ok(!text.includes("event: result"));
  assert.deepEqual(JSON.parse(text.trim().split("\ndata: ")[1]), failure);
});

test("cancelling the response aborts upstream work and allows its finally cleanup", async () => {
  const request = new AbortController();
  const upstream = new AbortController();
  let cleanedUp = false;
  let settle;
  const cleanup = new Promise((resolve) => { settle = resolve; });
  const response = planEventStream(async () => {
    try {
      await new Promise((_, reject) => upstream.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    } finally {
      cleanedUp = true;
      settle();
    }
    return Response.json({});
  }, () => upstream.abort(), request.signal);
  const reader = response.body.getReader();
  await reader.read();
  await reader.cancel();
  await cleanup;
  assert.equal(upstream.signal.aborted, true);
  assert.equal(cleanedUp, true);
});

test("request disconnection closes the stream and cancels pending generation", async () => {
  const request = new AbortController();
  let aborts = 0;
  let settle;
  const pending = new Promise((resolve) => { settle = resolve; });
  const response = planEventStream(async () => {
    await pending;
    return Response.json({ source: "live" });
  }, () => { aborts += 1; settle(); }, request.signal);
  const reader = response.body.getReader();
  await reader.read();
  request.abort();
  assert.equal((await reader.read()).done, true);
  assert.equal(aborts, 1);
});

test("already disconnected requests never start planning", async () => {
  const request = new AbortController();
  request.abort();
  let calls = 0;
  const response = planEventStream(async () => { calls += 1; return Response.json({}); }, () => {}, request.signal);
  assert.equal(await response.text(), "");
  assert.equal(calls, 0);
});

test("recommendations arrive before the completed result and the event contains only public fields", async () => {
  const batch = { stage: "flyai_inventory", destination: "杭州", retrievedAt: "2026-10-03T09:00:00.000Z", items: [{ name: "真实工具商品", category: "景点与体验", reason: "公开说明", source: "飞猪实时搜索", url: "https://example.com/item", healthMetrics: "must not leak" }], accountId: "private-account" };
  let complete;
  const pending = new Promise((resolve) => { complete = resolve; });
  const response = planEventStream(async (progress, recommendations) => {
    progress({ stage: "flyai_inventory", status: "ok" });
    recommendations(batch);
    await pending;
    return Response.json({ source: "live" });
  }, complete, new AbortController().signal);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (!text.includes("event: recommendations")) {
    const next = await reader.read();
    assert.equal(next.done, false);
    text += decoder.decode(next.value);
  }
  assert.ok(!text.includes("event: result"), "preview is delivered while composition is still pending");
  assert.ok(!text.includes("must not leak"));
  assert.ok(!text.includes("private-account"));
  complete();
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    text += decoder.decode(next.value);
  }
  assert.ok(text.indexOf("event: recommendations") < text.indexOf("event: result"));
  assert.match(text, /真实工具商品/);
});

test("a cancelled stream ignores any subsequent recommendation callback", async () => {
  const request = new AbortController();
  let push, complete;
  const pending = new Promise((resolve) => { complete = resolve; });
  const response = planEventStream(async (_progress, recommendations) => {
    push = recommendations;
    await pending;
    return Response.json({});
  }, complete, request.signal);
  const reader = response.body.getReader();
  await reader.read();
  request.abort();
  assert.doesNotThrow(() => push({ stage: "flyai_inventory", destination: "杭州", retrievedAt: "2026-10-03T09:00:00.000Z", items: [{ name: "返回较晚商品", category: "景点", reason: "公开说明", source: "飞猪", url: "https://example.com/item" }] }));
  assert.equal((await reader.read()).done, true);
});
