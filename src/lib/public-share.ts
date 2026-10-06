import { cache } from "react";
import { getDatabase } from "./auth";
import type { JourneyShareSnapshot } from "./journey-share";

/** Request-local deduplication only: revocation is checked on every SSR request. */
export const readActiveShare = cache(async (id: string): Promise<JourneyShareSnapshot | null> => {
  if (!/^[A-Za-z0-9_-]{12}$/.test(id)) return null;
  const row = await getDatabase().prepare("SELECT payload FROM trip_shares WHERE id = ? AND expires_at > unixepoch()")
    .bind(id).first<{ payload: string }>();
  return row ? JSON.parse(row.payload) as JourneyShareSnapshot : null;
});
