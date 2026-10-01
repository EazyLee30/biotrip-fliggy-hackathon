import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/lib/auth";
import { planningTransportAvailability } from "@/lib/planning/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reports only whether a plan can be generated right now.
 *
 * Transport readiness follows the same resolution the pipeline uses, so the
 * interface never enables planning for a transport the pipeline would refuse.
 * Which agents or credentials exist is deliberately not exposed: it is
 * operational detail, not something an account holder needs, and the
 * token-protected diagnostic endpoint covers operators.
 */
export async function GET() {
  const account = await getCurrentAccount().catch(() => null);
  if (!account) return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  const transport = planningTransportAvailability();
  const ready = Boolean(
    process.env.FLYAI_API_KEY && process.env.FLYAI_SIGN_SECRET &&
    ((transport.managedAgent && transport.localInfoAgent && transport.insightAgent) || transport.modelApi),
  );
  return NextResponse.json({ ready }, { headers: { "Cache-Control": "no-store, private" } });
}