import { createToolEvidence, type SafeToolObservation } from "./bailian-evidence";

type AgentEvent = {
  id?: string;
  type?: string;
  role?: string;
  status?: string;
  is_error?: boolean;
  metadata?: Record<string, unknown>;
  content?: Array<{ type?: string; text?: string; data?: Record<string, unknown> }>;
  error?: { code?: unknown };
};

export class AgentStreamError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "AgentStreamError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeErrorCode(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,64}$/.test(value) ? value : null;
}

export type SafeAgentEvent = {
  type: string;
  role: string | null;
  status: string | null;
  eventId: string | null;
  callId: string | null;
  toolName: string | null;
  isError: boolean | null;
  sessionStatus: string | null;
  stopReason: string | null;
  dataShape: Record<string, string>;
  outputShape: Record<string, string> | null;
} & Partial<SafeToolObservation>;

function safeId(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null;
}

function shape(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).slice(0, 24)
    .filter(([key]) => /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key))
    .map(([key, item]) => [key, Array.isArray(item) ? "array" : item === null ? "null" : typeof item]));
}

function safeEvent(event: AgentEvent): SafeAgentEvent {
  const data = event.content?.find((block) => block.type === "data")?.data;
  let output: unknown = data?.output;
  if (typeof output === "string" && output.length <= 128_000) {
    try { output = JSON.parse(output); } catch { /* Keep non-JSON output opaque. */ }
  }
  const reason = isRecord(data?.stop_reason) ? data.stop_reason.type : null;
  return {
    type: ["message", "tool_call", "tool_call_output", "mcp_call", "mcp_call_output", "session_status", "error", "tool_approval_request"].includes(event.type ?? "") ? event.type! : "other",
    role: ["assistant", "user", "tool"].includes(event.role ?? "") ? event.role! : null,
    status: event.status === "completed" ? "completed" : null,
    eventId: safeId(event.id),
    callId: safeId(data?.call_id ?? event.metadata?.call_id),
    toolName: ["bash", "web_search", "web_fetch", "read", "write", "edit", "glob", "grep", "mark_artifacts"].includes(String(data?.name)) ? String(data?.name) : null,
    isError: typeof event.is_error === "boolean" ? event.is_error : null,
    sessionStatus: ["running", "idle", "terminated"].includes(String(data?.session_status)) ? String(data?.session_status) : null,
    stopReason: ["end_turn", "requires_action", "retries_exhausted"].includes(String(reason)) ? String(reason) : null,
    dataShape: shape(data),
    outputShape: isRecord(output) ? shape(output) : null,
  };
}

export async function consumeAgentResponse(
  response: Response,
  controller: AbortController,
  observe?: (event: SafeAgentEvent) => void,
  evidence?: ReturnType<typeof createToolEvidence>,
) {
  if (!response.body) throw new AgentStreamError("STREAM_BODY_MISSING");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const seenMessages = new Set<string>();
  let buffer = "";
  let finalAssistantText = "";
  let completed = false;

  const handleFrame = (frame: string) => {
    const data = frame.split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart()).join("\n");
    if (!data) return;
    let event: AgentEvent;
    try {
      const parsed: unknown = JSON.parse(data);
      if (!isRecord(parsed)) throw new Error("Invalid event");
      event = parsed as AgentEvent;
    } catch {
      throw new AgentStreamError("INVALID_AGENT_EVENT");
    }
    const toolObservation = evidence?.accept(event);
    observe?.({ ...safeEvent(event), ...toolObservation });
    if (toolObservation?.failureCode) throw new AgentStreamError(toolObservation.failureCode);
    if (event.type === "error") {
      throw new AgentStreamError(safeErrorCode(event.error?.code) ?? "AGENT_REPORTED_ERROR");
    }
    // The API delivers complete Messages by default. Delta frames are not added
    // to the final Message, which would duplicate the same output if enabled.
    if (event.type === "message" && event.role === "assistant" && event.status === "completed") {
      if (!event.id) throw new AgentStreamError("INVALID_AGENT_EVENT");
      if (seenMessages.has(event.id)) return;
      seenMessages.add(event.id);
      const text = (event.content ?? [])
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text).join("");
      // Tool preambles and intermediate answers are separate messages; only
      // the final completed assistant message is the structured response.
      finalAssistantText = text;
    }
    if (event.type === "session_status") {
      const statusData = event.content?.find((block) => block.type === "data")?.data;
      if (statusData?.session_status === "terminated") throw new AgentStreamError("SESSION_TERMINATED");
      if (statusData?.session_status === "idle") {
        const stopReason = isRecord(statusData.stop_reason) ? statusData.stop_reason : null;
        if (stopReason?.type === "requires_action") throw new AgentStreamError("AGENT_REQUIRES_ACTION");
        if (stopReason?.type === "retries_exhausted") throw new AgentStreamError("AGENT_RETRIES_EXHAUSTED");
        // An initial idle snapshot is not completion of the submitted turn.
        if (stopReason?.type === "end_turn") completed = true;
      }
    }
  };

  try {
    while (!completed) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        handleFrame(frame);
        if (completed) break;
      }
      if (done) {
        if (!completed && buffer.trim()) handleFrame(buffer);
        break;
      }
    }
  } finally {
    controller.abort();
    await reader.cancel().catch(() => undefined);
  }
  if (!completed || !finalAssistantText.trim()) throw new AgentStreamError("INCOMPLETE_AGENT_RESPONSE");
  return finalAssistantText;
}

export function parseJsonText(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
  const parsed: unknown = JSON.parse(fenced ? fenced[1] : trimmed);
  if (!isRecord(parsed)) throw new Error("Agent returned invalid structured data.");
  return parsed;
}

export function safeHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

type FixedScheduleItem = { time: string; name: string; fixed: boolean; date?: string };

export function parsePlan(text: string, fixedItems: FixedScheduleItem[]) {
  const parsed = parseJsonText(text);
  const source = isRecord(parsed.plan) ? parsed.plan : parsed;
  const headline = typeof source.headline === "string" ? source.headline.slice(0, 120) : "个性化旅程建议";
  const summary = typeof source.summary === "string" ? source.summary.slice(0, 700) : null;
  const reason = typeof source.reason === "string" ? source.reason.slice(0, 700) : null;
  if (!Array.isArray(source.adjustments) || source.adjustments.some((item) => typeof item !== "string")) {
    throw new Error("Travel Agent returned invalid adjustments.");
  }
  const adjustments = source.adjustments.slice(0, 8).map((item: string) => item.slice(0, 260));
  const places = Array.isArray(source.places) ? source.places.filter(isRecord).slice(0, 8).map((place) => {
    const sourceUrl = safeHttpsUrl(place.url);
    if (!sourceUrl || typeof place.name !== "string" || typeof place.category !== "string" || typeof place.reason !== "string") return null;
    return { name: place.name.slice(0, 160), category: place.category.slice(0, 80), reason: place.reason.slice(0, 400), source: typeof place.source === "string" ? place.source.slice(0, 160) : "FlyAI / Fliggy", url: sourceUrl };
  }).filter((item): item is NonNullable<typeof item> => item !== null) : [];
  const itinerary = Array.isArray(source.itinerary) ? source.itinerary.filter(isRecord).slice(0, 100).map((item) => {
    if (typeof item.time !== "string" || !/^\d{2}:\d{2}$/.test(item.time) || typeof item.name !== "string" || typeof item.detail !== "string" || typeof item.fixed !== "boolean") return null;
    const [hour, minute] = item.time.split(":").map(Number);
    if (hour > 23 || minute > 59) return null;
    if (item.date !== undefined && (typeof item.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(item.date) || new Date(`${item.date}T00:00:00Z`).toISOString().slice(0, 10) !== item.date)) return null;
    return { time: item.time, name: item.name.slice(0, 160), detail: item.detail.slice(0, 500), fixed: item.fixed, ...(typeof item.date === "string" ? { date: item.date } : {}) };
  }).filter((item): item is NonNullable<typeof item> => item !== null) : [];

  if (!summary?.trim() || !reason?.trim() || !itinerary.length) throw new Error("Travel Agent returned an incomplete itinerary.");
  for (const fixed of fixedItems) {
    if (!itinerary.some((item) => item.fixed && item.time === fixed.time && item.name === fixed.name && (!fixed.date || item.date === fixed.date))) {
      throw new Error("Travel Agent did not preserve a fixed schedule item.");
    }
  }
  return { headline, summary, reason, adjustments, itinerary, places };
}
