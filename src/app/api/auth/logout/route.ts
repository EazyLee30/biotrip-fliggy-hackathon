import { NextResponse } from "next/server";
import { clearSessionCookie, getCurrentAccount, isSameOrigin, revokeCurrentSession } from "@/lib/auth";
import { clearWhoopTokens } from "@/lib/whoop";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "请求来源无效。" }, { status: 403 });
  const account = await getCurrentAccount().catch(() => null);
  await revokeCurrentSession().catch(() => undefined);
  if (account) await clearWhoopTokens(account.id).catch(() => undefined);
  const response = NextResponse.json({ signedOut: true });
  clearSessionCookie(response);
  return response;
}
