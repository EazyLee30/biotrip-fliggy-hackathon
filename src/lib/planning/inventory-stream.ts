import { createToolEvidence, type EvidenceEvent, type FlyaiEvidenceCommand, type SafeToolObservation, type ToolEvidence } from "@/lib/bailian-evidence";
import { AgentStreamError } from "@/lib/bailian-output";

/** Stop as soon as every requested CLI search is verified; no model recap wait. */
export async function consumeInventoryStream(
  response: Response,
  controller: AbortController,
  commands: readonly FlyaiEvidenceCommand[],
  observe: (event: { type: string; toolName: string | null } & SafeToolObservation) => void,
  onVerified?: (sources: ToolEvidence["flyaiSources"]) => void,
): Promise<ToolEvidence> {
  if (!response.body) throw new AgentStreamError("STREAM_BODY_MISSING");
  const evidence = createToolEvidence("flyai_inventory", commands);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const published = new Set<string>();
  const abort = () => { void reader.cancel().catch(() => undefined); };
  controller.signal.addEventListener("abort", abort, { once: true });
  const ready = () => {
    const result = evidence.result();
    return commands.every(command => command.queryKey
      ? result.queryReceipts?.some(receipt => receipt.queryKey === command.queryKey && ["completed", "empty"].includes(receipt.state))
      : result.flyaiCategories.includes(command.category));
  };
  const frame = (value: string) => {
    const data = value.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
    if (!data) return;
    let event: EvidenceEvent & { error?: { code?: unknown } };
    try {
      const parsed: unknown = JSON.parse(data);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error();
      event = parsed;
    } catch { throw new AgentStreamError("INVALID_AGENT_EVENT"); }
    const observation = evidence.accept(event);
    const name = event.content?.find((block) => block.type === "data")?.data?.name;
    observe({ type: event.type ?? "other", toolName: ["bash", "read"].includes(String(name)) ? String(name) : null, ...observation });
    if (observation.failureCode) throw new AgentStreamError(observation.failureCode);
    if (!controller.signal.aborted && observation.apiSucceeded && observation.exitCode === 0) {
      const fresh = evidence.result().flyaiSources.filter(source => !published.has(source.url));
      if (fresh.length && onVerified) {
        try { onVerified(fresh); for (const source of fresh) published.add(source.url); }
        catch { /* A preview failure must not discard verified inventory. */ }
      }
    }
    if (event.type === "error") {
      const code = event.error?.code;
      throw new AgentStreamError(typeof code === "string" && /^[A-Za-z0-9_.:-]{1,64}$/.test(code) ? code : "AGENT_REPORTED_ERROR");
    }
    if (event.type === "session_status") {
      const status = event.content?.find((block) => block.type === "data")?.data;
      if (status?.session_status === "terminated") throw new AgentStreamError("SESSION_TERMINATED");
      if (status?.session_status === "idle") {
        const stop = status.stop_reason;
        const reason = typeof stop === "object" && stop !== null && "type" in stop ? stop.type : null;
        if (reason === "requires_action") throw new AgentStreamError("AGENT_REQUIRES_ACTION");
        if (reason === "retries_exhausted") throw new AgentStreamError("AGENT_RETRIES_EXHAUSTED");
        if (reason === "end_turn" && !ready()) throw new AgentStreamError("NO_VERIFIED_FLYAI_SEARCH");
      }
    }
  };
  try {
    controller.signal.throwIfAborted();
    while (!ready()) {
      const { value, done } = await reader.read();
      controller.signal.throwIfAborted();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 2_200_000) throw new AgentStreamError("AGENT_EVENT_TOO_LARGE");
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? "";
      for (const item of frames) {
        frame(item);
        if (ready()) break;
      }
      if (done) {
        if (!ready() && buffer.trim()) frame(buffer);
        break;
      }
    }
    if (!ready()) throw new AgentStreamError("NO_VERIFIED_FLYAI_SEARCH");
    // An authentic empty result is a completed query, not a transport failure.
    // Its category stays explicitly unverified without repeating the search.
    return evidence.result();
  } catch (error) {
    // Keep completed queries, including authentic empty results, when a later
    // tool fails. The fallback can then search only the missing fingerprints.
    if (error && typeof error === "object") Object.assign(error, { inventoryEvidence: evidence.result() });
    throw error;
  } finally {
    controller.signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
