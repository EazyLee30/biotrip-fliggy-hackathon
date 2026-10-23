import { getDatabase } from "@/lib/database";
import { getJourney, JourneyError } from "@/lib/journeys";
import type { ItineraryActivity } from "@/lib/journey-types";
import type { AgentMessage } from "@/lib/agent/types";

export type JourneyCollectionItem = {
  id: string; journeyId: string; kind: "backlog" | "checklist";
  title: string; detail: string; checked: boolean; createdAt: string;
  activity?: ItineraryActivity;
  sourceUrl?: string; imageUrl?: string; retrievedAt?: string;
};
type Row = { id: string; journey_id: string; kind: "backlog" | "checklist"; title: string; detail: string; payload_json: string; checked: number; created_at: number };

export async function listJourneyCollections(accountId: string, journeyId: string): Promise<JourneyCollectionItem[]> {
  await getJourney(accountId, journeyId);
  const { results } = await getDatabase().prepare("SELECT * FROM journey_collection_items WHERE account_id=? AND journey_id=? ORDER BY created_at DESC,id LIMIT 200").bind(accountId, journeyId).all<Row>();
  return results.map(row => ({ ...JSON.parse(row.payload_json), id: row.id, journeyId: row.journey_id, kind: row.kind, title: row.title, detail: row.detail, checked: Boolean(row.checked), createdAt: new Date(row.created_at * 1000).toISOString() }));
}

/** Appended to the same batch as the itinerary write; a lost version race stores nothing. */
export function backlogInsertStatements(accountId: string, journeyId: string, items: ItineraryActivity[], sourceId: string, guardVersion?: number, guardAdjustmentId?: string, guardMutationId?: string, guardJobId?: string) {
  const db = getDatabase();
  return items.map((activity, index) => db.prepare(`INSERT OR IGNORE INTO journey_collection_items(id,account_id,journey_id,kind,title,detail,payload_json,source_key)
    SELECT ?,?,?,'backlog',?,?,?,? WHERE EXISTS(SELECT 1 FROM journeys WHERE id=? AND account_id=?${guardVersion === undefined ? "" : " AND version=?"}${guardMutationId ? " AND json_extract(plan_json,'$.manualAdjustment.id')=?" : ""})${guardAdjustmentId ? " AND EXISTS(SELECT 1 FROM journey_adjustments WHERE id=? AND account_id=? AND journey_id=?)" : ""}${guardJobId ? " AND EXISTS(SELECT 1 FROM planning_jobs WHERE id=? AND account_id=? AND journey_id=? AND state='completed')" : ""}`)
    .bind(crypto.randomUUID(), accountId, journeyId, activity.name, activity.detail, JSON.stringify({ activity, sourceUrl: activity.sourceUrl }), `${sourceId}:${activity.id ?? index}`, journeyId, accountId, ...(guardVersion === undefined ? [] : [guardVersion]), ...(guardMutationId ? [guardMutationId] : []), ...(guardAdjustmentId ? [guardAdjustmentId, accountId, journeyId] : []), ...(guardJobId ? [guardJobId, accountId, journeyId] : [])));
}

function record(v: unknown): v is Record<string, unknown> { return Boolean(v) && typeof v === "object" && !Array.isArray(v); }
export async function mutateJourneyCollection(accountId: string, journeyId: string, raw: unknown) {
  if (!record(raw) || !Number.isInteger(raw.expectedVersion)) throw new JourneyError(400, "INVALID_COLLECTION", "请刷新旅程后再试。");
  const journey = await getJourney(accountId, journeyId);
  if (journey.version !== raw.expectedVersion) throw new JourneyError(409, "JOURNEY_CHANGED", "旅程已变化，请刷新后重试。");
  const db = getDatabase();
  if (raw.operation === "save_offer") {
    if (typeof raw.messageId !== "string" || typeof raw.offerId !== "string") throw new JourneyError(400, "INVALID_COLLECTION", "请从检索结果中选择地点。");
    const message = await db.prepare("SELECT m.payload_json FROM agent_messages m JOIN agent_conversations c ON c.id=m.conversation_id WHERE m.id=? AND m.account_id=? AND c.journey_id=?").bind(raw.messageId, accountId, journeyId).first<{ payload_json: string | null }>();
    const payload = message?.payload_json ? JSON.parse(message.payload_json) as Pick<AgentMessage, "blocks"> : null;
    const offer = payload?.blocks?.flatMap(block => block.type === "offers" ? block.offers : []).find(offer => offer.id === raw.offerId);
    if (!offer) throw new JourneyError(404, "OFFER_NOT_FOUND", "这条检索结果已不可用，请重新查询。");
    await db.prepare("INSERT OR IGNORE INTO journey_collection_items(id,account_id,journey_id,kind,title,detail,payload_json,source_key) SELECT ?,?,?,'backlog',?,?,?,? WHERE EXISTS(SELECT 1 FROM journeys WHERE id=? AND account_id=? AND version=?)")
      .bind(crypto.randomUUID(), accountId, journeyId, offer.name, offer.facts.map(fact => `${fact.label}：${fact.value}`).join(" · ").slice(0, 1000), JSON.stringify({ sourceUrl: offer.url, imageUrl: offer.imageUrl, retrievedAt: offer.retrievedAt }), `offer:${offer.id}`, journeyId, accountId, journey.version).run();
    if ((await getJourney(accountId, journeyId)).version !== journey.version) throw new JourneyError(409, "JOURNEY_CHANGED", "旅程已变化，请刷新后重试。");
  } else if (raw.operation === "check" || raw.operation === "remove") {
    if (typeof raw.id !== "string" || (raw.operation === "check" && typeof raw.checked !== "boolean")) throw new JourneyError(400, "INVALID_COLLECTION", "请选择一个清单项目。");
    const sql = raw.operation === "remove"
      ? "DELETE FROM journey_collection_items WHERE id=? AND account_id=? AND journey_id=? AND EXISTS(SELECT 1 FROM journeys WHERE id=? AND account_id=? AND version=?) RETURNING id"
      : "UPDATE journey_collection_items SET checked=?,updated_at=unixepoch() WHERE kind='checklist' AND id=? AND account_id=? AND journey_id=? AND EXISTS(SELECT 1 FROM journeys WHERE id=? AND account_id=? AND version=?) RETURNING id";
    const changed = await db.prepare(sql).bind(...(raw.operation === "check" ? [raw.checked ? 1 : 0] : []), raw.id, accountId, journeyId, journeyId, accountId, journey.version).first();
    if (!changed) throw new JourneyError(409, "COLLECTION_CHANGED", "该项目已变化，请刷新后重试。");
  } else if (raw.operation === "add") {
    if (!["backlog", "checklist"].includes(String(raw.kind)) || !Array.isArray(raw.items) || !raw.items.length || raw.items.length > 20) throw new JourneyError(400, "INVALID_COLLECTION", "每次可添加 1–20 个项目。");
    const statements = raw.items.map((item, index) => {
      if (!record(item) || typeof item.title !== "string" || !item.title.trim() || item.title.length > 160 || (item.detail !== undefined && (typeof item.detail !== "string" || item.detail.length > 1000))) throw new JourneyError(400, "INVALID_COLLECTION", "请填写简短的项目名称与说明。");
      // Browser/model supplied links never become verified sources through this endpoint.
      const known = journey.plan?.plan.itinerary.find(a => a.id === item.activityId);
      const place = journey.plan?.plan.places.find(p => p.url === item.sourceUrl);
      const service = journey.plan?.localServices.find(p => p.sourceUrl === item.sourceUrl);
      const payload = known ? { activity: known, sourceUrl: known.sourceUrl } : place ? { sourceUrl: place.url, imageUrl: place.imageUrl, retrievedAt: journey.plan?.retrievedAt } : service ? { sourceUrl: service.sourceUrl, retrievedAt: journey.plan?.retrievedAt } : {};
      return db.prepare("INSERT OR IGNORE INTO journey_collection_items(id,account_id,journey_id,kind,title,detail,payload_json,source_key) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM journeys WHERE id=? AND account_id=? AND version=?)")
        .bind(crypto.randomUUID(), accountId, journeyId, raw.kind, known?.name ?? place?.name ?? service?.name ?? item.title.trim(), known?.detail ?? service?.detail ?? item.detail ?? "", JSON.stringify(payload), `${typeof raw.requestId === "string" ? raw.requestId.slice(0, 100) : crypto.randomUUID()}:${index}`, journeyId, accountId, journey.version);
    });
    const changed = await db.batch(statements);
    if (changed.every(result => !result.meta.changes) && (await getJourney(accountId, journeyId)).version !== journey.version) throw new JourneyError(409, "JOURNEY_CHANGED", "旅程已变化，请刷新后重试。");
  } else throw new JourneyError(400, "INVALID_COLLECTION", "不支持的清单操作。");
  return { items: await listJourneyCollections(accountId, journeyId), version: journey.version };
}
