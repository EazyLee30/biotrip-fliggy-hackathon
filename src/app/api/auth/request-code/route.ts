import { NextResponse } from "next/server";
import { AuthRateLimitError, checkAuthRateLimit, isSameOrigin, normalizeEmail, sendLoginCode } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "请求来源无效。" }, { status: 403 });
  const payload = await request.json().catch(() => null) as { email?: unknown; purpose?: unknown } | null;
  const email = normalizeEmail(payload?.email);
  if (!email) return NextResponse.json({ error: "请输入有效的邮箱地址。" }, { status: 400 });
  try {
    await checkAuthRateLimit(request, email, "send");
    const result = await sendLoginCode(email, payload?.purpose === "password" ? "password" : "login");
    return NextResponse.json({ sent: true, retryAfter: result.retryAfter, message: "如果该邮箱可以接收邮件，验证码已发送。" }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof AuthRateLimitError) return NextResponse.json({ error: error.message, retryAfter: error.retryAfter }, {
      status: 429, headers: { "Retry-After": String(error.retryAfter), "Cache-Control": "no-store" },
    });
    return NextResponse.json({ error: "暂时无法发送验证邮件，请稍后重试。" }, { status: 503 });
  }
}
