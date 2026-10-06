import assert from "node:assert/strict";
import test from "node:test";
import { addTravelDays, isTravelDate, monthDates, nextTravelMonth, selectTravelDate, travelDateLabel, travelDuration, validateTravelRange } from "./travel-dates.ts";

test("rejects impossible dates and accepts leap days", () => {
  assert.equal(isTravelDate("2026-02-29"), false);
  assert.equal(isTravelDate("2028-02-29"), true);
  assert.equal(isTravelDate("2026-04-31"), false);
  assert.equal(isTravelDate("2026-1-01"), false);
});
test("date arithmetic crosses month/year and leap boundaries", () => {
  assert.equal(addTravelDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addTravelDays("2028-02-28", 2), "2028-03-01");
  assert.equal(nextTravelMonth("2026-12", 1), "2027-01");
  assert.equal(nextTravelMonth("2027-01", -1), "2026-12");
});
test("Monday-first grid represents the complete month", () => {
  const days = monthDates("2026-10");
  assert.deepEqual(days.slice(0, 4), [null, null, null, "2026-10-01"]);
  assert.equal(days.filter(Boolean).length, 31);
  assert.equal(days.at(-1), "2026-10-31");
});
test("same-day trip counts as one day and zero nights", () => {
  assert.deepEqual(travelDuration("2026-10-02", "2026-10-02"), { days: 1, nights: 0 });
  assert.deepEqual(travelDuration("2026-10-02", "2026-10-06"), { days: 5, nights: 4 });
  assert.equal(travelDuration("2026-10-06", "2026-10-02"), null);
});
test("departure then return selection never inverts a range", () => {
  let selection = selectTravelDate({ start: "", end: "", phase: "departure" }, "2026-10-08");
  assert.deepEqual(selection, { start: "2026-10-08", end: "", phase: "return" });
  selection = selectTravelDate(selection, "2026-10-05");
  assert.deepEqual(selection, { start: "2026-10-05", end: "", phase: "return" });
  selection = selectTravelDate(selection, "2026-10-10");
  assert.deepEqual(selection, { start: "2026-10-05", end: "2026-10-10", phase: "departure" });
});
test("past starts blocked for new trips, retained for ongoing travel", () => {
  assert.ok(validateTravelRange("2026-10-01", "2026-10-04", "2026-10-02"));
  assert.equal(validateTravelRange("2026-10-01", "2026-10-04", "2026-10-02", true), "");
  assert.ok(validateTravelRange("2026-10-04", "2026-10-03", "2026-10-02"));
  assert.ok(validateTravelRange("2026-02-30", "", "2026-10-02"));
  assert.equal(validateTravelRange("2026-10-02", "", "2026-10-02"), "");
});
test("date labels preserve chosen day across browser zones", () => {
  const previous = process.env.TZ;
  try { process.env.TZ = "America/Los_Angeles"; assert.equal(travelDateLabel("2026-10-02"), "10月2日"); process.env.TZ = "Asia/Tokyo"; assert.equal(travelDateLabel("2026-10-02"), "10月2日"); }
  finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});
