import * as searchRouting from "../travel-search-routing.ts";
import * as adjustPrompts from "./adjust-prompts.ts";
import * as adjustHealth from "./adjust-health.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadModule, plain } from "../test-support/module-loader.mjs";

const places = loadModule("lib/places.ts");
const skill = loadModule("lib/planning/inventory.ts", { "@/lib/places": places, "../travel-search-routing": searchRouting });
const contract = loadModule("lib/planning/contract.ts");
const verifiedSource = { name: "真实检索来源", category: "景点与体验", url: "https://example.com/verified", price: null };
function worker(searchFlyai) {
  return loadModule("lib/planning/providers/bailian-model.ts", {
    "@/lib/places": places, "@/lib/upstream-response": {}, "@/lib/bailian-output": {},
    "@/lib/flyai": { searchFlyai }, "../adjust-prompts": adjustPrompts, "../adjust-health": adjustHealth, "../prompts": {}, "../schema": {},
    "../validation": {}, "../contract": contract, "../inventory": skill,
  });
}
const trip = { originCity: "上海", destinationCity: "亚龙湾", departureDate: "2026-10-16", returnDate: "2026-10-17", requestedServices: ["flights", "attractions"] };
const signal = new AbortController().signal;

test("both inventory transports search the area's transport city for flights and retain the area for experiences", async () => {
  const { commands } = skill.skillInventoryQueries({ input: { trip }, timing: { arrivalDate: trip.departureDate } });
  assert.match(commands[0].command, /--destination '三亚'/);
  assert.match(commands[1].command, /亚龙湾/);
  const calls = [];
  await worker(async (tool, args) => { calls.push({ tool, args }); return { sources: [verifiedSource] }; }).flyaiInventory(signal, trip, trip.departureDate);
  assert.equal(calls.find(call => call.tool === "search_flight").args.destination, "三亚");
  assert.equal(calls.find(call => call.tool === "search_poi").args.cityName, "亚龙湾");
});

test("an unmapped area never goes to the flight API and its missing coverage is reported", async () => {
  const unknown = { ...trip, destinationCity: "尚未确认的区域" };
  const { commands, unsearchedCategories } = skill.skillInventoryQueries({ input: { trip: unknown }, timing: { arrivalDate: trip.departureDate } });
  assert.ok(commands.every(item => !item.command.includes("search-flight")));
  assert.deepEqual(plain(unsearchedCategories), ["航班（区域尚未确定交通城市）"]);
  const calls = [];
  const result = await worker(async (tool) => { calls.push(tool); return { sources: [verifiedSource] }; }).flyaiInventory(signal, unknown, trip.departureDate);
  assert.ok(!calls.includes("search_flight"));
  assert.deepEqual(plain(result.failedCategories), plain(unsearchedCategories));
});

test("Worker inventory rejects wholly empty data and marks individual empty categories", async () => {
  await assert.rejects(worker(async () => ({ sources: [] })).flyaiInventory(signal, trip, trip.departureDate), { code: "NO_VERIFIED_FLYAI_SOURCE" });
  const result = await worker(async tool => ({ sources: tool === "search_flight" ? [] : [verifiedSource] })).flyaiInventory(signal, trip, trip.departureDate);
  assert.deepEqual(plain(result.failedCategories), ["航班"]);
  assert.equal(result.failedSearches, 1);
});

test("a city and its local area do not trigger an invalid flight query to the same city", async () => {
  const nearby = { ...trip, originCity: "三亚" };
  const commands = skill.skillInventoryQueries({ input: { trip: nearby }, timing: { arrivalDate: trip.departureDate } });
  assert.ok(commands.commands.every(item => !item.command.includes("search-flight")));
  const result = await worker(async tool => {
    assert.notEqual(tool, "search_flight");
    return { sources: [verifiedSource] };
  }).flyaiInventory(signal, nearby, trip.departureDate);
  assert.deepEqual(plain(result.failedCategories), ["航班（出发地与目的地位于同一交通城市）"]);
});

test("Worker publishes the first verified category without waiting for a slower search", async () => {
  let release; const delayed = new Promise(resolve => { release = resolve; });
  const batches = [];
  const running = worker(async tool => tool === 'search_flight' ? delayed : { sources: [verifiedSource] })
    .flyaiInventory(signal, trip, trip.departureDate, sources => batches.push(plain(sources)));
  await new Promise(setImmediate);
  assert.equal(batches.length, 1); assert.equal(batches[0][0].name, verifiedSource.name);
  release({ sources: [] }); const final = await running;
  assert.equal(final.sources.length, 1); assert.equal(final.failedSearches, 1);
});
