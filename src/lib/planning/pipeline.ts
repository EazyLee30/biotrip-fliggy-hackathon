import type { FlyaiSource } from "@/lib/flyai";
import type { PlanProgress } from "@/lib/plan-response";
import { inventoryRecommendations, localRecommendations, type PlanRecommendation, type PlanRecommendations } from "@/lib/planning-recommendations";
import { getRecentWhoopMetrics, readWhoopTokens, WhoopReauthorizationRequiredError } from "@/lib/whoop-core";
import type { PlannerInput, ScheduleItem } from "@/lib/planner-input";
import {
  buildStageInput,
  normalizePlannerError,
  PlannerError,
  type ComposedPlan,
  type FlyaiInventory,
  type GatheredResults,
  type HealthBasis,
  type HealthInsight,
  type LocalResearch,
  type PlanStage,
  type StageContext,
  type TripTiming,
} from "./contract";
import { PLAN_BUDGET_MS, STAGE_BY_NAME } from "./stages";
import { destinationVisuals } from "../destination-visuals";
import { resolvePlanningProvider } from "./providers";

/** How each stage actually behaved, so the interface can be honest about it. */
export type StageReport = {
  stage: PlanStage;
  label: string;
  status: "ok" | "skipped" | "degraded";
  /** A short, user-safe reason. Never contains prompts, tool output or metrics. */
  reason?: string;
  elapsedMs: number;
};

export type PlanningProvenance = {
  provider: "managed_agent" | "model_api";
  requestedAt: string;
  stages: StageReport[];
  health: { basis: HealthBasis; whoopUnavailable: boolean };
  local: { verified: boolean; reason?: string; unverifiedCount?: number };
  flyai: { searches: number; failedSearches: number; failedCategories: string[]; sourceCount: number; compositionSourceCount?: number; recommendedSourceCount?: number; executor: "agent_skill" | "worker"; fallbackReason?: string };
  memory: { applied: boolean; source: "learned" | "profile" | "none"; noteCount: number };
};

export type PlanningOutcome = {
  destinationCity?: string;
  pois?: FlyaiSource[];
  health: HealthInsight | null;
  local: LocalResearch | null;
  inventory: FlyaiInventory;
  plan: ComposedPlan;
  provenance: PlanningProvenance;
};

export type MemoryUsage = { applied: boolean; source: "learned" | "profile" | "none"; noteCount: number };

export type RunPlanningRequest = {
  accountId: string;
  input: PlannerInput;
  timing: TripTiming;
  fixedItems: ScheduleItem[];
  includeWhoop: boolean;
  isNearOrOngoingTrip: boolean;
  requestId: string;
  signal: AbortSignal;
  progress: (event: PlanProgress) => void;
  /** Public sources only, emitted as soon as each independent retrieval completes. */
  recommendations?: (event: PlanRecommendations) => void;
  memory: MemoryUsage;
  sessionCreated?: StageContext["sessionCreated"];
  checkpoint?: <T>(stage: PlanStage, run: () => Promise<T>) => Promise<T>;
};

function toPlannerError(stage: PlanStage, error: unknown) {
  return normalizePlannerError(stage, "pipeline", error, STAGE_BY_NAME[stage].degradable);
}

function derivedBasis(input: PlannerInput, isNearOrOngoingTrip: boolean, hasWhoop: boolean): HealthBasis {
  if (hasWhoop) return "whoop_recent";
  if (isNearOrOngoingTrip && (input.fatigue !== null || input.subjectiveStress !== null)) return "self_report";
  return "preferences_only";
}

const LOCAL_SERVICE_KINDS = new Set(["local_food", "relaxation", "onsen", "massage", "medical_info"]);
const EMPTY_INVENTORY: FlyaiInventory = { sources: [], searches: 0, failedSearches: 0, failedCategories: [], executor: "worker" };

/**
 * Runs the whole plan.
 *
 * This is the only orchestration implementation in the codebase. It owns stage
 * order, per-stage budgets, abort propagation, degradation policy, progress
 * reporting and provenance. Providers only translate their own transport.
 */
export async function runPlanning(request: RunPlanningRequest): Promise<PlanningOutcome> {
  const { accountId, input, timing, signal, requestId, progress } = request;
  const provider = resolvePlanningProvider();
  provider.assertConfigured();

  const reports: StageReport[] = [];
  const controller = new AbortController();
  const planSignal = AbortSignal.any([signal, controller.signal, AbortSignal.timeout(PLAN_BUDGET_MS)]);
  planSignal.throwIfAborted();

  const selfReport = {
    fatigue: input.fatigue,
    subjectiveStress: input.subjectiveStress,
    ...(input.bodyFeedback ? { bodyFeedback: input.bodyFeedback } : {}),
    ...(input.moodFeedback ? { moodFeedback: input.moodFeedback } : {}),
  };
  const preferences = {
    intention: input.intention,
    colorTone: input.colorTone,
    ambientPreferences: input.ambientPreferences,
    savedMemory: input.profileMemoryNotes,
    planningStyle: input.trip.planningStyle,
  };

  // Only health waits for WHOOP; destination and inventory searches can start
  // immediately. Raw records are copied only into the tool-free health stage.
  let healthMetrics: unknown;
  let whoopUnavailable = false;
  const readHealth = async (stageSignal: AbortSignal) => {
    if (request.includeWhoop && request.isNearOrOngoingTrip && await readWhoopTokens(accountId).catch(() => null)) {
      stageSignal.throwIfAborted();
      try {
        healthMetrics = await getRecentWhoopMetrics(accountId, { signal: stageSignal });
      } catch (error) {
        if (!(error instanceof WhoopReauthorizationRequiredError)) throw error;
        whoopUnavailable = true;
      }
    }
    stageSignal.throwIfAborted();
  };

  const contextFor = (stage: PlanStage): StageContext => ({
    input: buildStageInput(STAGE_BY_NAME[stage].grants, {
      trip: input.trip, preferences, selfReport, healthMetrics,
    }),
    accountId,
    signal: planSignal,
    requestId,
    progress,
    sessionCreated: request.sessionCreated,
    ...(stage === "flyai_inventory" ? { inventoryAvailable: (sources: readonly FlyaiSource[]) => emitRecommendations("flyai_inventory", inventoryRecommendations(sources)) } : {}),
    timing,
    fixedItems: request.fixedItems,
    includeWhoop: request.includeWhoop,
    isNearOrOngoingTrip: request.isNearOrOngoingTrip,
  });

  /** Runs one stage under its own budget, applying the degradation policy. */
  const execute = async <T>(stage: PlanStage, run: (ctx: StageContext) => Promise<T>, fallback: () => T): Promise<T> => {
    const policy = STAGE_BY_NAME[stage];
    const startedAt = Date.now();
    const stageSignal = AbortSignal.any([planSignal, AbortSignal.timeout(policy.budgetMs)]);
    const ctx = { ...contextFor(stage), signal: stageSignal };
    progress({ stage, status: "running", message: `${policy.label}进行中` });
    try {
      stageSignal.throwIfAborted();
      const result = await (request.checkpoint ? request.checkpoint(stage, () => run(ctx)) : run(ctx));
      stageSignal.throwIfAborted();
      reports.push({ stage, label: policy.label, status: "ok", elapsedMs: Date.now() - startedAt });
      progress({ stage, status: "ok", elapsedMs: Date.now() - startedAt, message: `${policy.label}已完成` });
      return result;
    } catch (error) {
      const failure = toPlannerError(stage, error);
      // A degradable stage reports honestly and planning continues. A required
      // stage fails the request: nothing downstream may be invented.
      if (planSignal.aborted) throw failure;
      if (!policy.degradable) {
        controller.abort(failure);
        throw failure;
      }
      reports.push({
        stage,
        label: policy.label,
        status: "degraded",
        reason: `${policy.label}本次未核验（${failure.code}）`,
        elapsedMs: Date.now() - startedAt,
      });
      progress({ stage, status: "degraded", elapsedMs: Date.now() - startedAt, message: `${policy.label}本次未核验，将继续用已核验来源编排` });
      return fallback();
    }
  };

  progress({ stage: "preparing", message: "正在整理本次行程信息" });

  const localRequested = input.trip.requestedServices.some((service) => LOCAL_SERVICE_KINDS.has(service));
  const published = new Set<string>();
  const emitRecommendations = (stage: PlanRecommendations["stage"], items: PlanRecommendation[]) => {
    if (planSignal.aborted || !items.length || !request.recommendations) return;
    const fresh = items.filter(item => !published.has(`${stage}:${item.url}`));
    if (!fresh.length) return;
    try {
      request.recommendations({ stage, destination: input.trip.destinationCity, retrievedAt: new Date().toISOString(), items: fresh });
      for (const item of fresh) published.add(`${stage}:${item.url}`);
    } catch { /* A preview transport failure must not invalidate the generated itinerary. */ }
  };
  if (!localRequested) {
    reports.push({ stage: "local_research", label: STAGE_BY_NAME.local_research.label, status: "skipped", reason: "本次未请求当地服务资料", elapsedMs: 0 });
    progress({ stage: "local_research", status: "skipped", elapsedMs: 0, message: "本次未请求当地服务资料，已跳过" });
  }

  // All three inputs are independent. Only the composing stage waits for them.
  const preparatory = [
    execute<HealthInsight | null>(
      "health_insight",
      async (ctx) => {
        await readHealth(ctx.signal);
        return provider.healthInsight({ ...ctx, input: contextFor("health_insight").input });
      },
      () => null,
    ),
    localRequested ? execute<LocalResearch | null>(
      "local_research",
      (ctx) => provider.localResearch(ctx),
      () => null,
    ).then((result) => { if (result) emitRecommendations("local_research", localRecommendations(result.services)); return result; }) : Promise.resolve(null),
    execute<FlyaiInventory>("flyai_inventory", async (ctx) => {
      const result = await provider.flyaiInventory(ctx);
      if (!result.sources.length) {
        throw new PlannerError("flyai_inventory", "flyai_search", 502, "NO_VERIFIED_FLYAI_SOURCE");
      }
      return result;
    }, () => EMPTY_INVENTORY).then((result) => { emitRecommendations("flyai_inventory", inventoryRecommendations(result.sources)); return result; }),
    execute<FlyaiSource[]>("poi_catalog", async (ctx) => (await destinationVisuals(accountId, input.trip.destinationCity, ctx.signal)).sources, () => []),
  ] as const;
  const [health, local, inventory, pois] = await Promise.all(preparatory).catch(async (error: unknown) => {
    controller.abort(error);
    await Promise.allSettled(preparatory);
    throw error;
  });
  if (localRequested && local && (!local.services.length || local.unverifiedCount)) {
    const report = reports.find((item) => item.stage === "local_research");
    if (report) {
      report.status = "degraded";
      report.reason = local.services.length
        ? `保留 ${local.services.length} 条已核验资料，排除 ${local.unverifiedCount} 条未核验资料`
        : "本次未检索到可核验的当地服务资料";
      progress({ stage: "local_research", status: "degraded", elapsedMs: report.elapsedMs, message: report.reason });
    }
  }
  const gathered: GatheredResults = { health, local, inventory, pois };
  const plan = await execute(
    "compose_plan",
    (ctx) => provider.composePlan(ctx, gathered),
    () => { throw new PlannerError("compose_plan", "pipeline", 502, "PLANNING_RUNTIME_ERROR"); },
  );

  const localReport = reports.find((report) => report.stage === "local_research");

  return {
    destinationCity: input.trip.destinationCity,
    pois,
    health,
    local,
    inventory,
    plan,
    provenance: {
      provider: provider.id,
      requestedAt: new Date().toISOString(),
      stages: Object.keys(STAGE_BY_NAME).flatMap((stage) => reports.filter((report) => report.stage === stage)),
      health: { basis: health?.basis ?? derivedBasis(input, request.isNearOrOngoingTrip, healthMetrics !== undefined), whoopUnavailable },
      local: {
        verified: Boolean(local?.services.length),
        ...(local?.unverifiedCount ? { unverifiedCount: local.unverifiedCount } : {}),
        ...(localRequested && !local?.services.length ? { reason: localReport?.reason ?? "目的地当地服务资料本次未核验" } : {}),
      },
      flyai: {
        searches: inventory.searches,
        failedSearches: inventory.failedSearches,
        failedCategories: inventory.failedCategories,
        sourceCount: inventory.sources.length,
        compositionSourceCount: Math.min(12, inventory.sources.length),
        recommendedSourceCount: plan.places.length,
        executor: inventory.executor,
        ...(inventory.fallbackReason ? { fallbackReason: inventory.fallbackReason } : {}),
      },
      memory: request.memory,
    },
  };
}

/** Exposed by the diagnostic endpoint so the stage contract is inspectable. */
export function planningStageTable() {
  return Object.values(STAGE_BY_NAME).map(({ name, label, budgetMs, grants, degradable, required }) =>
    ({ name, label, budgetMs, grants, degradable, required }));
}
