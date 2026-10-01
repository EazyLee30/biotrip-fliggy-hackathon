import { NextResponse } from "next/server";
import { getCurrentAccount, getDatabase, isSameOrigin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[A-Za-z0-9_-]{12}$/.test(id)) return NextResponse.json({ error: "分享页面不存在或已过期。" }, { status: 404 });
  try {
    const record = await getDatabase().prepare("SELECT payload, expires_at FROM trip_shares WHERE id = ? AND expires_at > unixepoch()")
      .bind(id).first<{ payload: string; expires_at: number }>();
    if (!record) return NextResponse.json({ error: "分享页面不存在或已过期。" }, { status: 404 });
    const payload = JSON.parse(record.payload) as unknown;
    return NextResponse.json({ share: payload, expiresAt: record.expires_at }, {
      headers: { "Cache-Control": "no-store, private" },
    });
  } catch {
    return NextResponse.json({ error: "分享页面暂时无法打开。" }, { status: 503 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "请求来源无效。" }, { status: 403 });
  const account = await getCurrentAccount().catch(() => null);
  if (!account) return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  const { id } = await context.params;
  if (!/^[A-Za-z0-9_-]{12}$/.test(id)) return NextResponse.json({ error: "分享页面不存在。" }, { status: 404 });
  try {
    const result = await getDatabase().prepare("DELETE FROM trip_shares WHERE id = ? AND account_id = ?")
      .bind(id, account.id).run();
    return result.meta.changes === 1
      ? NextResponse.json({ revoked: true })
      : NextResponse.json({ error: "分享页面不存在。" }, { status: 404 });
  } catch {
    return NextResponse.json({ error: "暂时无法撤回分享链接。" }, { status: 503 });
  }
}
