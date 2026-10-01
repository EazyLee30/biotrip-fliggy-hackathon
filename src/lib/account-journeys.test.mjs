import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { loadModule, plain, readProjectFile } from "./test-support/module-loader.mjs";

const ACCOUNT = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const MIGRATIONS = [
  "0001_accounts.sql", "0002_password_auth.sql", "0003_journeys.sql",
  "0004_whoop_connections.sql", "0005_learned_preferences.sql", "0006_preference_kinds.sql",
];

function storage() {
  const sqlite = new DatabaseSync(":memory:");
  for (const migration of MIGRATIONS) {
    sqlite.exec(readProjectFile(`migrations/${migration}`));
  }
  sqlite.prepare("INSERT INTO accounts(id,email) VALUES (?,?)").run(ACCOUNT, "traveler@example.com");
  sqlite.prepare("INSERT INTO accounts(id,email) VALUES (?,?)").run(OTHER, "other@example.com");
  const database = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        async first() { return statement.get(...values) ?? null; },
        async all() { return { results: statement.all(...values) }; },
        async run() { const result = statement.run(...values); return { meta: { changes: Number(result.changes) } }; },
      };
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec("COMMIT"); return results; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  return { sqlite, database };
}
function fixture() {
  const { database, sqlite } = storage();
  // The real preference module runs against the same database so learning is
  // exercised end to end rather than stubbed away.
  const preferences = loadModule("lib/preferences.ts", { "@/lib/auth": { getDatabase: () => database } });
  const journeys = loadModule("lib/journeys.ts", { "@/lib/auth": { getDatabase: () => database }, "@/lib/preferences": preferences });
  return { journeys, preferences, sqlite };
}
const DRAFT = {
  intention: "安静恢复", colorTone: "松林绿", consent: true,
  trip: { originCity: "上海", destinationCity: "京都", departureDate: "2026-10-12", departureTimezone: "Asia/Shanghai", destinationTimezone: "Asia/Tokyo", returnDate: "2026-10-14", planningStyle: "flexible" },
};
const PLAN = {
  source: "live", retrievedAt: "2026-10-01T11:00:00Z", timezone: { shiftMinutes: 60, travelHours: 3 },
  healthContext: { basis: "preferences_only", provisional: true }, localServices: [],
  plan: { headline: "留白的京都", summary: "休息后再出发", reason: "旅途留白", adjustments: [], itinerary: [{ date: "2026-10-12", time: "16:00", name: "入住", detail: "保留预约", fixed: true }], places: [] },
};

test("journeys are isolated by account and reject unverified client plans", async () => {
  const { journeys, sqlite } = fixture();
  try {
    const created = await journeys.createJourney(ACCOUNT, { draft: DRAFT });
    await assert.rejects(journeys.getJourney(OTHER, created.id), (error) => error.code === "JOURNEY_NOT_FOUND");
    await assert.rejects(journeys.updateJourney(OTHER, created.id, { version: 1, title: "窃取" }), (error) => error.code === "JOURNEY_NOT_FOUND");
    await assert.rejects(journeys.createJourney(ACCOUNT, { draft: DRAFT, plan: PLAN }), (error) => error.code === "INVALID_JOURNEY");
    assert.equal((await journeys.listJourneys(OTHER)).length, 0);
  } finally { sqlite.close(); }
});

test("trip lifecycle persists the plan, feedback, opt-in memory and completion", async () => {
  const { journeys, sqlite } = fixture();
  try {
    let journey = await journeys.createJourney(ACCOUNT, { draft: DRAFT });
    await assert.rejects(journeys.updateJourney(ACCOUNT, journey.id, { version: 1, status: "active" }), (error) => error.code === "INVALID_JOURNEY_TRANSITION");
    journey = await journeys.saveGeneratedJourney(ACCOUNT, { journeyId: journey.id, expectedVersion: journey.version, draft: DRAFT, generated: PLAN });
    assert.equal(journey.status, "planned"); assert.equal(journey.planCurrent, true);
    assert.equal(journey.plan.plan.itinerary[0].date, "2026-10-12");
    journey = await journeys.updateJourney(ACCOUNT, journey.id, { version: journey.version, status: "active" });
    assert.ok(journey.startedAt);
    const recorded = await journeys.recordJourneyFeedback(ACCOUNT, journey.id, { version: journey.version, fatigue: 3, note: "午休后舒服了", remember: true, memoryNote: "抵达当天留出午休" });
    journey = recorded.journey;
    assert.equal(recorded.remembered, true);
    assert.equal((await journeys.listJourneyMemories(ACCOUNT))[0].note, "抵达当天留出午休");
    assert.equal((await journeys.listJourneyFeedback(ACCOUNT, journey.id))[0].remembered, true);
    assert.equal((await journeys.listJourneyMemories(OTHER)).length, 0);
    journey = await journeys.updateJourney(ACCOUNT, journey.id, { version: journey.version, status: "completed" });
    assert.ok(journey.completedAt);
    await assert.rejects(journeys.saveGeneratedJourney(ACCOUNT, { journeyId: journey.id, expectedVersion: journey.version, draft: DRAFT, generated: PLAN }), (error) => error.code === "JOURNEY_COMPLETED");
    const memory = (await journeys.listJourneyMemories(ACCOUNT))[0];
    await assert.rejects(journeys.forgetJourneyMemory(OTHER, memory.id), (error) => error.code === "MEMORY_NOT_FOUND");
    await journeys.forgetJourneyMemory(ACCOUNT, memory.id);
    assert.equal((await journeys.listJourneyFeedback(ACCOUNT, journey.id))[0].remembered, false);
    assert.equal((await journeys.listJourneyMemories(ACCOUNT)).length, 0);
  } finally { sqlite.close(); }
});

test("edited drafts retain historical plans but cannot start until regenerated", async () => {
  const { journeys, sqlite } = fixture();
  try {
    let journey = await journeys.saveGeneratedJourney(ACCOUNT, { draft: DRAFT, generated: PLAN });
    const originalVersion = journey.version;
    journey = await journeys.updateJourney(ACCOUNT, journey.id, { version: originalVersion, draft: { ...DRAFT, intention: "慢慢探索" } });
    assert.equal(journey.status, "draft"); assert.equal(journey.planCurrent, false); assert.ok(journey.plan);
    await assert.rejects(journeys.updateJourney(ACCOUNT, journey.id, { version: journey.version, status: "active" }), (error) => error.code === "INVALID_JOURNEY_TRANSITION");
    await assert.rejects(journeys.saveGeneratedJourney(ACCOUNT, { journeyId: journey.id, expectedVersion: originalVersion, draft: DRAFT, generated: PLAN }), (error) => error.code === "JOURNEY_CHANGED");
    assert.equal((await journeys.getJourney(ACCOUNT, journey.id)).draft.intention, "慢慢探索");
  } finally { sqlite.close(); }
});

test("stale feedback has no partial feedback or memory writes", async () => {
  const { journeys, sqlite } = fixture();
  try {
    let journey = await journeys.saveGeneratedJourney(ACCOUNT, { draft: DRAFT, generated: PLAN });
    journey = await journeys.updateJourney(ACCOUNT, journey.id, { version: journey.version, status: "active" });
    await journeys.recordJourneyFeedback(ACCOUNT, journey.id, { version: journey.version, fatigue: 2 });
    await assert.rejects(journeys.recordJourneyFeedback(ACCOUNT, journey.id, { version: journey.version, fatigue: 4, remember: true, memoryNote: "休息" }), (error) => error.code === "JOURNEY_CHANGED");
    assert.equal((await journeys.listJourneyFeedback(ACCOUNT, journey.id)).length, 1);
    assert.equal((await journeys.listJourneyMemories(ACCOUNT)).length, 0);
    assert.throws(() => journeys.parseFeedback({ version: 1, note: "反馈", memoryNote: "未同意保存" }), (error) => error.code === "INVALID_JOURNEY");
    assert.throws(() => journeys.parseJourneyDraft({ trip: { departureDate: "2026-02-30" } }), (error) => error.code === "INVALID_JOURNEY");
  } finally { sqlite.close(); }
});

test("repeated choices become remembered preferences and one-off choices do not", async () => {
  const { journeys, preferences, sqlite } = fixture();
  try {
    const first = await journeys.createJourney(ACCOUNT, {
      draft: { ...DRAFT, trip: { ...DRAFT.trip, planningStyle: "structured", foodPreferences: "素食" } },
    });
    // A single choice is recorded but must not silently become a default.
    let defaults = preferences.preferenceDefaults(await preferences.listLearnedPreferences(ACCOUNT));
    assert.equal(defaults.established, false);
    assert.equal(defaults.planningStyle, undefined);

    await journeys.createJourney(ACCOUNT, {
      draft: { ...DRAFT, trip: { ...DRAFT.trip, planningStyle: "structured", foodPreferences: "素食" } },
    });
    defaults = preferences.preferenceDefaults(await preferences.listLearnedPreferences(ACCOUNT));
    assert.equal(defaults.established, true);
    assert.equal(defaults.planningStyle, "structured");
    assert.equal(defaults.foodPreferences, "素食");
    assert.deepEqual(plain(defaults.destinations), ["京都"]);

    // Preferences are per account and individually forgettable.
    const otherDefaults = preferences.preferenceDefaults(await preferences.listLearnedPreferences(OTHER));
    assert.equal(otherDefaults.established, false);
    assert.deepEqual(plain(otherDefaults.notes), []);
    assert.deepEqual(plain(otherDefaults.destinations), []);
    const rows = await preferences.listLearnedPreferences(ACCOUNT);
    await preferences.forgetLearnedPreference(ACCOUNT, rows[0].id);
    assert.ok((await preferences.listLearnedPreferences(ACCOUNT)).length < rows.length);
    assert.ok(first.id);
  } finally { sqlite.close(); }
});

test("in-trip fatigue teaches a slower default for later trips", async () => {
  const { journeys, preferences, sqlite } = fixture();
  try {
    let journey = await journeys.saveGeneratedJourney(ACCOUNT, { draft: DRAFT, generated: PLAN });
    journey = await journeys.updateJourney(ACCOUNT, journey.id, { version: journey.version, status: "active" });
    await journeys.recordJourneyFeedback(ACCOUNT, journey.id, { version: journey.version, fatigue: 5, subjectiveStress: 4 });
    await journeys.recordJourneyFeedback(ACCOUNT, journey.id, { version: journey.version + 1, fatigue: 4 });
    const defaults = preferences.preferenceDefaults(await preferences.listLearnedPreferences(ACCOUNT));
    assert.ok(defaults.notes.some((note) => note.includes("抵达当天优先留出休息")));
    assert.ok(defaults.notes.some((note) => note.includes("疲惫时倾向放慢节奏")));
  } finally { sqlite.close(); }
});

/** Loads the real rate-limit module against an in-memory database. */
function rateLimit(database) {
  return loadModule("lib/planning/rate-limit.ts", {
    "@/lib/auth": { getDatabase: () => database },
    "@/lib/journeys": loadModule("lib/journeys.ts", {
      "@/lib/auth": { getDatabase: () => database },
      "@/lib/preferences": loadModule("lib/preferences.ts", { "@/lib/auth": { getDatabase: () => database } }),
    }),
  });
}

test("a draft carries dates only; clock times are never collected or stored", async () => {
  const { journeys, sqlite } = fixture();
  try {
    const created = await journeys.createJourney(ACCOUNT, { draft: DRAFT });
    assert.deepEqual(Object.keys(created.draft.trip).sort(), [
      "departureDate", "departureTimezone", "destinationCity", "destinationTimezone",
      "originCity", "planningStyle", "returnDate",
    ].sort());
    // A precise time would mean the interface asked for something it should not.
    assert.throws(() => journeys.parseJourneyDraft({ trip: { departureLocal: "2026-10-12T10:00" } }), (error) => error.code === "INVALID_JOURNEY");
    // A draft may be mid-edit, so an inverted range is stored rather than lost;
    // the strict rule belongs at generation time.
    assert.ok(journeys.parseJourneyDraft({ trip: { ...DRAFT.trip, returnDate: "2026-10-01" } }));
  } finally { sqlite.close(); }
});

test("generation refuses an inverted or missing date range", () => {
  const { validateInput, localDateTimeAt, ASSUMED_DEPARTURE_HOUR, ASSUMED_ARRIVAL_HOUR } =
    loadModule("lib/planner-input.ts");
  const base = {
    intention: "安静恢复", colorTone: "未指定", fatigue: null, subjectiveStress: null,
    ambientPreferences: [], profileMemoryNotes: "", consent: true,
    trip: {
      originCity: "上海", destinationCity: "京都", departureDate: "2026-10-12",
      departureTimezone: "Asia/Shanghai", destinationTimezone: "Asia/Tokyo",
      returnDate: "2026-10-14", planningStyle: "flexible", itineraryText: "", requestedServices: [], foodPreferences: "",
    },
  };
  assert.ok(validateInput(base));
  assert.equal(validateInput({ ...base, trip: { ...base.trip, returnDate: "2026-10-01" } }), null);
  assert.equal(validateInput({ ...base, trip: { ...base.trip, departureDate: "" } }), null);
  assert.equal(validateInput({ ...base, trip: { ...base.trip, departureDate: "2026-10-32" } }), null);
  // Times are derived, never supplied.
  assert.equal(localDateTimeAt("2026-10-12", ASSUMED_DEPARTURE_HOUR), "2026-10-12T09:00");
  assert.equal(localDateTimeAt("2026-10-12", ASSUMED_ARRIVAL_HOUR), "2026-10-12T15:00");
});

test("planning allows one concurrent run per account and releases its lease", async () => {
  const { database, sqlite } = storage();
  const { reservePlanning } = rateLimit(database);
  try {
    const lease = await reservePlanning(ACCOUNT, 600, database);
    await assert.rejects(reservePlanning(ACCOUNT, 600, database), (error) => error.code === "PLANNING_IN_PROGRESS");
    const other = await reservePlanning(OTHER, 600, database);
    await other.release();
    await lease.release();
    const again = await reservePlanning(ACCOUNT, 600, database);
    await again.release();
  } finally { sqlite.close(); }
});

test("the hourly planning ceiling is enforced and a rejected attempt releases its lease", async () => {
  const { database, sqlite } = storage();
  const { reservePlanning, PLANNING_HOURLY_LIMIT } = rateLimit(database);
  try {
    for (let index = 0; index < PLANNING_HOURLY_LIMIT; index += 1) {
      const lease = await reservePlanning(ACCOUNT, 600, database);
      await lease.release();
    }
    await assert.rejects(reservePlanning(ACCOUNT, 600, database), (error) => error.code === "PLANNING_RATE_LIMIT");
    // A rejected attempt must not leave the concurrency lease held.
    const next = await reservePlanning(OTHER, 600, database);
    await next.release();
  } finally { sqlite.close(); }
});

test("widening the preference kinds keeps existing rows and allows the new ones", () => {
  const { database, sqlite } = storage();
  try {
    // A row written under the old allowlist must survive the rebuild.
    sqlite.prepare("INSERT INTO learned_preferences(id,account_id,kind,value,label,hits) VALUES(?,?,?,?,?,?)")
      .run("legacy-1", ACCOUNT, "rhythm", "flexible", "留白探索", 2).run?.();
    const { preferences } = (() => ({
      preferences: loadModule("lib/preferences.ts", { "@/lib/auth": { getDatabase: () => database } }),
    }))();
    const existing = sqlite.prepare("SELECT kind, label, hits FROM learned_preferences WHERE id='legacy-1'").get();
    assert.deepEqual({ kind: existing.kind, label: existing.label, hits: existing.hits }, {
      kind: "rhythm", label: "留白探索", hits: 2,
    });
    assert.throws(() => sqlite.prepare("INSERT INTO learned_preferences(id,account_id,kind,value,label) VALUES(?,?,?,?,?)")
      .run("bad", ACCOUNT, "nonsense", "x", "x"), /CHECK|constraint/i);
    assert.ok(preferences.PREFERENCE_KINDS.includes("pace"));
    assert.ok(preferences.PREFERENCE_KINDS.includes("guardrail"));
  } finally { sqlite.close(); }
});

test("verified accounts set one first password, then use passwords without more email codes", async () => {
  const { database, sqlite } = storage();
  const cookies = { get: () => undefined };
  const auth = loadModule("lib/auth.ts", { "cloudflare:workers": { env: { BIOTRIP_DB: database } }, "next/headers": { cookies: async () => cookies } });
  const account = { id: ACCOUNT, email: "traveler@example.com", display_name: "", has_password: false };
  try {
    const initial = await auth.setInitialPassword(account, "a quiet journey 2026");
    assert.ok(initial?.token); assert.equal(initial.account.has_password, true);
    assert.equal(await auth.setInitialPassword(account, "an attacker replacement"), null);
    assert.equal(await auth.signInWithPassword(account.email, "an attacker replacement"), null);
    const loggedIn = await auth.signInWithPassword(account.email, "a quiet journey 2026");
    assert.ok(loggedIn?.token);
    const record = sqlite.prepare("SELECT password_hash FROM account_passwords WHERE account_id=?").get(ACCOUNT);
    assert.ok(!record.password_hash.includes("quiet journey"));
    assert.equal(auth.safeAuthNext("//example.com"), "/");
    assert.equal(auth.safeAuthNext("/\\example.com"), "/");
    assert.equal(auth.safeAuthNext("/?view=create"), "/?view=create");
  } finally { sqlite.close(); }
});
