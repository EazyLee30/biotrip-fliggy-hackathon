import assert from "node:assert/strict";
import { test } from "node:test";
import { loadModule, plain } from "../../../lib/test-support/module-loader.mjs";

const parser = loadModule("lib/planner-input.ts");
const helpers = loadModule("app/components/planner/reservations.ts", { "@/lib/planner-input": parser });
const { reservationDates, encodeReservationName, decodeReservationName, reservationDraftError, reservationTextError, replaceReservation, removeReservation, serializeReservations } = helpers;
const draft = (overrides = {}) => ({ date: "2026-10-03", time: "13:07", activity: "参加活动", location: "", fixed: true, ...overrides });

test("reservation date chips cover valid destination dates including leap day, year boundary and thirty days", () => {
  assert.deepEqual(plain(reservationDates("2026-12-31", "2027-01-02")), ["2026-12-31", "2027-01-01", "2027-01-02"]);
  assert.deepEqual(plain(reservationDates("2028-02-28", "2028-03-01")), ["2028-02-28", "2028-02-29", "2028-03-01"]);
  assert.equal(reservationDates("2026-10-01", "2026-10-30").length, 30);
  assert.deepEqual(plain(reservationDates("2026-10-03", "")), ["2026-10-03"]);
  for (const [start, end] of [["2026-02-29", ""], ["2026-10-04", "2026-10-03"], ["2026-10-01", "2026-10-31"]]) assert.equal(reservationDates(start, end).length, 0);
});

test("activity and manually supplied place roundtrip through the explicit suffix", () => {
  const name = encodeReservationName("参观 (自由填) ：展览", "市立美术馆 (东门)");
  assert.equal(name, "参观 (自由填) ：展览（地点：市立美术馆 (东门)）");
  assert.deepEqual(plain(decodeReservationName(name)), { activity: "参观 (自由填) ：展览", location: "市立美术馆 (东门)" });
  assert.deepEqual(plain(decodeReservationName("老活动（备注）")), { activity: "老活动（备注）", location: "" });
  assert.deepEqual(plain(decodeReservationName("活动（地点：）")), { activity: "活动（地点：）", location: "" });
  assert.equal(encodeReservationName("  入住  ", "  "), "入住");
  assert.deepEqual(plain(decodeReservationName(encodeReservationName("参观", "南京（东门）"))), { activity: "参观", location: "南京（东门）" });
});

test("place encoding rejects separators and ambiguous suffixes rather than silently adding activities", () => {
  for (const activity of ["", "活动\n另一项", "活动|固定", "活动｜灵活", "活动（地点：冒充）", "活动\u2028另一项"]) assert.equal(encodeReservationName(activity, ""), null, activity);
  for (const location of ["地址\r换行", "地址|备注", "地址｜备注"]) assert.equal(encodeReservationName("参观", location), null, location);
  assert.notEqual(encodeReservationName("名".repeat(120), ""), null);
  assert.equal(encodeReservationName("名".repeat(121), ""), null);
  assert.equal(encodeReservationName("名".repeat(116), "地"), null);
});

test("a new appointment requires an explicit date and precise hour/minute within the trip", () => {
  assert.match(reservationDraftError(draft({ date: "" }), "2026-10-03", "2026-10-04"), /具体日期/);
  assert.match(reservationDraftError(draft({ date: "2026-10-05" }), "2026-10-03", "2026-10-04"), /旅程内/);
  for (const time of ["", "9:00", "24:00", "09:60"]) assert.match(reservationDraftError(draft({ time }), "2026-10-03", "2026-10-04"), /小时和分钟/);
  assert.equal(reservationDraftError(draft({ time: "23:59" }), "2026-10-03", "2026-10-04"), null);
});

test("editing and deleting retain every untouched legacy item, arbitrary minute and flexible flag", () => {
  const text = "9：07 old meetup\n2026-10-04 18:59 | 旧活动（任意备注） | 灵活\n13:11 午饭 | 灵活";
  const before = plain(parser.parseSchedule(text));
  const changed = replaceReservation(text, 0, draft({ activity: "更改活动", location: "用户输入地点" }), "2026-10-03", "2026-10-04");
  assert.equal(changed.error, null);
  const after = plain(parser.parseSchedule(changed.value));
  assert.deepEqual(after.slice(1), before.slice(1));
  assert.deepEqual(after[0], { date: "2026-10-03", time: "13:07", name: "更改活动（地点：用户输入地点）", fixed: true });
  assert.deepEqual(plain(parser.parseSchedule(removeReservation(changed.value, 0).value)), before.slice(1));
});

test("malformed original text is never treated as empty or overwritten", () => {
  const text = "13:00 valid\nnot a valid reservation";
  assert.equal(replaceReservation(text, null, draft(), "2026-10-03", "2026-10-04").value, null);
  assert.match(replaceReservation(text, null, draft(), "2026-10-03", "2026-10-04").error, /第 2 行/);
  assert.equal(removeReservation(text, 0).value, null);
  assert.equal(replaceReservation("x".repeat(6001), null, draft(), "2026-10-03", "2026-10-04").value, null);
});

test("new entries serialize back through the existing parser with the original names and dates", () => {
  const items = [{ time: "13:07", name: "omarchy cn meetup", fixed: true }, { date: "2026-10-04", time: "18:59", name: "晚餐（地点：用户餐厅）", fixed: false }];
  const serialized = serializeReservations(items);
  assert.equal(serialized.error, null);
  assert.deepEqual(plain(parser.parseSchedule(serialized.value)), items);
  const appended = replaceReservation(serialized.value, null, draft({ activity: "交通", fixed: false }), "2026-10-03", "2026-10-04");
  assert.equal(appended.error, null);
  assert.deepEqual(plain(parser.parseSchedule(appended.value)).slice(0, 2), items);
});

test("limits and invalid positions fail locally without a replacement value", () => {
  const thirty = Array.from({ length: 30 }, (_, i) => ({ time: "13:00", name: `活动${i}`, fixed: true }));
  const text = serializeReservations(thirty).value;
  assert.equal(replaceReservation(text, null, draft(), "2026-10-03", "2026-10-04").value, null);
  assert.match(replaceReservation(text, null, draft(), "2026-10-03", "2026-10-04").error, /30/);
  assert.equal(replaceReservation(text, 30, draft(), "2026-10-03", "2026-10-04").value, null);
  assert.equal(removeReservation(text, -1).value, null);
  assert.match(reservationTextError("x".repeat(6001), "2026-10-03", "2026-10-04"), /6000/);
});

test("batch text validates dated rows and reports original line numbers, preserving undated legacy", () => {
  assert.equal(reservationTextError("13:07 legacy", "2026-10-03", "2026-10-04"), null);
  assert.match(reservationTextError("\n13:07 legacy\n\n2026-10-05 13:00 活动", "2026-10-03", "2026-10-04"), /第 4 行.*旅程内/);
  assert.equal(reservationTextError("", "", ""), null);
});
