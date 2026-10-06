import type { ItineraryActivity, JourneyVisuals, VisualRef } from "../journey-types";
import { activityTags } from "../adjust/tags";
import { productImageUrl } from "../product-image";

/**
 * Pairs activities with real photographs, deterministically.
 *
 * A photograph is only ever attached when the activity's own name leads with
 * the name of a retrieved attraction or appears inside a retrieved product. No
 * model is asked which picture fits, nothing is guessed from a neighbourhood or
 * a dish, and an activity without a confident match simply has no picture —
 * a wrong photograph of a real place is worse than none.
 */

export type VisualSource = { name: string; url: string; category: string; imageUrl?: string };
type Candidate = VisualSource & { kind: VisualRef["kind"]; core: string };

const GENERIC_SUFFIX = /(?:国家级)?(?:风景名胜区|旅游度假区|旅游景区|风景区|度假区|旅游区|景区)$/;
const PRODUCT_NOISE = /(?:成人票|儿童票|大门票|门票|套票|联票|一日游|半日游|含.*)$/;
const SEPARATOR = /[·•・|｜\-—–:：，,、\s（(【\[]/;
// A place name must not lend its picture to a meal, a rest or a transfer that merely mentions it.
const PLACE_KINDS = new Set(["sight", "experience", "other"]);

function squash(text: string) {
  return text.replace(/[（(【\[][^）)】\]]*[）)】\]]/g, "").replace(/[\s·•・|｜\-—–:：，,、。！!？?"'“”‘’]/g, "");
}
/** The distinctive part of an attraction's name: no city prefix, no "scenic area" suffix. */
export function coreName(name: string, city: string): string {
  let core = squash(name);
  if (city && core.startsWith(city) && core.length - city.length >= 2) {
    core = core.slice(city.length);
    if (core.startsWith("市") && core.length >= 3) core = core.slice(1);
  }
  const trimmed = core.replace(GENERIC_SUFFIX, "");
  return trimmed.length >= 2 ? trimmed : core;
}
/** What an activity is about: the words before its first separator. */
export function leadName(name: string, city: string): string {
  const lead = name.trim().split(SEPARATOR).find((part) => part.trim())?.trim() ?? "";
  return coreName(lead, city);
}

function score(lead: string, candidate: Candidate, placeLike: boolean): number {
  if (!lead || !candidate.core) return 0;
  if (candidate.kind === "poi") {
    if (lead === candidate.core) return 1000 + candidate.core.length;
    if (!placeLike) return 0;
    if (lead.startsWith(candidate.core)) return 600 + candidate.core.length;
    if (lead.length >= 3 && candidate.core.startsWith(lead)) return 500 + lead.length;
    return 0;
  }
  return placeLike && lead.length >= 3 && squash(candidate.name).includes(lead) ? 300 + lead.length : 0;
}

export function bindVisuals(
  itinerary: readonly ItineraryActivity[],
  input: { city: string; pois: readonly VisualSource[]; products: readonly VisualSource[] },
): { itinerary: ItineraryActivity[]; visuals: JourneyVisuals } {
  const candidates: Candidate[] = [
    ...input.pois.map((source) => ({ ...source, kind: "poi" as const, core: coreName(source.name, input.city) })),
    ...input.products.map((source) => ({ ...source, kind: "product" as const, core: coreName(source.name.replace(PRODUCT_NOISE, ""), input.city) })),
  ].map((candidate) => ({ ...candidate, imageUrl: productImageUrl(candidate.imageUrl) ?? undefined }));
  const byUrl = new Map(candidates.map((candidate) => [candidate.url, candidate]));
  const images: JourneyVisuals["images"] = {};
  const referenced: Candidate[] = [];
  const remember = (candidate: Candidate) => {
    if (!candidate.imageUrl) return;
    images[candidate.url] = { imageUrl: candidate.imageUrl, name: candidate.name, kind: candidate.kind };
    if (!referenced.includes(candidate)) referenced.push(candidate);
  };

  const bound = itinerary.map((item) => {
    // A link the traveller or an accepted suggestion already chose is never replaced.
    if (item.sourceUrl) {
      const existing = byUrl.get(item.sourceUrl);
      if (existing) remember(existing);
      return { ...item };
    }
    const lead = leadName(item.name, input.city);
    const placeLike = PLACE_KINDS.has(activityTags(item).kind);
    let best: Candidate | null = null, bestScore = 0;
    for (const candidate of candidates) {
      const value = score(lead, candidate, placeLike);
      if (value > bestScore) { best = candidate; bestScore = value; }
    }
    if (!best) return { ...item };
    remember(best);
    return { ...item, sourceUrl: best.url };
  });

  // Cover: places the itinerary actually visits first, then other attractions, then ticketed experiences.
  const cover: VisualRef[] = [];
  const add = (candidate: Candidate) => {
    if (cover.length >= 8 || !candidate.imageUrl || cover.some((entry) => entry.url === candidate.url || entry.imageUrl === candidate.imageUrl)) return;
    cover.push({ imageUrl: candidate.imageUrl, name: candidate.name, url: candidate.url, kind: candidate.kind });
  };
  for (const candidate of referenced.filter((entry) => entry.kind === "poi")) add(candidate);
  for (const candidate of candidates.filter((entry) => entry.kind === "poi")) add(candidate);
  for (const candidate of candidates.filter((entry) => entry.kind === "product" && /景点|体验/.test(entry.category))) add(candidate);
  return { itinerary: bound, visuals: { cover, images } };
}
