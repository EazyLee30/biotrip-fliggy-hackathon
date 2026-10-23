import { env, waitUntil } from "cloudflare:workers";
import { filmResponse } from "@/lib/film-stream";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // A fixed public asset: no user-supplied upstream URL or account data is involved.
  const asset = await env.ASSETS.fetch(new Request(new URL("/film/biotrip-v3.mp4", request.url), {
    method: request.method === "HEAD" ? "HEAD" : "GET",
    headers: { "Accept-Encoding": "identity" },
  }));
  // Byte size of the immutable v3 web encode, verified against the delivered asset.
  const response = await filmResponse(request, asset, 13_948_597);
  if (response.status !== 206 || !response.body) return response;
  // Workers uses a fixed-length body to preserve Content-Length for media clients.
  const { readable, writable } = new FixedLengthStream(Number(response.headers.get("content-length")));
  waitUntil(response.body.pipeTo(writable).catch(() => undefined));
  return new Response(readable, { status: response.status, headers: response.headers });
}

export const HEAD = GET;
