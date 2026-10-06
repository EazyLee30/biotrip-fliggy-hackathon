import assert from "node:assert/strict";
import { test } from "node:test";
import { loadModule } from "./test-support/module-loader.mjs";

const dates = loadModule("lib/planner-input.ts");
const { resolveTripTiming } = loadModule("lib/trip-timing.ts", { "./planner-input": dates });
function trip(departureTimezone, destinationTimezone, returnDate = "2026-10-05") {
  return { trip: { departureDate: "2026-10-03", returnDate, departureTimezone, destinationTimezone } };
}

test("same-zone and nearby routes preserve the selected arrival day", () => {
  const domestic = resolveTripTiming(trip("Asia/Shanghai", "Asia/Shanghai"));
  assert.equal(domestic.arrivalDate, "2026-10-03");
  assert.equal(domestic.travelHours, 6);
  assert.equal(domestic.days, 3);
  assert.equal(resolveTripTiming(trip("Asia/Shanghai", "Asia/Tokyo")).travelHours, 5);
});

test("date-line routes use a positive planning buffer on the next local day", () => {
  const eastbound = resolveTripTiming(trip("Pacific/Honolulu", "Asia/Tokyo"));
  assert.equal(eastbound.arrivalDate, "2026-10-04");
  assert.equal(eastbound.travelHours, 11);
  assert.equal(eastbound.days, 2);
  assert.ok(eastbound.arrivalInstant.getTime() >= eastbound.departureInstant.getTime());
  const westbound = resolveTripTiming(trip("Asia/Tokyo", "America/Los_Angeles"));
  assert.equal(westbound.arrivalDate, "2026-10-03");
  assert.ok(westbound.travelHours > 0);
});

test("a return before the assumed international arrival is explained before generation", () => {
  assert.throws(() => resolveTripTiming(trip("Pacific/Honolulu", "Asia/Tokyo", "2026-10-03")), /2026-10-04/);
  assert.equal(resolveTripTiming(trip("Pacific/Honolulu", "Asia/Tokyo", "")).days, 1);
});

test("date range limits use calendar days rather than daylight-saving hours", () => {
  assert.equal(dates.planningDateError("2026-10-01", "2026-10-30"), null);
  assert.match(dates.planningDateError("2026-10-01", "2026-10-31"), /30/);
  assert.equal(dates.planningDateError("2026-10-03", "2026-10-03"), null);
  assert.equal(dates.planningDateError("2026-10-03", ""), null);
  assert.match(dates.planningDateError("2026-10-03", "2026-10-02"), /返程/);
  assert.match(dates.planningDateError("2026-02-30", "2026-03-01"), /有效/);
});
