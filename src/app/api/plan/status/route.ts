import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/lib/auth";
import { planningTransportAvailability } from "@/lib/planning/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reports whether a plan can be generated right now. Readiness follows the
 * same transport resolution the pipeline uses, so the interface can never
 * enable planning for a transport the pipeline would refuse.
 */
export async function GET() {
  const account = await getCurrentAccount().catch(() => null);
  if (!account) return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  const transport = planningTransportAvailability();
  const flyaiReady = Boolean(process.env.FLYAI_API_KEY && process.env.FLYAI_SIGN_SECRET);
  const managedReady = transport.managedAgent && transport.localInfoAgent && transport.insightAgent;
  const ready = flyaiReady && (managedReady || transport.modelApi);
  return NextResponse.json(
    { ready, transport, flyaiReady },
    { headers: { "Cache-Control": "no-store, private" } },
  );
}
