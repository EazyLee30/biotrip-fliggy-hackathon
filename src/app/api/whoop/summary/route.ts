import { NextResponse } from "next/server";
import { getRecentWhoopSummary, readWhoopTokens, WhoopReauthorizationRequiredError } from "@/lib/whoop";
import { getCurrentAccount } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store, private" };

export async function GET() {
  const account = await getCurrentAccount().catch(() => null);
  if (!account) return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  if (!(await readWhoopTokens(account.id))) {
    return NextResponse.json({ connected: false, summary: null }, { headers });
  }

  try {
    const summary = await getRecentWhoopSummary(account.id);
    return NextResponse.json({ connected: true, summary }, { headers });
  } catch (error) {
    // The stored grant is gone or was revoked in WHOOP. Ask for one new
    // authorisation instead of failing every future request.
    if (error instanceof WhoopReauthorizationRequiredError) {
      return NextResponse.json(
        { connected: false, reauthorizationRequired: true, error: error.message, summary: null },
        { status: 409, headers },
      );
    }
    return NextResponse.json(
      { connected: true, error: "WHOOP 数据暂时读取失败。请稍后重试。" },
      { status: 502, headers },
    );
  }
}
