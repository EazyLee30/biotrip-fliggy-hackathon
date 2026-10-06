import { randomBytes } from "node:crypto";
import { getDatabase } from "@/lib/auth";
import { getJourney, isRecord, JourneyError, onlyKeys, requireVersion } from "@/lib/journeys";
import { journeyAccount, journeyFailure, journeyResponse, readJourneyJson } from "@/lib/journey-http";
import { DEFAULT_SHARE_OPTIONS, SHARE_COVERS, publicJourneySnapshot, type ShareOptions, type ShareCover } from "@/lib/journey-share";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const account = await journeyAccount(request);
    const rows = await getDatabase().prepare("SELECT id, payload, expires_at FROM trip_shares WHERE account_id = ? AND expires_at > unixepoch() ORDER BY created_at DESC LIMIT 50")
      .bind(account.id).all<{ id: string; payload: string; expires_at: number }>();
    const shares = rows.results.map((row) => {
      const payload = JSON.parse(row.payload) as { destination?: unknown; headline?: unknown; itinerary?: unknown };
      return { id: row.id, destination: typeof payload.destination === "string" ? payload.destination : "旅程",
        headline: typeof payload.headline === "string" ? payload.headline : "分享的旅程",
        includesItinerary: Array.isArray(payload.itinerary) || Array.isArray((payload as { days?: unknown }).days), expiresAt: row.expires_at };
    });
    return journeyResponse({ shares });
  } catch (error) { return journeyFailure(error); }
}

export async function POST(request: Request) {
  try {
    const account = await journeyAccount(request, true);
    const value = await readJourneyJson(request);
    if (!isRecord(value)) throw new JourneyError(400, "INVALID_SHARE", "分享内容无效。");
    onlyKeys(value, ["journeyId", "version", "includeItinerary", "schemaVersion", "includeSummary", "includePlaces", "includeActivityDetails", "includeExactDates", "includeFixed", "coverAssetId", "template", "title", "selectedPlaceUrls", "selectedCoverUrls"]);
    if (value.selectedCoverUrls !== undefined) {
      if (value.schemaVersion !== 2 || !Array.isArray(value.selectedCoverUrls) || value.selectedCoverUrls.length > 4 || value.selectedCoverUrls.some(url => typeof url !== "string" || url.length > 4096)) throw new JourneyError(400, "INVALID_SHARE", "最多选择四张已有实景。");
    }
    if (value.schemaVersion !== undefined && value.schemaVersion !== 2) throw new JourneyError(400, "INVALID_SHARE", "分享版本无效。");
    const options = { ...DEFAULT_SHARE_OPTIONS };
    if (Array.isArray(value.selectedCoverUrls)) options.selectedCoverUrls = [...new Set(value.selectedCoverUrls)] as string[];
    if (value.template !== undefined) {
      if (value.template !== "postcard" && value.template !== "journal") throw new JourneyError(400, "INVALID_SHARE", "请选择分享样式。");
      options.template = value.template;
    }
    if (value.title !== undefined) {
      if (typeof value.title !== "string" || Array.from(value.title.trim()).length > 40 || /[\r\n\x00-\x1f]/.test(value.title)) throw new JourneyError(400, "INVALID_SHARE", "分享标题请使用 40 字以内的单行文字。");
      options.title = value.title.trim();
    }
    if (value.selectedPlaceUrls !== undefined) {
      if (!Array.isArray(value.selectedPlaceUrls) || value.selectedPlaceUrls.length > 100 || value.selectedPlaceUrls.some(url => typeof url !== "string" || url.length > 4096)) throw new JourneyError(400, "INVALID_SHARE", "请选择已有推荐。");
      options.selectedPlaceUrls = [...new Set(value.selectedPlaceUrls)] as string[];
    }
    if (value.coverAssetId !== undefined) {
      if (!SHARE_COVERS.includes(value.coverAssetId as ShareCover)) throw new JourneyError(400, "INVALID_SHARE", "请选择已有封面。");
      options.coverAssetId = value.coverAssetId as ShareCover;
    }
    for (const key of ["includeSummary", "includePlaces", "includeItinerary", "includeActivityDetails", "includeExactDates", "includeFixed"] as const) {
      if (value[key] !== undefined && typeof value[key] !== "boolean") throw new JourneyError(400, "INVALID_SHARE", "分享选项无效。");
      if (typeof value[key] === "boolean") options[key] = value[key];
    }
    if (typeof value.journeyId !== "string" || (value.includeItinerary !== undefined && typeof value.includeItinerary !== "boolean")) {
      throw new JourneyError(400, "INVALID_SHARE", "请选择一份已保存的旅程，并确认要公开的内容。");
    }
    const version = requireVersion(value.version);
    const journey = await getJourney(account.id, value.journeyId);
    if (journey.version !== version) throw new JourneyError(409, "JOURNEY_CHANGED", "旅程已更新，请刷新后再分享。");
    if (!journey.plan || !journey.planCurrent) throw new JourneyError(409, "PLAN_NOT_CURRENT", "请先为当前偏好生成行程，再创建公开分享。");
    if (options.coverAssetId === "hangzhou-broken-bridge" && journey.draft.trip?.destinationCity?.trim() !== "杭州") throw new JourneyError(400, "INVALID_SHARE", "这张实景封面仅用于杭州旅程。");
    if (options.selectedPlaceUrls?.some(url => !journey.plan!.plan.places.some(place => place.url === url))) throw new JourneyError(400, "INVALID_SHARE", "所选推荐不属于当前旅程，请刷新预览。");
    if (options.selectedCoverUrls?.some(url => !journey.plan!.visuals?.cover.some(image => image.url === url))) throw new JourneyError(400, "INVALID_SHARE", "所选实景不属于当前旅程，请刷新预览。");
    const payload = publicJourneySnapshot(journey, value.schemaVersion === 2 ? options as ShareOptions : value.includeItinerary === true);
    const id = randomBytes(9).toString("base64url");
    const expiresAt = Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60;
    // A concurrent edit cannot publish a stale snapshot after the user's preview.
    const result = await getDatabase().prepare(`INSERT INTO trip_shares (id, account_id, payload, expires_at)
      SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM journeys WHERE id = ? AND account_id = ? AND version = ?
      AND plan_json IS NOT NULL AND plan_draft_json = draft_json)`)
      .bind(id, account.id, JSON.stringify(payload), expiresAt, journey.id, account.id, version).run();
    if (result.meta.changes !== 1) throw new JourneyError(409, "JOURNEY_CHANGED", "旅程已更新，请刷新后再分享。");
    return journeyResponse({ path: `/share/${id}`, expiresAt, share: payload }, 201);
  } catch (error) { return journeyFailure(error); }
}
