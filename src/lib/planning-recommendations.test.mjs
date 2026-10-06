import assert from "node:assert/strict";
import { test } from "node:test";
import { decodePlanRecommendations, inventoryRecommendations, localRecommendations, mergeRecommendations, publicRecommendationUrl } from "./planning-recommendations.ts";

const item = { name: "真实工具商品", category: "景点与体验", reason: "公开说明", source: "飞猪实时搜索", url: "https://example.com/product/1" };
const batch = { stage: "flyai_inventory", destination: "杭州", retrievedAt: "2026-10-03T09:00:00.000Z", items: [item] };

test("inventory previews bind real tool names and links while ignoring extra personal or price fields", () => {
  const result = inventoryRecommendations([{ name: "工具原始标题", url: item.url, category: "景点与体验", price: "100", healthMetrics: { private: true }, reason: "模型不得使用此段" }]);
  assert.equal(result[0].name, "工具原始标题");
  assert.equal(result[0].url, item.url);
  assert.deepEqual(Object.keys(result[0]).sort(), ["category", "name", "reason", "source", "url"]);
  assert.ok(!JSON.stringify(result).includes("private"));
  assert.ok(!JSON.stringify(result).includes("模型不得使用"));
});

test("local previews use only verified site URL and a category allowlist, never agent-authored venue claims", () => {
  const result = localRecommendations([{ name: "未经原始title核验的场所", kind: "local_food", detail: "可能编造的营业时间", source: "未核验的官方宣称", sourceUrl: "https://example.com/local" }]);
  assert.equal(result[0].name, "当地餐食资料 · example.com");
  assert.equal(result[0].category, "当地餐食");
  assert.equal(result[0].source, "公开网页 · example.com");
  assert.ok(!JSON.stringify(result).includes("未经原始"));
  assert.ok(!JSON.stringify(result).includes("营业时间"));
  assert.equal(localRecommendations([{ kind: "__proto__", sourceUrl: item.url }])[0].category, "当地资料");
});

test("unsafe, local and credential-bearing links never enter SSE previews or the carousel", () => {
  for (const url of ["javascript:alert(1)", "http://example.com/product", "https://user:password@example.com/", "https://127.0.0.1/", "https://[::1]/", "https://localhost/path", "https://host.internal/", "https://example.com:8443/", "https://example.com/?api_key=secret", "https://example.com/#access_token=secret"]) {
    assert.equal(publicRecommendationUrl(url), null, url);
    assert.equal(mergeRecommendations([], [{ ...item, url }]).length, 0, url);
  }
  assert.equal(publicRecommendationUrl("https://example.com/detail?id=123&spm=public"), "https://example.com/detail?id=123&spm=public");
});

test("client decode rejects another destination or malformed batches and strips all undeclared fields", () => {
  assert.equal(decodePlanRecommendations(batch, "北京"), null);
  for (const invalid of [null, [], { ...batch, stage: "health_insight" }, { ...batch, retrievedAt: "invalid" }, { ...batch, items: null }]) assert.equal(decodePlanRecommendations(invalid, "杭州"), null);
  assert.deepEqual(decodePlanRecommendations({ ...batch, health: { private: true }, items: [{ ...item, apiKey: "secret" }] }, "杭州"), batch);
  assert.equal(decodePlanRecommendations({ ...batch, items: [{ ...item, url: "http://example.com/" }] }, "杭州").items.length, 0);
});

test("incremental batches preserve card positions, update a duplicate in place and are bounded", () => {
  const old = [{ ...item }, { ...item, name: "第二项", url: "https://example.com/2" }];
  const updated = { ...item, name: "更新同一来源" };
  const next = mergeRecommendations(old, [{ ...item, name: "第三项", url: "https://example.com/3" }, updated]);
  assert.deepEqual(next.map(({ name }) => name), ["更新同一来源", "第二项", "第三项"]);
  const many = Array.from({ length: 30 }, (_, i) => ({ ...item, url: `https://example.com/${i}` }));
  assert.equal(mergeRecommendations([], many).length, 20);
  assert.equal(decodePlanRecommendations({ ...batch, items: many }, "杭州").items.length, 20);
});
