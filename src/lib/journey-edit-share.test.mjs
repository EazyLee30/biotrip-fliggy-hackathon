import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { loadModule, plain, readProjectFile } from "./test-support/module-loader.mjs";

const ACCOUNT = "11111111-1111-1111-1111-111111111111", OTHER = "22222222-2222-2222-2222-222222222222";
const edit = loadModule("lib/itinerary-edit.ts", { "./planner-input": loadModule("lib/planner-input.ts") });
const shares = loadModule("lib/journey-share.ts", { "./product-image": loadModule("lib/product-image.ts"), "./planning-recommendations": loadModule("lib/planning-recommendations.ts", { "./product-image": loadModule("lib/product-image.ts") }, { URLSearchParams }) });
const DRAFT = { intention: "安静恢复", fatigue: 3, profileMemoryNotes: "私人身体记录", consent: true, trip: {
  originCity: "上海", destinationCity: "杭州", departureDate: "2026-10-03", returnDate: "2026-10-04",
  itineraryText: "2026-10-03 10:00 | 私密预约 | 固定\n2026-10-03 12:00 | 散步 | 灵活",
} };
const PLAN = { source: "live", retrievedAt: "2026-10-03T01:00:00Z", timezone: { shiftMinutes: 0, travelHours: 3 },
  healthContext: { basis: "self_report", provisional: true }, localServices: [],
  provenance: { provider: "managed_agent", requestedAt: "2026-10-03T01:00:00Z", stages: [{ stage: "compose_plan", label: "编排", status: "ok", elapsedMs: 15 }], health: { basis: "self_report", whoopUnavailable: false }, local: { verified: false }, flyai: { searches: 1, failedSearches: 0, failedCategories: [], sourceCount: 1, executor: "agent_skill" }, memory: { applied: false, source: "none", noteCount: 0 } },
  plan: { headline: "自己的杭州", summary: "城市简介", reason: "私人编排原因", adjustments: [],
    itinerary: [{ date: "2026-10-03", time: "10:00", name: "私密预约", detail: "私密地点", fixed: true },
      { date: "2026-10-03", time: "12:00", name: "散步", detail: "原详情", fixed: false },
      { date: "2026-10-03", time: "14:00", name: "喝茶", detail: "茶馆", fixed: false },
      { date: "2026-10-04", time: "09:00", name: "第二天", detail: "第二天详情", fixed: false }],
    places: [{ name: "工具返回商品", category: "景点与体验", reason: "商品推荐原因", source: "飞猪实时搜索", url: "https://h5.m.taobao.com/trip?id=123" }],
  },
};

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  for (const migration of ["0001_accounts.sql", "0002_password_auth.sql", "0003_journeys.sql", "0007_planning_jobs.sql"]) sqlite.exec(readProjectFile(`migrations/${migration}`));
  for (const id of [ACCOUNT, OTHER]) sqlite.prepare("INSERT INTO accounts(id,email) VALUES (?,?)").run(id, `${id}@example.com`);
  const state = { account: ACCOUNT, beforeRun: null };
  const database = { prepare(sql) {
    const statement = sqlite.prepare(sql);
    let values = [];
    return { bind(...args) { values = args; return this; },
      async first() { if (/^UPDATE/.test(sql)) state.beforeRun?.(sql); return statement.get(...values) ?? null; },
      async all() { return { results: statement.all(...values) }; },
      async run() { state.beforeRun?.(sql); const result = statement.run(...values); return { meta: { changes: Number(result.changes) } }; },
    };
  } };
  const auth = { getDatabase: () => database, getCurrentAccount: async () => state.account ? { id: state.account } : null,
    isSameOrigin: (request) => request.headers.get("origin") === new URL(request.url).origin };
  const journeys = loadModule("lib/journeys.ts", { "@/lib/database": auth, "@/lib/preferences": { learnFromDraft: async () => {}, learnFromFeedback: async () => {} }, "@/lib/itinerary-edit": edit });
  const http = loadModule("lib/journey-http.ts", { "next/server": { NextResponse: Response }, "@/lib/auth": auth, "@/lib/journeys": journeys });
  const deps = { "next/server": { NextResponse: Response }, "@/lib/auth": auth, "@/lib/journeys": journeys, "@/lib/journey-http": http, "@/lib/journey-share": shares };
  return { sqlite, state, journeys, api: loadModule("app/api/journeys/[id]/itinerary/route.ts", deps),
    shareApi: loadModule("app/api/share/route.ts", deps), shareIdApi: loadModule("app/api/share/[id]/route.ts", deps) };
}
function request(path, method, body, origin = "https://biotrip.test") {
  return new Request(`https://biotrip.test${path}`, { method, headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const context = (id) => ({ params: Promise.resolve({ id }) });

test("share cover is validated on the server and only approved local artwork reaches the snapshot", async () => {
  const { sqlite, journeys, shareApi } = fixture();
  try {
    const journey = await journeys.saveGeneratedJourney(ACCOUNT, { draft: DRAFT, generated: PLAN });
    const valid = await shareApi.POST(request("/api/share", "POST", { journeyId: journey.id, version: journey.version, schemaVersion: 2, coverAssetId: "coast" }));
    assert.equal(valid.status, 201); assert.equal((await valid.json()).share.coverAssetId, "coast");
    const invalid = await shareApi.POST(request("/api/share", "POST", { journeyId: journey.id, version: journey.version, schemaVersion: 2, coverAssetId: "https://example.com/tracker" }));
    assert.equal(invalid.status, 400);
    assert.equal((await journeys.getJourney(ACCOUNT, journey.id)).version, journey.version);
  } finally { sqlite.close(); }
});

test("manual edit route persists the full plan, fixed and flexible draft reservations, provenance and CAS", async () => {
  const { sqlite, journeys, api } = fixture();
  try {
    let journey = await journeys.saveGeneratedJourney(ACCOUNT, { draft: DRAFT, generated: PLAN });
    const response = await api.PATCH(request(`/api/journeys/${journey.id}/itinerary`, "PATCH", { version: journey.version,
      operations: [{ type: "edit", index: 0, time: "11:37", name: "用户改约" }, { type: "move", index: 1, toIndex: 2 }] }), context(journey.id));
    assert.equal(response.status, 200);
    journey = (await response.json()).journey;
    assert.equal(journey.version, 2); assert.equal(journey.status, "planned"); assert.equal(journey.planCurrent, true);
    assert.deepEqual(journey.plan.provenance, PLAN.provenance); assert.deepEqual(journey.plan.plan.places, PLAN.plan.places);
    assert.equal(journey.plan.retrievedAt, PLAN.retrievedAt); assert.equal(journey.plan.manualAdjustment.revision, 1);
    assert.ok(journey.draft.trip.itineraryText.includes("11:37 | 用户改约 | 固定"));
    assert.ok(journey.draft.trip.itineraryText.includes("14:00 | 散步 | 灵活"));
    assert.deepEqual(plain(await journeys.getJourney(ACCOUNT, journey.id)), journey);
    const stale = await api.PATCH(request(`/api/journeys/${journey.id}/itinerary`, "PATCH", { version: 1, operations: [{ type: "edit", index: 0, name: "stale" }] }), context(journey.id));
    assert.equal(stale.status, 409); assert.equal((await stale.json()).code, "JOURNEY_CHANGED");
  } finally { sqlite.close(); }
});

test("manual save refuses foreign, cross-origin, anonymous, completed, outdated plans and arbitrary plan fields", async () => {
  const { sqlite, state, journeys, api } = fixture();
  try {
    let journey = await journeys.saveGeneratedJourney(ACCOUNT, { draft: DRAFT, generated: PLAN });
    const payload = () => ({ version: journey.version, operations: [{ type: "edit", index: 0, detail: "修改" }] });
    assert.equal((await api.PATCH(request("/api/edit", "PATCH", payload(), "https://other.test"), context(journey.id))).status, 403);
    assert.equal((await api.PATCH(request("/api/edit", "PATCH", payload(), ""), context(journey.id))).status, 403);
    state.account = null;
    assert.equal((await api.PATCH(request("/api/edit", "PATCH", payload()), context(journey.id))).status, 401);
    state.account = OTHER;
    assert.equal((await api.PATCH(request("/api/edit", "PATCH", payload()), context(journey.id))).status, 404);
    state.account = ACCOUNT;
    assert.equal((await api.PATCH(request("/api/edit", "PATCH", { ...payload(), plan: PLAN }), context(journey.id))).status, 400);
    journey = await journeys.updateJourney(ACCOUNT, journey.id, { version: journey.version, status: "active" });
    const active = await api.PATCH(request("/api/edit", "PATCH", payload()), context(journey.id));
    assert.equal(active.status, 200); journey = (await active.json()).journey;
    assert.equal(journey.status, "active");
    journey = await journeys.updateJourney(ACCOUNT, journey.id, { version: journey.version, status: "completed" });
    const complete = await api.PATCH(request("/api/edit", "PATCH", payload()), context(journey.id));
    assert.equal(complete.status, 409); assert.equal((await complete.json()).code, "JOURNEY_COMPLETED");
    let stalePlan = await journeys.saveGeneratedJourney(ACCOUNT, { draft: DRAFT, generated: PLAN });
    stalePlan = await journeys.updateJourney(ACCOUNT, stalePlan.id, { version: stalePlan.version, draft: { ...DRAFT, fatigue: 2 } });
    await assert.rejects(journeys.updateJourneyItinerary(ACCOUNT, stalePlan.id, { version: stalePlan.version, operations: [{ type: "edit", index: 0, detail: "new" }] }), { code: "PLAN_NOT_CURRENT" });
  } finally { sqlite.close(); }
});

test("generation lease blocks editing both before work and if acquired immediately before conditional SQL", async () => {
  const { sqlite, state, journeys } = fixture();
  const limits = loadModule("lib/planning/rate-limit.ts", { "@/lib/database": { getDatabase: () => ({ prepare(sql) {
    const statement = sqlite.prepare(sql); let values = [];
    return { bind(...args) { values = args; return this; }, async first() { if (/^UPDATE/.test(sql)) state.beforeRun?.(sql); return statement.get(...values) ?? null; }, async run() { return { meta: { changes: Number(statement.run(...values).changes) } }; } };
  } }) }, "@/lib/journeys": journeys });
  try {
    const journey = await journeys.saveGeneratedJourney(ACCOUNT, { draft: DRAFT, generated: PLAN });
    const value = { version: journey.version, operations: [{ type: "edit", index: 0, detail: "user" }] };
    const lease = await limits.reservePlanning(ACCOUNT, 60);
    await assert.rejects(journeys.updateJourneyItinerary(ACCOUNT, journey.id, value), { code: "PLANNING_IN_PROGRESS" });
    await lease.release();
    state.beforeRun = (sql) => { if (sql.includes("AND NOT EXISTS")) {
      state.beforeRun = null;
      sqlite.prepare("INSERT INTO auth_rate_limits(limit_key,hit_count,reset_at) VALUES (?,1,unixepoch()+60)")
        .run(createHash("sha256").update(`plan:active:${ACCOUNT}`).digest("hex"));
    } };
    await assert.rejects(journeys.updateJourneyItinerary(ACCOUNT, journey.id, value), { code: "PLANNING_IN_PROGRESS" });
    assert.equal((await journeys.getJourney(ACCOUNT, journey.id)).version, journey.version);
  } finally { sqlite.close(); }
});

test("sharing defaults to a minimal authorized immutable snapshot, explicit itinerary share includes its exact preview", async () => {
  const { sqlite, journeys, shareApi, shareIdApi } = fixture();
  try {
    const journey = await journeys.saveGeneratedJourney(ACCOUNT, { draft: DRAFT, generated: PLAN });
    const result = await shareApi.POST(request("/api/share", "POST", { journeyId: journey.id, version: journey.version }));
    assert.equal(result.status, 201);
    const first = await result.json();
    assert.deepEqual(Object.keys(first.share).sort(), ["destination", "headline", "places", "summary"]);
    assert.ok(!JSON.stringify(first.share).includes("私密预约")); assert.ok(!JSON.stringify(first.share).includes("私人身体记录"));
    const full = await shareApi.POST(request("/api/share", "POST", { journeyId: journey.id, version: journey.version, includeItinerary: true }));
    const second = await full.json();
    assert.equal(full.status, 201); assert.deepEqual(second.share.itinerary, PLAN.plan.itinerary);
    assert.deepEqual(second.share, plain(shares.publicJourneySnapshot(journey, true)));
    await journeys.updateJourneyItinerary(ACCOUNT, journey.id, { version: journey.version, operations: [{ type: "edit", index: 0, name: "后来修改" }] });
    const publicRead = await shareIdApi.GET(request(first.path, "GET"), context(first.path.split("/").pop()));
    assert.equal(publicRead.status, 200); assert.deepEqual((await publicRead.json()).share, first.share);
    const privateList = await shareApi.GET(request("/api/share", "GET"));
    assert.deepEqual((await privateList.json()).shares.map((row) => row.includesItinerary).sort(), [false, true]);
  } finally { sqlite.close(); }
});

test("share rejects client-supplied snapshots, foreign and stale versions, invalid consent and a concurrent edit", async () => {
  const { sqlite, state, journeys, shareApi } = fixture();
  try {
    const journey = await journeys.saveGeneratedJourney(ACCOUNT, { draft: DRAFT, generated: PLAN });
    const value = { journeyId: journey.id, version: journey.version };
    for (const body of [{ trip: DRAFT.trip, plan: PLAN.plan }, { ...value, includeItinerary: "true" }, { ...value, draft: DRAFT }, { ...value, version: 999 }]) {
      assert.ok([400, 409].includes((await shareApi.POST(request("/api/share", "POST", body))).status));
    }
    state.account = OTHER;
    assert.equal((await shareApi.POST(request("/api/share", "POST", value))).status, 404);
    state.account = ACCOUNT;
    state.beforeRun = (sql) => { if (sql.includes("INSERT INTO trip_shares")) { state.beforeRun = null; sqlite.prepare("UPDATE journeys SET version=version+1 WHERE id=?").run(journey.id); } };
    const race = await shareApi.POST(request("/api/share", "POST", value));
    assert.equal(race.status, 409); assert.equal(sqlite.prepare("SELECT count(*) AS count FROM trip_shares").get().count, 0);
  } finally { sqlite.close(); }
});

test("public snapshot excludes credential-bearing and internal links", () => {
  const unsafe = ["https://user:secret@example.com/", "https://localhost/a", "https://127.0.0.1/a", "https://[::1]/a", "https://example.com/?token=private", "https://example.com/#access_token=private", "https://host.internal/a", "http://example.com/a"];
  const journey = { draft: DRAFT, planCurrent: true, plan: { ...PLAN, plan: { ...PLAN.plan, places: [...PLAN.plan.places, ...unsafe.map((url) => ({ ...PLAN.plan.places[0], url }))] } } };
  const result = shares.publicJourneySnapshot(journey);
  assert.equal(result.places.length, 1); assert.equal(result.places[0].url, PLAN.plan.places[0].url);
});

test("v2 public snapshot omits private summary, fixed appointments, dates and details unless explicitly chosen", () => {
  const journey = { draft: DRAFT, planCurrent: true, plan: { ...PLAN, plan: { ...PLAN.plan, headline: "因为身体疲劳而调整", summary: "私人身体感受" } } };
  const options = shares.DEFAULT_SHARE_OPTIONS;
  const minimal = shares.publicJourneySnapshot(journey, options);
  assert.equal(minimal.schemaVersion, 2); assert.equal(minimal.headline, "杭州旅行札记"); assert.equal(minimal.summary, "");
  assert.equal(minimal.days, undefined);
  const daily = shares.publicJourneySnapshot(journey, { ...options, includeItinerary: true });
  assert.ok(!JSON.stringify(daily).includes("私密"));
  assert.ok(!JSON.stringify(daily).includes("2026-10-03"));
  assert.equal(daily.days[0].items[0].detail, undefined);
  const all = shares.publicJourneySnapshot(journey, { ...options, includeItinerary: true, includeSummary: true, includeFixed: true, includeActivityDetails: true, includeExactDates: true });
  assert.equal(all.days[0].items[0].detail, "私密地点"); assert.equal(all.days[0].date, "2026-10-03");
  assert.equal(all.summary, "私人身体感受");
  const onlyFixedDay = { ...journey, plan: { ...PLAN, plan: { ...PLAN.plan, itinerary: [PLAN.plan.itinerary[0], PLAN.plan.itinerary[3]] } } };
  assert.equal(shares.publicJourneySnapshot(onlyFixedDay, { ...options, includeItinerary: true }).days[0].dayIndex, 2);
});

test("v2 share route stores the exact preview and rejects invalid option types", async () => {
  const { sqlite, journeys, shareApi, shareIdApi } = fixture();
  try {
    const journey = await journeys.saveGeneratedJourney(ACCOUNT, { draft: DRAFT, generated: PLAN });
    const options = { ...shares.DEFAULT_SHARE_OPTIONS, includeItinerary: true };
    const response = await shareApi.POST(request("/api/share", "POST", { journeyId: journey.id, version: journey.version, ...options }));
    assert.equal(response.status, 201);
    const result = await response.json();
    const publicResponse = await shareIdApi.GET(request(result.path, "GET"), context(result.path.split("/").at(-1)));
    assert.deepEqual((await publicResponse.json()).share, plain(shares.publicJourneySnapshot(journey, options)));
    const invalid = await shareApi.POST(request("/api/share", "POST", { journeyId: journey.id, version: journey.version, ...options, includeFixed: "yes" }));
    assert.equal(invalid.status, 400);
  } finally { sqlite.close(); }
});

test("licensed destination cover is accepted for its location and rejects a different destination", async () => {
  const { sqlite, journeys, shareApi } = fixture();
  try {
    const hangzhou=await journeys.saveGeneratedJourney(ACCOUNT,{draft:DRAFT,generated:PLAN});
    const accepted=await shareApi.POST(request('/api/share','POST',{journeyId:hangzhou.id,version:hangzhou.version,schemaVersion:2,coverAssetId:'hangzhou-broken-bridge'}));
    assert.equal(accepted.status,201);assert.equal((await accepted.json()).share.coverAssetId,'hangzhou-broken-bridge');
    const other=await journeys.saveGeneratedJourney(ACCOUNT,{draft:{...DRAFT,trip:{...DRAFT.trip,destinationCity:'北京'}},generated:PLAN});
    const rejected=await shareApi.POST(request('/api/share','POST',{journeyId:other.id,version:other.version,schemaVersion:2,coverAssetId:'hangzhou-broken-bridge'}));
    assert.equal(rejected.status,400);
  } finally {sqlite.close();}
});

test('magazine share validates titles and selections and keeps long private detail opt-in', async () => {
  const { sqlite, journeys, shareApi } = fixture();
  try {
    const journey = await journeys.saveGeneratedJourney(ACCOUNT, { draft: DRAFT, generated: PLAN });
    const base = { journeyId: journey.id, version: journey.version, ...shares.DEFAULT_SHARE_OPTIONS };
    const selected = journey.plan.plan.places[0].url;
    const options = { ...base, title: '沿途慢慢走', selectedPlaceUrls: [selected] };
    const response = await shareApi.POST(request('/api/share', 'POST', options));
    assert.equal(response.status, 201);
    const { share } = await response.json();
    assert.equal(share.headline, '沿途慢慢走');
    assert.equal(share.template, 'postcard');
    assert.equal(share.journeyVersion, journey.version);
    assert.deepEqual(share.places.map(place => place.url), [selected]);
    assert.ok(!JSON.stringify(share).includes('私密预约'));
    assert.equal(shares.publicJourneySnapshot(journey, { ...shares.DEFAULT_SHARE_OPTIONS, includeItinerary: true }).template, 'journal');
    for (const patch of [{ title: '长'.repeat(41) }, { title: '两行\n标题' }, { template: 'unknown' }, { selectedPlaceUrls: ['https://example.com/foreign'] }]) {
      assert.equal((await shareApi.POST(request('/api/share', 'POST', { ...base, ...patch }))).status, 400);
    }
  } finally { sqlite.close(); }
});

test('activity sources can bind only to this journey inventory and stay private in shares', async () => {
  const { sqlite, journeys } = fixture();
  try {
    const journey = await journeys.saveGeneratedJourney(ACCOUNT, { draft: DRAFT, generated: PLAN });
    const operation = { type: 'add', date: DRAFT.trip.departureDate, time: '11:30', name: '已检索的地点', detail: '关联原始来源', fixed: false, sourceUrl: journey.plan.plan.places[0].url };
    const updated = await journeys.updateJourneyItinerary(ACCOUNT, journey.id, { version: journey.version, operations: [operation] });
    assert.equal(updated.plan.plan.itinerary.find(item => item.name === operation.name).sourceUrl, operation.sourceUrl);
    assert.ok(shares.publicJourneySnapshot(updated, true).itinerary.every(item => !('sourceUrl' in item)));
    await assert.rejects(journeys.updateJourneyItinerary(ACCOUNT, journey.id, { version: updated.version, operations: [{ ...operation, time: '11:40', sourceUrl: 'https://example.com/foreign' }] }));
  } finally { sqlite.close(); }
});

test("share images are opt-in, use only saved records and reject foreign selections", async () => {
  const { sqlite, journeys, shareApi } = fixture();
  const image = { name: "西湖", url: "https://a.feizhu.com/poi/1", imageUrl: "https://img.alicdn.com/westlake.jpg", kind: "poi" };
  try {
    const journey = await journeys.saveGeneratedJourney(ACCOUNT, { draft: DRAFT, generated: { ...PLAN, visuals: { cover: [image], images: {} } } });
    assert.equal(shares.publicJourneySnapshot(journey, shares.DEFAULT_SHARE_OPTIONS).coverImages, undefined);
    const selected = shares.publicJourneySnapshot(journey, { ...shares.DEFAULT_SHARE_OPTIONS, selectedCoverUrls: [image.url] });
    assert.equal(selected.coverImages[0].imageUrl, image.imageUrl);
    const payload = { journeyId: journey.id, version: journey.version, schemaVersion: 2, selectedCoverUrls: ["https://a.feizhu.com/poi/foreign"] };
    assert.equal((await shareApi.POST(request("/api/share", "POST", payload))).status, 400);
    const published = await shareApi.POST(request("/api/share", "POST", { ...payload, selectedCoverUrls: [image.url] }));
    assert.equal(published.status, 201); assert.equal((await published.json()).share.coverImages[0].name, "西湖");
    const invalid = { ...journey, plan: { ...journey.plan, visuals: { cover: [{ ...image, imageUrl: "https://evil.example/image" }] } } };
    assert.equal(shares.publicJourneySnapshot(invalid, { ...shares.DEFAULT_SHARE_OPTIONS, selectedCoverUrls: [image.url] }).coverImages, undefined);
  } finally { sqlite.close(); }
});
