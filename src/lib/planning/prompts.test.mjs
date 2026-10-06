import assert from "node:assert/strict";
import { test } from "node:test";
import { loadModule, plain } from "../test-support/module-loader.mjs";

const plannerInput = loadModule("lib/planner-input.ts");
const { resolveTripTiming } = loadModule("lib/trip-timing.ts", { "./planner-input": plannerInput });
const { composePlanPrompt } = loadModule("lib/planning/prompts.ts", { "./schema": loadModule("lib/planning/schema.ts"), "@/lib/planner-input": plannerInput });
const { validateComposedPlan } = loadModule("lib/planning/validation.ts", { "./contract": loadModule("lib/planning/contract.ts") });

function fixture(trip = {}, fixedItems = []) {
  const input = { trip: {
    originCity: "上海", destinationCity: "杭州", departureDate: "2026-10-03", returnDate: "2026-10-05",
    departureTimezone: "Asia/Shanghai", destinationTimezone: "Asia/Shanghai", requestedServices: ["attractions"],
    guardrails: { protectReservations: true, morningLight: true, sensoryBreaks: true }, ...trip,
  } };
  const ctx = { input, timing: resolveTripTiming(input), fixedItems, requestId: "prompt-arrival-qa" };
  const text = composePlanPrompt(ctx, { health: null, local: null, inventory: {
    sources: [{ name: "实际检索商品", category: "景点与体验", url: "https://example.com/verified-source", price: null }],
    searches: 1, failedSearches: 0, failedCategories: [], executor: "agent_skill",
  } });
  const data = JSON.parse(text.split("行程请求：")[1]);
  return { ctx, text, data };
}

test("composition receives the same local arrival boundary that output validation enforces", () => {
  const { ctx, text, data } = fixture();
  assert.equal(data.arrival_utc, "2026-10-03T07:00:00.000Z");
  assert.equal(data.arrival_local, "2026-10-03T15:00");
  assert.equal(data.first_day_earliest_time, "15:00");
  assert.equal(data.itinerary_timezone, "Asia/Shanghai");
  assert.deepEqual(data.planning_date_window, { start_date: "2026-10-03", end_date: "2026-10-05", days: 3 });
  assert.match(text, /首日所有非固定项的 time 必须大于或等于 first_day_earliest_time/);
  const itinerary = ["2026-10-03", "2026-10-04", "2026-10-05"].map((date) => ({ date, time: data.first_day_earliest_time, name: "休息", detail: "", fixed: false }));
  assert.equal(validateComposedPlan({ itinerary }, ctx).itinerary[0].time, "15:00");
  assert.throws(() => validateComposedPlan({ itinerary: [{ ...itinerary[0], time: "07:00" }, ...itinerary.slice(1)] }, ctx), { code: "PLAN_BEFORE_ARRIVAL_BUFFER" });
});

test("cross-zone composition uses the derived destination arrival date rather than departure or UTC clocks", () => {
  const { data, ctx } = fixture({ originCity: "洛杉矶", destinationCity: "东京", departureTimezone: "America/Los_Angeles", destinationTimezone: "Asia/Tokyo" });
  assert.equal(data.trip.departureDate, "2026-10-03");
  assert.equal(data.arrival_utc, "2026-10-04T06:00:00.000Z");
  assert.equal(data.arrival_local, "2026-10-04T15:00");
  assert.equal(data.first_day_earliest_time, "15:00");
  assert.equal(data.itinerary_timezone, "Asia/Tokyo");
  assert.deepEqual(data.planning_date_window, { start_date: ctx.timing.arrivalDate, end_date: "2026-10-05", days: 2 });
});

test("morning preference cannot override arrival or change existing earlier reservations", () => {
  const fixed = { date: "2026-10-03", time: "10:00", name: "用户已确认预约", fixed: true };
  const { ctx, text, data } = fixture({ returnDate: "2026-10-03" }, [fixed]);
  assert.deepEqual(data.itinerary, [fixed]);
  assert.deepEqual(plain(ctx.fixedItems), [fixed]);
  assert.match(text, /若首日抵达时清晨已过，则从下一天实施/);
  assert.match(text, /若当天即返程，说明本次无可行清晨时段/);
  assert.match(text, /若固定日程早于暂估抵达时间，保留原项并在 adjustments 提示核对交通安排/);
  assert.match(text, /不得把新增活动标成 fixed=true/);
  assert.equal(validateComposedPlan({ itinerary: [{ ...fixed, detail: "保留，需核对交通" }] }, ctx).itinerary[0].time, "10:00");
});

test("inactive guardrails do not send rules that the model could mistake for selected preferences", () => {
  for (const guardrails of [null, { morningLight: false, protectReservations: false, sensoryBreaks: false }]) {
    const { text } = fixture({ guardrails });
    assert.ok(!text.includes("morningLight=true"));
    assert.ok(!text.includes("sensoryBreaks=true"));
    assert.ok(!text.includes("清晨户外"));
    assert.match(text, /本次没有额外行程守护/);
  }
});

test("flexible typed activities reach composition without becoming fixed reservations", () => {
  const fixed = { date: "2026-10-03", time: "13:00", name: "omarchy cn meetup", fixed: true };
  const { data, text } = fixture({ itineraryText: "13:00 omarchy cn meetup\n17:00 喝茶 | 灵活" }, [fixed]);
  assert.deepEqual(data.itinerary, [fixed]);
  assert.deepEqual(data.flexible_itinerary, [{ date: "2026-10-03", time: "17:00", name: "喝茶", fixed: false }]);
  assert.match(text, /允许调整时间，不得改成 fixed=true/);
  assert.equal(Object.hasOwn(data.trip, "itineraryText"), false);
});

test("composition caps inventory by category while preserving original source indices and fixed input once", () => {
  const fixed = { date: "2026-10-03", time: "17:00", name: "唯一预约字段", fixed: true };
  const { ctx } = fixture({}, [fixed]);
  const sources = Array.from({ length: 30 }, (_, index) => ({ name: `商品${index}`, category: index < 20 ? "住宿" : "体验", url: `https://example.com/${index}`, price: null }));
  const text = composePlanPrompt(ctx, { health: null, local: null, inventory: { sources, failedCategories: [], searches: 2, failedSearches: 0, executor: "worker" } });
  const data = JSON.parse(text.split("行程请求：")[1]);
  assert.equal(data.flyai_sources.length, 12);
  assert.equal(data.flyai_sources.filter((source) => source.category === "体验").length, 6);
  assert.equal(data.flyai_sources[1].source_index, 20);
  assert.ok(data.flyai_sources.every((source) => sources[source.source_index].name === source.name));
  assert.equal(text.split("唯一预约字段").length - 1, 1);
});
