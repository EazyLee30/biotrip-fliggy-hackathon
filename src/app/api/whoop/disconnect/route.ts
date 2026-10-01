import { NextResponse } from "next/server";
import { getCurrentAccount, isSameOrigin } from "@/lib/auth";
import {
  clearWhoopTokens,
  getValidWhoopAccessToken,
} from "@/lib/whoop";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  }
  const account = await getCurrentAccount().catch(() => null);
  if (!account) return NextResponse.json({ error: "请先登录。" }, { status: 401 });

  let revoked = false;
  try {
    const accessToken = await getValidWhoopAccessToken(account.id);
    if (accessToken) {
      const response = await fetch("https://api.prod.whoop.com/developer/v2/user/access", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      revoked = response.ok;
    }
  } catch {
    // Local access is removed even if WHOOP's revocation endpoint is unavailable.
  }

  await clearWhoopTokens(account.id);
  return NextResponse.json(
    { disconnected: true, revoked },
    { headers: { "Cache-Control": "no-store, private" } },
  );
}
