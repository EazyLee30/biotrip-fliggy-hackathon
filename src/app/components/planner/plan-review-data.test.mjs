import assert from "node:assert/strict";
import { test } from "node:test";
import { loadModule, plain } from "../../../lib/test-support/module-loader.mjs";

const dates = loadModule("lib/planner-input.ts");
const timing = loadModule("lib/trip-timing.ts", { "./planner-input": dates });
const { reviewBaselineItinerary } = loadModule("app/components/planner/plan-review-data.ts", { "@/lib/planner-input": dates, "@/lib/trip-timing": timing });
const { compareItineraries } = loadModule("lib/itinerary-diff.ts");
const original = () => ({
  planCurrent: true,
  draft: { trip: { departureDate: "2026-10-03", returnDate: "2026-10-05", departureTimezone: "America/Los_Angeles", destinationTimezone: "Pacific/Kiritimati" } },
  plan: { plan: { itinerary: [{ id: "old-reservation", time: "16:00", name: "茶室预约", detail: "", durationMin: 180, fixed: true, progress: { state: "completed", updatedAt: "2026-10-04T05:00:00Z" } }] } },
});

test("date-line arrival normalization does not display an unchanged legacy reservation as moving days", () => {
  const journey = original(), actualBefore = JSON.stringify(journey);
  const before = reviewBaselineItinerary(journey);
  const after = journey.plan.plan.itinerary.map(item => ({ ...item, date: "2026-10-04" }));
  const comparison = compareItineraries(before, after);
  assert.equal(before[0].date, "2026-10-04");
  assert.deepEqual(plain(before), after);
  assert.equal(comparison.changed.length, 0); assert.equal(comparison.retained.length, 1);
  assert.equal(JSON.stringify(journey), actualBefore);
});

test("review keeps real rescheduling visible and never infers the old date from a candidate or stale draft", () => {
  const journey = original(), before = reviewBaselineItinerary(journey);
  const moved = journey.plan.plan.itinerary.map(item => ({ ...item, date: "2026-10-05" }));
  const comparison = compareItineraries(before, moved);
  assert.equal(comparison.changed.length, 1);
  assert.equal(comparison.changed[0].before.date, "2026-10-04");
  assert.equal(comparison.changed[0].after.date, "2026-10-05");
  journey.planCurrent = false;
  assert.equal(reviewBaselineItinerary(journey)[0].date, undefined);
});
