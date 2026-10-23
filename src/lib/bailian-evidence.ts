export type EvidenceEvent = {
  id?: string;
  type?: string;
  status?: string;
  is_error?: boolean;
  metadata?: Record<string, unknown>;
  content?: Array<{ type?: string; data?: Record<string, unknown> }>;
};
/** Mirrors the pipeline stage names so evidence is always attributed correctly. */
type EvidenceMode = "health_insight" | "local_research" | "flyai_inventory" | "compose_plan" | "relief_inventory" | "mobility" | "compose_adjustments" | "poi_catalog";
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
  queryReceipts?: import("./travel-search-types").ToolReceipt[];
  webSearchCalls: number;
  successfulWebSearches: number;
  flyaiSearchCalls: number;
  successfulFlyaiSearches: number;
  sourceUrls: string[];
  flyaiSources: FlyaiSource[];
  flyaiCategories: string[];
  /** Completed API queries whose data contained no usable named HTTPS source. */
  emptyFlyaiCategories: string[];
};
export type FlyaiEvidenceCommand = { command: string; category: string; queryKey?: string; tool?: import("./travel-search-types").FlyaiTool; args?: Record<string, unknown> };

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
/** Parse literal shell words only, including quoted public endpoint prefixes. */
function shellWords(command: string): string[] | null {
  if (command.length > 6000 || /[\r\n]/.test(command)) return null;
  const words: string[] = [];
  let word = "";
  let started = false;
  let quote = "";
  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];
    if (quote === "'") {
      if (char === "'") quote = "";
      else word += char;
    } else if (char === "\\") {
      if (i + 1 >= command.length) return null;
      word += command[++i];
      started = true;
    } else if (quote === '"') {
      if (char === '"') quote = "";
      else if (char === "$" || char === "`") return null;
      else word += char;
    } else if (char === "'" || char === '"') {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) words.push(word);
      word = "";
      started = false;
    } else {
      if (/[;&|><(){}$`]/.test(char)) return null;
      word += char;
      started = true;
    }
  }
  if (quote) return null;
  if (started) words.push(word);
  if (words[0] === "DEBUG_FLYAI_MCP_URL=https://biotrip.eazylee.si/api/flyai/mcp") words.shift();
  if (words[0] === "timeout" && /^\d+[smh]?$/.test(words[1] ?? "")) words.splice(0, 2);
  if (words[0] === "/usr/local/bin/flyai") words[0] = "flyai";
  return words;
}
function commandText(value: unknown) {
  const argumentsValue = jsonValue(value);
  return isRecord(argumentsValue) && typeof argumentsValue.command === "string" ? argumentsValue.command.trim() : "";
}
function commandCategory(value: unknown): CommandCategory {
  const command = commandText(value);
  const words = shellWords(command);
  if (/\bflyai\b[^\n]*\s(?:--help|-h)\b|\bflyai\s+help\b/.test(command)) return "flyai_help";
  if (words?.[0] === "flyai" && ["keyword-search", "fliggy-fast-search", "ai-search", "search-flight", "search-train", "search-hotel", "search-poi", "search-marriott-hotel", "search-marriott-package"].includes(words[1])) return "flyai_search";
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
export function createToolEvidence(mode: EvidenceMode, allowedCommands?: readonly FlyaiEvidenceCommand[]) {
  const seen = new Set<string>();
  const calls = new Map<string, { name: string; category: CommandCategory | null; sourceCategory: string; expected?: FlyaiEvidenceCommand; startedAt: number }>();
  const completedCalls = new Set<string>();
  const sources = new Set<string>();
  const flyaiSources = new Map<string, FlyaiSource>();
  const flyaiCategories = new Set<string>();
  const emptyFlyaiCategories = new Set<string>();
  const expected = allowedCommands && new Map(allowedCommands.map((item) => [JSON.stringify(shellWords(item.command)), item]));
  const queryReceipts = new Map<string, import("./travel-search-types").ToolReceipt>();
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
    if (event.status !== "completed") return observation;
    // Composition has already received its verified sources. Reject every
    // provider call type before requiring a name, arguments or call identifier.
    if ((mode === "compose_plan" || mode === "compose_adjustments") && ["tool_call", "mcp_call", "function_call", "tool_approval_request"].includes(event.type ?? "")) {
      return { ...observation, failureCode: "COMPOSE_TOOL_CALL_FORBIDDEN" };
    }
    if (!["tool_call", "tool_call_output"].includes(event.type ?? "")) return observation;
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
      const expectedQuery = expected?.get(JSON.stringify(shellWords(commandText(data.arguments))));
      const sourceCategory = expectedQuery?.category ?? "景点与旅行商品";
      calls.set(callId, { name, category, sourceCategory, expected: expectedQuery, startedAt: Date.now() });
      if (expectedQuery?.queryKey && expectedQuery.tool) {
        if (queryReceipts.has(expectedQuery.queryKey)) observation.failureCode = "FLYAI_DUPLICATE_QUERY";
        else queryReceipts.set(expectedQuery.queryKey, { queryKey: expectedQuery.queryKey, tool: expectedQuery.tool, category: sourceCategory,
          state: "unknown", executor: "agent_skill", sourceCount: 0, elapsedMs: 0, retrievedAt: new Date().toISOString() });
      }
      observation.commandCategory = category;
      observation.isFlyaiSearch = category === "flyai_search";
      if (name === "web_search") {
        webSearchCalls += 1;
        if (mode === "local_research" && webSearchCalls > 4) {
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
          else if (category === "flyai_search" && expected && !expected.has(JSON.stringify(shellWords(commandText(data.arguments))))) observation.failureCode = "FLYAI_UNEXPECTED_QUERY";
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
        flyaiCategories.add(call.sourceCategory);
        const urls = new Set<string>();
        collectFlyaiSources(isRecord(payload) ? payload.data : null, urls);
        observation.sourceUrlCount = urls.size;
        for (const url of urls) sources.add(url);
        const retrieved = extractFlyaiSources(isRecord(payload) ? payload.data : null, call.sourceCategory, 30, call.expected?.tool);
        if (call.expected?.queryKey && call.expected.tool) queryReceipts.set(call.expected.queryKey, {
          queryKey: call.expected.queryKey, tool: call.expected.tool, category: call.sourceCategory,
          state: retrieved.length ? "completed" : "empty", executor: "agent_skill", sourceCount: retrieved.length,
          elapsedMs: Date.now() - call.startedAt, retrievedAt: new Date().toISOString(),
        });
        if (retrieved.length) emptyFlyaiCategories.delete(call.sourceCategory);
        else emptyFlyaiCategories.add(call.sourceCategory);
        for (const source of retrieved) {
          if (flyaiSources.size < 30) flyaiSources.set(source.id ?? source.url, source);
        }
      } else if (!observation.failureCode) {
        observation.failureCode = "FLYAI_OUTPUT_UNVERIFIED";
      }
      if (observation.failureCode && call.expected?.queryKey && call.expected.tool) queryReceipts.set(call.expected.queryKey, {
        queryKey: call.expected.queryKey, tool: call.expected.tool, category: call.sourceCategory, state: "failed", executor: "agent_skill",
        sourceCount: 0, elapsedMs: Date.now() - call.startedAt, retrievedAt: new Date().toISOString(), code: observation.failureCode,
      });
    }
    return observation;
  };
  const result = (): ToolEvidence => ({
    webSearchCalls, successfulWebSearches, flyaiSearchCalls, successfulFlyaiSearches,
    sourceUrls: [...sources],
    flyaiSources: [...flyaiSources.values()],
    flyaiCategories: [...flyaiCategories],
    emptyFlyaiCategories: [...emptyFlyaiCategories],
    ...(queryReceipts.size ? { queryReceipts: [...queryReceipts.values()] } : {}),
  });
  return { accept, result };
}
import { extractFlyaiSources } from "./planning/flyai-sources";
import type { FlyaiSource } from "./flyai";
