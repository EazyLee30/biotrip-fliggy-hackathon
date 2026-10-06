export type PlanProgress = {
  stage: string;
  message?: string;
  status?: "running" | "ok" | "skipped" | "degraded";
  elapsedMs?: number;
};

// The planning agents can run for several minutes. Send response bytes while
// they work so browsers and intermediary proxies do not close an idle request.
export function planEventStream(
  generate: (progress: (event: PlanProgress) => void, recommendations: (event: PlanRecommendations) => void) => Promise<Response>,
  abort: () => void,
  signal: AbortSignal,
  heartbeatMs = 10_000,
) {
  const encoder = new TextEncoder();
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;

  const finish = () => {
    if (heartbeat) clearInterval(heartbeat);
    signal.removeEventListener("abort", disconnected);
    if (closed) return;
    closed = true;
    streamController?.close();
  };
  const disconnected = () => {
    abort();
    finish();
  };
  const send = (frame: string) => {
    if (closed) return;
    try {
      streamController?.enqueue(encoder.encode(frame));
    } catch {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      signal.removeEventListener("abort", disconnected);
      abort();
    }
  };
  const event = (name: string, payload: unknown) => {
    send(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`);
  };

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
      if (signal.aborted) {
        disconnected();
        return;
      }
      signal.addEventListener("abort", disconnected, { once: true });
      send(": connected\n\n");
      heartbeat = setInterval(() => send(": keepalive\n\n"), heartbeatMs);
      void (async () => {
        try {
          const response = await generate((progress) => event("progress", progress), (recommendations) => {
            if (signal.aborted || closed) return;
            const safe = decodePlanRecommendations(recommendations, recommendations.destination);
            if (safe?.items.length) event("recommendations", safe);
          });
          const payload: unknown = await response.json();
          event(response.ok ? "result" : "error", payload);
        } catch {
          event("error", { error: "实时规划服务未能完成，请稍后重试。" });
        } finally {
          finish();
        }
      })();
    },
    cancel() {
      // cancel() has already closed the readable side; do not close it again.
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      signal.removeEventListener("abort", disconnected);
      abort();
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, private, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
import { decodePlanRecommendations, type PlanRecommendations } from "./planning-recommendations";

export type { PlanRecommendation, PlanRecommendations } from "./planning-recommendations";
