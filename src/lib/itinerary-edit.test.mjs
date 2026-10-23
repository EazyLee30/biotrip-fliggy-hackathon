import * as protection from "./adjust/protection.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadModule, plain } from "./test-support/module-loader.mjs";

const parser = loadModule("lib/planner-input.ts");
const { applyItineraryOperations: apply, itineraryDates, syncItineraryReservations: sync, rebasePendingReservations: rebase } =
  loadModule("lib/itinerary-edit.ts", { "./adjust/protection": protection, "./planner-input": parser });
const day = "2026-10-03", trip = { departureDate: day, returnDate: "2026-10-04" };
const item = (time, name, fixed = false, date = day) => ({ date, time, name, detail: `详情：${name}`, fixed });
const itinerary = [item("08:00", "早点"), item("10:00", "预约", true), item("12:00", "散步"), item("14:00", "茶馆"), item("09:00", "第二日", false, "2026-10-04")];

test("same-day reorder reuses flexible slots across a fixed reservation without moving its clock or position", () => {
  const result = apply(itinerary, [{ type: "move", index: 0, toIndex: 3 }], trip);
  assert.deepEqual(result.itinerary.map((row) => row.name), ["散步", "预约", "茶馆", "早点", "第二日"]);
  assert.deepEqual(result.itinerary.map((row) => row.time), ["08:00", "10:00", "12:00", "14:00", "09:00"]);
  assert.deepEqual(plain(result.itinerary[1]), itinerary[1]);
  assert.deepEqual(itinerary.map((row) => row.name), ["早点", "预约", "散步", "茶馆", "第二日"]);
  assert.throws(() => apply(itinerary, [{ type: "move", index: 1, toIndex: 2 }], trip), /固定预约/);
  assert.throws(() => apply(itinerary, [{ type: "move", index: 0, toIndex: 4 }], trip), /同一天/);
});

test("explicit fixed edit is chronologically sorted and its draft reservation is synchronized", () => {
  const result = apply(itinerary, [{ type: "edit", index: 1, time: "15:37", name: "新预约", detail: "由用户改约" }], trip);
  assert.equal(result.itinerary[3].name, "新预约");
  assert.equal(result.itinerary[3].time, "15:37");
  assert.equal(sync("2026-10-03 10:00 | 预约 | 固定", itinerary, result.reservationChanges, day), "2026-10-03 15:37 | 新预约 | 固定");
});

test("only manual input may unprotect or protect a reservation, and new generated protection reaches the draft", () => {
  const unlock = apply(itinerary, [{ type: "edit", index: 1, fixed: false }], trip);
  assert.equal(sync("10:00 预约", itinerary, unlock.reservationChanges, day), "10:00 | 预约 | 灵活");
  const protect = apply(itinerary, [{ type: "edit", index: 2, fixed: true }], trip);
  assert.equal(sync("10:00 预约", itinerary, protect.reservationChanges, day), "10:00 | 预约 | 固定\n2026-10-03 12:00 | 散步 | 固定");
  const legacyFixed = apply(itinerary, [{ type: "edit", index: 1, detail: "明确编辑仍保持预约" }], trip);
  assert.equal(sync("", itinerary, legacyFixed.reservationChanges, day), "2026-10-03 10:00 | 预约 | 固定");
});

test("original flexible reservations and unmatched entries survive edits and later replans", () => {
  const result = apply(itinerary, [{ type: "move", index: 0, toIndex: 2 }], trip);
  const text = sync("08:00 早点 | 灵活\n10:00 预约\n18:00 草稿中另一个预约", itinerary, result.reservationChanges, day);
  assert.deepEqual(plain(parser.parseSchedule(text)).map(({ time, name, fixed }) => ({ time, name, fixed })), [
    { time: "12:00", name: "早点", fixed: false }, { time: "10:00", name: "预约", fixed: true }, { time: "18:00", name: "草稿中另一个预约", fixed: true },
  ]);
});

test("date coverage, valid time, index, operation count and field limits are enforced", () => {
  for (const operation of [
    { type: "edit", index: 4, date: day }, { type: "edit", index: 0, date: "2026-10-05" },
    { type: "edit", index: 0, time: "25:00" }, { type: "edit", index: 0, name: "a\nb" },
    { type: "edit", index: 0, name: "x".repeat(121) }, { type: "edit", index: 0, detail: "x".repeat(1501) },
    { type: "edit", index: 0, url: "https://unverified.test" }, { type: "edit", index: 999, name: "消失" },
  ]) assert.throws(() => apply(itinerary, [operation], trip), { code: "INVALID_ITINERARY" });
  assert.throws(() => apply(itinerary, [], trip), /1–100/);
  assert.throws(() => apply(itinerary, Array.from({ length: 101 }, () => ({ type: "edit", index: 0, detail: "" })), trip), /1–100/);
  assert.throws(() => sync("not a reservation", itinerary, [], day), /原预约格式/);
});

test("new simultaneous activity collisions are rejected but existing legacy duplicate times remain editable", () => {
  assert.throws(() => apply(itinerary, [{ type: "edit", index: 0, time: "10:00" }], trip), /同一时分/);
  const legacy = [item("10:00", "固定", true), item("10:00", "已有同分"), item("13:00", "旧活动")];
  assert.equal(apply(legacy, [{ type: "edit", index: 2, detail: "用户说明" }], { departureDate: day, returnDate: day }).itinerary.length, 3);
});

test("calendar coverage uses the actual first arrival day and legacy undated entries still normalize safely", () => {
  assert.deepEqual(plain(itineraryDates([item("15:00", "抵达", false, "2026-10-04")], trip)), ["2026-10-04"]);
  const old = [{ time: "10:00", name: "旧预约", detail: "", fixed: true }];
  const result = apply(old, [{ type: "edit", index: 0, detail: "更新说明" }], { departureDate: day, returnDate: day });
  assert.equal(result.itinerary[0].date, day);
  assert.equal(sync("10:00 旧预约", old, result.reservationChanges, day), "10:00 旧预约");
});

test("pending rebase updates untouched base entries while preserving edited, removed and added user reservations", () => {
  const oldBase = "10:00 预约\n12:00 喝茶 | 灵活\n18:00 晚餐";
  const newBase = "11:37 新预约\n14:00 喝茶 | 灵活\n18:00 晚餐\n2026-10-03 16:00 | 手动固定 | 固定";
  const pending = "10:00 预约\n13:00 喝茶 | 灵活\n19:00 自己添加";
  const result = parser.parseSchedule(rebase(oldBase, newBase, pending));
  assert.deepEqual(plain(result).map((row) => [row.time, row.name]), [
    ["11:37", "新预约"], ["13:00", "喝茶"], ["19:00", "自己添加"], ["16:00", "手动固定"],
  ]);
  assert.throws(() => rebase("10:00 old", "", "10:00 old"), /安全合并/);
});

test("adding a real retrieved activity persists chronologically without moving existing reservations", () => {
  const added = { type: "add", date: day, time: "13:15", name: "当地展馆", detail: "来自真实检索", fixed: false };
  const result = apply(itinerary, [added], trip);
  assert.equal(result.itinerary.length, itinerary.length + 1);
  assert.equal(result.itinerary[3].name, added.name);
  assert.deepEqual(plain(result.itinerary[1]), itinerary[1]);
  assert.equal(sync("10:00 | 预约 | 固定", itinerary, result.reservationChanges, day), "10:00 | 预约 | 固定");
  assert.throws(() => apply(itinerary, [{ ...added, time: "10:00" }], trip), /同一时分/);
  assert.throws(() => apply(itinerary, [{ ...added, date: "2026-10-05" }], trip), /旅程内/);
  const protectedItem = apply(itinerary, [{ ...added, fixed: true }], trip);
  assert.ok(sync("", itinerary, protectedItem.reservationChanges, day).includes("13:15 | 当地展馆 | 固定"));
});

test("removal protects fixed reservations and day coverage, and removes only matched draft entries", () => {
  assert.throws(() => apply(itinerary, [{ type: "remove", index: 1 }], trip), /单独确认/);
  assert.throws(() => apply(itinerary, [{ type: "remove", index: 4 }], trip), /每天至少/);
  const result = apply(itinerary, [{ type: "remove", index: 1, confirmFixed: true }], trip);
  assert.equal(result.itinerary.length, itinerary.length - 1);
  assert.equal(result.reservationChanges[0].after, null);
  const old = "10:00 | 预约 | 固定\n18:00 | 草稿另一个预约 | 固定";
  const next = sync(old, itinerary, result.reservationChanges, day);
  assert.equal(next, "18:00 | 草稿另一个预约 | 固定");
  assert.equal(rebase(old, next, old, [itinerary[1]]), next);
  const pending = "10:00 | 预约 | 固定\n19:00 | 自己改的预约 | 固定";
  assert.equal(rebase(old, next, pending, [itinerary[1]]), "19:00 | 自己改的预约 | 固定");
});
