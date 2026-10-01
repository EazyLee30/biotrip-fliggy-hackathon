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
  local: { verified: boolean; reason?: string };
  flyai: { searches: number; failedSearches: number; failedCategories: string[]; sourceCount: number; executor: "agent_skill" | "worker" };
  memory: { applied: boolean; source: "learned" | "profile" | "none"; noteCount: number };
};

export type JourneyGeneratedPlan = {
  source: "live";
  retrievedAt: string;
  timezone: { shiftMinutes: number; travelHours: number };
  healthContext: {
    basis: "whoop_recent" | "self_report" | "preferences_only";
    provisional: boolean;
  };
  localServices: Array<{ name: string; kind: string; detail: string; source: string; sourceUrl: string }>;
  plan: {
    headline: string;
    summary: string;
    reason: string;
    adjustments: string[];
    itinerary: Array<{ date?: string; time: string; name: string; detail: string; fixed: boolean }>;
    places: Array<{ name: string; category: string; reason: string; source: string; url: string }>;
  };
  provenance?: JourneyProvenance;
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
