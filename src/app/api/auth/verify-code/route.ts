import { NextResponse } from "next/server";
import { AuthRateLimitError, checkAuthRateLimit, isSameOrigin, normalizeEmail, safeAuthNext, setSessionCookie, verifyLoginCode } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "请求来源无效。" }, { status: 403 });
  const payload = await request.json().catch(() => null) as { email?: unknown; code?: unknown; next?: unknown } | null;
  const email = normalizeEmail(payload?.email);
  const code = typeof payload?.code === "string" ? payload.code.trim() : "";
  if (!email || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "请检查邮箱和 6 位验证码。" }, { status: 400 });
  }
  try {
    await checkAuthRateLimit(request, email, "verify");
    const session = await verifyLoginCode(email, code);
    if (!session) return NextResponse.json({ error: "验证码无效或已过期，请重试。" }, { status: 401 });
    const next = safeAuthNext(payload?.next);
    const destination = session.account.has_password ? next : `/login?mode=register&next=${encodeURIComponent(next)}`;
    const response = NextResponse.json({ signedIn: true, next: destination, account: session.account }, {
      headers: { "Cache-Control": "no-store" },
    });
    setSessionCookie(response, session.token, session.expiresAt);
    return response;
  } catch (error) {
    if (error instanceof AuthRateLimitError) return NextResponse.json({ error: error.message, retryAfter: error.retryAfter }, {
      status: 429, headers: { "Retry-After": String(error.retryAfter), "Cache-Control": "no-store" },
    });
    return NextResponse.json({ error: "暂时无法完成登录，请稍后重试。" }, { status: 503 });
  }
}
