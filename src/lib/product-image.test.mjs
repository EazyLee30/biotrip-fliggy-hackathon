import test from "node:test";
import assert from "node:assert/strict";
import { productImageUrl, fliggyImage, fliggyPlaceholder } from "./product-image.ts";
import { extractFlyaiSources } from "./planning/flyai-sources.ts";
import { inventoryRecommendations, decodePlanRecommendations } from "./planning-recommendations.ts";

const image = "https://img.alicdn.com/imgextra/i1/6000000007744/O1CN01wpyBDF274nqr0ykTm_!!6000000007744-0-fliggyimage.jpg";
test("product pictures stay paired with the same raw product and survive preview decoding", () => {
  const sources = extractFlyaiSources({ items: [
    { title: "商品甲", jumpUrl: "https://item.fliggy.com/item.htm?id=1", picUrl: image },
    { title: "商品乙", jumpUrl: "https://item.fliggy.com/item.htm?id=2" },
  ] }, "景点与体验");
  assert.equal(sources[0].imageUrl, image); assert.equal(sources[1].imageUrl, undefined);
  const decoded = decodePlanRecommendations({ stage: "flyai_inventory", destination: "杭州", retrievedAt: "2026-10-04T00:00:00Z", items: inventoryRecommendations(sources) }, "杭州");
  assert.equal(decoded.items[0].imageUrl, image); assert.equal(decoded.items[1].imageUrl, undefined);
});
test("private, non-HTTPS, non-CDN and credential-bearing image addresses are rejected", () => {
  for (const url of ["http://img.alicdn.com/a.jpg", "https://evil.example/a.jpg", "https://img.alicdn.com.evil.example/a.jpg", "https://user:pass@img.alicdn.com/a.jpg", "https://img.alicdn.com:8443/a.jpg", "https://img.alicdn.com/a.jpg?token=secret", "data:image/png;base64,AAAA"]) assert.equal(productImageUrl(url), null);
  assert.equal(productImageUrl("//img.alicdn.com/a.jpg"), "https://img.alicdn.com/a.jpg");
});
test("attraction and hotel records contribute their own photograph and address", () => {
  const sources = extractFlyaiSources({ itemList: [
    { name: "西安钟鼓楼", jumpUrl: "https://a.feizhu.com/poi/177224", mainPic: "https://img.alicdn.com/tfscom/poi.jpg", address: "陕西省西安市莲湖区北院门", ticketInfo: { ticketName: "成人票", price: null } },
    { name: "杭州望湖宾馆", detailUrl: "https://hotel.fliggy.com/hotel_detail2.htm?shid=1", mainPic: "https://evil.example/x.jpg", price: "¥618" },
  ] }, "景点");
  assert.equal(sources.length, 2);
  assert.equal(sources[0].imageUrl, "https://img.alicdn.com/tfscom/poi.jpg"); assert.equal(sources[0].address, "陕西省西安市莲湖区北院门");
  assert.equal(sources[1].imageUrl, undefined); assert.equal(sources[1].price, "¥618");
});
test("resized renditions only ever point at the verified CDN object", () => {
  assert.equal(fliggyImage(image, 400), `${image}_400x400q75.jpg`);
  assert.equal(fliggyImage(image, 480, 360, 60), `${image}_480x360q60.jpg`);
  assert.equal(fliggyPlaceholder(image), `${image}_60x60q30.jpg`);
  assert.equal(fliggyImage(`${image}_400x400q75.jpg`, 200), `${image}_400x400q75.jpg`);
  assert.equal(fliggyImage("https://img.alicdn.com/a.webp", 200), "https://img.alicdn.com/a.webp");
  assert.equal(fliggyImage("https://evil.example/a.jpg", 200), null);
  assert.equal(fliggyImage(image, 9, 99999, 5), `${image}_40x2000q20.jpg`);
});
