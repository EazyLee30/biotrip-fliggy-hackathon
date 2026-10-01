import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const account = await getCurrentAccount();
    return NextResponse.json({ signedIn: Boolean(account), account }, {
      headers: { "Cache-Control": "no-store, private" },
    });
  } catch {
    return NextResponse.json({ signedIn: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
