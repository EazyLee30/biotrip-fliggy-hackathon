import { chat } from "@/lib/agent/chat";
import {
  journeyAccount,
  journeyFailure,
  readJourneyJson,
} from "@/lib/journey-http";
import { JourneyError } from "@/lib/journeys";
export async function POST(request: Request) {
  try {
    const account = await journeyAccount(request, true),
      raw = await readJourneyJson(request, 16000);
    const encoder = new TextEncoder();
    const cancellation = new AbortController();
    const signal = AbortSignal.any([request.signal, cancellation.signal]);
    const stream = new ReadableStream({
      async start(controller) {
        let closed = false;
        const send = (event: string, data: unknown) => {
          if (!closed)
            try {
              controller.enqueue(
                encoder.encode(
                  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
                ),
              );
            } catch {
              closed = true;
            }
        };
        let progress = "正在理解你的安排…";
        send("status", { message: progress });
        const heartbeat = setInterval(
          () => send("heartbeat", { message: progress }),
          12000,
        );
        try {
          const message = await chat(account.id, raw, signal, (text) => send("text", { text }), (message) => { progress = message; send("status", { message }); });
          send("done", { message });
        } catch (e) {
          send("error", {
            error:
              e instanceof JourneyError
                ? e.message
                : "助手暂时不可用，请重试。",
          });
        } finally {
          clearInterval(heartbeat);
          if (!closed) controller.close();
        }
      },
      cancel() { cancellation.abort(); },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return journeyFailure(e);
  }
}
