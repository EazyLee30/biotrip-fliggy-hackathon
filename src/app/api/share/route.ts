import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentAccount, getDatabase, isSameOrigin } from "@/lib/auth";
import { getJourney, JourneyError, requireVersion } from "@/lib/journeys";
import { journeyFailure, readJourneyJson } from "@/lib/journey-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch { return null; }
}

export async function GET() {
  const account = await getCurrentAccount().catch(() => null);
  if (!account) return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  try {
    const rows = await getDatabase().prepare("SELECT id, payload, expires_at FROM trip_shares WHERE account_id = ? AND expires_at > unixepoch() ORDER BY created_at DESC LIMIT 50")
      .bind(account.id).all<{ id: string; payload: string; expires_at: number }>();
    const shares = rows.results.map((row) => {
      const payload = JSON.parse(row.payload) as { destination?: unknown; headline?: unknown };
      return {
        id: row.id,
        destination: typeof payload.destination === "string" ? payload.destination : "旅程",
        headline: typeof payload.headline === "string" ? payload.headline : "分享的旅程",
        expiresAt: row.expires_at,
      };
    });
    return NextResponse.json({ shares }, { headers: { "Cache-Control": "no-store, private" } });
  } catch {
    return NextResponse.json({ error: "暂时无法读取分享链接。" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "请求来源无效。" }, { status: 403 });
  const account = await getCurrentAccount().catch(() => null);
  if (!account) return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  let value: unknown;
  try {
    value = await readJourneyJson(request, 64_000);
    if (isRecord(value) && typeof value.journeyId === "string") {
      const journey = await getJourney(account.id, value.journeyId);
      if (journey.version !== requireVersion(value.version)) throw new JourneyError(409, "JOURNEY_CHANGED", "旅程已更新，请刷新后再分享。");
      if (!journey.plan || !journey.planCurrent) throw new JourneyError(409, "PLAN_NOT_CURRENT", "请先为当前偏好生成行程，再创建公开分享。");
      value = { trip: journey.draft.trip, plan: journey.plan.plan };
    }
  } catch (error) { return journeyFailure(error); }
  if (!isRecord(value) || !isRecord(value.trip) || !isRecord(value.plan) ||
      typeof value.trip.destinationCity !== "string" || value.trip.destinationCity.length > 100 ||
      typeof value.plan.headline !== "string" || value.plan.headline.length > 120 ||
      typeof value.plan.summary !== "string" || value.plan.summary.length > 700 ||
      !Array.isArray(value.plan.places) || value.plan.places.length > 8) {
    return NextResponse.json({ error: "分享内容无效。" }, { status: 400 });
  }
  const places = value.plan.places.filter(isRecord).map((place) => {
    const url = safeUrl(place.url);
    if (!url || typeof place.name !== "string" || typeof place.category !== "string") return null;
    return { name: place.name.slice(0, 160), category: place.category.slice(0, 80), url };
  }).filter((place): place is NonNullable<typeof place> => place !== null);
  const id = randomBytes(9).toString("base64url");
  const expiresAt = Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60;
  const payload = {
    destination: value.trip.destinationCity.trim(),
    headline: value.plan.headline.trim(),
    summary: value.plan.summary.trim(),
    places,
  };
  try {
    await getDatabase().prepare("DELETE FROM trip_shares WHERE expires_at <= unixepoch()").run();
    await getDatabase().prepare("INSERT INTO trip_shares (id, account_id, payload, expires_at) VALUES (?, ?, ?, ?)")
      .bind(id, account.id, JSON.stringify(payload), expiresAt).run();
    return NextResponse.json({ path: `/share/${id}`, expiresAt }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "暂时无法生成分享链接。" }, { status: 503 });
  }
}
