import type { FlyaiSource } from "./flyai";
import type { LocalService } from "./planning/contract";
import { productImageUrl } from "./product-image";

export type PlanRecommendation = { name: string; category: string; reason: string; source: string; url: string; imageUrl?: string };
export type PlanRecommendations = {
  stage: "local_research" | "flyai_inventory";
  destination: string;
  retrievedAt: string;
  items: PlanRecommendation[];
};
export const MAX_WAITING_RECOMMENDATIONS = 20;

const LOCAL_CATEGORIES: Record<string, string> = {
  local_food: "当地餐食", relaxation: "放松体验", onsen: "温泉", massage: "按摩", medical_info: "医疗信息",
};
const INVENTORY_CATEGORIES = new Set(["住宿", "景点与体验", "旅行服务", "交通", "当地餐食", "放松体验"]);
const PRIVATE_QUERY = /^(?:access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|key|token|authorization|password|credential|secret|session(?:[_-]?id)?|auth[_-]?code)$/i;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Preview links must be public HTTPS pages, never authenticated or local endpoints. */
export function publicRecommendationUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return null;
    if (!host.includes(".") || host.includes(":") || /^\d+\.\d+\.\d+\.\d+$/.test(host) || /(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/.test(host)) return null;
    if ([...url.searchParams.keys(), ...new URLSearchParams(url.hash.slice(1)).keys()].some((key) => PRIVATE_QUERY.test(key))) return null;
    return url.href;
  } catch { return null; }
}

function text(value: unknown, maximum: number): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return value.trim().slice(0, maximum);
}

function safeItem(value: unknown): PlanRecommendation | null {
  if (!record(value)) return null;
  const name = text(value.name, 180), category = text(value.category, 80), reason = text(value.reason, 400), source = text(value.source, 260);
  const url = publicRecommendationUrl(value.url);
  const imageUrl = productImageUrl(value.imageUrl);
  return name && category && reason && source && url ? { name, category, reason, source, url, ...(imageUrl ? { imageUrl } : {}) } : null;
}

/** FlyAI names and URLs come from the same real tool item; no model-written reasons are copied. */
export function inventoryRecommendations(sources: readonly FlyaiSource[]): PlanRecommendation[] {
  return mergeRecommendations([], sources.map((source) => ({
    name: source.name,
    category: INVENTORY_CATEGORIES.has(source.category) ? source.category : "当地体验",
    reason: "本次飞猪搜索返回的商品资料；价格、余位和开放安排请查看原始页面。",
    source: "飞猪实时搜索",
    url: source.url,
    ...(source.imageUrl ? { imageUrl: source.imageUrl } : {}),
  })));
}

/** Only source URLs are verified by the local stage, so its preview uses a factual site label. */
export function localRecommendations(services: readonly LocalService[]): PlanRecommendation[] {
  return mergeRecommendations([], services.flatMap((service) => {
    const url = publicRecommendationUrl(service.sourceUrl);
    if (!url) return [];
    const host = new URL(url).hostname;
    const category = Object.hasOwn(LOCAL_CATEGORIES, service.kind) ? LOCAL_CATEGORIES[service.kind] : "当地资料";
    return [{ name: `${category === "当地资料" ? category : `${category}资料`} · ${host}`, category, reason: "本次当地检索返回的公开资料，具体服务和预约条件请以来源页面为准。", source: `公开网页 · ${host}`, url }];
  }));
}

/** Decode one request's preview. Unknown fields (including health data) are never copied. */
export function decodePlanRecommendations(value: unknown, expectedDestination: string): PlanRecommendations | null {
  if (!record(value) || !expectedDestination.trim() || typeof value.destination !== "string" || value.destination.trim() !== expectedDestination.trim()) return null;
  if (value.stage !== "local_research" && value.stage !== "flyai_inventory") return null;
  if (typeof value.retrievedAt !== "string" || !Number.isFinite(Date.parse(value.retrievedAt)) || value.retrievedAt.length > 40 || !Array.isArray(value.items)) return null;
  return {
    stage: value.stage, destination: value.destination.trim().slice(0, 100), retrievedAt: value.retrievedAt,
    items: mergeRecommendations([], value.items.slice(0, MAX_WAITING_RECOMMENDATIONS)),
  };
}

/** Existing card positions stay stable when the other parallel stage adds or updates a source. */
export function mergeRecommendations(current: readonly unknown[], incoming: readonly unknown[]): PlanRecommendation[] {
  const items = new Map<string, PlanRecommendation>();
  for (const value of [...current.slice(0, MAX_WAITING_RECOMMENDATIONS), ...incoming.slice(0, MAX_WAITING_RECOMMENDATIONS)]) {
    const item = safeItem(value);
    if (item && (items.has(item.url) || items.size < MAX_WAITING_RECOMMENDATIONS)) items.set(item.url, item);
  }
  return [...items.values()];
}
