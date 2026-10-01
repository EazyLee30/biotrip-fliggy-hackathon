import { NextResponse } from "next/server";
import { AuthRateLimitError, checkAuthRateLimit, isSameOrigin, normalizeEmail, safeAuthNext, setSessionCookie, signInWithPassword } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "请求来源无效。" }, { status: 403 });
  const payload = await request.json().catch(() => null) as { email?: unknown; password?: unknown; next?: unknown } | null;
  const email = normalizeEmail(payload?.email);
  if (!email || typeof payload?.password !== "string" || !payload.password || payload.password.length > 128) {
    return NextResponse.json({ error: "请检查邮箱和密码。" }, { status: 400 });
  }
  try {
    await checkAuthRateLimit(request, email, "password");
    const session = await signInWithPassword(email, payload.password);
    if (!session) return NextResponse.json({ error: "邮箱或密码不正确。尚未设置密码时，请使用验证码登录或设置密码。" }, {
      status: 401, headers: { "Cache-Control": "no-store" },
    });
    const response = NextResponse.json({ signedIn: true, next: safeAuthNext(payload.next), account: session.account }, {
      headers: { "Cache-Control": "no-store" },
    });
    setSessionCookie(response, session.token, session.expiresAt);
    return response;
  } catch (error) {
    if (error instanceof AuthRateLimitError) return NextResponse.json({ error: error.message, retryAfter: error.retryAfter }, {
      status: 429, headers: { "Retry-After": String(error.retryAfter), "Cache-Control": "no-store" },
    });
    return NextResponse.json({ error: "暂时无法登录，请稍后重试。" }, { status: 503 });
  }
}
