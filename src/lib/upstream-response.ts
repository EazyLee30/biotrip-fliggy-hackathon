/** Read provider data with an actual byte limit before allocating/parsing it. */
export async function readBoundedUpstream(response: Response, maximumBytes: number) {
  if (!response.body) throw new Error("UPSTREAM_BODY_MISSING");
  const declared = Number(response.headers.get("Content-Length") || 0);
  if (Number.isFinite(declared) && declared > maximumBytes) {
    await response.body.cancel();
    throw new Error("UPSTREAM_RESPONSE_TOO_LARGE");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let length = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) throw new Error("UPSTREAM_RESPONSE_TOO_LARGE");
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
