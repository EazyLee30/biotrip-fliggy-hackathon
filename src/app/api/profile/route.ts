import { NextResponse } from "next/server";
import { getCurrentAccount, getDatabase, isSameOrigin } from "@/lib/auth";
import { learnFromProfile } from "@/lib/preferences";
import { readJourneyJson } from "@/lib/journey-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProfileRecord = {
  home_city: string;
  travel_style: "flexible" | "structured";
  food_preferences: string;
  sensory_preferences: string;
  memory_notes: string;
};

export async function GET() {
  try {
    const account = await getCurrentAccount();
    if (!account) return NextResponse.json({ error: "请先登录。" }, { status: 401 });
    const profile = await getDatabase().prepare(`SELECT home_city, travel_style, food_preferences,
        sensory_preferences, memory_notes FROM profiles WHERE account_id = ?`)
      .bind(account.id).first<ProfileRecord>();
    return NextResponse.json({ account, profile: profile ? {
      homeCity: profile.home_city,
      travelStyle: profile.travel_style,
      foodPreferences: profile.food_preferences,
      sensoryPreferences: JSON.parse(profile.sensory_preferences) as string[],
      memoryNotes: profile.memory_notes,
    } : null }, { headers: { "Cache-Control": "no-store, private" } });
  } catch {
    return NextResponse.json({ error: "暂时无法读取个人档案。" }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "请求来源无效。" }, { status: 403 });
  const account = await getCurrentAccount().catch(() => null);
  if (!account) return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  const value = await readJourneyJson(request, 24_000).catch(() => null) as Record<string, unknown> | null;
  if (!value ||
      typeof value.homeCity !== "string" || value.homeCity.length > 100 ||
      !["flexible", "structured"].includes(String(value.travelStyle)) ||
      typeof value.foodPreferences !== "string" || value.foodPreferences.length > 500 ||
      !Array.isArray(value.sensoryPreferences) || value.sensoryPreferences.length > 8 ||
      value.sensoryPreferences.some((item) => typeof item !== "string" || item.length > 40) ||
      typeof value.memoryNotes !== "string" || value.memoryNotes.length > 5000 ||
      (value.displayName !== undefined && (typeof value.displayName !== "string" || value.displayName.length > 80))) {
    return NextResponse.json({ error: "请检查档案内容后重试。" }, { status: 400 });
  }
  try {
    await getDatabase().batch([
      getDatabase().prepare(`INSERT INTO profiles (account_id, home_city, travel_style, food_preferences, sensory_preferences, memory_notes)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET home_city = excluded.home_city,
        travel_style = excluded.travel_style, food_preferences = excluded.food_preferences,
        sensory_preferences = excluded.sensory_preferences, memory_notes = excluded.memory_notes, updated_at = unixepoch()`)
        .bind(account.id, value.homeCity.trim(), value.travelStyle, value.foodPreferences.trim(),
          JSON.stringify([...new Set(value.sensoryPreferences)]), value.memoryNotes.trim()),
      getDatabase().prepare("UPDATE accounts SET display_name = ?, updated_at = unixepoch() WHERE id = ?")
        .bind(typeof value.displayName === "string" ? value.displayName.trim() : account.display_name, account.id),
    ]);
    // Defaults the traveller set by hand outrank anything BioTrip inferred.
    await learnFromProfile(account.id, {
      travelStyle: String(value.travelStyle),
      sensoryPreferences: value.sensoryPreferences.filter((item): item is string => typeof item === "string"),
      foodPreferences: String(value.foodPreferences),
      homeCity: String(value.homeCity),
    });
    return NextResponse.json({ saved: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "个人档案暂时无法保存。" }, { status: 503 });
  }
}
