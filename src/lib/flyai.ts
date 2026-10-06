import { createHash, createHmac, randomBytes } from "node:crypto";
import { readBoundedUpstream } from "./upstream-response";
import { extractFlyaiSources } from "./planning/flyai-sources";

const ENDPOINT = "https://flyai.open.fliggy.com/mcp";
export const FLYAI_READ_TOOLS = new Set([
  "fliggy_fast_search", "fliggy_ai_search", "search_flight", "search_domestic_train",
  "search_hotels", "search_poi", "search_marriott_packages", "search_marriott_hotels",
]);

// Protocol from official @fly-ai/flyai-cli@1.0.16. Signing must happen after
// the Vault has replaced its placeholder with the actual Authorization value.
export function flyaiSignedHeaders(body: string, apiKey: string, signingSecret: string) {
  const authorization = `Bearer ${apiKey.trim()}`;
  const timestamp = Date.now().toString();
  const nonce = randomBytes(16).toString("hex");
  const hash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
  const canonical = ["POST", "/mcp", timestamp, nonce, hash(body), hash(authorization)].join("\n");
  const signature = createHmac("sha256", signingSecret.trim()).update(canonical, "utf8").digest("base64url");
  return new Headers({
    Authorization: authorization,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "x-flyai-sign-ver": "7",
    "x-flyai-sign-alg": "hmac-sha256",
    "x-flyai-ts": timestamp,
    "x-flyai-nonce": nonce,
    "x-flyai-sign": signature,
  });
}

export async function forwardFlyaiSearch(body: string, request: Request, apiKey: string, signingSecret: string) {
  const headers = flyaiSignedHeaders(body, apiKey, signingSecret);
  // Preserve the official CLI's encrypted client context and identifier.
  // They are not part of Authorization and must not be regenerated per search.
  for (const name of ["x-ff-ctx", "x-ttid", "user-agent"]) {
    const value = request.headers.get(name);
    if (value && value.length <= 8192) headers.set(name, value);
  }
  const upstream = await fetch(ENDPOINT, {
    method: "POST", headers, body,
    signal: AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]),
    cache: "no-store", redirect: "manual",
  });
  if (upstream.status >= 300 && upstream.status < 400) {
    await upstream.body?.cancel();
    throw new Error("FlyAI search endpoint returned an unexpected redirect");
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export type FlyaiSource = { name: string; url: string; category: string; price: string | null; imageUrl?: string; address?: string };
export class FlyaiSearchError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
    this.name = "FlyaiSearchError";
  }
}
function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// Same read-only JSON-RPC request as the official CLI, signed with the real
// server credential. No Vault placeholder, shell, login or model retry loop.
export async function searchFlyai(tool: string, args: Record<string, unknown>, signal: AbortSignal, category: string) {
  const key = process.env.FLYAI_API_KEY;
  const secret = process.env.FLYAI_SIGN_SECRET;
  if (!key || !secret) throw new FlyaiSearchError(503, "FLYAI_NOT_CONFIGURED");
  if (!FLYAI_READ_TOOLS.has(tool)) throw new FlyaiSearchError(400, "FLYAI_READ_ONLY");
  const result = await flyaiRpc("tools/call", { name: tool, arguments: args }, signal, category);
  const content = result.content;
  const first = Array.isArray(content) ? content.find((part) => record(part) && part.type === "text" && typeof part.text === "string") : null;
  let payload: unknown;
  try { payload = record(first) ? JSON.parse(String(first.text)) : null; } catch { payload = null; }
  if (!record(payload) || payload.status !== 0 || payload.message !== "success" || !record(payload.data)) {
    // Keep the reason, never the content: an unexplained provider rejection is
    // the difference between a quota problem and a wrong argument shape.
    console.info("[BioTrip flyai output rejected]", {
      tool,
      category,
      status: record(payload) ? String(payload.status) : typeof payload,
      message: record(payload) && typeof payload.message === "string" ? payload.message.slice(0, 120) : "unparsed",
      systemMessage: record(payload) && typeof payload.systemMessage === "string" ? payload.systemMessage.slice(0, 120) : "",
      dataKeys: record(payload) && record(payload.data) ? Object.keys(payload.data).slice(0, 8) : [],
    });
    throw new FlyaiSearchError(502, "FLYAI_OUTPUT_UNVERIFIED");
  }
  return { sources: extractFlyaiSources(payload.data, category, 20), verified: true as const };
}

/** Signed discovery uses the provider’s actual schema, never guessed arguments. */
export async function listFlyaiTools(signal: AbortSignal) {
  const found: Record<string, unknown>[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 4; page++) {
    const result = await flyaiRpc("tools/list", cursor ? { cursor } : undefined, signal, "公开景点目录");
    if (!Array.isArray(result.tools)) throw new FlyaiSearchError(502, "INVALID_FLYAI_TOOL_SCHEMA");
    found.push(...result.tools.filter(record));
    if (found.some(tool => tool.name === "search_poi")) return found;
    cursor = typeof result.nextCursor === "string" ? result.nextCursor : undefined;
    if (!cursor) break;
  }
  return found;
}

async function flyaiRpc(method: string, params: Record<string, unknown> | undefined, signal: AbortSignal, category: string) {
  const key = process.env.FLYAI_API_KEY;
  const secret = process.env.FLYAI_SIGN_SECRET;
  if (!key || !secret) throw new FlyaiSearchError(503, "FLYAI_NOT_CONFIGURED");
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) });
  const headers = flyaiSignedHeaders(body, key, secret);
  headers.set("User-Agent", "BioTrip/1.0");
  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST", headers, body, cache: "no-store",
      // A redirect would break the signature, so surface it explicitly instead
      // of letting the fetch layer throw an opaque connection error.
      redirect: "manual",
      signal: AbortSignal.any([signal, AbortSignal.timeout(25_000)]),
    });
  } catch (error) {
    signal.throwIfAborted();
    const timedOut = error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
    const cause = error instanceof Error ? (error.cause as { code?: string; name?: string } | undefined) : undefined;
    // Keep the transport reason: DNS, TLS and reset are different fixes.
    console.info("[BioTrip flyai transport failure]", {
      tool: method,
      category,
      name: error instanceof Error ? error.name : typeof error,
      cause: cause?.code ?? cause?.name ?? "",
    });
    throw new FlyaiSearchError(504, timedOut ? "FLYAI_TIMEOUT" : "FLYAI_CONNECTION_ERROR");
  }
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new FlyaiSearchError(502, "FLYAI_UNEXPECTED_REDIRECT");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new FlyaiSearchError(response.status, [401, 403].includes(response.status) ? "FLYAI_AUTH_ERROR" : "FLYAI_HTTP_ERROR");
  }
  let text: string;
  try { text = await readBoundedUpstream(response, 2_000_000); }
  catch (error) {
    signal.throwIfAborted();
    throw new FlyaiSearchError(error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name) ? 504 : 502,
      error instanceof Error && error.message === "UPSTREAM_RESPONSE_TOO_LARGE" ? "FLYAI_RESPONSE_TOO_LARGE" : "FLYAI_RESPONSE_INTERRUPTED");
  }
  let envelope: unknown;
  try {
    if (response.headers.get("Content-Type")?.includes("text/event-stream")) {
      for (const line of text.split(/\r?\n/).filter((line) => line.startsWith("data:"))) {
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        const item: unknown = JSON.parse(data);
        if (record(item) && (item.result || item.error)) envelope = item;
      }
    } else envelope = JSON.parse(text);
  } catch { throw new FlyaiSearchError(502, "INVALID_FLYAI_RESPONSE"); }
  if (!record(envelope) || envelope.error || !record(envelope.result) || envelope.result.isError === true) {
    throw new FlyaiSearchError(502, "FLYAI_API_ERROR");
  }
  return envelope.result;
}
