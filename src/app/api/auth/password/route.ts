import { NextResponse } from "next/server";
import { AuthRateLimitError, checkAuthRateLimit, getCurrentAccount, isSameOrigin, normalizeEmail, passwordValidationError, safeAuthNext, setInitialPassword, setPasswordWithCode, setSessionCookie } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "请求来源无效。" }, { status: 403 });
  const payload = await request.json().catch(() => null) as { email?: unknown; code?: unknown; password?: unknown; next?: unknown } | null;
  const email = normalizeEmail(payload?.email);
  const code = typeof payload?.code === "string" ? payload.code.trim() : "";
  if (!email || (code && !/^\d{6}$/.test(code))) return NextResponse.json({ error: "请检查邮箱和 6 位验证码。" }, { status: 400 });
  const passwordError = passwordValidationError(payload?.password);
  if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 });
  try {
    await checkAuthRateLimit(request, email, "verify");
    const account = !code ? await getCurrentAccount() : null;
    if (!code && (!account || account.email !== email || account.has_password)) {
      return NextResponse.json({ error: "请先验证邮箱，再设置登录密码。" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    }
    const session = account
      ? await setInitialPassword(account, payload!.password as string)
      : await setPasswordWithCode(email, code, payload!.password as string);
    if (!session) return NextResponse.json({ error: "验证码无效或已过期，请重新发送设置密码验证码。" }, {
      status: 401, headers: { "Cache-Control": "no-store" },
    });
    const response = NextResponse.json({ signedIn: true, passwordSet: true, next: safeAuthNext(payload?.next), account: session.account }, {
      headers: { "Cache-Control": "no-store" },
    });
    setSessionCookie(response, session.token, session.expiresAt);
    return response;
  } catch (error) {
    if (error instanceof AuthRateLimitError) return NextResponse.json({ error: error.message, retryAfter: error.retryAfter }, {
      status: 429, headers: { "Retry-After": String(error.retryAfter), "Cache-Control": "no-store" },
    });
    return NextResponse.json({ error: "暂时无法保存密码，请稍后重试。" }, { status: 503 });
  }
}
