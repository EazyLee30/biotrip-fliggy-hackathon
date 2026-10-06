import type { PlannerInput, ScheduleItem } from "@/lib/planner-input";
import type { PlanProgress } from "@/lib/plan-response";
import type { FlyaiSource } from "@/lib/flyai";

/**
 * One planning pipeline, two interchangeable Bailian transports.
 *
 * A stage declares the data it is allowed to receive. `buildStageInput` is the
 * only place stage inputs are constructed, so a stage physically cannot read a
 * grant it did not declare — the privacy boundary is enforced by the type
 * system and by `grants.test.mjs`, not by prose in a prompt.
 */

export type PlanStage =
  | "health_insight"
  | "local_research"
  | "flyai_inventory"
  | "compose_plan"
  | "relief_inventory"
  | "mobility"
  | "compose_adjustments"
  | "poi_catalog";

export const PLAN_STAGES: readonly PlanStage[] = [
  "health_insight",
  "local_research",
  "flyai_inventory",
  "poi_catalog",
  "compose_plan",
];

/**
 * `health_metrics` carries raw WHOOP records and is the most sensitive grant in
 * the system. Only `health_insight` declares it, and that stage's agent is
 * configured with no tools at all.
 */
export type DataGrant =
  | "trip"
  | "preferences"
  | "self_report"
  | "health_metrics"
  | "itinerary";

export type StagePolicy = {
  name: PlanStage;
  /** Chinese label used in user-facing diagnostics. */
  label: string;
  budgetMs: number;
  grants: readonly DataGrant[];
  /** A failure is reported as unverified and planning continues. */
  degradable: boolean;
  /** A failure fails the whole plan. Load-bearing stages never fabricate. */
  required: boolean;
};

export type HealthBasis = "whoop_recent" | "self_report" | "preferences_only";

export type HealthInsight = {
  walkingPace: "reduced" | "usual" | "flexible";
  breakFrequency: "frequent" | "usual" | "optional";
  sensoryFilters: string[];
  basis: HealthBasis;
  /** True when WHOOP was connected but its grant is no longer usable. */
  whoopUnavailable: boolean;
  energy?: import("../adjust/types").Energy;
  needs?: import("../adjust/types").Need[];
};

export type LocalService = {
  name: string;
  kind: string;
  detail: string;
  source: string;
  sourceUrl: string;
};

export type LocalResearch = {
  services: LocalService[];
  searches: number;
  unverifiedCount?: number;
};

export type FlyaiInventory = {
  sources: FlyaiSource[];
  searches: number;
  failedSearches: number;
  failedCategories: string[];
  /** Original Skill failure, retained when the verified Worker fallback runs. */
  fallbackReason?: string;
  /**
   * Who actually ran the searches. The competition requires the Bailian agent to
   * use the official FlyAI Skill, so `agent_skill` is the intended path; when the
   * sandbox cannot reach the signing bridge the Worker performs the identical
   * read-only searches itself. Both return verified FlyAI data — only the
   * executor differs, and the interface reports which one ran.
   */
  executor: "agent_skill" | "worker";
};

export type ComposedPlan = {
  headline: string;
  summary: string;
  reason: string;
  adjustments: string[];
  itinerary: import("../journey-types").ItineraryActivity[];
  places: Array<{ name: string; category: string; reason: string; source: string; url: string; imageUrl?: string }>;
};

/** Everything a stage may be shown, already narrowed to its declared grants. */
export type StageInput = {
  trip?: PlannerInput["trip"];
  preferences?: {
    intention: string;
    colorTone: string;
    ambientPreferences: string[];
    savedMemory: string;
    planningStyle: PlannerInput["trip"]["planningStyle"];
  };
  selfReport?: {
    fatigue: number | null;
    subjectiveStress: number | null;
    bodyFeedback?: string;
    moodFeedback?: string;
  };
  healthMetrics?: unknown;
  itinerary?: Array<{ id: string; date: string; time: string; name: string; fixed: boolean }>;
};

export type StageContext = {
  input: StageInput;
  accountId: string;
  signal: AbortSignal;
  requestId: string;
  progress: (event: PlanProgress) => void;
  sessionCreated?: (stage: PlanStage, sessionId: string) => Promise<void>;
  /** Public verified inventory batches; never model text or health records. */
  inventoryAvailable?: (sources: readonly FlyaiSource[]) => void;
  /** Derived facts shared by every stage, already validated. */
  timing: TripTiming;
  fixedItems: ScheduleItem[];
  includeWhoop: boolean;
  isNearOrOngoingTrip: boolean;
};

export type TripTiming = {
  departureInstant: Date;
  arrivalInstant: Date;
  timezoneShiftMinutes: number;
  travelHours: number;
  arrivalDate: string;
  endDate: string;
  days: number;
  /** Derived wall-clock strings, so no prompt implies the traveller chose them. */
  departureLocal: string;
  arrivalLocal: string;
};

/**
 * The single error taxonomy. Providers translate their own transport errors at
 * the boundary so the pipeline only ever reasons about this shape.
 */
export class PlannerError extends Error {
  constructor(
    readonly stage: PlanStage,
    readonly operation: string,
    readonly status: number,
    readonly code: string,
    readonly requestId: string | null = null,
    /** Set when the stage may continue with a reduced result. */
    readonly degradable = false,
  ) {
    super(code);
    this.name = "PlannerError";
  }
}

/**
 * Duck-typed rather than `instanceof`: values crossing a Worker isolate, a
 * bundle boundary or a vm context fail prototype checks, and a misclassified
 * provider error would either hide a real failure or wrongly degrade a
 * required stage.
 */
function isPlannerError(value: unknown): value is PlannerError {
  return typeof value === "object" && value !== null &&
    typeof (value as PlannerError).stage === "string" &&
    typeof (value as PlannerError).code === "string" &&
    typeof (value as PlannerError).status === "number";
}

function errorName(value: unknown) {
  return typeof value === "object" && value !== null && typeof (value as Error).name === "string"
    ? (value as Error).name : "";
}

/** Provider errors carry their own `code`; that reason must survive normalisation. */
function providerCode(value: unknown) {
  if (typeof value !== "object" || value === null) return null;
  const code = (value as { code?: unknown }).code;
  return typeof code === "string" && /^[A-Za-z0-9_.:-]{1,64}$/.test(code) ? code : null;
}

export function normalizePlannerError(
  stage: PlanStage,
  operation: string,
  error: unknown,
  degradable = false,
): PlannerError {
  if (isPlannerError(error)) return error;
  const name = errorName(error);
  if (name === "TimeoutError" || name === "AbortError") {
    return new PlannerError(stage, operation, 504, "UPSTREAM_TIMEOUT", null, degradable);
  }
  // Keep the upstream reason: "FLYAI_AUTH_ERROR" tells an operator what to fix,
  // a generic runtime code tells them nothing.
  const preserved = providerCode(error);
  return new PlannerError(stage, operation, 502, preserved ?? "PLANNING_RUNTIME_ERROR", null, degradable);
}

/**
 * Builds the object a stage sees. This is the enforcement point of the whole
 * data boundary: an undeclared grant is never copied in, so no prompt can leak
 * what a stage was not given.
 */
export function buildStageInput(
  grants: readonly DataGrant[],
  gathered: {
    trip: PlannerInput["trip"];
    preferences: StageInput["preferences"];
    selfReport: StageInput["selfReport"];
    healthMetrics?: unknown;
    itinerary?: StageInput["itinerary"];
  },
): StageInput {
  const input: StageInput = {};
  for (const grant of grants) {
    if (grant === "itinerary") input.itinerary = gathered.itinerary;
    if (grant === "trip") input.trip = gathered.trip;
    if (grant === "preferences") input.preferences = gathered.preferences;
    if (grant === "self_report") input.selfReport = gathered.selfReport;
    if (grant === "health_metrics" && gathered.healthMetrics !== undefined) {
      input.healthMetrics = gathered.healthMetrics;
    }
  }
  return input;
}

export type ProviderId = "managed_agent" | "model_api";

/**
 * Every transport implements the same four capabilities. The competition
 * requires Bailian Managed Agents, which is the primary implementation; the
 * plain model API is the cheaper fallback when agents are unavailable.
 */
export interface PlanningProvider {
  readonly id: ProviderId;
  /** Rejects early when the transport is not usable, e.g. missing credentials. */
  assertConfigured(): void;
  healthInsight(ctx: StageContext): Promise<HealthInsight>;
  localResearch(ctx: StageContext): Promise<LocalResearch>;
  flyaiInventory(ctx: StageContext): Promise<FlyaiInventory>;
  composePlan(ctx: StageContext, gathered: GatheredResults): Promise<ComposedPlan>;
  mobility?(ctx: StageContext): Promise<import("./mobility").MobilityResult>;
  reliefInventory?(ctx: StageContext): Promise<FlyaiInventory>;
  composeAdjustments?(ctx: StageContext, gathered: import("./adjust-pipeline").AdjustmentGathered): Promise<unknown>;
}

/** Stage outputs collected so far, handed to the composing stage. */
export type GatheredResults = {
  pois?: FlyaiSource[];
  health: HealthInsight | null;
  local: LocalResearch | null;
  inventory: FlyaiInventory;
};
