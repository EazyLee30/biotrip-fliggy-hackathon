import { createHash } from "node:crypto";
import { getDatabase } from "./database";
import { JourneyError } from "./journeys";
import { searchFlyai } from "./flyai";
import { travelQueries } from "./travel-search-routing";
import { relevantTravelOffers, searchRelevanceDetail } from "./travel-search-relevance";
import type { ToolReceipt, TravelSearchResult, VerifiedOffer } from "./travel-search-types";

type ReceiptRow = { query_key: string; tool: ToolReceipt["tool"]; category: string; state: ToolReceipt["state"] | "started"; offers_json: string; elapsed_ms: number; code: string | null; retrieved_at: string };
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const safeCode = (error: unknown) => {
  const code = error && typeof error === "object" && "code" in error ? error.code : "SEARCH_FAILED";
  return typeof code === "string" && /^[A-Z0-9_]{1,80}$/.test(code) ? code : "SEARCH_FAILED";
};

/** Caller supplies the authenticated account, never an account field from JSON. */
export async function searchTravel(accountId: string, rawIntents: unknown, signal: AbortSignal, requestKey = crypto.randomUUID()): Promise<TravelSearchResult> {
  if (!accountId || !/^[\w:.-]{8,160}$/.test(requestKey)) throw new JourneyError(400, "INVALID_SEARCH_KEY", "搜索标识无效，请重试。");
  let queries;
  try { queries = travelQueries(rawIntents); }
  catch { throw new JourneyError(400, "INVALID_SEARCH_INTENT", "请补充搜索所需的城市、日期或关键词。"); }
  signal.throwIfAborted();
  const db = getDatabase(), hash = digest(JSON.stringify(queries.map(q => q.queryKey).sort()));
  // One atomic claim per request; an interrupted provider call is never
  // silently billed again when the client retries the same message.
  await db.prepare("INSERT OR IGNORE INTO travel_search_runs(account_id,request_key,request_hash) VALUES(?,?,?) RETURNING request_hash")
    .bind(accountId, requestKey, hash).first();
  const stored = await db.prepare("SELECT request_hash FROM travel_search_runs WHERE account_id=? AND request_key=?")
    .bind(accountId, requestKey).first<{ request_hash: string }>();
  if (stored?.request_hash !== hash) throw new JourneyError(409, "SEARCH_KEY_REUSED", "搜索条件已变化，请重新发起搜索。");
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
  await Promise.all(queries.map(async query => {
    const startedAt = new Date().toISOString();
    const owned = await db.prepare("INSERT OR IGNORE INTO travel_search_queries(account_id,request_key,query_key,tool,category,state,retrieved_at) VALUES(?,?,?,?,?,'started',?) RETURNING query_key")
      .bind(accountId, requestKey, query.queryKey, query.tool, query.category, startedAt).first();
    if (!owned) return;
    const start = Date.now();
    try {
      bounded.throwIfAborted();
      const count = await db.prepare(`INSERT INTO auth_rate_limits(limit_key,hit_count,reset_at) VALUES(?,1,unixepoch()+3600)
        ON CONFLICT(limit_key) DO UPDATE SET hit_count=CASE WHEN reset_at<=unixepoch() THEN 1 ELSE hit_count+1 END,
        reset_at=CASE WHEN reset_at<=unixepoch() THEN unixepoch()+3600 ELSE reset_at END RETURNING hit_count`)
        .bind(digest(`travel-search:${accountId}`)).first<{ hit_count: number }>();
      if (!count || count.hit_count > 48) throw new JourneyError(429, "SEARCH_RATE_LIMIT", "本小时搜索次数已达上限，请稍后再试。");
      const result = await searchFlyai(query.tool, query.args, bounded, query.category);
      const checked = relevantTravelOffers(result.sources.filter((source): source is VerifiedOffer => Boolean(source.id && source.kind && source.tool && source.retrievedAt && source.facts)), query);
      const offers = checked.offers.slice(0, 12);
      await db.prepare("UPDATE travel_search_queries SET state=?,offers_json=?,elapsed_ms=?,retrieved_at=?,code=? WHERE account_id=? AND request_key=? AND query_key=?")
        .bind(offers.length ? "completed" : "empty", JSON.stringify(offers), Date.now() - start, new Date().toISOString(), checked.code ?? null, accountId, requestKey, query.queryKey).run();
    } catch (error) {
      // Timeout may occur after provider accepted the request: show unknown,
      // never convert it into an automatic paid retry.
      await db.prepare("UPDATE travel_search_queries SET state=?,code=?,elapsed_ms=? WHERE account_id=? AND request_key=? AND query_key=?")
        .bind(bounded.aborted ? "unknown" : "failed", safeCode(error), Date.now() - start, accountId, requestKey, query.queryKey).run();
    }
  }));
  signal.throwIfAborted();
  const rows = await db.prepare("SELECT * FROM travel_search_queries WHERE account_id=? AND request_key=? ORDER BY retrieved_at,query_key")
    .bind(accountId, requestKey).all<ReceiptRow>();
  const offers = new Map<string, VerifiedOffer>();
  const receipts = rows.results.map(row => {
    const items = JSON.parse(row.offers_json) as VerifiedOffer[];
    for (const item of items) if (offers.size < 24) offers.set(item.id, item);
    return { queryKey: row.query_key, tool: row.tool, category: row.category,
      state: row.state === "started" ? "unknown" as const : row.state, executor: "worker" as const,
      sourceCount: items.length, elapsedMs: row.elapsed_ms, retrievedAt: row.retrieved_at,
      ...(searchRelevanceDetail(row.code) ? { detail: searchRelevanceDetail(row.code) } : {}),
      ...(row.code ? { code: row.code } : row.state === "started" ? { code: "SEARCH_IN_PROGRESS" } : {}) };
  });
  return { offers: [...offers.values()], receipts, searchedAt: new Date().toISOString() };
}
