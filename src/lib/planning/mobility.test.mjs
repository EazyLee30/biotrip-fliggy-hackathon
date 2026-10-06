import assert from "node:assert/strict";
import { test } from "node:test";
import { createMobilityEvidence, mobilityLegs, mobilityPrompt } from "./mobility.ts";
import { reflow } from "../adjust/reflow.ts";

const leg = { fromActivityId: "activity-westlake", toActivityId: "activity-temple", fromName: "西湖", toName: "灵隐寺" };
const event = (type, id, data, extra = {}) => ({ id: `${type}:${id}`, type, status: "completed", content: [{ type: "data", data: { call_id: id, ...data } }], ...extra });
const call = (collector, id, name, args) => collector.accept(event("mcp_call", id, { name, arguments: JSON.stringify(args) }));
const output = (collector, id, value, extra) => collector.accept(event("mcp_call_output", id, { output: JSON.stringify({ content: [{ type: "text", text: JSON.stringify(value) }], isError: false }) }, extra));
function locations(collector, detail = false) {
  for (const [id, name, location] of [["a", "西湖", "120.1,30.2"], ["b", "灵隐寺", "120.2,30.3"]]) {
    call(collector, id, "maps_text_search", { keywords: name, city: "杭州" });
    output(collector, id, { pois: [{ id, name, ...(detail ? {} : { location }) }] });
    if (detail) {
      call(collector, `detail:${id}`, "maps_search_detail", { id });
      output(collector, `detail:${id}`, { id, name, location, city: "杭州市" });
    }
  }
}
const args = { origin: "120.1,30.2", destination: "120.2,30.3" };
test("official MCP output is bound through paired search/detail events, seconds and metres are converted", () => {
  const c = createMobilityEvidence("杭州", [leg]); locations(c, true);
  call(c, "walk", "maps_direction_walking", args); output(c, "walk", { route: { ...args, paths: [{ duration: "1680", distance: "2100" }] } });
  call(c, "drive", "maps_direction_driving", args); output(c, "drive", { route: { ...args, taxi_cost: "18", paths: [{ duration: "540", distance: "2100" }] } });
  call(c, "transit", "maps_direction_transit_integrated", { ...args, city: "杭州", cityd: "杭州" }); output(c, "transit", { route: { transits: [{ duration: "1200" }] } });
  assert.deepEqual(c.result(), [{ toActivityId: "activity-temple", fromActivityId: "activity-westlake", walkMinutes: 28, taxiMinutes: 9, transitMinutes: 20, km: 2.1, taxiCostCny: 18 }]);
  output(c, "drive", { route: { paths: [{ duration: "1" }] } }); assert.equal(c.result()[0].taxiMinutes, 9);
});
test("missing fares stay missing; v5 cost.duration is accepted without inventing a taxi fare", () => {
  const c = createMobilityEvidence("杭州", [leg]); locations(c);
  call(c, "drive", "maps_direction_driving", args); output(c, "drive", { route: { paths: [{ cost: { duration: "541" }, distance: "2100" }] } });
  assert.equal(c.result()[0].taxiMinutes, 10); assert.equal(c.result()[0].taxiCostCny, undefined);
});
test("assistant text, orphan output, failed output, wrong coordinates and ambiguous POIs never become facts", () => {
  for (const situation of ["assistant", "orphan", "error", "wrong-origin", "ambiguous", "wrong-returned-origin"]) {
    const c = createMobilityEvidence("杭州", [leg]); locations(c);
    if (situation === "ambiguous") {
      call(c, "duplicate", "maps_text_search", { keywords: "西湖", city: "杭州" });
      output(c, "duplicate", { pois: [{ name: "西湖", location: "121,31" }] });
    }
    const route = { route: { ...(situation === "wrong-returned-origin" ? { origin: "121,31" } : {}), paths: [{ duration: "540" }] } };
    if (!["orphan", "assistant"].includes(situation)) call(c, "drive", "maps_direction_driving", { ...args, ...(situation === "wrong-origin" ? { origin: "121,31" } : {}) });
    if (situation === "assistant") c.accept(event("message", "drive", { output: JSON.stringify(route) }));
    else output(c, "drive", route, { is_error: situation === "error" });
    assert.deepEqual(c.result(), [], situation);
  }
});
test("unrelated searches, detail IDs, write tools and excess calls are rejected", () => {
  const c = createMobilityEvidence("杭州", [leg]);
  assert.equal(call(c, "wrong-city", "maps_text_search", { keywords: "西湖", city: "北京" }), "MOBILITY_UNEXPECTED_QUERY");
  assert.equal(call(c, "detail", "maps_search_detail", { id: "made-up" }), "MOBILITY_UNEXPECTED_QUERY");
  assert.equal(call(c, "write", "maps_create_map", {}), "MOBILITY_TOOL_FORBIDDEN");
  assert.equal(c.accept(event("tool_call", "bash", { name: "bash" })), "MOBILITY_TOOL_FORBIDDEN");
  for (let i = 0; i < 16; i++) assert.equal(call(c, String(i), "maps_text_search", { keywords: "西湖", city: "杭州" }), null);
  assert.equal(call(c, "17", "maps_text_search", { keywords: "西湖", city: "杭州" }), "MOBILITY_CALL_LIMIT");
});
test("only adjacent same-day named stops are queried; prompts exclude health and personal context", () => {
  const ctx = { input: { itinerary: [
    { id: "a", date: "2026-10-12", name: "西湖·晨间散步", fixed: false },
    { id: "b", date: "2026-10-12", name: "灵隐寺参观", fixed: false },
    { id: "c", date: "2026-10-13", name: "雷峰塔", fixed: false },
    { id: "d", date: "2026-10-13", name: "午餐", fixed: false },
  ], selfReport: { fatigue: 5 }, healthMetrics: { private: "secret" } } };
  const legs = mobilityLegs(ctx); assert.equal(legs.length, 1);
  const prompt = mobilityPrompt("杭州", legs); assert.doesNotMatch(prompt, /secret|fatigue|2026-/);
});
test("accepting another edit that removes the verified route origin invalidates the map proposal in either order", () => {
  const date = "2026-10-12";
  const itinerary = [
    { id: "activity-westlake", date, time: "10:00", name: "西湖", detail: "", fixed: false },
    { id: "activity-temple", date, time: "14:00", name: "灵隐寺", detail: "", fixed: false },
  ];
  const trip = { departureDate: date, returnDate: date };
  const scope = { date, throughDate: date, fromTime: "00:00" };
  const move = { type: "swap_move", activityId: "activity-temple", fromActivityId: "activity-westlake", fromActivityName: "西湖", mode: "taxi", minutes: 9, basis: "amap" };
  assert.equal(reflow(itinerary, [move], trip, scope).itinerary[1].move.minutes, 9);
  const drop = { type: "drop", activityId: "activity-westlake" };
  for (const templates of [[move, drop], [drop, move]]) assert.throws(() => reflow(itinerary, templates, trip, scope), /路线起点已变化/);
});
