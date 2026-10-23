import { createHash } from "node:crypto";
import { SEARCH_KINDS, type SearchIntent, type TravelQuery } from "./travel-search-types";

const POI_CATEGORIES = new Set("自然风光 山湖田园 森林丛林 峡谷瀑布 沙滩海岛 沙漠草原 人文古迹 古镇古村 历史古迹 园林花园 宗教场所 公园乐园 主题乐园 水上乐园 影视基地 动物园 植物园 海洋馆 体育场馆 演出赛事 剧院剧场 博物馆 纪念馆 展览馆 地标建筑 市集 文创街区 城市观光 户外活动 滑雪 漂流 冲浪 潜水 露营 温泉".split(" "));
const fields = new Set(["kind", "city", "origin", "destination", "departureDate", "returnDate", "checkInDate", "checkOutDate", "keyword", "query", "nearby", "category", "brands", "maxPrice", "directOnly", "maxDurationHours", "sort"]);
const record = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
function invalid(): never { throw new Error("INVALID_SEARCH_INTENT"); }
const quote = (text: unknown) => `'${String(text).replaceAll("'", "'\\''")}'`;
const privateDetail = (text: string) => /\b(?:WHOOP|HRV|SpO2|RHR|fatigue)\b|heart\s*rate|(?:sleep|recovery)\s*score|疲劳|心率|血氧|睡了|(?:压力|恢复|睡眠)(?:值|评分|分数|指数)|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:\+?86[- ]?)?1[3-9]\d{9}/i.test(text);

export function parseSearchIntents(value: unknown): SearchIntent[] {
  const values = Array.isArray(value) ? value : [value];
  if (!values.length || values.length > 4) invalid();
  return values.map(value => {
    if (!record(value) || !SEARCH_KINDS.includes(value.kind as SearchIntent["kind"]) || Object.keys(value).some(key => !fields.has(key))) invalid();
    const intent: Record<string, unknown> = { kind: value.kind };
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined || key === "kind") continue;
      if (key === "brands") {
        if (!Array.isArray(item) || item.length > 4 || item.some(v => typeof v !== "string" || !v.trim() || v.length > 60 || /[\u0000-\u001f]/.test(v) || privateDetail(v))) invalid();
        intent.brands = item.map(v => String(v).trim());
      } else if (key === "directOnly") { if (typeof item !== "boolean") invalid(); intent[key] = item; }
      else if (["maxPrice", "maxDurationHours"].includes(key)) {
        if (typeof item !== "number" || !Number.isFinite(item) || item <= 0 || item > (key === "maxPrice" ? 1_000_000 : 240)) invalid();
        intent[key] = item;
      } else {
        if (typeof item !== "string" || !item.trim() || item.length > (key === "query" ? 400 : 120) || /[\u0000-\u001f]/.test(item)) invalid();
        const text = item.trim();
        if (privateDetail(text)) invalid();
        if (key.endsWith("Date") && (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(text)) || new Date(text).toISOString().slice(0, 10) !== text)) invalid();
        intent[key] = text;
      }
    }
    if (intent.sort && !["recommended", "price_asc", "distance_asc", "duration_asc"].includes(String(intent.sort))) invalid();
    if (intent.category && !POI_CATEGORIES.has(String(intent.category))) invalid();
    if (intent.checkInDate && intent.checkOutDate && String(intent.checkOutDate) <= String(intent.checkInDate)) invalid();
    if (intent.departureDate && intent.returnDate && String(intent.returnDate) < String(intent.departureDate)) invalid();
    return intent as SearchIntent;
  });
}

/** Field names/CLI flags verified against @fly-ai/flyai-cli 1.0.16, not inferred. */
export function routeSearchIntent(intent: SearchIntent): TravelQuery {
  let tool: TravelQuery["tool"], cli: string, category: string;
  const args: Record<string, unknown> = {}, flags: Array<[string, unknown]> = [];
  const put = (key: string, flag: string, value: unknown) => { if (value !== undefined && value !== "") { args[key] = value; flags.push([flag, value]); } };
  const required = (value: string | undefined) => value || invalid();
  if (intent.kind === "flight" || intent.kind === "train") {
    tool = intent.kind === "flight" ? "search_flight" : "search_domestic_train";
    cli = intent.kind === "flight" ? "search-flight" : "search-train";
    category = intent.kind === "flight" ? "航班" : "火车";
    put("origin", "origin", required(intent.origin)); put("destination", "destination", required(intent.destination));
    put("depDate", "dep-date", required(intent.departureDate)); put("backDate", "back-date", intent.returnDate);
    put("journeyType", "journey-type", intent.directOnly ? 1 : undefined);
    put("totalDurationHour", "total-duration-hour", intent.maxDurationHours);
    put("maxPrice", "max-price", intent.maxPrice);
    put("sortType", "sort-type", intent.sort === "price_asc" ? 3 : intent.sort === "duration_asc" ? 4 : undefined);
    args.limit = 10;
  } else if (intent.kind === "hotel" || intent.kind === "marriott_hotel") {
    tool = intent.kind === "hotel" ? "search_hotels" : "search_marriott_hotels";
    cli = intent.kind === "hotel" ? "search-hotel" : "search-marriott-hotel"; category = "住宿";
    put("destName", "dest-name", required(intent.city));
    put("keyWords", "key-words", [intent.keyword, ...(intent.brands ?? [])].filter(Boolean).join(" ") || undefined);
    put("poiName", "poi-name", intent.nearby);
    put("checkInDate", "check-in-date", intent.checkInDate); put("checkOutDate", "check-out-date", intent.checkOutDate);
    put("maxPrice", "max-price", intent.maxPrice);
    put("sort", "sort", ["price_asc", "distance_asc"].includes(intent.sort ?? "") ? intent.sort : undefined);
    if (intent.kind === "hotel") args.limit = 10;
  } else if (intent.kind === "poi") {
    tool = "search_poi"; cli = "search-poi"; category = "景点与体验";
    put("cityName", "city-name", required(intent.city)); put("keyword", "keyword", intent.keyword); put("category", "category", intent.category);
  } else if (intent.kind === "marriott_package") {
    tool = "search_marriott_packages"; cli = "search-marriott-package"; category = "酒店与体验套餐";
    put("keyword", "keyword", required(intent.keyword ?? intent.city));
    put("sortType", "sort-type", intent.sort === "price_asc" ? "price_asc" : undefined);
  } else {
    tool = intent.kind === "semantic" ? "fliggy_ai_search" : "fliggy_fast_search";
    cli = intent.kind === "semantic" ? "ai-search" : "keyword-search"; category = "旅行商品";
    const query = required(intent.query ?? [intent.city, intent.keyword].filter(Boolean).join(" "));
    put("query", "query", query);
  }
  const queryKey = createHash("sha256").update(JSON.stringify([tool, Object.entries(args).sort(([a], [b]) => a.localeCompare(b))])).digest("hex");
  return { tool, args, category, kind: intent.kind, queryKey,
    command: `DEBUG_FLYAI_MCP_URL=https://biotrip.eazylee.si/api/flyai/mcp flyai ${cli} ${flags.map(([flag, value]) => `--${flag} ${quote(value)}`).join(" ")}` };
}

export function travelQueries(value: unknown): TravelQuery[] {
  return [...new Map(parseSearchIntents(value).map(intent => { const query = routeSearchIntent(intent); return [query.queryKey, query]; })).values()];
}
