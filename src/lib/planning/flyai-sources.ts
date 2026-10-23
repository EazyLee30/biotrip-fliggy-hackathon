import type { FlyaiSource } from "@/lib/flyai";
import { productImageUrl } from "../product-image";
import { createHash } from "node:crypto";
import type { FlyaiTool, OfferSegment, SearchKind, VerifiedOffer } from "../travel-search-types";

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Names and URLs are copied together from real FlyAI data, never model output. */
export function extractFlyaiSources(data: unknown, category: string, maximum = 30, tool?: FlyaiTool, retrievedAt = new Date().toISOString()): FlyaiSource[] {
  const sources = new Map<string, FlyaiSource>();
  const walk = (value: unknown, depth = 0) => {
    if (depth > 12 || sources.size >= maximum) return;
    if (typeof value === "string" && value.length < 2_000_000) {
      try { walk(JSON.parse(value), depth + 1); } catch { /* Plain product text is not JSON. */ }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 50)) walk(item, depth + 1);
      return;
    }
    if (!record(value)) return;
    const link = value.jumpUrl ?? value.detailUrl ?? value.source_url ?? value.sourceUrl ?? value.url ?? value.link;
    const transport = ["search_flight", "search_domestic_train"].includes(tool ?? "") || Array.isArray(value.journeys) ? transportFacts(value, tool) : undefined;
    // Transport responses have no title. This label joins actual segment fields;
    // it is never a model-generated carrier, route or departure time.
    const name = value.title ?? value.name ?? value.poiName ?? value.hotelName ?? (transport?.segments.length
      ? `${transport.segments[0].origin} → ${transport.segments.at(-1)!.destination}${transport.segments[0].number ? ` · ${transport.segments[0].number}` : ""}` : undefined);
    if (typeof link === "string" && typeof name === "string" && name.trim()) {
      try {
        const url = new URL(link);
        if (publicSourceUrl(url)) {
          const ticket = record(value.ticketInfo) ? value.ticketInfo : null;
          const priceValue = value.price ?? value.adultPrice ?? ticket?.price;
          const price = sourcePrice(priceValue);
          // Product searches return `picUrl`; attraction and hotel searches return `mainPic`.
          const imageUrl = productImageUrl(value.picUrl ?? value.mainPic ?? value.imageUrl ?? value.image_url);
          const address = typeof value.address === "string" && value.address.trim() ? value.address.trim().slice(0, 160) : null;
          const source = { name: name.trim().slice(0, 160), url: url.toString(), category: sourceCategory(value, tool, category), price,
            ...(imageUrl ? { imageUrl } : {}), ...(address ? { address } : {}) };
          if (tool) {
            const facts: VerifiedOffer["facts"] = [];
            const add = (label: string, item: unknown) => { const text = shortText(item); if (text) facts.push({ label, value: text }); };
            // Each tool's documented fields are explicitly selected. Unknown
            // response prose is never promoted to verified availability.
            if (["search_hotels", "search_marriott_hotels"].includes(tool)) {
              add("品牌", value.brandName); add("评分", value.score); add("星级", value.star); add("附近", value.interestsPoi);
            } else if (tool === "search_poi") {
              add("票种", ticket?.ticketName); add("票价日期", ticket?.priceDate);
            } else if (tool === "search_marriott_packages") {
              add("酒店", value.hotelName); add("城市", value.cityName); add("套餐说明", value.sellingPoint);
            } else if (["fliggy_fast_search", "fliggy_ai_search"].includes(tool)) {
              add("评分", value.scoreDesc); add("标签", Array.isArray(value.tags) ? value.tags.filter(v => typeof v === "string").slice(0, 3).join(" · ") : undefined);
            }
            if (transport) { add("用时", transport.duration); add("出发", transport.segments[0]?.departure); add("到达", transport.segments.at(-1)?.arrival); }
            const id = createHash("sha256").update(JSON.stringify([tool, source.url, transport ?? null])).digest("hex").slice(0, 24);
            const offer: VerifiedOffer = { ...source, id, tool, kind: toolKind(tool), retrievedAt, facts, ...(transport ? { transport } : {}) };
            sources.set(id, offer);
          } else sources.set(url.toString(), source);
        }
      } catch { /* Invalid provider links never become recommendations. */ }
    }
    for (const [key, item] of Object.entries(value).slice(0, 60)) {
      if (!/image|pic|thumbnail|icon|systemMessage|authorization|credential|api.?key/i.test(key)) walk(item, depth + 1);
    }
  };
  walk(data);
  return [...sources.values()];
}

function shortText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 160)
    : typeof value === "number" && Number.isFinite(value) ? String(value) : undefined;
}
/** Only called with provider price/adultPrice/ticketInfo.price, never ratings or IDs. */
function sourcePrice(value: unknown): string | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? `¥${value}` : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const price = value.trim().slice(0, 40);
  return /^\d+(?:\.\d+)?$/.test(price) || /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(price) ? `¥${price}` : price;
}
function sourceCategory(value: Record<string, unknown>, tool: FlyaiTool | undefined, fallback: string): string {
  if (!tool) return fallback;
  const known: Partial<Record<FlyaiTool, string>> = { search_flight: "航班", search_domestic_train: "火车", search_hotels: "住宿", search_marriott_hotels: "住宿", search_poi: "景点与体验", search_marriott_packages: "酒店与体验套餐" };
  if (known[tool]) return known[tool]!;
  // Mixed searches do not inherit the requested scenario. A hotel returned
  // for a tea query is not evidence of a tea room or a place to sit down.
  if (shortText(value.hotelName)) return "酒店相关商品";
  if (shortText(value.poiName) || record(value.ticketInfo)) return "景点相关商品";
  return "旅行商品";
}
function publicSourceUrl(url: URL): boolean {
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || url.href.length > 4096) return false;
  const host = url.hostname.toLowerCase();
  if (!host.includes(".") || host.startsWith("[") || /^\d+(?:\.\d+){3}$/.test(host) || /(?:^|\.)(?:localhost|local|internal|invalid)$/.test(host)) return false;
  return ![...url.searchParams.keys()].some(key => /^(?:api[-_]?key|access[-_]?token|authorization|credential|password|client[-_]?secret)$/i.test(key));
}
function transportDuration(value: unknown, tool?: FlyaiTool, total = false): string | undefined {
  // These two transport tools use minutes for numeric duration fields. Text
  // responses keep their supplied units; other tools do not inherit this unit.
  if (tool === "search_flight" || tool === "search_domestic_train") {
    if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? `${value} 分钟` : undefined;
    // totalDuration is the tools' total-minute field, also serialized as text.
    // A generic segment duration string has no such numeric-string guarantee.
    if (total && typeof value === "string" && value.length <= 160 && /^\d+(?:\.\d+)?$/.test(value.trim())) return `${value.trim()} 分钟`;
  }
  return shortText(value);
}
function transportFacts(value: Record<string, unknown>, tool?: FlyaiTool): VerifiedOffer["transport"] | undefined {
  const journeys = Array.isArray(value.journeys) ? value.journeys.filter(record).slice(0, 4) : [];
  const segments: OfferSegment[] = journeys.flatMap(journey => Array.isArray(journey.segments) ? journey.segments.filter(record).slice(0, 8) : []).flatMap(segment => {
    const origin = shortText(segment.depStationName ?? segment.depCityName), destination = shortText(segment.arrStationName ?? segment.arrCityName);
    if (!origin || !destination) return [];
    return [{ origin, destination,
      ...(shortText(segment.depDateTime) ? { departure: shortText(segment.depDateTime) } : {}),
      ...(shortText(segment.arrDateTime) ? { arrival: shortText(segment.arrDateTime) } : {}),
      ...(shortText(segment.marketingTransportNo) ? { number: shortText(segment.marketingTransportNo) } : {}),
      ...(shortText(segment.seatClassName) ? { seat: shortText(segment.seatClassName) } : {}),
      ...(transportDuration(segment.duration, tool) ? { duration: transportDuration(segment.duration, tool) } : {}) }];
  });
  if (!segments.length) return undefined;
  const duration = transportDuration(value.totalDuration ?? journeys[0]?.totalDuration, tool, true);
  return { segments, ...(duration ? { duration } : {}) };
}
function toolKind(tool: FlyaiTool): SearchKind {
  return ({ search_flight: "flight", search_domestic_train: "train", search_hotels: "hotel", search_poi: "poi", search_marriott_hotels: "marriott_hotel", search_marriott_packages: "marriott_package", fliggy_fast_search: "keyword", fliggy_ai_search: "semantic" } as const)[tool];
}
