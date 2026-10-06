import assert from "node:assert/strict";
import { test } from "node:test";
import { loadModule, plain } from "../test-support/module-loader.mjs";

const contract = loadModule("lib/planning/contract.ts");
const stages = loadModule("lib/planning/stages.ts");

const { buildStageInput, PlannerError, normalizePlannerError } = contract;
const { STAGE_POLICIES, STAGE_BY_NAME, PLAN_BUDGET_MS } = stages;

const HEALTH_MARKER = { cycles: [{ strain: 12.4 }], recoveries: [{ score: { recovery_score: 31 } }] };
const gathered = {
  trip: {
    originCity: "上海", destinationCity: "东京",
    departureDate: "2026-10-10",
    departureTimezone: "Asia/Shanghai", destinationTimezone: "Asia/Tokyo",
    returnDate: "2026-10-15", planningStyle: "flexible",
    itineraryText: "", requestedServices: ["hotels"], foodPreferences: "",
  },
  preferences: {
    intention: "安静恢复", colorTone: "未指定",
    ambientPreferences: ["安静少噪"], savedMemory: "", planningStyle: "flexible",
  },
  selfReport: { fatigue: 4, subjectiveStress: 3 },
  healthMetrics: HEALTH_MARKER,
};

/**
 * The privacy boundary is executable. These assertions fail if a stage is ever
 * granted data it should not see, which is what keeps "health data only reaches
 * the tool-free agent" an enforced property rather than a documented promise.
 */
test("only health_insight may receive raw WHOOP records", () => {
  for (const policy of STAGE_POLICIES) {
    const input = buildStageInput(policy.grants, gathered);
    if (policy.name === "health_insight") assert.deepEqual(plain(input.healthMetrics), plain(HEALTH_MARKER));
    else assert.equal(input.healthMetrics, undefined, `${policy.name} must not receive health metrics`);
  }
});

test("local research sees the trip and preferences but no self-report or health data", () => {
  const input = buildStageInput(STAGE_BY_NAME.local_research.grants, gathered);
  assert.ok(input.trip);
  assert.ok(input.preferences);
  assert.equal(input.selfReport, undefined);
  assert.equal(input.healthMetrics, undefined);
});

test("FlyAI inventory receives the trip only", () => {
  const input = buildStageInput(STAGE_BY_NAME.flyai_inventory.grants, gathered);
  assert.ok(input.trip);
  assert.equal(input.preferences, undefined);
  assert.equal(input.selfReport, undefined);
  assert.equal(input.healthMetrics, undefined);
});

test("composition receives context but never raw health metrics", () => {
  const input = buildStageInput(STAGE_BY_NAME.compose_plan.grants, gathered);
  assert.ok(input.trip && input.preferences && input.selfReport);
  assert.equal(input.healthMetrics, undefined);
});

test("an undeclared grant is never copied in even when the data exists", () => {
  assert.deepEqual(plain(buildStageInput([], gathered)), plain({}));
});

test("no stage declares a credential grant", () => {
  for (const policy of STAGE_POLICIES) {
    for (const grant of policy.grants) {
      assert.ok(["trip", "preferences", "self_report", "health_metrics", "itinerary"].includes(grant),
        `${policy.name} declares an unexpected grant ${grant}`);
    }
  }
});

test("advisory stages may degrade while required stages fail the plan", () => {
  const degradable = STAGE_POLICIES.filter((policy) => policy.degradable).map((policy) => policy.name).sort();
  assert.deepEqual(plain(degradable), ["compose_adjustments", "health_insight", "local_research", "mobility", "poi_catalog", "relief_inventory"]);
  for (const policy of STAGE_POLICIES) assert.equal(policy.degradable || policy.required, true);
  assert.equal(STAGE_BY_NAME.flyai_inventory.required, true);
  assert.equal(STAGE_BY_NAME.compose_plan.required, true);
});

test("stage budgets stay within the overall planning budget", () => {
  const total = STAGE_POLICIES.reduce((sum, policy) => sum + policy.budgetMs, 0);
  assert.ok(total >= PLAN_BUDGET_MS, "stages must be able to fill the request budget");
});

test("every stage has a Chinese label used for user-facing diagnostics", () => {
  for (const policy of STAGE_POLICIES) {
    assert.match(policy.label, /[\u4e00-\u9fa5]/);
  }
});

test("a provider error keeps its identity and a raw error becomes a pipeline error", () => {
  const original = new PlannerError("local_research", "agent_stream", 502, "NO_VERIFIED_WEB_SEARCH", "req-1", true);
  assert.equal(normalizePlannerError("local_research", "agent_stream", original), original);
  const wrapped = normalizePlannerError("compose_plan", "compose_plan", new Error("boom"));
  assert.equal(wrapped.stage, "compose_plan");
  assert.equal(wrapped.code, "PLANNING_RUNTIME_ERROR");
  const timeoutError = new Error("aborted");
  timeoutError.name = "TimeoutError";
  const timeout = normalizePlannerError("compose_plan", "compose_plan", timeoutError);
  assert.equal(timeout.status, 504);
  assert.equal(timeout.code, "UPSTREAM_TIMEOUT");
  // An upstream reason must survive so diagnostics stay actionable.
  const upstream = new Error("flyai rejected");
  upstream.code = "FLYAI_AUTH_ERROR";
  assert.equal(normalizePlannerError("flyai_inventory", "pipeline", upstream).code, "FLYAI_AUTH_ERROR");
});

test("relief and mobility receive only trip and scoped itinerary; composer cannot see raw metrics", () => {
  const data = { ...gathered, itinerary: [{ id: "activity-test", name: "西湖", date: "2026-10-12", time: "14:00", fixed: false }] };
  for (const stage of ["relief_inventory", "mobility"]) {
    const input = buildStageInput(STAGE_BY_NAME[stage].grants, data);
    assert.deepEqual(Object.keys(input).sort(), ["itinerary", "trip"]);
    assert.equal(input.healthMetrics, undefined); assert.equal(input.selfReport, undefined);
  }
  const composer = buildStageInput(STAGE_BY_NAME.compose_adjustments.grants, data);
  assert.ok(composer.itinerary); assert.ok(composer.selfReport); assert.equal(composer.healthMetrics, undefined);
});
