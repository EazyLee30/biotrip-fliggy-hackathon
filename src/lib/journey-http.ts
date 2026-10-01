import { NextResponse } from "next/server";
import { getCurrentAccount, isSameOrigin } from "@/lib/auth";
import { JourneyError } from "@/lib/journeys";

export function journeyResponse(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store, private" } });
}
export function journeyFailure(error: unknown) {
  return error instanceof JourneyError
    ? journeyResponse({ error: error.message, code: error.code }, error.status)
    : journeyResponse({ error: "旅程服务暂时不可用，请稍后重试。", code: "JOURNEY_STORAGE_UNAVAILABLE" }, 503);
}
export async function journeyAccount(request: Request, mutation = false) {
  // Browser fetches on the same origin omit Origin for GET. Refuse cross-origin
  // origins and cross-site browser requests, and require Origin for all writes.
  const origin = request.headers.get("origin");
  if ((mutation && !isSameOrigin(request)) ||
      (origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new JourneyError(403, "INVALID_ORIGIN", "请求来源无效。");
  }
  const account = await getCurrentAccount();
  if (!account) throw new JourneyError(401, "LOGIN_REQUIRED", "请先登录。");
  return account;
}

/** Bound the streamed body before parsing, including requests without Content-Length. */
export async function readJourneyJson(request: Request, maximumBytes = 24_000): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new JourneyError(415, "JSON_REQUIRED", "请使用 JSON 提交旅程内容。");
  }
  const declaredSize = Number(request.headers.get("content-length") ?? 0);
  if (!Number.isFinite(declaredSize) || declaredSize > maximumBytes) {
    throw new JourneyError(413, "REQUEST_TOO_LARGE", "旅程内容过长，请精简后重试。");
  }
  if (!request.body) throw new JourneyError(400, "INVALID_JSON", "旅程内容无效。");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let length = 0;
  let body = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new JourneyError(413, "REQUEST_TOO_LARGE", "旅程内容过长，请精简后重试。");
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return JSON.parse(body) as unknown;
  } catch (error) {
    if (error instanceof JourneyError) throw error;
    throw new JourneyError(400, "INVALID_JSON", "旅程内容无效。");
  } finally {
    reader.releaseLock();
  }
}
