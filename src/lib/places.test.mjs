import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PLACES, DOMESTIC_PLACES, INTERNATIONAL_PLACES, INTERNATIONAL_GROUPS, GROUP_LABELS,
  groupByInitial, initialsOf, placesInGroup, popularFirst, searchPlaces, selectablePlaces, transportCityFor,
} from "./places.ts";

const find = (city) => {
  const place = PLACES.find((place) => place.city === city);
  assert.ok(place, `${city} must be selectable`);
  return place;
};
function offsetAt(city, iso) {
  const zone = new Intl.DateTimeFormat("en", { timeZone: find(city).timezone, timeZoneName: "shortOffset" })
    .formatToParts(new Date(iso)).find((part) => part.type === "timeZoneName").value;
  return zone.replace(/^GMT\+0$/, "GMT");
}

test("destination catalog has unique places, real runtime zones and populated international regions", () => {
  assert.equal(new Set(PLACES.map((place) => place.city)).size, PLACES.length);
  assert.ok(DOMESTIC_PLACES.length >= 130, "preserve the existing mainland catalog");
  assert.ok(INTERNATIONAL_PLACES.length >= 100, "international selection must have useful coverage");
  for (const place of PLACES) {
    assert.ok(place.city && place.country && place.romanization && place.flag);
    assert.ok(["city", "area"].includes(place.kind));
    assert.ok(Object.hasOwn(GROUP_LABELS, place.group));
    assert.match(place.initial, /^[A-Z]$/);
    assert.equal(place.domestic, place.group === "cn");
    assert.doesNotThrow(() => new Intl.DateTimeFormat("zh-CN", { timeZone: place.timezone }).format());
    if (place.domestic) assert.equal(place.timezone, "Asia/Shanghai");
  }
  for (const group of INTERNATIONAL_GROUPS) assert.ok(placesInGroup(group).length > 0, `${group} rail must not point to an empty panel`);
  assert.equal(find("香港").group, "hkt"); assert.equal(find("澳门").group, "hkt"); assert.equal(find("台北").group, "hkt");
  assert.equal(find("香港").timezone, "Asia/Hong_Kong");
  assert.equal(find("澳门").timezone, "Asia/Macau");
  assert.equal(find("台北").timezone, "Asia/Taipei");
});

test("departure eligibility removes areas from search, popular history and alphabet pools", () => {
  const origins = selectablePlaces(PLACES, { citiesOnly: true, exclude: "北京" });
  assert.ok(origins.length > 200);
  assert.ok(origins.every((place) => place.kind === "city" && place.city !== "北京"));
  for (const city of ["玉龙雪山", "亚龙湾", "海棠湾", "凤凰古城", "巴厘岛", "冲绳", "马尔代夫"]) {
    assert.equal(find(city).kind, "area");
    assert.equal(origins.some((place) => place.city === city), false);
  }
  assert.equal(searchPlaces("巴厘岛", origins).length, 0);
  assert.equal(searchPlaces("海棠湾", origins).length, 0);
  assert.ok(popularFirst(origins, ["玉龙雪山", "巴厘岛"]).every((place) => place.kind === "city"));
  assert.ok(groupByInitial(origins.filter((place) => place.domestic)).flatMap(([, cities]) => cities).every((place) => place.kind === "city"));
  assert.ok(selectablePlaces().some((place) => place.city === "玉龙雪山"), "destination selection keeps scenic areas");
  assert.equal(selectablePlaces(PLACES, { exclude: "上海" }).some((place) => place.city === "上海"), false);
});

test("transport searches resolve verified cities and never submit unmapped areas or arbitrary input", () => {
  const expected = {
    "上海": "上海", "玉龙雪山": "丽江", "洛阳老君山": "洛阳", "洛阳龙门": "洛阳",
    "阳朔": "桂林", "婺源": "上饶", "亚龙湾": "三亚", "海棠湾": "三亚",
    "西双版纳": "景洪", "伊犁": "伊宁", "冲绳": "那霸", "济州岛": "济州",
    "普吉岛": "普吉", "巴厘岛": "登巴萨", "马尔代夫": "马累",
  };
  for (const [selection, city] of Object.entries(expected)) assert.equal(transportCityFor(selection), city);
  for (const place of PLACES) {
    const city = transportCityFor(place.city);
    if (place.kind === "city") assert.equal(city, place.city);
    if (city) {
      const gateway = find(city);
      assert.equal(gateway.kind, "city", `${place.city} must resolve to a city, not another area`);
      assert.equal(gateway.country, place.country);
      assert.equal(gateway.timezone, place.timezone);
    } else assert.equal(place.transportCity, undefined);
  }
  for (const area of ["九寨沟", "稻城亚丁", "凤凰古城", "箱根", "圣托里尼", "毛里求斯"]) assert.equal(transportCityFor(area), null);
  assert.equal(transportCityFor("机场代码 XXX"), null);
  assert.equal(transportCityFor(""), null);
});

test("legacy themed names resolve to the real city and Sanya bays remain separate destinations", () => {
  assert.equal(PLACES.some((place) => place.city === "长春冰雪"), false);
  assert.deepEqual(searchPlaces("长春冰雪").map((place) => place.city), ["长春"]);
  assert.ok(searchPlaces("chang chun bing xue").some((place) => place.city === "长春"));
  assert.equal(transportCityFor(" 长春冰雪 "), "长春");
  assert.equal(transportCityFor("ChangChunBingXue"), "长春");
  assert.equal(find("亚龙湾").hint.includes("海棠湾"), false);
  assert.deepEqual(searchPlaces("海棠湾").map((place) => place.city), ["海棠湾"]);
  assert.deepEqual(searchPlaces("亚龙湾").map((place) => place.city), ["亚龙湾"]);
});

test("city zones avoid the old Mexico City and Cape Town travel-time errors", () => {
  assert.equal(find("墨西哥城").timezone, "America/Mexico_City");
  assert.equal(find("开普敦").timezone, "Africa/Johannesburg");
  assert.equal(offsetAt("墨西哥城", "2026-01-15T12:00:00Z"), "GMT-6");
  assert.equal(offsetAt("开普敦", "2026-01-15T12:00:00Z"), "GMT+2");
  assert.equal(offsetAt("加德满都", "2026-01-15T12:00:00Z"), "GMT+5:45");
  assert.equal(offsetAt("伦敦", "2026-01-15T12:00:00Z"), "GMT");
  assert.equal(offsetAt("伦敦", "2026-07-15T12:00:00Z"), "GMT+1");
});

test("search handles Chinese, country names, spaced pinyin and foreign city spellings", () => {
  assert.ok(searchPlaces("Cheng Du").some((place) => place.city === "成都"));
  assert.ok(searchPlaces("Wu Lu Mu Qi").some((place) => place.city === "乌鲁木齐"));
  assert.ok(searchPlaces("Urumqi").some((place) => place.city === "乌鲁木齐"));
  assert.ok(searchPlaces("Hong Kong").some((place) => place.city === "香港"));
  assert.ok(searchPlaces("xiang gang").some((place) => place.city === "香港"));
  assert.ok(searchPlaces("TOKYO").some((place) => place.city === "东京"));
  assert.ok(searchPlaces("Japan").some((place) => place.city === "京都"));
  assert.ok(searchPlaces("日本").every((place) => place.country === "日本"));
  assert.equal(searchPlaces("a city that is not in this catalog").length, 0);
  assert.equal(searchPlaces("东京", DOMESTIC_PLACES).length, 0);
});

test("history ordering is explicit, deterministic and leaves the original catalog intact", () => {
  const before = DOMESTIC_PLACES.map((place) => place.city);
  const ranked = popularFirst(DOMESTIC_PLACES, ["温州", "北京"]);
  assert.equal(ranked[0].city, "温州"); assert.equal(ranked[1].city, "北京");
  assert.deepEqual(DOMESTIC_PLACES.map((place) => place.city), before);
  assert.deepEqual(popularFirst(DOMESTIC_PLACES).slice(0, 4).map((place) => place.city), ["北京", "上海", "广州", "深圳"]);
});

test("alphabet sections include every mainland destination exactly once and have no dead jumps", () => {
  const grouped = groupByInitial(DOMESTIC_PLACES);
  assert.equal(grouped.flatMap(([, cities]) => cities).length, DOMESTIC_PLACES.length);
  assert.equal(new Set(grouped.flatMap(([, cities]) => cities.map((place) => place.city))).size, DOMESTIC_PLACES.length);
  assert.deepEqual(grouped.map(([letter]) => letter), initialsOf(DOMESTIC_PLACES));
  for (const [letter, cities] of grouped) assert.ok(cities.length && cities.every((place) => place.initial === letter));
  assert.ok(grouped.find(([letter]) => letter === "W")[1].some((place) => place.city === "乌鲁木齐"));
});
