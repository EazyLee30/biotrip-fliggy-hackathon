import assert from "node:assert/strict";
import { test } from "node:test";
import { loadModule, plain } from "../test-support/module-loader.mjs";

const contract = loadModule("lib/planning/contract.ts");
const stages = loadModule("lib/planning/stages.ts");
const recommendationHelpers = loadModule("lib/planning-recommendations.ts", { "./product-image": loadModule("lib/product-image.ts") }, { URLSearchParams });
const health = { basis: "self_report", walkingPace: "reduced", breakFrequency: "frequent", sensoryFilters: [] };
const local = { services: [{ name: "已核验资料", kind: "local_food", detail: "Agent 组织的资料", source: "Agent 组织的名称", sourceUrl: "https://example.com/local" }], searches: 1, unverifiedCount: 1 };
const inventory = { sources: [{ name: "已检索商品", url: "https://example.com/item", category: "景点与体验", price: null }], searches: 1, failedSearches: 0, failedCategories: [], executor: "agent_skill" };
const plan = { headline: "测试", summary: "测试", reason: "测试", adjustments: [], itinerary: [], places: [] };
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
function setup(overrides = {}, services = ["attractions", "local_food"], catalogue = async () => ({ sources: [] })) {
  const calls = [], progress = [], recommendations = [];
  const provider = {
    id: "managed_agent", assertConfigured() {},
    async healthInsight() { calls.push("health"); return health; },
    async localResearch() { calls.push("local"); return local; },
    async flyaiInventory() { calls.push("inventory"); return inventory; },
    async composePlan(ctx, gathered) { calls.push({ ctx, gathered }); return plan; },
    ...overrides,
  };
  const { runPlanning } = loadModule("lib/planning/pipeline.ts", {
    "@/lib/whoop-core": { readWhoopTokens: async () => null },
    "@/lib/planning-recommendations": recommendationHelpers,
    "./contract": contract, "./stages": stages,
    "../destination-visuals": { destinationVisuals: catalogue },
    "./providers": { resolvePlanningProvider: () => provider },
  });
  const controller = new AbortController();
  const request = {
    accountId: "qa", input: { trip: { requestedServices: services, destinationCity: "杭州" }, fatigue: 4, subjectiveStress: null, intention: "安静", profileMemoryNotes: "坐着看风景", ambientPreferences: [] },
    timing: {}, fixedItems: [], includeWhoop: false, isNearOrOngoingTrip: true,
    requestId: "test", signal: controller.signal, progress: (event) => progress.push(event),
    recommendations: (event) => recommendations.push(event),
    memory: { applied: false, source: "none", noteCount: 0 },
  };
  return { calls, progress, recommendations, request, controller, run: () => runPlanning(request) };
}

test("all independent stages start before any completes, then compose sees every gathered result", async () => {
  const gates = [deferred(), deferred(), deferred()], started = [];
  const qa = setup({
    async healthInsight() { started.push("health"); await gates[0].promise; return health; },
    async localResearch() { started.push("local"); await gates[1].promise; return local; },
    async flyaiInventory() { started.push("inventory"); await gates[2].promise; return inventory; },
  });
  const result = qa.run();
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(started.sort(), ["health", "inventory", "local"]);
  assert.equal(qa.calls.length, 0);
  gates.forEach((gate) => gate.resolve());
  const outcome = await result;
  assert.deepEqual(plain(qa.calls[0].gathered), { health, local, inventory, pois: [] });
  assert.equal(qa.calls[0].ctx.input.selfReport.fatigue, 4);
  assert.equal(qa.calls[0].ctx.input.preferences.savedMemory, "坐着看风景");
  assert.equal(outcome.provenance.local.verified, true);
  assert.equal(outcome.provenance.local.unverifiedCount, 1);
  assert.equal(outcome.provenance.stages.find((stage) => stage.stage === "local_research").status, "degraded");
});

test("unrequested local research does not call a model and advisory failure retains inventory", async () => {
  const qa = setup({ async healthInsight() { throw new Error("upstream unavailable"); } }, ["attractions"]);
  const outcome = await qa.run();
  assert.equal(qa.calls.includes("local"), false);
  assert.equal(outcome.health, null);
  assert.equal(outcome.inventory, inventory);
  assert.deepEqual(plain(outcome.provenance.stages.map(({ status }) => status)), ["degraded", "skipped", "ok", "ok", "ok"]);
});

test("required inventory failure cancels siblings and prevents composition", async () => {
  const cancelled = [];
  const waiting = (name) => ({ signal }) => new Promise((resolve, reject) => {
    const stop = () => { cancelled.push(name); reject(signal.reason); };
    if (signal.aborted) stop(); else signal.addEventListener("abort", stop, { once: true });
  });
  const qa = setup({ healthInsight: waiting("health"), localResearch: waiting("local"), async flyaiInventory() { throw new contract.PlannerError("flyai_inventory", "test", 502, "NO_SOURCES"); } });
  await assert.rejects(qa.run(), (error) => error.code === "NO_SOURCES");
  assert.equal(qa.calls.length, 0);
  assert.deepEqual(cancelled.sort(), ["health", "local"]);
});

test("client cancellation reaches every active request without starting composition", async () => {
  const active = [], cancelled = [];
  const waiting = (name) => ({ signal }) => new Promise((resolve, reject) => {
    active.push(name);
    const stop = () => { cancelled.push(name); reject(signal.reason); };
    if (signal.aborted) stop(); else signal.addEventListener("abort", stop, { once: true });
  });
  const qa = setup({ healthInsight: waiting("health"), localResearch: waiting("local"), flyaiInventory: waiting("inventory") });
  const result = qa.run();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(active.length, 3);
  qa.controller.abort(new DOMException("Cancelled", "AbortError"));
  await assert.rejects(result);
  assert.equal(cancelled.length, 3);
  assert.equal(qa.calls.length, 0);
});

test("an authentic but wholly empty inventory stops before composing an invented trip", async () => {
  const qa = setup({ async flyaiInventory() { return { ...inventory, sources: [], failedCategories: ["景点与体验"] }; } });
  await assert.rejects(qa.run(), { code: "NO_VERIFIED_FLYAI_SOURCE" });
  assert.ok(qa.calls.every(call => typeof call === "string"));
});

test("each completed retrieval pushes its public sources while health and compose are still pending", async () => {
  const gates = [deferred(), deferred(), deferred()];
  const qa = setup({
    async healthInsight() { await gates[0].promise; return health; },
    async localResearch() { await gates[1].promise; return local; },
    async flyaiInventory() { await gates[2].promise; return inventory; },
  });
  const outcome = qa.run();
  await new Promise(setImmediate);
  assert.equal(qa.recommendations.length, 0);
  gates[2].resolve();
  await new Promise(setImmediate);
  assert.deepEqual(qa.recommendations.map((batch) => batch.stage), ["flyai_inventory"]);
  assert.equal(qa.recommendations[0].items[0].name, "已检索商品");
  assert.equal(qa.recommendations[0].destination, "杭州");
  assert.equal(qa.calls.length, 0, "compose still waits for independent health/local context");
  gates[1].resolve();
  await new Promise(setImmediate);
  assert.deepEqual(qa.recommendations.map((batch) => batch.stage), ["flyai_inventory", "local_research"]);
  assert.equal(qa.recommendations[1].items[0].name, "当地餐食资料 · example.com");
  assert.equal(qa.calls.length, 0, "health is still pending; recommendations do not wait for composition");
  assert.ok(!JSON.stringify(qa.recommendations).includes("坐着看风景"));
  assert.ok(!JSON.stringify(qa.recommendations).includes("疲劳"));
  assert.ok(!JSON.stringify(qa.recommendations).includes("Agent 组织"));
  gates[0].resolve();
  await outcome;
  assert.equal(qa.calls.length, 1);
});

test("late retrieval completions after cancellation never push recommendations", async () => {
  const gates = [deferred(), deferred(), deferred()];
  const qa = setup({
    async healthInsight() { await gates[0].promise; return health; },
    async localResearch() { await gates[1].promise; return local; },
    async flyaiInventory() { await gates[2].promise; return inventory; },
  });
  const outcome = qa.run();
  const failed = assert.rejects(outcome);
  await new Promise(setImmediate);
  qa.controller.abort(new DOMException("Cancelled", "AbortError"));
  gates.forEach((gate) => gate.resolve());
  await failed;
  assert.equal(qa.recommendations.length, 0);
  assert.equal(qa.calls.length, 0);
});

test("an advisory search failure emits no invented local preview and a preview callback failure does not invalidate a plan", async () => {
  const qa = setup({ async localResearch() { throw new Error("unavailable"); } });
  await qa.run();
  assert.deepEqual(qa.recommendations.map((batch) => batch.stage), ["flyai_inventory"]);
  const brokenPreview = setup();
  brokenPreview.request.recommendations = () => { throw new Error("display disconnected"); };
  assert.equal((await brokenPreview.run()).plan, plan);
});

test("a verified partial batch is visible before inventory completes and final replay is deduplicated", async () => {
  const gate = deferred(); let received;
  const qa = setup({ async flyaiInventory(ctx) { received = ctx; ctx.inventoryAvailable(inventory.sources); await gate.promise; return inventory; } });
  const running = qa.run(); await new Promise(setImmediate);
  assert.equal(qa.recommendations.filter(batch => batch.stage === 'flyai_inventory').length, 1);
  assert.equal(qa.calls.some(call => typeof call === 'object'), false);
  assert.equal(received.input.healthMetrics, undefined);
  gate.resolve(); await running;
  assert.equal(qa.recommendations.filter(batch => batch.stage === 'flyai_inventory').length, 1);
});

test("partial inventory arriving after cancellation is never published", async () => {
  const gate = deferred(); let context;
  const qa = setup({ async flyaiInventory(ctx) { context = ctx; await gate.promise; ctx.inventoryAvailable(inventory.sources); return inventory; } });
  const running = qa.run(); await new Promise(setImmediate); qa.controller.abort();
  context.inventoryAvailable(inventory.sources); gate.resolve(); await assert.rejects(running);
  assert.equal(qa.recommendations.filter(batch => batch.stage === 'flyai_inventory').length, 0);
});

test("POI retrieval failure degrades without discarding verified inventory or stopping composition", async () => {
  const qa = setup({}, ["local_food"], async () => { throw new Error("FLYAI_NOT_CONFIGURED"); });
  const result = await qa.run();
  assert.equal(result.provenance.stages.find(stage => stage.stage === "poi_catalog").status, "degraded");
  assert.equal(result.inventory, inventory);
  assert.deepEqual(plain(qa.calls.find(call => call.gathered).gathered.pois), []);
});
