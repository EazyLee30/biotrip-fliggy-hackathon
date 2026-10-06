import type { JourneyGeneratedPlan, JourneyTripDraft } from "../journey-types";
import { productImageUrl } from "../product-image";
import { resolveAccepted } from "./validate";
import { ReflowError } from "./reflow";
import type { AdjustmentCandidate } from "../planning/adjust-pipeline";

/** Applies only server-validated proposals; caller supplies IDs, never operations. */
export function applyAdjustments(current: JourneyGeneratedPlan, candidate: AdjustmentCandidate, accept: unknown, trip: JourneyTripDraft, fromTime?: string): JourneyGeneratedPlan {
  if (!Array.isArray(accept) || !accept.length || accept.length > 12 || accept.some(id => typeof id !== "string") || new Set(accept).size !== accept.length) throw new ReflowError("请逐条选择要应用的建议，不能重复选择。");
  const scope = { ...candidate.scope, ...(fromTime && fromTime > candidate.scope.fromTime ? { fromTime } : {}) };
  const result = resolveAccepted(candidate.proposals, accept, current.plan.itinerary, trip, scope);
  if (!result.operations.length) throw new ReflowError("所选建议没有改变行程；呼吸练习可以直接开始。");
  const places = [...current.plan.places];
  const images = { ...current.visuals?.images };
  for (const proposal of result.proposals) {
    const source = proposal.source;
    if (!source) continue;
    const imageUrl = productImageUrl(source.imageUrl);
    if (!places.some(place => place.url === source.url)) places.push({ name: source.name, category: proposal.angle === "food" ? "餐食" : "放松", reason: proposal.reason,
      source: source.kind.startsWith("fliggy") ? "飞猪实时搜索" : "当地公开来源", sourceKind: source.kind === "fliggy_poi" ? "fliggy_poi" : source.kind === "fliggy_product" ? "fliggy_product" : "reference",
      url: source.url, ...(imageUrl ? { imageUrl } : {}) });
    if (imageUrl) images[source.url] = { imageUrl, name: source.name, kind: source.kind === "fliggy_poi" ? "poi" : "product" };
  }
  return { ...current, plan: { ...current.plan, itinerary: result.itinerary, places,
    adjustments: [...current.plan.adjustments, ...result.proposals.map(proposal => `已采纳：${proposal.title}`)].slice(-30) },
    ...(current.visuals || Object.keys(images).length ? { visuals: { cover: current.visuals?.cover ?? [], images } } : {}),
    manualAdjustment: { updatedAt: new Date().toISOString(), revision: (current.manualAdjustment?.revision ?? 0) + 1, operationCount: result.operations.length } };
}
