import { NextResponse } from "next/server";
import {
  getWhoopConnectionMeta,
  readWhoopTokens,
  whoopAppConfigured,
  WHOOP_SCOPES,
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
  const tokens = await readWhoopTokens(account.id).catch(() => null);
  const meta = tokens ? await getWhoopConnectionMeta(account.id) : null;
  return NextResponse.json(
    {
      configured: whoopAppConfigured(),
      connected: Boolean(tokens),
      scopes: WHOOP_SCOPES,
      mode: tokens ? "whoop" : "not_connected",
      connectedAt: meta?.connectedAt ?? null,
      memberName: meta?.displayName || null,
    },
    { headers },
  );
}
