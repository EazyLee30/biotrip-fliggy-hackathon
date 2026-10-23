import { bailianRequest, deleteBailianSession, type BailianConfig } from "@/lib/bailian";
import { registerSessionCleanup, queueSessionCleanup } from "@/lib/bailian-session-cleanup";
import { AgentStreamError, consumeAgentResponse, parseJsonText, parsePlan, safeHttpsUrl } from "@/lib/bailian-output";
import { createToolEvidence, type FlyaiEvidenceCommand, type ToolEvidence } from "@/lib/bailian-evidence";
import { composePlanPrompt, healthInsightPrompt, localResearchPrompt } from "../prompts";
import { bindPlanPlaces, flyaiInventory } from "./bailian-model";
import { flyaiInventoryPrompt, skillInventoryQueries } from "../inventory";
import { consumeInventoryStream } from "../inventory-stream";
import { adjustmentPrompt, reliefQueries } from "../adjust-prompts";
import { createMobilityEvidence, mobilityLegs, mobilityPrompt } from "../mobility";
import type { RouteFact } from "../../adjust/validate";
import { abstractHealth } from "../adjust-health";
import { STAGE_BY_NAME } from "../stages";
import { validateComposedPlan } from "../validation";
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

type AgentKind = "insight" | "local" | "travel" | "compose" | "mobility";

type AgentSessionResult = { text: string; evidence: ToolEvidence; routes?: RouteFact[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
/** Validate both legacy references and the documented toolkit-based MCP snapshot. */
function verifiedMobilitySnapshot(agent: unknown, expectedServer: string): boolean {
  if (!isRecord(agent) || !Array.isArray(agent.skills) || agent.skills.length || !Array.isArray(agent.tools) || !Array.isArray(agent.mcp_servers) || agent.mcp_servers.length !== 1) return false;
  const server = agent.mcp_servers[0];
  if (typeof server === "string" || (isRecord(server) && typeof server.id === "string")) {
    return (typeof server === "string" ? server : server.id) === expectedServer && agent.tools.length === 0;
  }
  if (!isRecord(server) || server.type !== "official" || server.name !== expectedServer) return false;
  const allowed = new Set(["maps_text_search", "maps_search_detail", "maps_direction_walking", "maps_direction_driving", "maps_direction_transit_integrated"]);
  let mapToolkit = false;
  for (const toolkit of agent.tools) {
    if (!isRecord(toolkit) || !isRecord(toolkit.default_config) || toolkit.default_config.enabled !== false || !Array.isArray(toolkit.configs)) return false;
    if (toolkit.type === "builtin_toolkit") {
      if (toolkit.configs.some(config => !isRecord(config) || config.enabled !== false)) return false;
    } else if (toolkit.type === "mcp_toolkit" && toolkit.mcp_server_name === expectedServer && !mapToolkit) {
      mapToolkit = true;
      const enabled = new Set<string>();
      for (const config of toolkit.configs) {
        if (!isRecord(config) || typeof config.name !== "string" || typeof config.enabled !== "boolean") return false;
        if (!config.enabled) continue;
        if (!allowed.has(config.name) || enabled.has(config.name)) return false;
        const policy = config.permission_policy ?? toolkit.default_config.permission_policy;
        if (policy !== undefined && (!isRecord(policy) || policy.type !== "always_allow")) return false;
        enabled.add(config.name);
      }
      if (enabled.size !== allowed.size) return false;
    } else return false;
  }
  return mapToolkit;
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
  mobilityEvidence?: ReturnType<typeof createMobilityEvidence>,
): Promise<AgentSessionResult> {
  try {
    const base = createToolEvidence(stage);
    const evidence = mobilityEvidence ? { ...base, accept(event: Parameters<typeof base.accept>[0]) {
      const failureCode = mobilityEvidence.accept(event);
      const observation = base.accept(event);
      return failureCode ? { ...observation, failureCode } : observation;
    } } : base;
    const text = await consumeAgentResponse(streamResponse, controller, (event) => {
      if (["tool_call", "tool_call_output", "mcp_call", "mcp_call_output", "session_status", "error"].includes(event.type)) {
        // Prompts, tool arguments and tool output never enter logs.
        console.info("[BioTrip agent event]", { requestId, stage, sessionId, elapsedMs: Date.now() - startedAt, ...event });
      }
    }, evidence);
    const verified = evidence.result();
    if (mobilityEvidence && !mobilityEvidence.result().length) throw new AgentStreamError("NO_VERIFIED_AMAP_ROUTE");
    if (!evidenceSatisfies(verified)) throw new AgentStreamError(stage === "local_research" ? "NO_VERIFIED_WEB_SEARCH" : "NO_VERIFIED_FLYAI_SEARCH");
    const { sourceUrls, flyaiSources, flyaiCategories, emptyFlyaiCategories, ...counts } = verified;
    console.info("[BioTrip tool evidence]", { requestId, stage, sessionId, ...counts, sourceUrlCount: sourceUrls.length, inventoryCount: flyaiSources.length, verifiedCategoryCount: flyaiCategories.length, emptyCategoryCount: emptyFlyaiCategories.length });
    return { text, evidence: verified, ...(mobilityEvidence ? { routes: mobilityEvidence.result() } : {}) };
  } catch (error) {
    if (error instanceof AgentStreamError) throw new PlannerError(stage, "agent_stream", 502, error.code, null, degradable);
    throw error;
  }
}

/**
 * One short-lived Bailian Managed Agent session.
 *
 * Session deletion is attempted immediately after the result is read. Logs
 * distinguish confirmed cleanup from an unconfirmed provider or network error.
 */
export async function runAgentSession(
  config: BailianConfig,
  stage: PlanStage,
  target: { agentId: string; environmentId: string; title: string; requireNoTools?: boolean; vaultIds?: string[]; requireMcpServerId?: string },
  prompt: string,
  budgetMs: number,
  degradable: boolean,
  signal: AbortSignal,
  requestId: string,
  progress: (event: { stage: string; message?: string }) => void,
  evidenceSatisfies: (evidence: ToolEvidence) => boolean,
  inventoryCommands?: readonly FlyaiEvidenceCommand[],
  sessionCreated?: StageContext["sessionCreated"],
  inventoryAvailable?: StageContext["inventoryAvailable"],
  mobilityEvidence?: ReturnType<typeof createMobilityEvidence>,
): Promise<AgentSessionResult> {
  let sessionId: string | null = null;
  let cleanupRegistered = false;
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
    await registerSessionCleanup(sessionId);
    cleanupRegistered = true;
    await sessionCreated?.(stage, sessionId);
    // Health interpretation and composition must have no tools, checked against the session
    // snapshot the provider actually created rather than a local assumption.
    if (target.requireNoTools && (
      !Array.isArray(created.agent?.tools) || created.agent.tools.length > 0 ||
      (["compose_plan", "compose_adjustments"].includes(stage) && (!Array.isArray(created.agent.skills) || !Array.isArray(created.agent.mcp_servers))) ||
      (Array.isArray(created.agent.skills) && created.agent.skills.length > 0) ||
      (Array.isArray(created.agent.mcp_servers) && created.agent.mcp_servers.length > 0)
    )) {
      throw new PlannerError(stage, "agent_config", 503,
        ["compose_plan", "compose_adjustments"].includes(stage) ? "COMPOSE_AGENT_HAS_TOOLS" : "HEALTH_AGENT_HAS_TOOLS", null, false);
    }
    if (target.requireMcpServerId) {
      if (!verifiedMobilitySnapshot(created.agent, target.requireMcpServerId)) {
        throw new PlannerError(stage, "agent_config", 503, "MOBILITY_AGENT_MCP_MISMATCH", null, true);
      }
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
    const result = inventoryCommands
      ? { text: "", evidence: await consumeInventoryStream(streamResponse, controller, inventoryCommands, (event) => {
          if (["tool_call", "tool_call_output", "session_status", "error"].includes(event.type)) {
            console.info("[BioTrip agent event]", { requestId, stage, sessionId, elapsedMs: Date.now() - startedAt, ...event });
          }
        }, inventoryAvailable) }
      : await consumeAgentStream(streamResponse, controller, stage, degradable, requestId, sessionId, startedAt, evidenceSatisfies, mobilityEvidence);
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
    if (error && typeof error === "object" && "inventoryEvidence" in error) Object.assign(failure, { inventoryEvidence: error.inventoryEvidence });
    throw failure;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    controller.abort();
    if (sessionId) {
      if (cleanupRegistered) {
        await queueSessionCleanup(sessionId).catch(() => undefined);
        log("cleanup_queued");
      } else {
        // A storage outage happened before any prompt was sent. Do not orphan
        // that newly-created session merely because the queue was unavailable.
        const cleanup = await deleteBailianSession(config, sessionId);
        log(cleanup.confirmed ? "cleanup_completed" : "cleanup_failed", { status: cleanup.status });
      }
    }
  }
}

function parseLocalServices(text: string, sourceUrls: string[]): Pick<LocalResearch, "services" | "unverifiedCount"> {
  const parsed = parseJsonText(text);
  const list = Array.isArray(parsed.services) ? parsed.services : [];
  const verified = new Set(sourceUrls);
  let unverifiedCount = 0;
  const services = list.filter(isRecord).slice(0, 6).map((item) => {
    const sourceUrl = safeHttpsUrl(item.source_url);
    if (!sourceUrl || typeof item.name !== "string" || typeof item.kind !== "string" ||
      typeof item.detail !== "string" || typeof item.source !== "string" || !verified.has(sourceUrl)) {
      unverifiedCount += 1;
      return null;
    }
    return {
      name: item.name.slice(0, 180), kind: item.kind.slice(0, 80),
      detail: item.detail.slice(0, 500), source: item.source.slice(0, 160), sourceUrl,
    };
  }).filter((item): item is LocalService => item !== null);
  return { services, unverifiedCount };
}

/**
 * Bailian Managed Agents provider — the transport the competition requires.
 *
 * Inventory uses the official Skill and reads actual tool output. Composition
 * waits for all independent stages and receives their granted context once.
 */
export function createAgentProvider(config: BailianConfig): PlanningProvider {
  const target = (kind: AgentKind) => {
    if (kind === "mobility") {
      if (!config.mobilityAgentId || !config.mobilityEnvironmentId || !config.mobilityMcpServerId) return null;
      return { agentId: config.mobilityAgentId, environmentId: config.mobilityEnvironmentId, title: "BioTrip 高德出行顾问", requireMcpServerId: config.mobilityMcpServerId };
    }
    if (kind === "insight") {
      if (!config.insightAgentId || !config.insightEnvironmentId) return null;
      return { agentId: config.insightAgentId, environmentId: config.insightEnvironmentId, title: "BioTrip 身体信号解读", requireNoTools: true };
    }
    if (kind === "local") {
      if (!config.localInfoAgentId || !config.localInfoEnvironmentId) return null;
      return { agentId: config.localInfoAgentId, environmentId: config.localInfoEnvironmentId, title: "BioTrip 目的地服务检索" };
    }
    if (kind === "compose") {
      const environmentId = config.composeEnvironmentId || config.insightEnvironmentId || config.environmentId;
      if (!config.composeAgentId || !environmentId) return null;
      return { agentId: config.composeAgentId, environmentId, title: "BioTrip 已核验来源行程编排", requireNoTools: true };
    }
    return { agentId: config.agentId, environmentId: config.environmentId, title: "BioTrip 实时旅行编排", vaultIds: config.flyaiVaultId ? [config.flyaiVaultId] : [] };
  };

  return {
    id: "managed_agent",
    assertConfigured() {
      if (!target("compose")) throw new PlannerError("compose_plan", "agent_config", 503, "COMPOSE_AGENT_NOT_CONFIGURED");
      if (!config.agentId || !config.environmentId || !config.flyaiVaultId || !target("local")) {
        throw new Error("Managed Agents are not configured.");
      }
    },

    async mobility(ctx: StageContext) {
      const mobility = target("mobility");
      if (!mobility) throw new PlannerError("mobility", "agent_config", 503, "MOBILITY_AGENT_NOT_CONFIGURED", null, true);
      const legs = mobilityLegs(ctx);
      if (!legs.length) throw new PlannerError("mobility", "route_scope", 422, "NO_ROUTABLE_LEG", null, true);
      const city = ctx.input.trip!.destinationCity;
      const collector = createMobilityEvidence(city, legs);
      const result = await runAgentSession(config, "mobility", mobility, mobilityPrompt(city, legs), STAGE_BY_NAME.mobility.budgetMs,
        true, ctx.signal, ctx.requestId, ctx.progress, () => true, undefined, ctx.sessionCreated, undefined, collector);
      return { routes: result.routes ?? [], requestedLegs: legs.length };
    },
    async healthInsight(ctx: StageContext): Promise<HealthInsight> {
      const insight = target("insight");
      if (!insight) throw new PlannerError("health_insight", "agent_config", 503, "HEALTH_AGENT_NOT_CONFIGURED", null, true);
      const result = await runAgentSession(config, "health_insight", insight, healthInsightPrompt(ctx), STAGE_BY_NAME.health_insight.budgetMs, true,
        ctx.signal, ctx.requestId, ctx.progress, () => true, undefined, ctx.sessionCreated);
      const parsed = parseJsonText(result.text);
      const pace = parsed.walking_pace;
      const breaks = parsed.break_frequency;
      if (!(typeof pace === "string" && ["reduced", "usual", "flexible"].includes(pace)) ||
          !(typeof breaks === "string" && ["frequent", "usual", "optional"].includes(breaks))) {
        throw new PlannerError("health_insight", "agent_output", 502, "INVALID_HEALTH_INSIGHT", null, true);
      }
      return {
        ...abstractHealth(parsed),
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
      const result = await runAgentSession(config, "local_research", local, localResearchPrompt(ctx), STAGE_BY_NAME.local_research.budgetMs, true,
        ctx.signal, ctx.requestId, ctx.progress, (evidence) => evidence.successfulWebSearches > 0, undefined, ctx.sessionCreated);
      return { ...parseLocalServices(result.text, result.evidence.sourceUrls), searches: result.evidence.successfulWebSearches };
    },

    async flyaiInventory(ctx: StageContext): Promise<FlyaiInventory> {
      const travel = target("travel");
      if (!travel?.vaultIds?.length) {
        throw new PlannerError("flyai_inventory", "agent_config", 503, "FLYAI_VAULT_NOT_CONFIGURED", null, false);
      }
      const { commands, unsearchedCategories } = skillInventoryQueries(ctx);

      try {
        // Leave part of the stage budget for one bounded Worker fallback.
        const result = await runAgentSession(config, "flyai_inventory", travel, flyaiInventoryPrompt(ctx, commands), 50_000, false,
          ctx.signal, ctx.requestId, ctx.progress, (evidence) => evidence.successfulFlyaiSearches > 0, commands, ctx.sessionCreated, ctx.inventoryAvailable);
        return {
          sources: result.evidence.flyaiSources,
          searches: result.evidence.successfulFlyaiSearches,
          failedSearches: 0,
          failedCategories: [...new Set([...unsearchedCategories, ...result.evidence.emptyFlyaiCategories])],
          executor: "agent_skill",
          receipts: result.evidence.queryReceipts,
        };
      } catch (error) {
        if (ctx.signal.aborted || error instanceof PlannerError && error.code === "CLIENT_DISCONNECTED") throw error;
        // A failed tool call, missing evidence or invalid agent output can all
        // prevent the Skill result from being accepted. Log the actual failure
        // code and use verified Worker searches; provenance records the executor.
        const failure = normalizePlannerError("flyai_inventory", "agent_inventory", error);
        console.info("[BioTrip flyai executor fallback]", {
          requestId: ctx.requestId,
          code: failure.code,
        });
        return recoverInventory(ctx, error, failure.code);
      }
    },

    async reliefInventory(ctx) {
      const travel = target("travel");
      const scoped = { ...ctx, searchIntents: ctx.searchIntents ?? reliefQueries(ctx).map(query => ({ kind: "keyword" as const, query: query.query })) };
      const { commands } = skillInventoryQueries(scoped);
      let fallbackReason: string | undefined;
      let originalError: unknown;
      if (travel?.vaultIds?.length) {
        try {
          const result = await runAgentSession(config, "relief_inventory", travel, flyaiInventoryPrompt(ctx, commands), 25_000, true,
            ctx.signal, ctx.requestId, ctx.progress, () => true, commands, ctx.sessionCreated);
          return { sources: result.evidence.flyaiSources, searches: result.evidence.successfulFlyaiSearches, failedSearches: 0,
            failedCategories: result.evidence.emptyFlyaiCategories, receipts: result.evidence.queryReceipts, executor: "agent_skill" };
        } catch (error) {
          ctx.signal.throwIfAborted();
          fallbackReason = normalizePlannerError("relief_inventory", "agent_inventory", error).code;
          originalError = error;
        }
      } else fallbackReason = "FLYAI_VAULT_NOT_CONFIGURED";
      return recoverInventory(scoped, originalError, fallbackReason);
    },

    async composeAdjustments(ctx, gathered) {
      const composer = target("compose");
      if (!composer) throw new PlannerError("compose_adjustments", "agent_config", 503, "COMPOSE_AGENT_NOT_CONFIGURED", null, true);
      const result = await runAgentSession(config, "compose_adjustments", composer, adjustmentPrompt(ctx, gathered), 45_000, true,
        ctx.signal, ctx.requestId, ctx.progress, () => true, undefined, ctx.sessionCreated);
      return parseJsonText(result.text);
    },

    async composePlan(ctx: StageContext, gathered: GatheredResults): Promise<ComposedPlan> {
      const composer = target("compose");
      if (!composer) throw new PlannerError("compose_plan", "agent_config", 503, "COMPOSE_AGENT_NOT_CONFIGURED", null, false);
      // The inventory is already verified, so composition uses those sources
      // without spending another search call.
      const result = await runAgentSession(config, "compose_plan", composer, composePlanPrompt(ctx, gathered), STAGE_BY_NAME.compose_plan.budgetMs, false,
        ctx.signal, ctx.requestId, ctx.progress, () => true, undefined, ctx.sessionCreated);
      const parsed = parseJsonText(result.text);
      const body = isRecord(parsed.plan) ? parsed.plan : parsed;
      const rows = Array.isArray(body.itinerary) ? body.itinerary.filter(isRecord) : [];
      console.info("[BioTrip composition shape]", {
        requestId: ctx.requestId,
        textLength: result.text.length,
        summaryPresent: typeof body.summary === "string" && Boolean(body.summary.trim()),
        reasonPresent: typeof body.reason === "string" && Boolean(body.reason.trim()),
        adjustmentsArray: Array.isArray(body.adjustments),
        itineraryRows: rows.length,
        detailRows: rows.filter((item) => typeof item.detail === "string").length,
        datedRows: rows.filter((item) => typeof item.date === "string").length,
        fixedMatches: ctx.fixedItems.filter((fixed) => rows.some((item) => item.fixed === true && item.time === fixed.time && item.name === fixed.name && (!fixed.date || item.date === fixed.date))).length,
        fixedRequested: ctx.fixedItems.length,
      });
      const plan = parsePlan(result.text, ctx.fixedItems);
      // Both transports request source_index references for supplied inventory.
      // Bind from the raw output because parsePlan only normalises URL places.
      return validateComposedPlan(bindPlanPlaces(plan, result.text, gathered.inventory.sources, ctx.requestId), ctx);
    },
  };
}

/** Verified Worker searches when the Skill result cannot be accepted. */
async function recoverInventory(ctx: StageContext, error: unknown, fallbackReason: string): Promise<FlyaiInventory> {
  const partial = error && typeof error === "object" && "inventoryEvidence" in error ? error.inventoryEvidence as ToolEvidence : null;
  const selection = skillInventoryQueries(ctx);
  const completed = new Set((partial?.queryReceipts ?? []).filter(receipt => ["completed", "empty"].includes(receipt.state)).map(receipt => receipt.queryKey));
  // An observed call without its output may already have reached the provider.
  // Keep it unknown instead of issuing the same potentially billed query again.
  const unknown = new Set((partial?.queryReceipts ?? []).filter(receipt => receipt.state === "unknown").map(receipt => receipt.queryKey));
  const unknownCategories = selection.queries.filter(query => unknown.has(query.queryKey)).map(query => query.category);
  const missing = selection.queries.filter(query => !completed.has(query.queryKey) && !unknown.has(query.queryKey));
  // Cap application-observed attempts, including failed Skill calls. This
  // cannot account for retries hidden inside the managed upstream runtime.
  const remaining = missing.slice(0, Math.max(0, 4 - (partial?.flyaiSearchCalls ?? 0)));
  const unsearched = [...unknownCategories, ...missing.slice(remaining.length).map(query => query.category)];
  const direct = remaining.length ? await flyaiInventory(ctx.signal, ctx.input.trip!, ctx.timing.arrivalDate, ctx.inventoryAvailable,
    { queries: remaining, unsearchedCategories: [...selection.unsearchedCategories, ...unsearched] }, true)
    : { sources: [], searches: 0, failedSearches: missing.length, failedCategories: [...selection.unsearchedCategories, ...unsearched], receipts: [] };
  const sources = [...new Map([...(partial?.flyaiSources ?? []), ...direct.sources].map(source => [source.id ?? source.url, source])).values()].slice(0, 30);
  return { ...direct, sources, searches: (partial?.successfulFlyaiSearches ?? 0) + direct.searches,
    failedCategories: [...new Set([...(partial?.emptyFlyaiCategories ?? []), ...direct.failedCategories])],
    receipts: [...(partial?.queryReceipts ?? []), ...(direct.receipts ?? [])], executor: "worker", fallbackReason };
}

function fallbackBasis(ctx: StageContext): HealthBasis {
  return ctx.isNearOrOngoingTrip && (ctx.input.selfReport?.fatigue != null || ctx.input.selfReport?.subjectiveStress != null)
    ? "self_report" : "preferences_only";
}
