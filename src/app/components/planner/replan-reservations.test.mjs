import assert from "node:assert/strict";
import { test } from "node:test";
import { loadModule, plain } from "../../../lib/test-support/module-loader.mjs";

const parser = loadModule("lib/planner-input.ts");
const reservations = loadModule("app/components/planner/reservations.ts", { "@/lib/planner-input": parser });
const { initialReplanReservations, reservationEditsFromItems, replanReservationText } = loadModule("app/components/planner/replan-reservations-state.ts", { "@/lib/planner-input": parser, "./reservations": reservations });
const start = "2030-10-20", end = "2030-10-22";
const activity = (overrides = {}) => ({ id: "dinner", date: start, time: "18:00", name: "朋友晚餐", detail: "已有预约", fixed: true, durationMin: 60, ...overrides });

test("malformed legacy text recovers real appointments without exposing a parser failure", () => {
  const actual = [activity(), activity({ id: "museum", time: "10:00", name: "博物馆", fixed: false })];
  const result = initialReplanReservations(actual, "预约信息见附件\n18:00 dinner", start, end);
  assert.equal(result.recovered, true);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].activityId, "dinner");
  assert.equal(result.canonicalText, `${start} 18:00 | 朋友晚餐 | 固定`);
  assert.equal(parser.scheduleError(result.canonicalText), null);
  assert.deepEqual(plain(result.edits), []);
});

test("valid per-card time and flexibility changes preserve activity identity on re-entry", () => {
  const actual = [activity()];
  const next = initialReplanReservations(actual, `${start} 19:07 | 朋友晚餐 | 灵活`, start, end);
  assert.equal(next.items[0].fixed, false);
  assert.equal(next.items[0].time, "19:07");
  assert.deepEqual(plain(next.edits), [{ activityId: "dinner", date: start, time: "19:07", fixed: false }]);
  const restored = initialReplanReservations(actual, next.canonicalText, start, end, next.edits);
  assert.equal(restored.canonicalText, next.canonicalText);
  assert.equal(restored.items[0].activityId, "dinner");
});

test("in-progress and completed activities override stale edits and remain immutable", () => {
  for (const progress of ["in_progress", "completed"]) {
    const actual = [activity({ progress: { state: progress, updatedAt: "2030-10-20T09:00:00Z" } })];
    const result = initialReplanReservations(actual, `${start} 21:00 | 朋友晚餐 | 灵活`, start, end, [{ activityId: "dinner", date: end, time: "23:00", fixed: false }]);
    assert.equal(result.items[0].locked, true);
    assert.equal(result.items[0].time, "18:00");
    assert.equal(result.items[0].date, start);
    assert.equal(result.items[0].fixed, true);
    assert.equal(result.items.length, 1);
    assert.deepEqual(plain(result.edits), []);
  }
});

test("same-named appointments cannot be moved by ambiguous text and explicit IDs move only the chosen one", () => {
  const actual = [activity({ id: "first", time: "12:00" }), activity({ id: "second", time: "18:00" })];
  const ambiguous = initialReplanReservations(actual, `${start} 19:00 | 朋友晚餐 | 固定`, start, end);
  assert.deepEqual(plain(ambiguous.items.map(item => [item.activityId, item.time])), [["first", "12:00"], ["second", "18:00"]]);
  assert.deepEqual(plain(ambiguous.edits), []);
  const edited = initialReplanReservations(actual, `${start} 12:00 | 朋友晚餐 | 固定\n${start} 19:00 | 朋友晚餐 | 固定`, start, end, [{ activityId: "second", date: start, time: "19:00", fixed: true }]);
  assert.deepEqual(plain(edited.items.map(item => [item.activityId, item.time])), [["first", "12:00"], ["second", "19:00"]]);
  assert.deepEqual(plain(edited.edits), [{ activityId: "second", date: start, time: "19:00", fixed: true }]);
});

test("new named reservations roundtrip while skipped history is never reintroduced", () => {
  const actual = [activity({ progress: { state: "skipped", updatedAt: "2030-10-20T09:00:00Z" } })];
  const result = initialReplanReservations(actual, `${start} 18:00 | 朋友晚餐 | 固定\n${end} 10:37 | 参观展览 | 固定`, start, end);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].name, "参观展览");
  assert.equal(result.items[0].origin, "draft");
  assert.deepEqual(plain(reservationEditsFromItems(result.items, actual, start)), []);
  assert.equal(replanReservationText(result.items).value, result.canonicalText);
});

test("invalid dates fall back to the actual appointment and arbitrary minute precision survives", () => {
  const actual = [activity({ time: "18:59" })];
  const result = initialReplanReservations(actual, "2030-10-25 10:00 | 朋友晚餐 | 固定", start, end);
  assert.equal(result.recovered, true);
  assert.equal(result.items[0].time, "18:59");
  assert.equal(result.items[0].date, start);
  assert.deepEqual(plain(result.edits), []);
});
