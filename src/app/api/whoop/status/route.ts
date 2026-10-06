import { NextResponse } from "next/server";
import {
  getWhoopConnectionMeta,
  readWhoopTokens,
  whoopAppConfigured,
  WHOOP_SCOPES,
  whoopFailureDiagnostic,
} from "@/lib/whoop";
import { getCurrentAccount } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store, private" };

export async function GET() {
  const account = await getCurrentAccount().catch(() => null);
  if (!account) return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  // The grant lives in D1, so this reports the account-wide connection rather
  // than whether this particular browser still holds the cookie.
  let tokens;
  try { tokens = await readWhoopTokens(account.id); }
  catch (error) {
    return NextResponse.json({ configured: whoopAppConfigured(), error: "WHOOP 授权记录暂时无法读取。请稍后重试。",
      syncStatus: "failed", diagnostic: whoopFailureDiagnostic(error) }, { status: 503, headers });
  }
  const meta = tokens ? await getWhoopConnectionMeta(account.id) : null;
  return NextResponse.json(
    {
      configured: whoopAppConfigured(),
      connected: Boolean(tokens),
      scopes: tokens?.scope.split(/\s+/).filter(Boolean) ?? [],
      requestedScopes: WHOOP_SCOPES,
      mode: tokens ? "whoop" : "not_connected",
      connectedAt: meta?.connectedAt ?? null,
      memberName: meta?.displayName || null,
    },
    { headers },
  );
}
