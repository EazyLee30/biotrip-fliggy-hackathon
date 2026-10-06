import { createHash, randomInt } from "node:crypto";
import { getDatabase } from "./database";
import { PLACES } from "./places";
import { listFlyaiTools, searchFlyai, FlyaiSearchError, type FlyaiSource } from "./flyai";
import { extractFlyaiSources } from "./planning/flyai-sources";
import { poiArguments } from "./planning/poi-schema";

export class DestinationVisualError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
export function destinationCity(value: unknown): string {
  if (typeof value !== "string" || !PLACES.some(place => place.city === value)) throw new DestinationVisualError(400, "INVALID_DESTINATION");
  return value;
}
export type DestinationCatalogue = { city: string; sources: FlyaiSource[]; retrievedAt: string; cached: boolean };
type Database = ReturnType<typeof getDatabase>;

/** Cache contains public provider records only; no dates, account IDs, preferences or health data. */
export async function destinationVisuals(accountId: string, value: unknown, signal: AbortSignal, database: Database = getDatabase()): Promise<DestinationCatalogue> {
  const city = destinationCity(value);
  signal.throwIfAborted();
  const row = await database.prepare("SELECT sources_json, retrieved_at FROM destination_visuals WHERE city=? AND expires_at>unixepoch()")
    .bind(city).first<{ sources_json: string; retrieved_at: number }>();
  if (row) {
    try { return { city, sources: extractFlyaiSources(JSON.parse(row.sources_json), "景点", 24), retrievedAt: new Date(row.retrieved_at * 1000).toISOString(), cached: true }; }
    catch { /* A malformed cache is replaced only by a verified fresh result. */ }
  }
  // Configuration failures must not consume a paid-query allowance.
  if (!process.env.FLYAI_API_KEY || !process.env.FLYAI_SIGN_SECRET) throw new FlyaiSearchError(503, "FLYAI_NOT_CONFIGURED");
  const now = Math.floor(Date.now() / 1000);
  const digest = (scope: string, value: string) => createHash("sha256").update(`${scope}:${value}`).digest("hex");
  const leaseKey = digest("visual:city", city), token = randomInt(1, 2147483647);
  const lease = await database.prepare(`INSERT INTO auth_rate_limits(limit_key,hit_count,reset_at) VALUES(?,?,?)
    ON CONFLICT(limit_key) DO UPDATE SET hit_count=excluded.hit_count,reset_at=excluded.reset_at
    WHERE auth_rate_limits.reset_at<=? RETURNING hit_count`).bind(leaseKey, token, now + 20, now).first();
  if (!lease) throw new DestinationVisualError(429, "VISUAL_QUERY_IN_PROGRESS");
  try {
    const count = await database.prepare(`INSERT INTO auth_rate_limits(limit_key,hit_count,reset_at) VALUES(?,1,?)
      ON CONFLICT(limit_key) DO UPDATE SET hit_count=CASE WHEN reset_at<=? THEN 1 ELSE hit_count+1 END,
      reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END RETURNING hit_count`)
      .bind(digest("visual:hour", accountId), now + 3600, now, now).first<{ hit_count: number }>();
    if (!count || count.hit_count > 12) throw new DestinationVisualError(429, "VISUAL_RATE_LIMIT");
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(12_000)]);
    const tools = await listFlyaiTools(bounded);
    const args = poiArguments(tools.find(tool => tool.name === "search_poi"), city);
    const result = await searchFlyai("search_poi", args, bounded, "景点");
    bounded.throwIfAborted();
    const sources = result.sources.slice(0, 24);
    if (!sources.length) throw new DestinationVisualError(502, "NO_VERIFIED_POI_SOURCE");
    const retrieved = Math.floor(Date.now() / 1000);
    await database.prepare(`INSERT INTO destination_visuals(city,sources_json,retrieved_at,expires_at) VALUES(?,?,?,?)
      ON CONFLICT(city) DO UPDATE SET sources_json=excluded.sources_json,retrieved_at=excluded.retrieved_at,expires_at=excluded.expires_at`)
      .bind(city, JSON.stringify(sources), retrieved, retrieved + 604800).run();
    return { city, sources, retrievedAt: new Date(retrieved * 1000).toISOString(), cached: false };
  } finally {
    await database.prepare("DELETE FROM auth_rate_limits WHERE limit_key=? AND hit_count=?").bind(leaseKey, token).run().catch(() => undefined);
  }
}
