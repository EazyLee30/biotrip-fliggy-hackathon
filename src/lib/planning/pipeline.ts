import type { PlanProgress } from "@/lib/plan-response";
import { getRecentWhoopMetrics, readWhoopTokens, WhoopReauthorizationRequiredError } from "@/lib/whoop";
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
  local: { verified: boolean; reason?: string };
  flyai: { searches: number; failedSearches: number; failedCategories: string[]; sourceCount: number; executor: "agent_skill" | "worker" };
  memory: { applied: boolean; source: "learned" | "profile" | "none"; noteCount: number };
};

export type PlanningOutcome = {
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
  memory: MemoryUsage;
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
  const planSignal = AbortSignal.any([signal, AbortSignal.timeout(PLAN_BUDGET_MS)]);

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

  // WHOOP records are read once, before any stage runs, and are only ever
  // copied into the stage input of the stage that declares the grant.
  let healthMetrics: unknown;
  let whoopUnavailable = false;
  if (request.includeWhoop && request.isNearOrOngoingTrip && await readWhoopTokens(accountId).catch(() => null)) {
    try {
      healthMetrics = await getRecentWhoopMetrics(accountId);
    } catch (error) {
      // A revoked grant must not block the trip; planning continues from the
      // traveller's own self-report and the interface offers to reconnect.
      if (!(error instanceof WhoopReauthorizationRequiredError)) throw error;
      whoopUnavailable = true;
    }
  }

  const contextFor = (stage: PlanStage): StageContext => ({
    input: buildStageInput(STAGE_BY_NAME[stage].grants, {
      trip: input.trip, preferences, selfReport, healthMetrics,
    }),
    accountId,
    signal: planSignal,
    requestId,
    progress,
    timing,
    fixedItems: request.fixedItems,
    includeWhoop: request.includeWhoop,
    isNearOrOngoingTrip: request.isNearOrOngoingTrip,
  });

  /** Runs one stage under its own budget, applying the degradation policy. */
  const execute = async <T>(stage: PlanStage, run: () => Promise<T>, fallback: () => T): Promise<T> => {
    const policy = STAGE_BY_NAME[stage];
    const startedAt = Date.now();
    progress({ stage, message: `${policy.label}进行中` });
    try {
      const result = await run();
      reports.push({ stage, label: policy.label, status: "ok", elapsedMs: Date.now() - startedAt });
      return result;
    } catch (error) {
      const failure = toPlannerError(stage, error);
      // A degradable stage reports honestly and planning continues. A required
      // stage fails the request: nothing downstream may be invented.
      if (!policy.degradable) throw failure;
      reports.push({
        stage,
        label: policy.label,
        status: "degraded",
        reason: `${policy.label}本次未核验（${failure.code}）`,
        elapsedMs: Date.now() - startedAt,
      });
      progress({ stage, message: `${policy.label}本次未核验，将继续用已核验来源编排` });
      return fallback();
    }
  };

  progress({ stage: "preparing", message: "正在整理本次行程信息" });

  // The two advisory stages are independent, so they run concurrently.
  const advisory = await Promise.allSettled([
    execute<HealthInsight | null>(
      "health_insight",
      () => provider.healthInsight(contextFor("health_insight")),
      () => null,
    ),
    execute<LocalResearch | null>(
      "local_research",
      () => provider.localResearch(contextFor("local_research")),
      () => null,
    ),
  ]);
  for (const outcome of advisory) {
    if (outcome.status === "rejected") {
      // Attribute the failure to the stage that produced it, not to health by default.
      throw toPlannerError(advisory[0].status === "rejected" && outcome === advisory[0] ? "health_insight" : "local_research", outcome.reason);
    }
  }
  const health = advisory[0].status === "fulfilled" ? advisory[0].value : null;
  const local = advisory[1].status === "fulfilled" ? advisory[1].value : null;

  // Inventory is required, and composition depends on it, so these stay
  // sequential: the composer may only reference sources that already exist.
  const inventory = await execute<FlyaiInventory>(
    "flyai_inventory",
    () => provider.flyaiInventory(contextFor("flyai_inventory")),
    () => EMPTY_INVENTORY,
  );
  const gathered: GatheredResults = { health, local, inventory };
  const plan = await execute(
    "compose_plan",
    () => provider.composePlan(contextFor("compose_plan"), gathered),
    () => { throw new PlannerError("compose_plan", "pipeline", 502, "PLANNING_RUNTIME_ERROR"); },
  );

  const localRequested = input.trip.requestedServices.some((service) => LOCAL_SERVICE_KINDS.has(service));
  const localReport = reports.find((report) => report.stage === "local_research");

  return {
    health,
    local,
    inventory,
    plan,
    provenance: {
      provider: provider.id,
      requestedAt: new Date().toISOString(),
      stages: reports,
      health: { basis: health?.basis ?? derivedBasis(input, request.isNearOrOngoingTrip, healthMetrics !== undefined), whoopUnavailable },
      local: {
        verified: Boolean(local),
        ...(localRequested && !local ? { reason: localReport?.reason ?? "目的地当地服务资料本次未核验" } : {}),
      },
      flyai: {
        searches: inventory.searches,
        failedSearches: inventory.failedSearches,
        failedCategories: inventory.failedCategories,
        sourceCount: inventory.sources.length,
        executor: inventory.executor,
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
