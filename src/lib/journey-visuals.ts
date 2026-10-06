import { createHash } from "node:crypto";
import { getDatabase } from "./database";
import { getJourney, JourneyError, isRecord, onlyKeys, requireVersion } from "./journeys";
import { destinationVisuals } from "./destination-visuals";
import { bindVisuals } from "./planning/visuals";

/** Bind public photographs to the saved plan without invoking a model or changing its draft. */
export async function supplementJourneyVisuals(accountId: string, id: string, value: unknown, signal: AbortSignal) {
  if (!isRecord(value)) throw new JourneyError(400, "INVALID_JOURNEY", "补图请求无效。");
  onlyKeys(value, ["version"]);
  const version = requireVersion(value.version);
  const current = await getJourney(accountId, id);
  if (current.version !== version) throw new JourneyError(409, "JOURNEY_CONFLICT", "旅程已更新，请刷新后再补图。");
  if (!current.plan || !current.planCurrent) throw new JourneyError(409, "PLAN_NOT_CURRENT", "请先为当前目的地生成行程。");
  const database = getDatabase();
  const lockKey = createHash("sha256").update(`plan:active:${accountId}`).digest("hex");
  const active = async () => Boolean(await database.prepare(`SELECT 1 FROM auth_rate_limits WHERE limit_key=? AND reset_at>unixepoch()
    UNION ALL SELECT 1 FROM planning_jobs WHERE account_id=? AND state IN ('queued','running','cancel_requested') LIMIT 1`).bind(lockKey, accountId).first());
  const busy = () => new JourneyError(409, "PLANNING_IN_PROGRESS", "请等待后台规划完成或取消后再补图。");
  if (await active()) throw busy();
  const catalogue = await destinationVisuals(accountId, current.draft.trip?.destinationCity, signal);
  const previous = current.plan.visuals;
  const products = [
    ...(previous?.cover ?? []).filter(ref => ref.kind === "product").map(ref => ({ ...ref, category: "景点与体验" })),
    ...Object.entries(previous?.images ?? {}).filter(([, ref]) => ref.kind === "product").map(([url, ref]) => ({ ...ref, url, category: "景点与体验" })),
  ];
  const bound = bindVisuals(current.plan.plan.itinerary, { city: catalogue.city, pois: catalogue.sources, products });
  const covers = [...bound.visuals.cover, ...(previous?.cover ?? [])];
  const visuals = { cover: covers.filter((ref, index) => covers.findIndex(other => other.url === ref.url || other.imageUrl === ref.imageUrl) === index).slice(0, 8), images: { ...previous?.images, ...bound.visuals.images } };
  if (!visuals.cover.length && !Object.keys(bound.visuals.images).length) return { journey: current, updated: false };
  const generated = { ...current.plan, plan: { ...current.plan.plan, itinerary: bound.itinerary }, visuals };
  if (JSON.stringify(generated) === JSON.stringify(current.plan)) return { journey: current, updated: false };
  const encoded = JSON.stringify(generated);
  if (encoded.length > 64_000) throw new JourneyError(413, "PLAN_TOO_LARGE", "实景资料过长，暂时无法补图。");
  signal.throwIfAborted();
  const result = await database.prepare(`UPDATE journeys SET plan_json=?,version=version+1,updated_at=unixepoch()
    WHERE id=? AND account_id=? AND version=?
    AND NOT EXISTS(SELECT 1 FROM auth_rate_limits WHERE limit_key=? AND reset_at>unixepoch())
    AND NOT EXISTS(SELECT 1 FROM planning_jobs WHERE account_id=? AND state IN ('queued','running','cancel_requested')) RETURNING version`)
    .bind(encoded, id, accountId, version, lockKey, accountId).first();
  if (!result) {
    if (await active()) throw busy();
    throw new JourneyError(409, "JOURNEY_CONFLICT", "旅程已更新，请刷新后再补图。");
  }
  return { journey: await getJourney(accountId, id), updated: true };
}
