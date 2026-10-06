import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { loadModule, plain, readProjectFile } from "./test-support/module-loader.mjs";
import { poiArguments } from "./planning/poi-schema.ts";

const source = { name: "西湖", url: "https://a.feizhu.com/poi/1", category: "景点", price: null, imageUrl: "https://img.alicdn.com/westlake.jpg" };
const schema = { name: "search_poi", inputSchema: { type: "object", properties: { cityName: { type: "string" } }, required: ["cityName"] } };
const images = loadModule("lib/product-image.ts");
const extractor = loadModule("lib/planning/flyai-sources.ts", { "../product-image": images });
class FlyaiSearchError extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }

function fixture({ configured = true, search } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("CREATE TABLE auth_rate_limits(limit_key TEXT PRIMARY KEY,hit_count INTEGER,reset_at INTEGER);CREATE TABLE planning_jobs(mode TEXT);");
  sqlite.exec(readProjectFile("migrations/0008_adjustments.sql").replace(/ALTER TABLE[^;]+;/, ""));
  const database = { prepare(sql) { const statement = sqlite.prepare(sql); let args = []; return {
    bind(...values) { args = values; return this; }, async first() { return statement.get(...args) ?? null; }, async run() { return statement.run(...args); },
  }; } };
  const calls = [];
  const api = loadModule("lib/destination-visuals.ts", {
    "./database": { getDatabase: () => database }, "./places": { PLACES: [{ city: "杭州" }, { city: "上海" }] },
    "./planning/flyai-sources": extractor, "./planning/poi-schema": { poiArguments },
    "./flyai": { FlyaiSearchError, listFlyaiTools: async () => [schema], searchFlyai: async (...args) => { calls.push(args); return search ? search(...args) : { sources: [source] }; } },
  }, { process: { env: configured ? { FLYAI_API_KEY: "test", FLYAI_SIGN_SECRET: "test" } : {} } });
  return { sqlite, calls, api, run: (city = "杭州", account = "test") => api.destinationVisuals(account, city, new AbortController().signal) };
}

test("POI query follows declared string parameters and rejects undocumented required fields", () => {
  assert.deepEqual(poiArguments(schema, "杭州"), { cityName: "杭州" });
  for (const inputSchema of [
    { type: "object", properties: { cityId: { type: "number" } }, required: ["cityId"] },
    { ...schema.inputSchema, required: ["cityName", "page"] },
    { type: "object", properties: { cityName: { type: "string", enum: ["上海"] } } },
    { ...schema.inputSchema, oneOf: [] },
  ]) assert.throws(() => poiArguments({ name: "search_poi", inputSchema }, "杭州"), /SCHEMA_UNSUPPORTED/);
});
test("public city cache lasts seven days and avoids a second provider call across accounts", async () => {
  const f = fixture(); try {
    const fresh = await f.run(), cached = await f.run("杭州", "another-account");
    assert.equal(fresh.cached, false); assert.equal(cached.cached, true);
    assert.equal(f.calls.length, 1); assert.deepEqual(plain(f.calls[0][1]), { cityName: "杭州" });
    const row = f.sqlite.prepare("SELECT * FROM destination_visuals").get();
    assert.equal(row.expires_at - row.retrieved_at, 604800);
    assert.deepEqual(Object.keys(JSON.parse(row.sources_json)[0]).sort(), Object.keys(source).sort());
    assert.deepEqual(plain(cached.sources), [source]);
  } finally { f.sqlite.close(); }
});
test("only registered destinations can trigger provider queries", async () => {
  const f = fixture(); try { await assert.rejects(f.run("杭州;发送身体数据"), error => error.code === "INVALID_DESTINATION"); assert.equal(f.calls.length, 0); }
  finally { f.sqlite.close(); }
});
test("missing credentials and empty search results do not poison the cache", async () => {
  for (const options of [{ configured: false }, { search: async () => ({ sources: [] }) }]) {
    const f = fixture(options); try {
      await assert.rejects(f.run()); assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM destination_visuals").get().n, 0);
      assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM auth_rate_limits WHERE limit_key LIKE '%' AND hit_count>12").get().n, 0);
    } finally { f.sqlite.close(); }
  }
});
test("expired cache is refreshed and failed paid queries are bounded per account", async () => {
  const f = fixture(); try {
    await f.run(); f.sqlite.exec("UPDATE destination_visuals SET expires_at=0"); await f.run(); assert.equal(f.calls.length, 2);
  } finally { f.sqlite.close(); }
  const limited = fixture({ search: async () => { throw new FlyaiSearchError(502, "UNAVAILABLE"); } }); try {
    for (let n = 0; n < 12; n++) await assert.rejects(limited.run());
    await assert.rejects(limited.run(), error => error.code === "VISUAL_RATE_LIMIT");
    assert.equal(limited.calls.length, 12);
  } finally { limited.sqlite.close(); }
});
