export type JourneyStatus = "draft" | "planned" | "active" | "completed";

/** How much walking a day should carry. Chosen once, applied to every day. */
export type PaceLevel = "gentle" | "balanced" | "active";

/** Recurring protections the traveller can switch on once and forget. */
export type Guardrails = {
  /** Schedule outdoor light soon after waking on trip days. */
  morningLight: boolean;
  /** Never auto-shift an existing reservation. */
  protectReservations: boolean;
  /** Insert quiet pauses at a regular interval. */
  sensoryBreaks: boolean;
};

export type JourneyTripDraft = {
  originCity?: string;
  destinationCity?: string;
  /** First and last day, `YYYY-MM-DD`. Clock times are derived, never collected. */
  departureDate?: string;
  departureTimezone?: string;
  destinationTimezone?: string;
  returnDate?: string;
  planningStyle?: "flexible" | "structured";
  paceLevel?: PaceLevel;
  guardrails?: Guardrails;
  itineraryText?: string;
  requestedServices?: string[];
  foodPreferences?: string;
};

/** A draft can be incomplete; the generation endpoint validates a complete input. */
export type JourneyDraft = {
  intention?: string;
  colorTone?: string;
  fatigue?: number | null;
  subjectiveStress?: number | null;
  ambientPreferences?: string[];
  bodyFeedback?: string;
  moodFeedback?: string;
  profileMemoryNotes?: string;
  consent?: boolean;
  trip?: JourneyTripDraft;
};

/**
 * Per-request provenance. Every capability records how it actually behaved so
 * the interface can distinguish verified results from stages that degraded, and
 * so a reviewer can audit which data reached which stage.
 */
export type JourneyProvenance = {
  provider: "managed_agent" | "model_api";
  requestedAt: string;
  stages: Array<{
    stage: string;
    label: string;
    status: "ok" | "skipped" | "degraded";
    reason?: string;
    elapsedMs: number;
  }>;
  health: { basis: "whoop_recent" | "self_report" | "preferences_only"; whoopUnavailable: boolean };
  local: { verified: boolean; reason?: string; unverifiedCount?: number };
  flyai: { searches: number; failedSearches: number; failedCategories: string[]; sourceCount: number; compositionSourceCount?: number; recommendedSourceCount?: number; executor: "agent_skill" | "worker"; fallbackReason?: string };
  memory: { applied: boolean; source: "learned" | "profile" | "none"; noteCount: number };
};

export type SourceKind = "fliggy_product" | "fliggy_poi" | "place_reference" | "topic_reference" | "reference";

/** What an activity is, so an adjustment can reason about it without re-reading prose. */
export type ActivityKind = "sight" | "meal" | "rest" | "relax" | "stay" | "experience" | "transit" | "other";
/** 1 seated · 2 light walking · 3 sustained walking. A planning density, never a health measure. */
export type ActivityEffort = 1 | 2 | 3;
export type MoveMode = "walk" | "transit" | "taxi" | "none";
/** How the traveller reaches this activity from the previous one. Figures exist only when a map tool returned them. */
export type ActivityMove = { mode: MoveMode; minutes?: number; km?: number; costCny?: number; basis?: "amap" | "unverified" };
export type ItineraryActivity = {
  id?: string; sourceUrl?: string; date?: string; time: string; name: string; detail: string; fixed: boolean;
  kind?: ActivityKind; effort?: ActivityEffort; durationMin?: number; move?: ActivityMove;
  /** Explicit traveller progress; a planned clock time alone is not proof of completion. */
  progress?: { state: ActivityState; updatedAt: string };
};
export type ActivityState = "planned" | "in_progress" | "completed" | "skipped";
export type BodyCheckIn = {
  id: string; journeyId: string; localDate: string; timezone: string; recordedAt: string;
  fatigue: number | null; stress: number | null; tags: import("./adjust/types").CheckInTag[];
  source: "self_report" | "adjustment_outcome";
};
export type AdjustmentOutcome = {
  id: string; adjustmentId: string; journeyId: string; recordedAt: string; localDate: string;
  feeling: "lighter" | "same" | "still_tired"; fatigue: number | null; stress: number | null; note: string;
};
export type AdjustmentRecord = {
  id: string; journeyId: string; jobId: string; appliedAt: string; localDate: string;
  beforeVersion: number; afterVersion: number; fatigueBefore: number | null;
  changes: Array<{ id: string; title: string; angle: import("./adjust/types").Angle; templates: import("./adjust/types").AdjustTemplate[] }>;
  outcome: AdjustmentOutcome | null;
};

/** Real photographs bound server-side from the same FlyAI record as their link; never model output. */
export type VisualRef = { imageUrl: string; name: string; url: string; kind: "poi" | "product" };
export type JourneyVisuals = { cover: VisualRef[]; images: Record<string, Omit<VisualRef, "url">> };

export type JourneyGeneratedPlan = {
  source: "live";
  retrievedAt: string;
  timezone: { shiftMinutes: number; travelHours: number };
  healthContext: {
    basis: "whoop_recent" | "self_report" | "preferences_only";
    provisional: boolean;
  };
  localServices: Array<{ sourceKind?: SourceKind; name: string; kind: string; detail: string; source: string; sourceUrl: string }>;
  plan: {
    headline: string;
    summary: string;
    reason: string;
    adjustments: string[];
    itinerary: ItineraryActivity[];
    places: Array<{ sourceKind?: SourceKind; name: string; category: string; reason: string; source: string; url: string; imageUrl?: string }>;
  };
  visuals?: JourneyVisuals;
  provenance?: JourneyProvenance;
  /** Manual changes retain the original generation provenance and retrieval time. */
  bodyAdjustment?: { id?: string; updatedAt: string; fatigueBefore: number | null; changes: string[] };
  manualAdjustment?: { id?: string; updatedAt: string; revision: number; operationCount: number };
};

export type Journey = {
  id: string;
  title: string;
  status: JourneyStatus;
  draft: JourneyDraft;
  plan: JourneyGeneratedPlan | null;
  /** False when preferences were edited after this plan was generated. */
  planCurrent: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

export type JourneyFeedbackInput = {
  adjustmentAt?: string;
  bodyFeedback?: string;
  moodFeedback?: string;
  fatigue?: number | null;
  subjectiveStress?: number | null;
  note?: string;
  remember?: boolean;
  memoryNote?: string;
};

export type JourneyFeedback = Omit<JourneyFeedbackInput, "remember" | "memoryNote"> & {
  id: string;
  journeyId: string;
  createdAt: string;
  remembered: boolean;
};

export type JourneyMemory = {
  id: string;
  journeyId: string;
  note: string;
  createdAt: string;
};
