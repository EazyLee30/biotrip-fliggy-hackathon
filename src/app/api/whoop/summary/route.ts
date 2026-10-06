import { NextResponse } from "next/server";
import { getRecentWhoopSummary, readWhoopTokens, whoopFailureDiagnostic, WhoopReauthorizationRequiredError, WhoopSyncError } from "@/lib/whoop";
import { getCurrentAccount } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store, private" };

export async function GET(request: Request) {
  const account = await getCurrentAccount().catch(() => null);
  if (!account) return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  try {
    if (!(await readWhoopTokens(account.id))) {
      return NextResponse.json({ connected: false, summary: null, retrievedAt: null, syncStatus: "not_connected", failedMetrics: [] }, { headers });
    }
    const snapshot = await getRecentWhoopSummary(account.id, { signal: request.signal });
    return NextResponse.json({ connected: true, ...snapshot }, { headers });
  } catch (error) {
    // The stored grant is gone or was revoked in WHOOP. Ask for one new
    // authorisation instead of failing every future request.
    if (error instanceof WhoopReauthorizationRequiredError) {
      return NextResponse.json(
        { connected: false, reauthorizationRequired: true, error: "WHOOP 授权已失效，请重新连接一次。", summary: null,
          retrievedAt: null, syncStatus: "reauthorization_required", failedMetrics: [] },
        { status: 409, headers },
      );
    }
    const diagnostic = whoopFailureDiagnostic(error);
    if (diagnostic.code === "WHOOP_NOT_CONNECTED") {
      return NextResponse.json({ connected: false, summary: null, retrievedAt: null, syncStatus: "not_connected", failedMetrics: [] }, { headers });
    }
    const failures = error instanceof WhoopSyncError ? error.failures : [];
    console.info("[BioTrip WHOOP summary failure]", { diagnostic, failures });
    const message = failures.some((failure) => failure.status === 403)
      ? "WHOOP 拒绝了本次数据请求，请确认所需的数据权限已授权。"
      : failures.some((failure) => failure.status === 429)
        ? "WHOOP 本次请求达到频率限制，请稍后同步。"
        : "WHOOP 数据暂时读取失败。授权记录已保留，请稍后重试。";
    return NextResponse.json({ connected: true, error: message, summary: null, retrievedAt: null,
      syncStatus: "failed", failedMetrics: failures.map(({ metric }) => metric), diagnostic },
    { status: diagnostic.status === 503 ? 503 : 502, headers });
  }
}
