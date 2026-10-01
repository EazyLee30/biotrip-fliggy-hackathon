import { timingSafeEqual } from "node:crypto";
import { FLYAI_READ_TOOLS, forwardFlyaiSearch } from "@/lib/flyai";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const expected = process.env.FLYAI_API_KEY;
  const signingSecret = process.env.FLYAI_SIGN_SECRET;
  const actual = request.headers.get("Authorization")?.replace(/^Bearer /, "") ?? "";
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected ?? "");
  if (!expected || !signingSecret || actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) {
    return new Response(null, { status: 404 });
  }
  // This credentialed bridge only accepts the eight official read-only tools.
  // Neither a destination URL nor booking actions can be supplied by callers.
  const body = await request.text();
  if (body.length > 16_384) return new Response(null, { status: 413 });
  let value: unknown;
  try { value = JSON.parse(body); } catch { return new Response(null, { status: 400 }); }
  if (!value || typeof value !== "object" || !("method" in value) || value.method !== "tools/call" || !("params" in value)) {
    return new Response(null, { status: 400 });
  }
  const params = value.params;
  if (!params || typeof params !== "object" || !("name" in params) || typeof params.name !== "string" || !FLYAI_READ_TOOLS.has(params.name)) {
    return new Response(null, { status: 400 });
  }
  try {
    return await forwardFlyaiSearch(body, request, expected, signingSecret);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[BioTrip FlyAI bridge failure]", {
      name: error instanceof Error ? error.name : "Unknown",
      message: message.replaceAll(expected, "[redacted]").replaceAll(signingSecret, "[redacted]").replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 240),
    });
    return Response.json({ jsonrpc: "2.0", error: { code: -32000, message: "FlyAI search temporarily unavailable" } }, { status: 502 });
  }
}
