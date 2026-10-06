import assert from "node:assert/strict";
import { test } from "node:test";
import { activityTags, dayLoad, activeMinutes } from "./tags.ts";
import { bodyStatus } from "./status.ts";
import { reflow, feasible, ReflowError } from "./reflow.ts";
import { instantProposals } from "./rules.ts";
import { parseAdvisorProposals, mergeProposals, markConflicts, resolveAccepted, bundle } from "./validate.ts";

const day = "2026-10-12", next = "2026-10-13";
const trip = { departureDate: day, returnDate: next };
const scope = { date: day, fromTime: "13:00", throughDate: next };
const row = (id, time, name, extra = {}) => ({ id: `activity-${id}`, date: day, time, name, detail: "", fixed: false, ...extra });
const plan = () => [
  row("arrive", "09:00", "抵达杭州并稍作休整"),
  row("wetland", "14:00", "西溪国家湿地公园·步行游览", { durationMin: 120 }),
  row("booking", "16:30", "灵隐寺预约参观", { fixed: true, durationMin: 60 }),
  row("dinner", "18:00", "楼外楼·杭帮菜晚餐"),
  row("night", "20:00", "河坊街夜市漫步"),
  { ...row("museum", "09:00", "浙江省博物馆"), date: next },
  { ...row("lake", "11:00", "西湖环湖徒步"), date: next },
];
const byId = (items, id) => items.find((item) => item.id === `activity-${id}`);
const low = () => bodyStatus({ checkIn: { fatigue: 4, stress: null, tags: ["legs_tired"] } });

test("activity tags read stored structure first and fall back to the words of older plans", () => {
  assert.deepEqual({ ...activityTags(row("a", "10:00", "西湖环湖徒步")) }, { kind: "experience", effort: 3, durationMin: 90, inferred: true });
  assert.equal(activityTags(row("b", "10:00", "足疗按摩")).kind, "relax");
  assert.equal(activityTags(row("c", "10:00", "抵达杭州并稍作休整")).kind, "rest");
  assert.equal(activityTags(row("d", "10:00", "西溪湿地·摇橹船与品茗", { detail: "乘船深入湿地，步行极少。" })).effort, 1);
  assert.deepEqual({ ...activityTags(row("e", "10:00", "随便走走", { kind: "meal", effort: 1, durationMin: 50 })) }, { kind: "meal", effort: 1, durationMin: 50, inferred: false });
  const load = dayLoad(plan(), day);
  assert.equal(load.find((item) => item.id === "activity-wetland").minutes, 120);
  assert.equal(load.find((item) => item.id === "activity-dinner").minutes, 75);
  assert.ok(activeMinutes(load) > 0);
});

test("the traveller's own report outranks a device record, and no reading is treated as a diagnosis", () => {
  const device = bodyStatus({ summary: { recoveryScore: 28, sleepMinutes: 290, cycleSteps: null } });
  assert.equal(device.level, "low"); assert.equal(device.energy, "low");
  assert.ok(device.needs.includes("rest") && device.needs.includes("early_night"));
  const overridden = bodyStatus({ summary: { recoveryScore: 28, sleepMinutes: null, cycleSteps: null }, checkIn: { fatigue: 1, stress: null, tags: ["energetic"] } });
  assert.equal(overridden.level, "watch");
  assert.ok(!overridden.needs.includes("less_walking"));
  assert.equal(bodyStatus({}).level, "unknown"); assert.equal(bodyStatus({}).energy, null);
  assert.equal(bodyStatus({ summary: { recoveryScore: null, sleepMinutes: null, cycleSteps: null } }).level, "unknown");
  const hungry = bodyStatus({ checkIn: { fatigue: null, stress: null, tags: ["hungry"] } });
  assert.deepEqual(hungry.needs, ["comfort_food"]); assert.equal(hungry.level, "good");
  const jet = bodyStatus({ timezoneShiftHours: -7, tripDayIndex: 0 });
  assert.equal(jet.level, "watch"); assert.ok(jet.needs.includes("early_night"));
  for (const status of [device, overridden, hungry, jet]) for (const reason of status.reasons) assert.doesNotMatch(reason.text, /诊断|疾病|治疗|异常/);
});

test("a new stop pushes flexible activities back and shrinks to fit before a fixed reservation", () => {
  const stop = { type: "add_stop", date: day, afterActivityId: "activity-wetland", durationMin: 45, name: "坐下来歇一会儿", detail: "", kind: "rest", effort: 1 };
  const result = reflow(plan(), [stop], trip, scope);
  const added = result.itinerary.find((item) => item.name === "坐下来歇一会儿");
  assert.equal(added.time, "16:00"); assert.equal(added.durationMin, 30);
  assert.equal(byId(result.itinerary, "booking").time, "16:30");
  const after = { ...stop, afterActivityId: "activity-dinner", durationMin: 60 };
  const pushed = reflow(plan(), [after], trip, scope);
  assert.equal(pushed.itinerary.find((item) => item.name === "坐下来歇一会儿").time, "19:15");
  assert.equal(byId(pushed.itinerary, "night").time, "20:15");
  assert.equal(byId(pushed.itinerary, "booking").time, "16:30");
  assert.equal(plan()[4].time, "20:00");
});

test("fixed reservations, the past and impossible slots make a template infeasible instead of reshaping it", () => {
  assert.throws(() => reflow(plan(), [{ type: "drop", activityId: "activity-booking" }], trip, scope), ReflowError);
  assert.throws(() => reflow(plan(), [{ type: "shift", activityId: "activity-booking", minutes: 30 }], trip, scope), /固定预约/);
  assert.throws(() => reflow(plan(), [{ type: "drop", activityId: "activity-arrive" }], trip, scope), /已经过去/);
  assert.equal(feasible(plan(), [{ type: "shift", activityId: "activity-wetland", minutes: 150 }], trip, scope), false);
  assert.equal(feasible(plan(), [{ type: "drop", activityId: "activity-missing" }], trip, scope), false);
  assert.equal(feasible(plan().map((item) => ({ ...item, id: undefined })), [{ type: "drop", activityId: "activity-night" }], trip, scope), false);
  const moved = reflow(plan(), [{ type: "swap_move", activityId: "activity-booking", mode: "taxi", minutes: 9, km: 3.2, costCny: 18, basis: "amap" }], trip, scope);
  assert.deepEqual({ ...byId(moved.itinerary, "booking").move }, { mode: "taxi", basis: "amap", minutes: 9, km: 3.2, costCny: 18 });
  assert.equal(byId(moved.itinerary, "booking").time, "16:30");
});

test("postponing, shortening and ending early keep every day covered", () => {
  const later = reflow(plan(), [{ type: "postpone", activityId: "activity-night", date: next, time: "09:00" }], trip, scope);
  assert.equal(byId(later.itinerary, "night").date, next);
  assert.equal(byId(later.itinerary, "museum").time, "10:30");
  assert.equal(byId(later.itinerary, "lake").time, "12:00");
  const early = reflow(plan(), [{ type: "end_early", afterActivityId: "activity-dinner" }], trip, scope);
  assert.equal(byId(early.itinerary, "night"), undefined);
  assert.equal(byId(early.itinerary, "booking").time, "16:30");
  const shorter = reflow(plan(), [{ type: "shorten", activityId: "activity-wetland", durationMin: 60 }], trip, scope);
  assert.equal(byId(shorter.itinerary, "wetland").durationMin, 60);
  assert.equal(feasible(plan(), [{ type: "shorten", activityId: "activity-wetland", durationMin: 200 }], trip, scope), false);
});

test("instant proposals rearrange the day without naming a venue or quoting a figure", () => {
  const proposals = instantProposals({ itinerary: plan(), trip, scope, status: low(), stance: "treat" });
  assert.ok(proposals.length >= 3 && proposals.length <= 4);
  assert.ok(proposals.some((proposal) => proposal.angle === "pace") && proposals.some((proposal) => proposal.angle === "mobility"));
  const move = proposals.find((proposal) => proposal.angle === "mobility");
  assert.deepEqual({ ...move.templates[0] }, { type: "swap_move", activityId: "activity-wetland", mode: "taxi", basis: "unverified" });
  assert.equal(move.effect.costCny, undefined); assert.equal(move.effect.walkMinutes, undefined);
  for (const proposal of proposals) {
    assert.equal(proposal.tier, "instant"); assert.equal(proposal.source, undefined);
    assert.ok(proposal.signals.length > 0);
    assert.ok(feasible(plan(), proposal.templates, trip, scope));
    for (const template of proposal.templates) assert.notEqual(template.activityId, "activity-booking");
  }
  const frugal = instantProposals({ itinerary: plan(), trip, scope, status: bodyStatus({ checkIn: { fatigue: 3, stress: null, tags: ["legs_tired"] } }), stance: "save" });
  assert.equal(frugal.find((proposal) => proposal.angle === "mobility").templates[0].mode, "transit");
  assert.deepEqual(instantProposals({ itinerary: plan(), trip, scope, status: bodyStatus({ checkIn: { fatigue: 1, stress: null, tags: ["energetic"] } }), stance: "balanced" }), []);
});

test("sleep, hunger and calm each produce their own kind of suggestion", () => {
  const sleepy = instantProposals({ itinerary: plan(), trip, scope, status: bodyStatus({ checkIn: { fatigue: null, stress: null, tags: ["poor_sleep"] } }), stance: "balanced" });
  assert.deepEqual(sleepy.map((proposal) => proposal.templates[0].type).sort(), ["end_early", "shift"]);
  const hungry = instantProposals({ itinerary: plan(), trip, scope, status: bodyStatus({ checkIn: { fatigue: null, stress: null, tags: ["hungry"] } }), stance: "balanced" });
  assert.equal(hungry.length, 1); assert.equal(hungry[0].angle, "food"); assert.equal(hungry[0].templates[0].name, "找个地方吃点东西");
  const tense = instantProposals({ itinerary: plan(), trip, scope, status: bodyStatus({ checkIn: { fatigue: null, stress: 4, tags: [] } }), stance: "balanced" });
  assert.ok(tense.some((proposal) => proposal.action === "breathing" && proposal.templates.length === 0));
  assert.ok(tense.some((proposal) => proposal.templates[0]?.name === "安静地待一会儿"));
});

const sources = [
  { name: "西溪足道·60分钟足疗", url: "https://item.fliggy.com/item.htm?id=11", category: "按摩", kind: "fliggy_product", price: "¥128", imageUrl: "https://img.alicdn.com/a.jpg" },
  { name: "知味观·片儿川", url: "https://item.fliggy.com/item.htm?id=12", category: "当地餐食", kind: "fliggy_product", price: null },
];
const routes = [{ toActivityId: "activity-dinner", km: 2.1, walkMinutes: 28, transitMinutes: 16, taxiMinutes: 9, taxiCostCny: 18 }];
const context = () => ({ itinerary: plan(), trip, scope, sources, routes, allowWhoopSignals: false });
const advice = (overrides) => ({ angle: "relief", template: "add_stop", activity_id: "activity-dinner", title: "晚饭后做个足疗", reason: "走了一天，坐下来放松一小时。", signals: ["self_fatigue", "whoop_recovery"], minutes: 60, date: "", time: "", mode: "", stop: "", source_index: 0, source_name: sources[0].name, ...overrides });

test("advisor rows are rebuilt from retrieved sources and map facts, never from the model's own claims", () => {
  const { proposals, dropped } = parseAdvisorProposals({ proposals: [
    advice({}),
    advice({ angle: "mobility", template: "swap_move", activity_id: "activity-dinner", title: "去晚饭这一段打车", reason: "少走一段路。", mode: "taxi", source_index: -1, source_name: "", minutes: 3, }),
    advice({ source_name: "编造的另一家店" }),
    advice({ source_index: 9 }),
    advice({ source_index: -1, source_name: "", stop: "", title: "去一家网红店" }),
    advice({ reason: "按摩可以治疗腰椎疾病。" }),
    advice({ template: "drop", activity_id: "activity-booking", source_index: -1, source_name: "" }),
    advice({ template: "drop", activity_id: "activity-arrive", source_index: -1, source_name: "" }),
    advice({ angle: "unknown" }),
  ] }, context());
  assert.equal(proposals.length, 2); assert.equal(dropped, 7);
  const [relief, taxi] = proposals;
  assert.equal(relief.source.url, sources[0].url); assert.equal(relief.source.imageUrl, sources[0].imageUrl);
  assert.equal(relief.templates[0].name, sources[0].name); assert.equal(relief.templates[0].kind, "relax");
  assert.deepEqual(relief.effect.costCny, [128, 128]); assert.equal(relief.effect.basis, "source");
  assert.deepEqual(relief.signals, ["self_fatigue"]);
  assert.deepEqual({ ...taxi.templates[0] }, { type: "swap_move", activityId: "activity-dinner", mode: "taxi", minutes: 9, basis: "amap", km: 2.1, costCny: 18 });
  assert.deepEqual({ ...taxi.effect }, { basis: "amap", walkMinutes: -28, timeMinutes: -19, costCny: [18, 18] });
  const unverified = parseAdvisorProposals({ proposals: [advice({ angle: "mobility", template: "swap_move", activity_id: "activity-night", mode: "transit", source_index: -1, source_name: "" })] }, context());
  assert.deepEqual({ ...unverified.proposals[0].templates[0] }, { type: "swap_move", activityId: "activity-night", mode: "transit", basis: "unverified" });
  assert.deepEqual({ ...unverified.proposals[0].effect }, { basis: "none" });
  assert.deepEqual(parseAdvisorProposals("not json", context()), { proposals: [], dropped: 0 });
});

test("accepted proposals apply in order, and a conflicting pair is named rather than half-applied", () => {
  const instant = instantProposals({ itinerary: plan(), trip, scope, status: low(), stance: "treat" });
  const { proposals: advisor } = parseAdvisorProposals({ proposals: [
    advice({}),
    advice({ angle: "pace", template: "postpone", activity_id: "activity-night", title: "夜市挪到明天", reason: "今晚早点休息。", date: next, time: "20:00", source_index: -1, source_name: "" }),
    advice({ angle: "pace", template: "drop", activity_id: "activity-night", title: "今晚不去夜市", reason: "直接回住处。", source_index: -1, source_name: "" }),
  ] }, context());
  const all = markConflicts(mergeProposals(instant, advisor), plan(), trip, scope);
  const postpone = all.find((proposal) => proposal.title === "夜市挪到明天"), drop = all.find((proposal) => proposal.title === "今晚不去夜市");
  assert.ok(postpone.conflictsWith.includes(drop.id) && drop.conflictsWith.includes(postpone.id));
  assert.equal(all.filter((proposal) => proposal.id.startsWith("instant:postpone")).length, 0);
  const relief = all.find((proposal) => proposal.source);
  const applied = resolveAccepted(all, [relief.id, postpone.id], plan(), trip, scope);
  assert.equal(applied.itinerary.find((item) => item.sourceUrl === sources[0].url).time, "19:15");
  assert.equal(byId(applied.itinerary, "night").date, next);
  assert.equal(byId(applied.itinerary, "booking").time, "16:30");
  assert.ok(applied.operations.length >= 2);
  assert.throws(() => resolveAccepted(all, [postpone.id, drop.id], plan(), trip, scope), /今晚不去夜市/);
  assert.throws(() => resolveAccepted(all, ["missing"], plan(), trip, scope), /已失效/);
  const treat = bundle(all, "treat", "treat"), minimal = bundle(all, "minimal", "balanced");
  assert.ok(treat.includes(relief.id));
  assert.ok(minimal.length <= 2 && !minimal.includes(relief.id) && !minimal.includes(drop.id));
});
