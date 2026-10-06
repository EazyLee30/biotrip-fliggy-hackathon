import type { Journey, JourneyGeneratedPlan, VisualRef } from "./journey-types";
import { productImageUrl } from "./product-image";
import { publicRecommendationUrl } from "./planning-recommendations";

export const SHARE_COVERS = ["morning-courtyard", "forest", "tea", "coast", "rest", "train", "hangzhou-broken-bridge"] as const;
export type ShareCover = typeof SHARE_COVERS[number];

export type JourneyShareSnapshot = {
  destination: string; headline: string; summary: string;
  places: Array<{ name: string; category: string; source: string; url: string }>;
  itinerary?: JourneyGeneratedPlan["plan"]["itinerary"];
  schemaVersion?: 2;
  template?: "postcard" | "journal";
  journeyVersion?: number;
  coverAssetId?: ShareCover;
  coverImages?: VisualRef[];
  theme?: "zen-light";
  days?: Array<{ dayIndex: number; date?: string; items: Array<{ time: string; name: string; detail?: string; fixed?: boolean }> }>;
};

export type ShareOptions = {
  template?: "postcard" | "journal";
  title?: string;
  selectedPlaceUrls?: string[];
  selectedCoverUrls?: string[];
  schemaVersion: 2;
  includeSummary: boolean;
  includePlaces: boolean;
  includeItinerary: boolean;
  includeActivityDetails: boolean;
  includeExactDates: boolean;
  includeFixed: boolean;
  coverAssetId?: ShareCover;
};
export const DEFAULT_SHARE_OPTIONS: ShareOptions = {
  template: "postcard", schemaVersion: 2, includeSummary: false, includePlaces: true, includeItinerary: false,
  includeActivityDetails: false, includeExactDates: false, includeFixed: false,
  coverAssetId: "morning-courtyard",
};

/** The same exact snapshot can be previewed before granting public access. */
export function publicJourneySnapshot(journey: Journey, includeItinerary: boolean | ShareOptions = false): JourneyShareSnapshot {
  if (!journey.plan || !journey.planCurrent) throw new Error("请先为当前偏好生成行程，再创建公开分享。");
  const places = journey.plan.plan.places.flatMap((place) => {
    const url = publicRecommendationUrl(place.url);
    return url ? [{ name: place.name, category: place.category, source: place.source, url }] : [];
  });
  const destination = journey.draft.trip?.destinationCity ?? "旅程";
  if (typeof includeItinerary === "object") {
    const options = includeItinerary;
    const dates = [...new Set(journey.plan.plan.itinerary.map((item) => item.date ?? ""))];
    const days = options.includeItinerary ? dates.flatMap((date, index) => {
      const items = journey.plan!.plan.itinerary.filter((item) => (item.date ?? "") === date && (options.includeFixed || !item.fixed))
        .map((item) => ({ time: item.time, name: item.name,
          ...(options.includeActivityDetails ? { detail: item.detail } : {}),
          ...(options.includeFixed ? { fixed: item.fixed } : {}) }));
      return items.length ? [{ dayIndex: index + 1, ...(options.includeExactDates && date ? { date } : {}), items }] : [];
    }) : [];
    if (options.coverAssetId === "hangzhou-broken-bridge" && destination !== "杭州") throw new Error("这张实景封面仅用于杭州旅程，请选择对应目的地或氛围封面。");
    const selectedPlaces = options.includePlaces ? places.filter(place => options.selectedPlaceUrls === undefined || options.selectedPlaceUrls.includes(place.url)) : [];
    const summary = options.includeSummary ? journey.plan.plan.summary : "";
    const coverImages = (journey.plan.visuals?.cover ?? []).filter(image =>
      options.selectedCoverUrls?.includes(image.url) && productImageUrl(image.imageUrl) && publicRecommendationUrl(image.url))
      .slice(0, 4).map(({ name, imageUrl, url, kind }) => ({ name, imageUrl, url, kind }));
    // Long or detailed content stays readable in the paginated journal.
    const template = options.template === "postcard" && !days.length && !summary && selectedPlaces.length <= 3
      && selectedPlaces.every(place => Array.from(place.name).length <= 22 && Array.from(place.source).length <= 30) ? "postcard" : "journal";
    return { schemaVersion: 2, template, journeyVersion: journey.version, coverAssetId: options.coverAssetId ?? "morning-courtyard", theme: "zen-light", destination,
      headline: options.title?.trim() || `${destination}旅行札记`, summary,
      places: selectedPlaces, ...(coverImages.length ? { coverImages } : {}), ...(options.includeItinerary ? { days } : {}) };
  }
  return { destination,
    headline: journey.plan.plan.headline, summary: journey.plan.plan.summary, places,
    ...(includeItinerary ? { itinerary: journey.plan.plan.itinerary.map(({ date, time, name, detail, fixed }) => ({ ...(date ? { date } : {}), time, name, detail, fixed })) } : {}) };
}
