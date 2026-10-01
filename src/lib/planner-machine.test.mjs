import assert from "node:assert/strict";
import { test } from "node:test";
import { loadModule, plain } from "./test-support/module-loader.mjs";

const { journeyMachine, allowedTransitions, hasCurrentPlan } = loadModule("app/components/planner/machine.ts");

function journey(overrides = {}) {
  return plain({
    id: "j", title: "京都", status: "draft",
    draft: { trip: { destinationCity: "京都" } },
    plan: null, planCurrent: false, version: 1,
    createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z",
    startedAt: null, completedAt: null,
    ...overrides,
  });
}
const PLAN = { headline: "留白的京都", itinerary: [{ time: "10:00", name: "岚山", detail: "", fixed: false }] };

test("a fresh draft can be edited and generated but not started", () => {
  const { can } = journeyMachine(journey());
  assert.equal(can.canEdit, true);
  assert.equal(can.canGenerate, true);
  assert.equal(can.canStart, false);
  assert.equal(can.canRecordFeedback, false);
});

test("a planned journey with a current plan offers Start and no edit", () => {
  const { can, primary } = journeyMachine(journey({ status: "planned", plan: PLAN, planCurrent: true }));
  assert.equal(can.canStart, true);
  assert.equal(can.canEdit, false);
  assert.equal(primary.key, "start");
});

test("a stale plan cannot be started, only regenerated", () => {
  const { can, primary } = journeyMachine(journey({ status: "planned", plan: PLAN, planCurrent: false }));
  assert.equal(can.canStart, false);
  assert.equal(can.canGenerate, true);
  assert.notEqual(primary?.key, "start");
});

test("travelling locks editing and unlocks feedback and completion", () => {
  const { can, primary } = journeyMachine(journey({ status: "active", plan: PLAN, planCurrent: true, startedAt: "2026-10-02T00:00:00Z" }));
  assert.equal(can.canEdit, false);
  assert.equal(can.canReplan, true);
  assert.equal(can.canComplete, true);
  assert.equal(can.canRecordFeedback, true);
  assert.equal(primary.key, "replan");
});

test("a completed journey only offers a new trip and memories", () => {
  const { can, primary } = journeyMachine(journey({ status: "completed", plan: PLAN, planCurrent: true, completedAt: "2026-10-05T00:00:00Z" }));
  assert.equal(can.canEdit, false);
  assert.equal(can.canStart, false);
  assert.equal(can.canPlanNew, true);
  assert.equal(can.canRecordFeedback, true);
  assert.equal(primary.key, "new_journey");
});

test("an absent journey offers creation and shares nothing", () => {
  const { can, primary, status } = journeyMachine(null);
  assert.equal(status, null);
  assert.equal(can.canShare, false);
  assert.equal(can.canPlanNew, true);
  assert.equal(primary.key, "new_journey");
});

test("lifecycle transitions are exactly the server rules", () => {
  assert.deepEqual([...allowedTransitions("draft")], ["planned"]);
  assert.deepEqual([...allowedTransitions("planned")], ["active", "draft"]);
  assert.deepEqual([...allowedTransitions("active")], ["completed", "planned"]);
  assert.deepEqual([...allowedTransitions("completed")], []);
});

test("a plan only counts as current when it matches the stored draft", () => {
  assert.equal(hasCurrentPlan(journey({ plan: PLAN, planCurrent: true })), true);
  assert.equal(hasCurrentPlan(journey({ plan: PLAN, planCurrent: false })), false);
  assert.equal(hasCurrentPlan(journey()), false);
});