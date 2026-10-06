import assert from "node:assert/strict";
import { test } from "node:test";
import { loadModule } from "./test-support/module-loader.mjs";

const { parseSchedule: readSchedule, scheduleError, validateInput } = loadModule("lib/planner-input.ts");
// The fixture executes TypeScript in a VM; compare values in this test's realm.
const parseSchedule = (text) => structuredClone(readSchedule(text));

test("the reported meetup input is a fixed reservation without an invented date", () => {
  assert.deepEqual(parseSchedule("13:00 omarchy cn meetup"), [
    { time: "13:00", name: "omarchy cn meetup", fixed: true },
  ]);
  assert.equal(scheduleError("13:00 omarchy cn meetup"), null);
});

test("legacy pipes and natural explicit markers preserve fixed and flexible intent", () => {
  assert.deepEqual(parseSchedule("09:00 | 已预约早餐 | 固定\n13:00 | 公园散步 | 灵活\n15:00 下午茶 | 灵活\n16:00 理疗 | 固定"), [
    { time: "09:00", name: "已预约早餐", fixed: true },
    { time: "13:00", name: "公园散步", fixed: false },
    { time: "15:00", name: "下午茶", fixed: false },
    { time: "16:00", name: "理疗", fixed: true },
  ]);
});

test("single-digit hours and fullwidth delimiters normalize only the time", () => {
  assert.deepEqual(parseSchedule("9：05 会议：中文名称｜灵活\n0:00 | 入住 | 固定\n23：59｜接机｜固定"), [
    { time: "09:05", name: "会议：中文名称", fixed: false },
    { time: "00:00", name: "入住", fixed: true },
    { time: "23:59", name: "接机", fixed: true },
  ]);
});

test("optional valid dates work with either grammar and are preserved exactly", () => {
  assert.deepEqual(parseSchedule("2028-02-29 9:30 博物馆\n2026-10-03 13：00｜活动｜灵活"), [
    { date: "2028-02-29", time: "09:30", name: "博物馆", fixed: true },
    { date: "2026-10-03", time: "13:00", name: "活动", fixed: false },
  ]);
});

test("invalid calendar dates are rejected with a date-specific diagnostic", () => {
  for (const date of ["2026-02-29", "2026-02-30", "2026-13-01", "2026-00-03", "2026-2-03", "2026/10/03"]) {
    const input = `${date} 13:00 活动`;
    assert.equal(parseSchedule(input), null, input);
    assert.match(scheduleError(input), /第 1 行.*日期/, input);
  }
});

test("invalid clock values and incomplete clock syntax never become activities", () => {
  for (const clock of ["24:00", "13:60", "99:99", "13:0", "-1:00", "1:000", "123:00", "13.00"]) {
    const input = `${clock} 活动`;
    assert.equal(parseSchedule(input), null, input);
    assert.match(scheduleError(input), /第 1 行.*时间/, input);
  }
  assert.equal(parseSchedule("13:00活动"), null);
});

test("activity names must be present and at most 120 characters", () => {
  for (const input of ["13:00", "13:00 | | 固定", "13:00 | 灵活", "2026-10-03 13:00   "]) {
    assert.equal(parseSchedule(input), null, input);
    assert.match(scheduleError(input), /活动名称/, input);
  }
  assert.equal(parseSchedule(`13:00 ${"名".repeat(120)}`)?.[0].name.length, 120);
  assert.equal(parseSchedule(`13:00 ${"名".repeat(121)}`), null);
  assert.match(scheduleError(`13:00 ${"名".repeat(121)}`), /120/);
});

test("unknown or missing pipe markers and extra pipes are rejected", () => {
  for (const input of ["13:00 | 活动 | 可调整", "13:00 活动 | 未知", "13:00 活动 |", "13:00 | 活动 |"]) {
    assert.equal(parseSchedule(input), null, input);
    assert.match(scheduleError(input), /标记/, input);
  }
  assert.equal(parseSchedule("13:00 | 活动 | 固定 | 备注"), null);
  assert.equal(parseSchedule("13:00 活动 | 另一活动 | 灵活"), null);
});

test("blank lines and CRLF preserve the original line number of a later error", () => {
  assert.deepEqual(parseSchedule(" \r\n\t"), []);
  assert.equal(scheduleError(" \r\n\t"), null);
  assert.match(scheduleError("\n13:00 活动\r\n \r\n24:00 第二项"), /^第 4 行：.*时间/);
  assert.equal(parseSchedule("\n13:00 活动\r\n \r\n14:00 第二项")?.length, 2);
});

test("at most 30 nonempty rows are accepted, with the overflowing physical line identified", () => {
  const thirty = Array.from({ length: 30 }, (_, index) => `13:00 活动${index + 1}`).join("\n");
  assert.equal(parseSchedule(thirty)?.length, 30);
  const thirtyOne = `\n${thirty}\n\n14:00 超出活动`;
  assert.equal(parseSchedule(thirtyOne), null);
  assert.match(scheduleError(thirtyOne), /^第 33 行：.*30/);
});

test("input validation accepts the reported reservation through the shared parser", () => {
  const input = {
    intention: "未指定", colorTone: "未指定", fatigue: null, subjectiveStress: null,
    ambientPreferences: [], profileMemoryNotes: "", consent: true,
    trip: {
      originCity: "上海", destinationCity: "杭州", departureDate: "2026-10-03",
      departureTimezone: "Asia/Shanghai", destinationTimezone: "Asia/Shanghai", returnDate: "2026-10-04",
      planningStyle: "flexible", itineraryText: "13:00 omarchy cn meetup", requestedServices: [], foodPreferences: "",
    },
  };
  assert.equal(validateInput(input)?.trip.itineraryText, input.trip.itineraryText);
  assert.equal(validateInput({ ...input, trip: { ...input.trip, itineraryText: "25:00 omarchy cn meetup" } }), null);
});
