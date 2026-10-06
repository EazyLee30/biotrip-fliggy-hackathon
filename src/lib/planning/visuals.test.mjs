import assert from "node:assert/strict";
import { test } from "node:test";
import { bindVisuals, coreName, leadName } from "./visuals.ts";

const image = (name) => `https://img.alicdn.com/tfscom/${name}.jpg`;
const poi = (name, id, picture = id) => ({ name, url: `https://a.feizhu.com/poi/${id}`, category: "景点", ...(picture ? { imageUrl: image(picture) } : {}) });
const pois = [poi("杭州西湖风景名胜区", "westlake"), poi("西溪国家湿地公园", "xixi"), poi("灵隐寺", "lingyin"), poi("雷峰塔景区", "leifeng"), poi("河坊街", "hefang", null), poi("杭州宋城", "songcheng")];
const products = [
  { name: "[西溪国家湿地公园-门票+寻味西溪（2-4人）]含摇橹船、龙井茶、船餐", url: "https://item.fliggy.com/item.htm?id=1", category: "景点与体验", imageUrl: image("ticket") },
  { name: "杭州千岛湖一日游", url: "https://item.fliggy.com/item.htm?id=2", category: "景点与体验", imageUrl: "https://evil.example/x.jpg" },
  { name: "西湖边精品酒店", url: "https://item.fliggy.com/item.htm?id=3", category: "住宿", imageUrl: image("hotel") },
];
const row = (name, extra = {}) => ({ id: name, date: "2026-10-12", time: "10:00", name, detail: "", fixed: false, ...extra });

test("names are compared on their distinctive part", () => {
  assert.equal(coreName("杭州西湖风景名胜区", "杭州"), "西湖");
  assert.equal(coreName("杭州市西溪国家湿地公园", "杭州"), "西溪国家湿地公园");
  assert.equal(coreName("雷峰塔景区", "杭州"), "雷峰塔");
  assert.equal(coreName("杭州", "杭州"), "杭州");
  assert.equal(leadName("楼外楼（西湖景区孤山路店）·杭帮菜晚餐", "杭州"), "楼外楼");
  assert.equal(leadName("西溪国家湿地公园·摇橹船与品茗", "杭州"), "西溪国家湿地公园");
});

test("an activity is pictured only when its own name leads with a retrieved place", () => {
  const { itinerary, visuals } = bindVisuals([
    row("抵达杭州并稍作休整"),
    row("西溪国家湿地公园·摇橹船与品茗"),
    row("西湖晨间散步"),
    row("灵隐寺预约参观", { fixed: true }),
    row("楼外楼（西湖景区孤山路店）·杭帮菜晚餐"),
    row("西湖醋鱼晚餐"),
    row("河坊街夜市漫步"),
    row("自由探索"),
  ], { city: "杭州", pois, products });
  const link = (name) => itinerary.find((item) => item.name === name).sourceUrl;
  assert.equal(link("西溪国家湿地公园·摇橹船与品茗"), pois[1].url);
  assert.equal(link("西湖晨间散步"), pois[0].url);
  assert.equal(link("灵隐寺预约参观"), pois[2].url);
  assert.equal(link("河坊街夜市漫步"), pois[4].url);
  for (const name of ["抵达杭州并稍作休整", "楼外楼（西湖景区孤山路店）·杭帮菜晚餐", "西湖醋鱼晚餐", "自由探索"]) assert.equal(link(name), undefined);
  assert.equal(visuals.images[pois[1].url].imageUrl, image("xixi"));
  assert.equal(visuals.images[pois[4].url], undefined);
  assert.deepEqual(visuals.cover.slice(0, 3).map((entry) => entry.name), ["西溪国家湿地公园", "杭州西湖风景名胜区", "灵隐寺"]);
  assert.ok(visuals.cover.every((entry) => entry.imageUrl.startsWith("https://img.alicdn.com/")));
  assert.ok(!visuals.cover.some((entry) => entry.name.includes("酒店") || entry.name.includes("千岛湖")));
  assert.ok(visuals.cover.some((entry) => entry.kind === "product"));
});

test("an existing link is kept, products fill in when no attraction matches, and nothing is invented", () => {
  const chosen = "https://item.fliggy.com/item.htm?id=1";
  const { itinerary, visuals } = bindVisuals([row("西湖晨间散步", { sourceUrl: chosen }), row("千岛湖一日游"), row("宋城千古情演出")], { city: "杭州", pois, products });
  assert.equal(itinerary[0].sourceUrl, chosen);
  assert.equal(visuals.images[chosen].imageUrl, image("ticket"));
  assert.equal(itinerary[1].sourceUrl, products[1].url);
  assert.equal(visuals.images[products[1].url], undefined);
  assert.equal(itinerary[2].sourceUrl, pois[5].url);
  const empty = bindVisuals([row("西湖晨间散步")], { city: "杭州", pois: [], products: [] });
  assert.equal(empty.itinerary[0].sourceUrl, undefined);
  assert.deepEqual(empty.visuals, { cover: [], images: {} });
  const many = bindVisuals([], { city: "杭州", pois: Array.from({ length: 20 }, (_, index) => poi(`景点${index}号`, `p${index}`)), products: [] });
  assert.equal(many.visuals.cover.length, 8);
});
