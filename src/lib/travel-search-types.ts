export const SEARCH_KINDS = ["flight", "train", "hotel", "poi", "marriott_hotel", "marriott_package", "keyword", "semantic"] as const;
export type SearchKind = typeof SEARCH_KINDS[number];
export type FlyaiTool = "search_flight" | "search_domestic_train" | "search_hotels" | "search_poi" | "search_marriott_hotels" | "search_marriott_packages" | "fliggy_fast_search" | "fliggy_ai_search";
/** Public travel conditions only. Never pass body signals or memory objects. */
export type SearchIntent = {
  kind: SearchKind;
  city?: string; origin?: string; destination?: string;
  departureDate?: string; returnDate?: string; checkInDate?: string; checkOutDate?: string;
  keyword?: string; query?: string; nearby?: string; category?: string; brands?: string[];
  maxPrice?: number; directOnly?: boolean; maxDurationHours?: number;
  sort?: "recommended" | "price_asc" | "distance_asc" | "duration_asc";
};
export type OfferSegment = { origin: string; destination: string; departure?: string; arrival?: string; number?: string; seat?: string; duration?: string };
export type VerifiedOffer = {
  id: string; kind: SearchKind; tool: FlyaiTool; retrievedAt: string;
  name: string; url: string; category: string; price: string | null;
  imageUrl?: string; address?: string;
  facts: Array<{ label: string; value: string }>;
  transport?: { segments: OfferSegment[]; duration?: string };
};
export type ToolReceipt = {
  queryKey: string; tool: FlyaiTool; category: string;
  state: "completed" | "empty" | "failed" | "unknown";
  executor: "agent_skill" | "worker";
  sourceCount: number; elapsedMs: number; retrievedAt: string; code?: string; detail?: string;
};
export type TravelSearchResult = { offers: VerifiedOffer[]; receipts: ToolReceipt[]; searchedAt: string };
export type TravelQuery = { tool: FlyaiTool; args: Record<string, unknown>; command: string; category: string; queryKey: string; kind: SearchKind };
