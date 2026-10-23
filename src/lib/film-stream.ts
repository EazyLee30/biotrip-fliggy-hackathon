type ByteRange = { start: number; end: number };

function byteRange(value: string | null, size: number): ByteRange | "unsatisfiable" | null {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  // Multiple ranges may be ignored; this endpoint deliberately serves one range.
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0 || !size) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return "unsatisfiable";
  return { start, end: Math.min(end, size - 1) };
}

/** Discard preceding bytes at the edge, then stream only the requested interval to the viewer. */
function sliceStream(body: ReadableStream<Uint8Array>, range: ByteRange) {
  const reader = body.getReader();
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) { controller.error(new Error("Film asset ended before the requested range.")); return; }
          const previous = offset;
          offset += value.byteLength;
          if (offset <= range.start) continue;
          const start = Math.max(0, range.start - previous);
          const end = Math.min(value.byteLength, range.end + 1 - previous);
          if (end > start) controller.enqueue(value.subarray(start, end));
          if (offset > range.end) {
            controller.close();
            await reader.cancel().catch(() => undefined);
          }
          return;
        }
      } catch (error) { controller.error(error); }
    },
    cancel(reason) { return reader.cancel(reason); },
  });
}

export async function filmResponse(request: Request, asset: Response, expectedSize?: number): Promise<Response> {
  if (!asset.ok) { await asset.body?.cancel(); return new Response("Film temporarily unavailable", { status: 503 }); }
  // The production ASSETS binding can omit Content-Length; the versioned release records it.
  const size = asset.headers.has("content-length") ? Number(asset.headers.get("content-length")) : expectedSize;
  if (size === undefined || !Number.isSafeInteger(size) || size <= 0 || (expectedSize !== undefined && size !== expectedSize)) { await asset.body?.cancel(); return new Response("Film metadata unavailable", { status: 503 }); }
  const headers = new Headers({ "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" });
  const etag = asset.headers.get("etag");
  if (etag) headers.set("ETag", etag);
  const ifRange = request.headers.get("if-range");
  const range = !ifRange || ifRange === etag ? byteRange(request.headers.get("range"), size) : null;
  if (range === "unsatisfiable") {
    await asset.body?.cancel();
    headers.set("Content-Range", `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }
  headers.set("Content-Length", String(range ? range.end - range.start + 1 : size));
  if (range) headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
  if (request.method === "HEAD") {
    await asset.body?.cancel();
    return new Response(null, { status: range ? 206 : 200, headers });
  }
  return new Response(range && asset.body ? sliceStream(asset.body, range) : asset.body, { status: range ? 206 : 200, headers });
}
