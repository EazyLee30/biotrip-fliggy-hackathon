export type EvidenceEvent = {
  id?: string;
  type?: string;
  status?: string;
  is_error?: boolean;
  metadata?: Record<string, unknown>;
  content?: Array<{ type?: string; data?: Record<string, unknown> }>;
};
/** Mirrors the pipeline stage names so evidence is always attributed correctly. */
type EvidenceMode = "health_insight" | "local_research" | "flyai_inventory" | "compose_plan";
type CommandCategory = "flyai_search" | "flyai_help" | "flyai_auth" | "environment_probe" | "other";
export type SafeToolObservation = {
  commandCategory: CommandCategory | null;
  isFlyaiSearch: boolean;
  exitCode: number | null;
  interrupted: boolean | null;
  apiSucceeded: boolean | null;
  sourceUrlCount: number;
  failureCode: string | null;
  duplicate: boolean;
};
export type ToolEvidence = {
  webSearchCalls: number;
  successfulWebSearches: number;
  flyaiSearchCalls: number;
  successfulFlyaiSearches: number;
  sourceUrls: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function jsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (value.length > 2_000_000) return null;
  try { return JSON.parse(value); } catch { return null; }
}
function httpsUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch { return null; }
}
function collectUrls(value: unknown, result: Set<string>, depth = 0) {
  if (depth > 12 || result.size >= 500) return;
  if (typeof value === "string") {
    if (/^https:\/\/\S+$/.test(value)) {
      const url = httpsUrl(value);
      if (url) result.add(url);
      return;
    }
    for (const match of value.matchAll(/https:\/\/[^\s<>"'\\\u0000-\u001f]+/g)) {
      const url = httpsUrl(match[0].replace(/[)\]},.;]+$/, ""));
      if (url) result.add(url);
    }
  } else if (Array.isArray(value)) {
    for (const item of value.slice(0, 500)) collectUrls(item, result, depth + 1);
  } else if (isRecord(value)) {
    for (const [key, item] of Object.entries(value).slice(0, 100)) {
      if (!/image|pic|thumbnail|icon|systemMessage/i.test(key)) collectUrls(item, result, depth + 1);
    }
  }
}
function collectFlyaiSources(value: unknown, result: Set<string>, depth = 0) {
  if (depth > 12 || result.size >= 100) return;
  if (typeof value === "string") {
    const nested = jsonValue(value);
    if (nested !== null && nested !== value) collectFlyaiSources(nested, result, depth + 1);
  } else if (Array.isArray(value)) {
    for (const item of value.slice(0, 100)) collectFlyaiSources(item, result, depth + 1);
  } else if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (/^(?:jumpUrl|detailUrl|source_url|sourceUrl|url|link)$/i.test(key) && typeof item === "string") {
        const url = httpsUrl(item);
        if (url) result.add(url);
      } else if (!/image|pic|thumbnail|icon|systemMessage/i.test(key)) collectFlyaiSources(item, result, depth + 1);
    }
  }
}
function commandCategory(value: unknown): CommandCategory {
  const argumentsValue = jsonValue(value);
  const command = isRecord(argumentsValue) && typeof argumentsValue.command === "string" ? argumentsValue.command.trim() : "";
  if (/\bflyai\b[^\n]*\s(?:--help|-h)\b|\bflyai\s+help\b/.test(command)) return "flyai_help";
  if (/^(?:DEBUG_FLYAI_MCP_URL=https:\/\/biotrip\.ccwu\.cc\/api\/flyai\/mcp\s+)?(?:timeout\s+\d+[smh]?\s+)?(?:\/usr\/local\/bin\/)?flyai\s+(?:keyword-search|ai-search|search-flight|search-train|search-hotel|search-poi|search-marriott-hotel|search-marriott-package)\b/.test(command) && !/[\r\n]/.test(command)) return "flyai_search";
  if (/\bflyai\s+(?:config|login|logout|auth)\b/.test(command)) return "flyai_auth";
  if (/(?:^|[;&|\s])(?:printenv|env|which|command\s+-v)\b|(?:process\.env|os\.environ)|\becho\b[^\n]*\bFLYAI_API_KEY\b/.test(command)) return "environment_probe";
  return "other";
}
function cliFailure(output: Record<string, unknown>, payload: unknown): string | null {
  if (output.interrupted === true) return "FLYAI_CLI_INTERRUPTED";
  const stdout = typeof output.stdout === "string" ? output.stdout : "";
  const stderr = typeof output.stderr === "string" ? output.stderr : "";
  const text = `${stderr}\n${apiSucceeded(payload) ? "" : stdout}`.slice(0, 128_000);
  if (/\b(?:unauthorized|AccessDenied|AuthenticationFailed|invalid[ _-]?(?:api[ _-]?)?key|missing[ _-](?:api[ _-])?key)\b|(?:API key|API token).{0,40}(?:required|missing|invalid)|(?:HTTP|status(?:Code)?)[\s:=]*40[13]\b/i.test(text)) return "FLYAI_AUTH_ERROR";
  if (/\b(?:unrecognized arguments|unknown (?:command|option)|invalid (?:argument|option)|required (?:argument|option)|missing required|usage:)\b/i.test(text)) return "FLYAI_ARGUMENT_ERROR";
  if (/\b(?:command not found|flyai: not found|No such file or directory)\b/i.test(stderr)) return "FLYAI_COMMAND_NOT_FOUND";
  if (typeof output.exit_code === "number" && output.exit_code !== 0) return "FLYAI_CLI_EXIT_NONZERO";
  if (isRecord(payload)) {
    if (payload.success === false || payload.error || (typeof payload.status === "number" && payload.status !== 0) || (typeof payload.code === "number" && payload.code !== 0 && payload.code !== 200)) return "FLYAI_API_ERROR";
  }
  return null;
}
function apiSucceeded(payload: unknown) {
  if (!isRecord(payload) || payload.success === false || payload.error ||
    (typeof payload.status === "number" && payload.status !== 0) ||
    (typeof payload.code === "number" && ![0, 200].includes(payload.code))) return false;
  return (
    payload.status === 0 || payload.code === 0 || payload.code === 200 ||
    payload.success === true || payload.message === "success"
  );
}

// Keep raw commands and tool output in request memory only. Consumers receive
// safe counters, error categories and original source URLs, never credentials.
export function createToolEvidence(mode: EvidenceMode) {
  const seen = new Set<string>();
  const calls = new Map<string, { name: string; category: CommandCategory | null }>();
  const completedCalls = new Set<string>();
  const sources = new Set<string>();
  let webSearchCalls = 0;
  let successfulWebSearches = 0;
  let flyaiSearchCalls = 0;
  let successfulFlyaiSearches = 0;
  let bashCalls = 0;
  let helpCalls = 0;

  const accept = (event: EvidenceEvent): SafeToolObservation => {
    const observation: SafeToolObservation = {
      commandCategory: null, isFlyaiSearch: false, exitCode: null,
      interrupted: null, apiSucceeded: null, sourceUrlCount: 0,
      failureCode: null, duplicate: false,
    };
    if (event.status !== "completed" || !["tool_call", "tool_call_output"].includes(event.type ?? "")) return observation;
    if (event.id && seen.has(event.id)) return { ...observation, duplicate: true };
    if (event.id) seen.add(event.id);
    const data = event.content?.find((block) => block.type === "data")?.data;
    if (!data) return observation;
    const callId = typeof data.call_id === "string" ? data.call_id : typeof event.metadata?.call_id === "string" ? event.metadata.call_id : null;
    if (!callId) return observation;
    if (event.type === "tool_call") {
      if (calls.has(callId)) return { ...observation, duplicate: true };
      const name = typeof data.name === "string" ? data.name : "";
      const category = name === "bash" ? commandCategory(data.arguments) : null;
      calls.set(callId, { name, category });
      observation.commandCategory = category;
      observation.isFlyaiSearch = category === "flyai_search";
      if (name === "web_search") {
        webSearchCalls += 1;
        if (mode === "local_research" && webSearchCalls > 8 && successfulWebSearches === 0) {
          // Over-searching only counts as failure while nothing usable has come
          // back. Once real sources are verified, an extra call is wasteful
          // rather than wrong, and discarding those results would be worse.
          observation.failureCode = "WEB_SEARCH_LIMIT_EXCEEDED";
        }
      }
      if (name === "bash") {
        bashCalls += 1;
        if (category === "flyai_search") flyaiSearchCalls += 1;
        if (category === "flyai_help") helpCalls += 1;
        if (mode === "flyai_inventory") {
          if (category === "flyai_auth" || category === "environment_probe") observation.failureCode = "FLYAI_UNSUPPORTED_PROBE";
          else if (flyaiSearchCalls > 4 || bashCalls > 6 || helpCalls > 1) observation.failureCode = "FLYAI_SEARCH_LIMIT_EXCEEDED";
        }
      }
      return observation;
    }
    const call = calls.get(callId);
    if (!call) return observation;
    if (completedCalls.has(callId)) return { ...observation, duplicate: true };
    completedCalls.add(callId);
    observation.commandCategory = call.category;
    observation.isFlyaiSearch = call.category === "flyai_search";
    const output = jsonValue(data.output);
    if (isRecord(output)) {
      observation.exitCode = typeof output.exit_code === "number" && Number.isInteger(output.exit_code) && output.exit_code >= -255 && output.exit_code <= 255 ? output.exit_code : null;
      observation.interrupted = typeof output.interrupted === "boolean" ? output.interrupted : null;
    }
    if (call.name === "web_search" && event.is_error === false) {
      successfulWebSearches += 1;
      const urls = new Set<string>();
      collectUrls(output ?? data.output, urls);
      observation.sourceUrlCount = urls.size;
      for (const url of urls) sources.add(url);
    }
    if (call.category === "flyai_search") {
      const payload = isRecord(output) ? jsonValue(output.stdout) : null;
      const failure = isRecord(output) ? cliFailure(output, payload) : "FLYAI_OUTPUT_UNVERIFIED";
      observation.failureCode = failure ?? (event.is_error === true ? "FLYAI_TOOL_ERROR" : null);
      observation.apiSucceeded = apiSucceeded(payload);
      if (!observation.failureCode && event.is_error === false && observation.exitCode === 0 && observation.interrupted !== true && observation.apiSucceeded) {
        successfulFlyaiSearches += 1;
        const urls = new Set<string>();
        collectFlyaiSources(isRecord(payload) ? payload.data : null, urls);
        observation.sourceUrlCount = urls.size;
        for (const url of urls) sources.add(url);
      } else if (!observation.failureCode) {
        observation.failureCode = "FLYAI_OUTPUT_UNVERIFIED";
      }
    }
    return observation;
  };
  const result = (): ToolEvidence => ({
    webSearchCalls, successfulWebSearches, flyaiSearchCalls, successfulFlyaiSearches,
    sourceUrls: [...sources],
  });
  return { accept, result };
}
