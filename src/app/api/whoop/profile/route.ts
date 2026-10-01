import { NextResponse } from "next/server";
import {
  getWhoopConnectionMeta,
  getWhoopProfile,
  readWhoopTokens,
  saveWhoopProfileMeta,
  WhoopReauthorizationRequiredError,
} from "@/lib/whoop";
import { getCurrentAccount } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const account = await getCurrentAccount().catch(() => null);
  if (!account) return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  const headers = { "Cache-Control": "no-store, private" };
  if (!(await readWhoopTokens(account.id))) {
    return NextResponse.json({ connected: false, profile: null }, { headers });
  }

  // The display name is stored at connection time, so the interface can confirm
  // the linked WHOOP account even before a live WHOOP call succeeds.
  const stored = await getWhoopConnectionMeta(account.id);
  try {
    const profile = await getWhoopProfile(account.id);
    await saveWhoopProfileMeta(account.id, profile).catch(() => undefined);
    return NextResponse.json({
      connected: true,
      profile,
      connectedAt: stored?.connectedAt ?? null,
    }, { headers });
  } catch (error) {
    if (error instanceof WhoopReauthorizationRequiredError) {
      return NextResponse.json(
        { connected: false, reauthorizationRequired: true, error: "WHOOP 授权已失效，请重新连接一次。", profile: null },
        { status: 409, headers },
      );
    }
    return NextResponse.json(
      {
        connected: true,
        error: "WHOOP 资料暂时无法读取。",
        profile: stored?.displayName
          ? { firstName: stored.displayName, lastName: "", email: stored.memberEmail }
          : null,
        connectedAt: stored?.connectedAt ?? null,
      },
      { status: 502, headers },
    );
  }
}
