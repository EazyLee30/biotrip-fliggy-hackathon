import { bailianRequest, deleteBailianSession, type BailianConfig } from "@/lib/bailian";
import { AgentStreamError, consumeAgentResponse, parseJsonText, parsePlan, safeHttpsUrl } from "@/lib/bailian-output";
import { createToolEvidence, type ToolEvidence } from "@/lib/bailian-evidence";
import { composePlanPrompt, healthInsightPrompt, localResearchPrompt } from "../prompts";
import {
  PlannerError,
  normalizePlannerError,
  type ComposedPlan,
  type FlyaiInventory,
  type GatheredResults,
  type HealthBasis,
  type HealthInsight,
  type LocalResearch,
  type LocalService,
  type PlanStage,
  type PlanningProvider,
  type StageContext,
} from "../contract";

type AgentKind = "insight" | "local" | "travel";

type AgentSessionResult = { text: string; evidence: ToolEvidence };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function safeErrorCode(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,64}$/.test(value) ? value : null;
}

async function providerFailure(stage: PlanStage, operation: string, response: Response, degradable: boolean) {
  let providerCode: string | null = null;
  let requestId = response.headers.get("x-request-id") ?? response.headers.get("x-acs-request-id");
  try {
    const payload: unknown = await response.clone().json();
    if (isRecord(payload)) {
      providerCode = safeErrorCode(payload.code);
      if (!requestId) requestId = safeErrorCode(payload.request_id);
      if (!providerCode && isRecord(payload.error)) providerCode = safeErrorCode(payload.error.code);
      if (!providerCode && isRecord(payload.error) && isRecord(payload.error.error)) {
        providerCode = safeErrorCode(payload.error.error.code);
      }
    }
  } catch {
    // Provider bodies can contain traveller data; only allowlisted codes are read.
  }
  return new PlannerError(stage, operation, response.status, providerCode ?? "UPSTREAM_HTTP_ERROR", safeErrorCode(requestId), degradable);
}

async function consumeAgentStream(
  streamResponse: Response,
  controller: AbortController,
  stage: PlanStage,
  degradable: boolean,
  requestId: string,
  sessionId: string,
  startedAt: number,
  evidenceSatisfies: (evidence: ToolEvidence) => boolean,
): Promise<AgentSessionResult> {
  try {
    const evidence = createToolEvidence(
      stage === "health_insight" ? "health_insight" : stage === "local_research" ? "local_research" : "flyai_inventory",
    );
    const text = await consumeAgentResponse(streamResponse, controller, (event) => {
      if (["tool_call", "tool_call_output", "mcp_call", "mcp_call_output", "session_status", "error"].includes(event.type)) {
        // Prompts, tool arguments and tool output never enter logs.
        console.info("[BioTrip agent event]", { requestId, stage, sessionId, elapsedMs: Date.now() - startedAt, ...event });
      }
    }, evidence);
    const verified = evidence.result();
    if (!evidenceSatisfies(verified)) throw new AgentStreamError(stage === "local_research" ? "NO_VERIFIED_WEB_SEARCH" : "NO_VERIFIED_FLYAI_SEARCH");
    const { sourceUrls, ...counts } = verified;
    console.info("[BioTrip tool evidence]", { requestId, stage, sessionId, ...counts, sourceUrlCount: sourceUrls.length });
    return { text, evidence: verified };
  } catch (error) {
    if (error instanceof AgentStreamError) throw new PlannerError(stage, "agent_stream", 502, error.code, null, degradable);
    throw error;
  }
}

/**
 * One short-lived Bailian Managed Agent session.
 *
 * Sessions are deleted immediately after their result is read, so the provider's
 * retained event history does not outlive the request.
 */
async function runAgentSession(
  config: BailianConfig,
  stage: PlanStage,
  target: { agentId: string; environmentId: string; title: string; requireNoTools?: boolean; vaultIds?: string[] },
  prompt: string,
  budgetMs: number,
  degradable: boolean,
  signal: AbortSignal,
  requestId: string,
  progress: (event: { stage: string; message?: string }) => void,
  evidenceSatisfies: (evidence: ToolEvidence) => boolean,
): Promise<AgentSessionResult> {
  let sessionId: string | null = null;
  let operation = "session_create";
  const startedAt = Date.now();
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new DOMException("Stage budget exceeded", "TimeoutError")),
    budgetMs,
  );
  const log = (state: string, extra: Record<string, unknown> = {}) => {
    console.info("[BioTrip plan stage]", { requestId, stage, operation, state, sessionId, elapsedMs: Date.now() - startedAt, ...extra });
  };
  const requestSignal = () => AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]);
  progress({ stage });
  log("started", { budgetMs });
  try {
    const createdResponse = await bailianRequest(config, "/sessions", {
      method: "POST",
      signal: requestSignal(),
      body: JSON.stringify({
        agent: target.agentId,
        environment_id: target.environmentId,
        title: target.title,
        ...(target.vaultIds?.length ? { vault_ids: target.vaultIds } : {}),
      }),
    });
    log("response", { status: createdResponse.status });
    if (!createdResponse.ok) throw await providerFailure(stage, operation, createdResponse, degradable);
    const created = await createdResponse.json() as {
      id?: string;
      agent?: { tools?: unknown[]; skills?: unknown[]; mcp_servers?: unknown[] };
    };
    if (!created.id || !/^sesn_[A-Za-z0-9_-]{1,123}$/.test(created.id)) {
      throw new PlannerError(stage, operation, 502, "INVALID_SESSION_RESPONSE", null, degradable);
    }
    sessionId = created.id;
    // The health agent must have no tools at all, checked against the session
    // snapshot the provider actually created rather than a local assumption.
    if (target.requireNoTools && (
      !Array.isArray(created.agent?.tools) || created.agent.tools.length > 0 ||
      (Array.isArray(created.agent.skills) && created.agent.skills.length > 0) ||
      (Array.isArray(created.agent.mcp_servers) && created.agent.mcp_servers.length > 0)
    )) {
      throw new PlannerError(stage, "agent_config", 503, "HEALTH_AGENT_HAS_TOOLS", null, false);
    }
    operation = "stream_open";
    log("started");
    const streamResponse = await bailianRequest(config, `/sessions/${encodeURIComponent(sessionId)}/events/stream`, {
      headers: { Accept: "text/event-stream" }, signal: controller.signal,
    });
    log("response", { status: streamResponse.status });
    if (!streamResponse.ok) throw await providerFailure(stage, operation, streamResponse, degradable);
    operation = "event_submit";
    log("started");
    const eventResponse = await bailianRequest(config, `/sessions/${encodeURIComponent(sessionId)}/events`, {
      method: "POST",
      signal: requestSignal(),
      body: JSON.stringify({ input: [{ role: "user", type: "message", content: [{ type: "text", text: prompt }] }] }),
    });
    log("response", { status: eventResponse.status });
    if (!eventResponse.ok) throw await providerFailure(stage, operation, eventResponse, degradable);
    operation = "agent_stream";
    log("started");
    const result = await consumeAgentStream(streamResponse, controller, stage, degradable, requestId, sessionId, startedAt, evidenceSatisfies);
    log("completed");
    return result;
  } catch (error) {
    const failure = controller.signal.aborted && !(error instanceof PlannerError)
      ? new PlannerError(
          stage, operation, 504,
          signal.aborted && signal.reason?.name !== "TimeoutError" ? "CLIENT_DISCONNECTED" : "UPSTREAM_TIMEOUT",
          null, degradable,
        )
      : normalizePlannerError(stage, operation, error, degradable);
    log("failed", { status: failure.status, code: failure.code });
    throw failure;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    controller.abort();
    if (sessionId) {
      log("cleanup_started");
      await deleteBailianSession(config, sessionId);
      log("cleanup_completed");
    }
  }
}

function parseLocalServices(text: string, sourceUrls: string[]): LocalService[] {
  const parsed = parseJsonText(text);
  const list = Array.isArray(parsed.services) ? parsed.services : [];
  const verified = new Set(sourceUrls);
  return list.filter(isRecord).slice(0, 6).map((item) => {
    const sourceUrl = safeHttpsUrl(item.source_url);
    if (!sourceUrl || typeof item.name !== "string" || typeof item.kind !== "string" ||
      typeof item.detail !== "string" || typeof item.source !== "string") return null;
    if (!verified.has(sourceUrl)) throw new PlannerError("local_research", "agent_output", 502, "UNVERIFIED_SOURCE_URL", null, true);
    return {
      name: item.name.slice(0, 180), kind: item.kind.slice(0, 80),
      detail: item.detail.slice(0, 500), source: item.source.slice(0, 160), sourceUrl,
    };
  }).filter((item): item is LocalService => item !== null);
}

const FLYAI_SKILL_RULE = [
  "CLI 已安装。为兼容 Vault 必须通过 BioTrip 只读签名网关调用，命令固定前缀",
  'DEBUG_FLYAI_MCP_URL=https://biotrip.ccwu.cc/api/flyai/mcp flyai keyword-search --query "目的地及当前所需类别"。',
  "最多 4 次真实搜索，通常 1–2 次足够；不要查环境、凭证、登录或安装，不要重复 help。",
  "官方 CLI 的 status=0、message=success 表示成功。命令失败时停止并返回错误说明。",
].join("");

/**
 * Bailian Managed Agents provider — the transport the competition requires.
 *
 * The travel agent searches FlyAI with the official Skill and composes the plan
 * in a single session, because splitting them would double both the runtime
 * cost and the latency for no additional evidence. `composePlan` therefore reads
 * back the session the inventory stage already paid for.
 */
export function createAgentProvider(config: BailianConfig): PlanningProvider {
  const target = (kind: AgentKind) => {
    if (kind === "insight") {
      if (!config.insightAgentId || !config.insightEnvironmentId) return null;
      return { agentId: config.insightAgentId, environmentId: config.insightEnvironmentId, title: "BioTrip 身体信号解读", requireNoTools: true };
    }
    if (kind === "local") {
      if (!config.localInfoAgentId || !config.localInfoEnvironmentId) return null;
      return { agentId: config.localInfoAgentId, environmentId: config.localInfoEnvironmentId, title: "BioTrip 目的地服务检索" };
    }
    return { agentId: config.agentId, environmentId: config.environmentId, title: "BioTrip 实时旅行编排", vaultIds: config.flyaiVaultId ? [config.flyaiVaultId] : [] };
  };

  // Memoised per request so the composing stage reuses the inventory session.
  let travelSession: ComposedPlan | null = null;

  return {
    id: "managed_agent",
    assertConfigured() {
      if (!target("travel")) throw new Error("Managed Agents are not configured.");
    },

    async healthInsight(ctx: StageContext): Promise<HealthInsight> {
      const insight = target("insight");
      if (!insight) throw new PlannerError("health_insight", "agent_config", 503, "HEALTH_AGENT_NOT_CONFIGURED", null, true);
      const result = await runAgentSession(config, "health_insight", insight, healthInsightPrompt(ctx), 75_000, true,
        ctx.signal, ctx.requestId, ctx.progress, () => true);
      const parsed = parseJsonText(result.text);
      const pace = parsed.walking_pace;
      const breaks = parsed.break_frequency;
      if (!(typeof pace === "string" && ["reduced", "usual", "flexible"].includes(pace)) ||
          !(typeof breaks === "string" && ["frequent", "usual", "optional"].includes(breaks))) {
        throw new PlannerError("health_insight", "agent_output", 502, "INVALID_HEALTH_INSIGHT", null, true);
      }
      return {
        walkingPace: pace as HealthInsight["walkingPace"],
        breakFrequency: breaks as HealthInsight["breakFrequency"],
        sensoryFilters: Array.isArray(parsed.sensory_filters)
          ? parsed.sensory_filters.filter((item): item is string => typeof item === "string").slice(0, 5)
          : (ctx.input.preferences?.ambientPreferences ?? []),
        basis: (ctx.input.healthMetrics ? "whoop_recent" : fallbackBasis(ctx)) as HealthBasis,
        whoopUnavailable: false,
      };
    },

    async localResearch(ctx: StageContext): Promise<LocalResearch> {
      const local = target("local");
      if (!local) throw new PlannerError("local_research", "agent_config", 503, "LOCAL_AGENT_NOT_CONFIGURED", null, true);
      const result = await runAgentSession(config, "local_research", local, localResearchPrompt(ctx), 120_000, true,
        ctx.signal, ctx.requestId, ctx.progress, (evidence) => evidence.successfulWebSearches > 0);
      return { services: parseLocalServices(result.text, result.evidence.sourceUrls), searches: result.evidence.successfulWebSearches };
    },

    async flyaiInventory(ctx: StageContext): Promise<FlyaiInventory> {
      const travel = target("travel");
      if (!travel?.vaultIds?.length) {
        throw new PlannerError("flyai_inventory", "agent_config", 503, "FLYAI_VAULT_NOT_CONFIGURED", null, false);
      }
      const prompt = [
        "你是 BioTrip 的旅行编排 Agent。使用本环境安装的 BioTrip FlyAI search Skill 和官方 FlyAI CLI 搜索飞猪真实旅行库存、景点、票务与旅游保险，再结合用户日程与已核验的当地资料编排行程。",
        `只允许搜索，不得预订、付款、修改外部订单或假称已预订。运行环境中的 FLYAI_API_KEY 由百炼 Vault 以占位符形式提供，只发往 BioTrip 只读签名网关，网关验证后签名并转发至飞猪官方 API；不要输出、记录或改写该变量。${FLYAI_SKILL_RULE}`,
        composePlanPrompt(ctx, { health: null, local: null, inventory: EMPTY_INVENTORY }, { inventoryFromAgent: true }),
      ].join("\n\n");
      const result = await runAgentSession(config, "flyai_inventory", travel, prompt, 180_000, false,
        ctx.signal, ctx.requestId, ctx.progress, (evidence) => evidence.successfulFlyaiSearches > 0);
      // The agent's own place links become the inventory, but only after every
      // one of them is matched against the URLs its tool calls actually returned.
      const plan = parsePlan(result.text, ctx.fixedItems);
      const allowed = new Set(result.evidence.sourceUrls);
      if (!plan.places.length || plan.places.some((place) => !allowed.has(place.url))) {
        throw new PlannerError("flyai_inventory", "agent_output", 502, "UNVERIFIED_FLYAI_SOURCE", null, false);
      }
      travelSession = plan;
      return {
        sources: plan.places.map((place) => ({ name: place.name, url: place.url, category: place.category, price: null })),
        searches: result.evidence.successfulFlyaiSearches,
        failedSearches: 0,
        failedCategories: [],
      };
    },

    async composePlan(ctx: StageContext, gathered: GatheredResults): Promise<ComposedPlan> {
      if (travelSession) return travelSession;
      // Reached only when inventory came from another transport.
      const travel = target("travel");
      if (!travel) throw new PlannerError("compose_plan", "agent_config", 503, "TRAVEL_AGENT_NOT_CONFIGURED", null, false);
      const result = await runAgentSession(config, "compose_plan", travel, composePlanPrompt(ctx, gathered), 180_000, false,
        ctx.signal, ctx.requestId, ctx.progress, () => true);
      const plan = parsePlan(result.text, ctx.fixedItems);
      const allowed = new Set(gathered.inventory.sources.map((source) => source.url));
      if (plan.places.some((place) => !allowed.has(place.url))) {
        throw new PlannerError("compose_plan", "agent_output", 502, "UNVERIFIED_SOURCE_URL", null, false);
      }
      return plan;
    },
  };
}

const EMPTY_INVENTORY: FlyaiInventory = { sources: [], searches: 0, failedSearches: 0, failedCategories: [] };

function fallbackBasis(ctx: StageContext): HealthBasis {
  return ctx.isNearOrOngoingTrip && (ctx.input.selfReport?.fatigue != null || ctx.input.selfReport?.subjectiveStress != null)
    ? "self_report" : "preferences_only";
}