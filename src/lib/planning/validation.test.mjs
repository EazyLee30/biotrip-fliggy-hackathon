import assert from "node:assert/strict";
import { test } from "node:test";
import { loadModule, plain } from "../test-support/module-loader.mjs";
const contract = loadModule("lib/planning/contract.ts");
const { validateComposedPlan } = loadModule("lib/planning/validation.ts", { "./contract": contract });
const ctx = { requestId: "validation-qa", timing: { arrivalDate: "2026-10-03", endDate: "2026-10-05", arrivalLocal: "2026-10-03T15:00", days: 3 } };
const item = (date, time = "16:00", fixed = false) => ({ date, time, fixed, name: "用户测试安排", detail: "" });
const plan = { itinerary: [item("2026-10-05"), item("2026-10-03"), item("2026-10-04")], places: [], adjustments: [] };
test("multi-day output covers every day and is sorted before saving", () => {
  const result = validateComposedPlan(plan, ctx);
  assert.deepEqual(plain(result.itinerary.map(row => row.date)), ["2026-10-03", "2026-10-04", "2026-10-05"]);
  assert.equal(plan.itinerary[0].date, "2026-10-05");
  assert.throws(() => validateComposedPlan({ ...plan, itinerary: plan.itinerary.filter(row => row.date !== "2026-10-04") }, ctx), { code: "INCOMPLETE_PLAN_DAYS" });
});
test("assumed arrival buffers constrain suggestions while existing fixed appointments remain preserved", () => {
  const oneDay = { ...ctx, timing: { ...ctx.timing, endDate: "2026-10-03", days: 1 } };
  assert.throws(() => validateComposedPlan({ ...plan, itinerary: [item("2026-10-03", "14:00")] }, oneDay), { code: "PLAN_BEFORE_ARRIVAL_BUFFER" });
  assert.equal(validateComposedPlan({ ...plan, itinerary: [item("2026-10-03", "14:00", true)] }, oneDay).itinerary[0].time, "14:00");
  assert.throws(() => validateComposedPlan({ ...plan, itinerary: [item("2026-10-02")] }, oneDay), { code: "INVALID_PLAN_DATE_RANGE" });
});
