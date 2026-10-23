import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readProjectFile, loadModule, plain } from "./test-support/module-loader.mjs";
import * as routing from "./travel-search-routing.ts";
import * as relevance from "./travel-search-relevance.ts";
import { extractFlyaiSources } from "./planning/flyai-sources.ts";

test("all eight search intents map to official CLI/MCP fields without guessed flags", () => {
  const examples = [
    [{ kind: "flight", origin: "上海", destination: "东京", departureDate: "2026-11-01", directOnly: true, maxDurationHours: 5 }, "search_flight", "journeyType", 1],
    [{ kind: "train", origin: "上海", destination: "杭州", departureDate: "2026-11-01", sort: "duration_asc" }, "search_domestic_train", "sortType", 4],
    [{ kind: "hotel", city: "杭州", checkInDate: "2026-11-01", checkOutDate: "2026-11-03", nearby: "西湖" }, "search_hotels", "checkOutDate", "2026-11-03"],
    [{ kind: "poi", city: "杭州", category: "博物馆" }, "search_poi", "category", "博物馆"],
    [{ kind: "marriott_hotel", city: "上海", brands: ["喜来登"] }, "search_marriott_hotels", "keyWords", "喜来登"],
    [{ kind: "marriott_package", keyword: "杭州", sort: "price_asc" }, "search_marriott_packages", "sortType", "price_asc"],
    [{ kind: "keyword", query: "香港 SIM卡" }, "fliggy_fast_search", "query", "香港 SIM卡"],
    [{ kind: "semantic", query: "东京市中心有早餐的酒店" }, "fliggy_ai_search", "query", "东京市中心有早餐的酒店"],
  ];
  for (const [intent, tool, key, expected] of examples) { const query = routing.travelQueries(intent)[0]; assert.equal(query.tool, tool); assert.equal(query.args[key], expected); assert.equal(query.queryKey.length, 64); }
  assert.doesNotMatch(routing.travelQueries(examples[4][0])[0].command, /hotel-brands/);
});

test("query router deduplicates exact searches, bounds calls, rejects invalid dates and body/identity fields", () => {
  assert.equal(routing.travelQueries([{ kind: "poi", city: "杭州" }, { kind: "poi", city: "杭州" }]).length, 1);
  for (const input of [Array(5).fill({ kind: "poi", city: "杭州" }), { kind: "hotel", city: "杭州", health: "private" }, { kind: "flight", origin: "上海", destination: "香港", departureDate: "2026-02-31" }, { kind: "keyword", query: "WHOOP fatigue 5/5 酒店" }, { kind: "semantic", query: "someone@example.com 的旅行" }, { kind: "marriott_hotel", city: "杭州", brands: ["HRV 38"] }, { kind: "hotel", city: "杭州", brands: ["someone@example.com"] }]) assert.throws(() => routing.travelQueries(input), /INVALID_SEARCH_INTENT/);
  const command = routing.travelQueries({ kind: "keyword", query: "杭州 O'Reilly $(unsafe)" })[0].command;
  assert.match(command, /O'\\''Reilly/); // Shell word stays literal in the Skill path.
});

test("documented flight/train response shapes yield real segments and adult prices, not discarded titles", () => {
  for (const [tool, kind] of [["search_flight", "flight"], ["search_domestic_train", "train"]]) {
    const data = { itemList: [{ adultPrice: "¥553", jumpUrl: "https://example.com/ticket", totalDuration: "268分钟", journeys: [{ segments: [{ depStationName: "北京南", arrStationName: "上海虹桥", depDateTime: "2026-11-01 08:00", arrDateTime: "2026-11-01 12:28", marketingTransportNo: "G11", seatClassName: "二等座" }] }] }] };
    const [offer] = extractFlyaiSources(data, "交通", 20, tool, "2026-10-19T00:00:00Z");
    assert.equal(offer.kind, kind); assert.equal(offer.price, "¥553"); assert.equal(offer.name, "北京南 → 上海虹桥 · G11");
    assert.equal(offer.transport.segments[0].departure, "2026-11-01 08:00"); assert.equal(offer.url, data.itemList[0].jumpUrl);
  }
});

test("known numeric flight/train durations include minutes in both segments and displayed facts", () => {
  for (const tool of ["search_flight", "search_domestic_train"]) {
    for (const atJourneyLevel of [false, true]) {
      const journey = { segments: [{ depStationName: "上海", arrStationName: "北京", duration: 120 }] };
      const item = { jumpUrl: "https://example.com/ticket", journeys: [journey] };
      for (const totalDuration of [150, "150"]) {
        (atJourneyLevel ? journey : item).totalDuration = totalDuration;
        const [offer] = extractFlyaiSources(item, "交通", 20, tool);
        assert.equal(offer.transport.duration, "150 分钟");
        assert.equal(offer.transport.segments[0].duration, "120 分钟");
        assert.deepEqual(offer.facts.find(fact => fact.label === "用时"), { label: "用时", value: "150 分钟" });
      }
    }
  }
});

test("duration text preserves provider wording and unknown tool units are not guessed", () => {
  const item = duration => ({ jumpUrl: "https://example.com/ticket", totalDuration: duration, journeys: [{ segments: [{ depStationName: "上海", arrStationName: "北京", duration }] }] });
  for (const tool of ["search_flight", "search_domestic_train"]) {
    for (const duration of ["140分钟", "2小时30分", "150", "待确认"]) {
      const [offer] = extractFlyaiSources(item(duration), "交通", 20, tool);
      assert.equal(offer.transport.duration, duration === "150" ? "150 分钟" : duration);
      assert.equal(offer.transport.segments[0].duration, duration);
    }
    for (const duration of [-1, Infinity, NaN, null]) {
      const [offer] = extractFlyaiSources(item(duration), "交通", 20, tool);
      assert.equal(offer.transport.duration, undefined);
      assert.equal(offer.transport.segments[0].duration, undefined);
      assert.ok(!offer.facts.some(fact => fact.label === "用时"));
    }
  }
  const [semantic] = extractFlyaiSources(item(150), "旅行", 20, "fliggy_ai_search");
  assert.equal(semantic.transport.duration, "150");
});

test("hotel/POI/package/keyword/semantic adapters select their documented facts and preserve missing prices", () => {
  const shapes = [
    ["search_hotels", { name: "湖畔酒店", detailUrl: "https://example.com/hotel", brandName: "酒店品牌", score: "4.8", mainPic: "https://img.alicdn.com/hotel.jpg", price: 618 }, "¥618", "品牌"],
    ["search_marriott_hotels", { name: "万豪酒店", detailUrl: "https://example.com/marriott", brandName: "JW万豪" }, null, "品牌"],
    ["search_poi", { name: "城市博物馆", jumpUrl: "https://example.com/poi", ticketInfo: { price: 0, ticketName: "普通票", priceDate: "2026-11-01" } }, "¥0", "票种"],
    ["search_marriott_packages", { name: "双人下午茶", detailUrl: "https://example.com/package", hotelName: "万豪酒店", sellingPoint: "双人下午茶" }, null, "酒店"],
    ["fliggy_fast_search", { title: "茶馆", jumpUrl: "https://example.com/tea", scoreDesc: "4.9" }, null, "评分"],
    ["fliggy_ai_search", { title: "茶馆", jumpUrl: "https://example.com/semantic", tags: ["早餐"] }, null, "标签"],
  ];
  for (const [tool, item, price, fact] of shapes) {
    const data = tool === "fliggy_ai_search" ? JSON.stringify({ itemList: [item] }) : { itemList: [item] };
    const offers = extractFlyaiSources(data, "旅行", 20, tool); assert.equal(offers.length, 1); assert.equal(offers[0].price, price); assert.ok(offers[0].facts.some(row => row.label === fact));
  }
  assert.deepEqual(extractFlyaiSources("推荐一家未核验的酒店，https://example.com/guess", "旅行", 20, "fliggy_ai_search"), []);
  assert.deepEqual(extractFlyaiSources({ name: "恶意地址", url: "https://key:secret@example.com" }, "旅行", 20, "search_poi"), []);
  for (const url of ["https://localhost/item", "https://127.0.0.1/item", "https://example.internal/item", "https://example.com:8443/item", "https://example.com/item?api_key=canary"]) {
    assert.deepEqual(extractFlyaiSources({ name: "不可显示的地址", url }, "旅行", 20, "fliggy_ai_search"), []);
  }
});

test("mixed search categories and prices come from returned products, never the requested tea scenario", () => {
  const query = routing.travelQueries({ kind: "semantic", query: "杭州西湖附近茶馆，可以坐下来喝茶" })[0];
  assert.equal(query.category, "旅行商品");
  const data = { itemList: [
    { name: "秋水山庄", hotelName: "秋水山庄", price: "10607", url: "https://example.com/hotel" },
    { title: "锦江之星", price: "194", url: "https://example.com/inn" },
    { poiName: "宋城", score: 4.9, priceDesc: "¥300起", url: "https://example.com/scenic" },
    { name: "价格待核验", score: 194, id: 10607, url: "https://example.com/unknown" },
    { title: "注明币种的产品", price: "US$25", url: "https://example.com/currency" },
  ] };
  const offers = extractFlyaiSources(JSON.stringify(data), "餐食与休息", 20, "fliggy_ai_search");
  assert.deepEqual(offers.map(offer => offer.category), ["酒店相关商品", "旅行商品", "景点相关商品", "旅行商品", "旅行商品"]);
  assert.deepEqual(offers.map(offer => offer.price), ["¥10607", "¥194", null, null, "US$25"]);
  assert.ok(offers.every(offer => !/茶|休息/.test(offer.category)));
});

test("tea relevance uses product evidence, not location or query-inferred category", () => {
  const query = routing.travelQueries({ kind: "semantic", query: "杭州西湖附近可以坐下来喝茶的地点或产品" })[0];
  const items = [
    { name: "灵隐寺", url: "https://example.com/temple", address: "茶馆旁边" },
    { name: "宋城", url: "https://example.com/themepark" },
    { name: "杭州动物世界", url: "https://example.com/zoo" },
    { name: "秋水山庄", hotelName: "秋水山庄", price: "10607", url: "https://example.com/hotel" },
    { name: "锦江之星", price: "194", url: "https://example.com/inn" },
    { name: "湖畔茶室", url: "https://example.com/tea" },
    { name: "双人体验套餐", tags: ["下午茶"], url: "https://example.com/package" },
  ];
  const offers = extractFlyaiSources({ itemList: items }, "餐食与休息", 20, "fliggy_ai_search");
  const result = relevance.relevantTravelOffers(offers, query);
  assert.deepEqual(result.offers.map(offer => offer.name), ["湖畔茶室", "双人体验套餐"]);
  assert.equal(result.code, "SEARCH_RELEVANCE_LIMITED");
  assert.match(relevance.searchRelevanceDetail(result.code), /能否入座、实际距离、营业状态与是否可单独使用仍需/);
  const hotels = routing.travelQueries({ kind: "semantic", query: "杭州西湖附近酒店" })[0];
  assert.equal(relevance.relevantTravelOffers(offers, hotels).offers.length, offers.length);
  const nearTea = routing.travelQueries({ kind: "semantic", query: "杭州湖畔茶馆附近酒店" })[0];
  assert.equal(relevance.relevantTravelOffers(offers, nearTea).offers.length, offers.length);
});

test("explicit coffee, meal and spa requests require service evidence, not hotel or scenic amenities", () => {
  const items = [
    { name: "秋水山庄", hotelName: "秋水山庄", tags: ["咖啡", "早餐", "SPA"], url: "https://example.com/hotel" },
    { poiName: "宋城", tags: ["餐厅", "咖啡", "按摩"], url: "https://example.com/scenic" },
    { name: "锦江之星", tags: ["早餐", "咖啡"], url: "https://example.com/unknown-inn" },
    { name: "湖畔温泉酒店", tags: ["SPA"], url: "https://example.com/spa-hotel" },
    { name: "湖畔咖啡馆", url: "https://example.com/cafe" },
    { name: "正午餐厅", url: "https://example.com/restaurant" },
    { name: "湖畔酒店 双人午餐套餐", url: "https://example.com/meal" },
    { name: "湖畔酒店 SPA按摩60分钟套餐", url: "https://example.com/spa" },
  ];
  const offers = extractFlyaiSources({ itemList: items }, "餐食与休息", 20, "fliggy_ai_search");
  for (const [queryText, expected] of [
    ["西湖附近可以喝咖啡的地方", ["湖畔咖啡馆"]],
    ["西湖附近吃饭的餐厅或午餐产品", ["正午餐厅", "湖畔酒店 双人午餐套餐"]],
    ["西湖附近按摩或SPA服务", ["湖畔酒店 SPA按摩60分钟套餐"]],
  ]) {
    const query = routing.travelQueries({ kind: "semantic", query: queryText })[0];
    assert.deepEqual(relevance.relevantTravelOffers(offers, query).offers.map(offer => offer.name), expected);
    const unmatched = relevance.relevantTravelOffers(offers.slice(0, 4), query);
    assert.equal(unmatched.offers.length, 0);
    assert.equal(unmatched.code, "SEARCH_NO_RELEVANT_MATCHES");
  }
  for (const queryText of ["杭州含早餐的酒店", "咖啡馆附近酒店", "杭州适合慢慢旅行的地方"]) {
    const query = routing.travelQueries({ kind: "semantic", query: queryText })[0];
    assert.equal(relevance.relevantTravelOffers(offers, query).offers.length, offers.length);
  }
});

export function searchFixture(search) {
  const sqlite = new DatabaseSync(":memory:"); sqlite.exec("PRAGMA foreign_keys=ON");
  sqlite.exec(readProjectFile("migrations/0001_accounts.sql")); sqlite.exec(readProjectFile("migrations/0002_password_auth.sql")); sqlite.exec(readProjectFile("migrations/0015_tool_receipts_cleanup.sql"));
  for (const id of ["account-one", "account-two"]) sqlite.prepare("INSERT INTO accounts(id,email) VALUES(?,?)").run(id, `${id}@example.invalid`);
  const db = { prepare(sql) { const stmt = sqlite.prepare(sql); let args = []; return { bind(...values) { args = values; return this; }, async first() { return stmt.get(...args) ?? null; }, async all() { return { results: stmt.all(...args) }; }, async run() { return stmt.run(...args); } }; } };
  class JourneyError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
  const service = loadModule("lib/travel-search.ts", { "./database": { getDatabase: () => db }, "./journeys": { JourneyError }, "./travel-search-routing": routing, "./travel-search-relevance": relevance, "./flyai": { searchFlyai: search } });
  return { sqlite, db, service };
}

test("one tea search with only hotel/scenic results persists an honest empty receipt and does not expand or repeat calls", async () => {
  let calls = 0;
  const f = searchFixture(async (tool, _args, _signal, category) => {
    calls++;
    return { sources: extractFlyaiSources({ itemList: [
      { name: "灵隐寺", url: "https://example.com/temple" },
      { name: "宋城", url: "https://example.com/scenic" },
      { name: "秋水山庄", hotelName: "秋水山庄", price: "10607", url: "https://example.com/hotel" },
    ] }, category, 20, tool) };
  });
  try {
    const input = { kind: "semantic", query: "杭州西湖附近可以坐下来喝茶的地点或产品" };
    const result = await f.service.searchTravel("account-one", input, new AbortController().signal, "request-tea-only");
    assert.equal(calls, 1); assert.equal(result.offers.length, 0); assert.equal(result.receipts.length, 1);
    assert.equal(result.receipts[0].state, "empty"); assert.equal(result.receipts[0].sourceCount, 0);
    assert.equal(result.receipts[0].code, "SEARCH_NO_RELEVANT_MATCHES");
    assert.match(result.receipts[0].detail, /未将普通酒店或景点当作匹配的服务推荐/);
    const retry = await f.service.searchTravel("account-one", input, new AbortController().signal, "request-tea-only");
    assert.equal(calls, 1); assert.deepEqual(plain(retry.receipts), plain(result.receipts));
  } finally { f.sqlite.close(); }
});

test("search receipts isolate accounts, preserve partial failures, and prevent repeat calls on response retry", async () => {
  const calls = [];
  const f = searchFixture(async (tool, args, _signal, category) => {
    calls.push([tool, args]); if (tool === "search_hotels") throw Object.assign(new Error("unavailable"), { code: "FLYAI_TIMEOUT" });
    return { sources: extractFlyaiSources({ name: "真实景点", url: "https://example.com/poi" }, category, 20, tool) };
  });
  try {
    const intents = [{ kind: "hotel", city: "杭州" }, { kind: "poi", city: "杭州" }], signal = new AbortController().signal;
    const first = await f.service.searchTravel("account-one", intents, signal, "request-1234");
    assert.equal(first.offers.length, 1); assert.equal(first.receipts.length, 2); assert.ok(first.receipts.some(r => r.state === "failed"));
    const again = await f.service.searchTravel("account-one", intents, signal, "request-1234"); assert.equal(calls.length, 2); assert.deepEqual(plain(again.offers), plain(first.offers));
    await assert.rejects(f.service.searchTravel("account-one", { kind: "poi", city: "北京" }, signal, "request-1234"), { code: "SEARCH_KEY_REUSED" });
    await f.service.searchTravel("account-two", intents, signal, "request-1234"); assert.equal(calls.length, 4);
  } finally { f.sqlite.close(); }
});

test("an in-flight search retry never starts the provider twice", async () => {
  let release; const gate = new Promise(resolve => { release = resolve; }); let calls = 0;
  const f = searchFixture(async () => { calls++; await gate; return { sources: [] }; });
  try {
    const input = { kind: "poi", city: "杭州" }, signal = new AbortController().signal;
    const original = f.service.searchTravel("account-one", input, signal, "request-concurrent");
    await new Promise(setImmediate);
    const retry = await f.service.searchTravel("account-one", input, signal, "request-concurrent");
    assert.equal(calls, 1); assert.equal(retry.receipts[0].code, "SEARCH_IN_PROGRESS");
    release(); const finished = await original; assert.equal(finished.receipts[0].state, "empty");
  } finally { f.sqlite.close(); }
});

test("search rate limits cannot be bypassed by retrying a rejected request key", async () => {
  let calls = 0;
  const f = searchFixture(async () => { calls++; return { sources: [] }; });
  try {
    const key = createHash("sha256").update("travel-search:account-one").digest("hex");
    f.sqlite.prepare("INSERT INTO auth_rate_limits(limit_key,hit_count,reset_at) VALUES(?,48,unixepoch()+3600)").run(key);
    for (let i = 0; i < 2; i++) {
      const result = await f.service.searchTravel("account-one", { kind: "poi", city: "杭州" }, new AbortController().signal, "request-limited");
      assert.equal(result.receipts[0].code, "SEARCH_RATE_LIMIT");
    }
    assert.equal(calls, 0);
  } finally { f.sqlite.close(); }
});

test("session deletion leaves the result path immediately and durable receipts retry failures", async () => {
  const f = searchFixture(async () => ({ sources: [] }));
  const background = []; let release; let calls = 0;
  const cleanup = loadModule("lib/bailian-session-cleanup.ts", {
    "cloudflare:workers": { waitUntil: promise => background.push(promise) },
    "./database": { getDatabase: () => f.db },
    "./bailian": { getBailianConfig: () => ({}), deleteBailianSession: async () => { calls++; return calls === 1 ? new Promise(resolve => { release = resolve; }) : { confirmed: true, status: 404 }; } },
  }, { console: { info() {} } });
  try {
    await cleanup.registerSessionCleanup("sesn_test");
    await cleanup.queueSessionCleanup("sesn_test");
    await new Promise(setImmediate);
    assert.equal(background.length, 1); assert.equal(calls, 1);
    assert.equal(f.sqlite.prepare("SELECT count(*) n FROM agent_session_cleanup").get().n, 1);
    release({ confirmed: false, status: 503 }); await background[0];
    assert.equal(f.sqlite.prepare("SELECT attempts FROM agent_session_cleanup").get().attempts, 1);
    f.sqlite.prepare("UPDATE agent_session_cleanup SET next_attempt_at=0").run();
    await cleanup.drainSessionCleanups();
    assert.equal(calls, 2); assert.equal(f.sqlite.prepare("SELECT count(*) n FROM agent_session_cleanup").get().n, 0);
  } finally { f.sqlite.close(); }
});

test("cleanup persists without a request context and only one scheduled drain owns the lease", async () => {
  const f = searchFixture(async () => ({ sources: [] }));
  let config = null, calls = 0, release;
  const cleanup = loadModule("lib/bailian-session-cleanup.ts", {
    "cloudflare:workers": { waitUntil() { throw new Error("No request context"); } },
    "./database": { getDatabase: () => f.db },
    "./bailian": { getBailianConfig: () => config, deleteBailianSession: async () => { calls++; return new Promise(resolve => { release = resolve; }); } },
  }, { console: { info() {} } });
  try {
    await cleanup.registerSessionCleanup("sesn_scheduled");
    await cleanup.queueSessionCleanup("sesn_scheduled");
    assert.equal(calls, 0);
    assert.equal(f.sqlite.prepare("SELECT count(*) n FROM agent_session_cleanup").get().n, 1);
    config = {};
    const scheduled = cleanup.drainSessionCleanups();
    await new Promise(setImmediate);
    await cleanup.drainSessionCleanups();
    assert.equal(calls, 1, "parallel cron work must not claim an active lease");
    release({ confirmed: true, status: 204 }); await scheduled;
    assert.equal(f.sqlite.prepare("SELECT count(*) n FROM agent_session_cleanup").get().n, 0);
  } finally { f.sqlite.close(); }
});

test("public search route checks same-origin authentication before spending any search allowance", async () => {
  let account = null, calls = 0;
  class JourneyError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
  const http = loadModule("lib/journey-http.ts", {
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    "@/lib/auth": { getCurrentAccount: async () => account, isSameOrigin: request => request.headers.get("origin") === new URL(request.url).origin },
    "@/lib/journeys": { JourneyError },
  });
  const api = loadModule("app/api/travel/search/route.ts", { "@/lib/journey-http": http,
    "@/lib/travel-search": { searchTravel: async (accountId, intent, _signal, key) => { calls++; assert.equal(accountId, "account-one"); assert.equal(intent.kind, "poi"); assert.equal(key, "route-search-test"); return { offers: [], receipts: [] }; } },
  });
  const request = origin => new Request("https://biotrip.example/api/travel/search", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", "Idempotency-Key": "route-search-test" }, body: JSON.stringify({ kind: "poi", city: "杭州" }) });
  assert.equal((await api.POST(request("https://biotrip.example"))).status, 401);
  account = { id: "account-one" };
  assert.equal((await api.POST(request("https://other.example"))).status, 403); assert.equal(calls, 0);
  const response = await api.POST(request("https://biotrip.example")); assert.equal(response.status, 200); assert.match(response.headers.get("Cache-Control"), /private/); assert.equal(calls, 1);
});
