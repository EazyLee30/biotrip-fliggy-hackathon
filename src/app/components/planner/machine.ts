import type { Journey, JourneyStatus } from "@/lib/journey-types";

/**
 * The journey lifecycle as data instead of conditionals.
 *
 * Views ask `machine.can.*` instead of re-deriving rules from
 * `status === "planned" && planCurrent`, so a transition rule is stated once and
 * every surface — buttons, empty states, hints, disabled tooltips — agrees.
 * The server remains the authority; this mirrors its rules so the interface
 * never offers an action the API would reject.
 */

export type CreateStep = 0 | 1 | 2 | 3;

export const CREATE_STEPS: ReadonlyArray<{ step: CreateStep; label: string }> = [
  { step: 0, label: "旅行意图" },
  { step: 1, label: "目的地与时间" },
  { step: 2, label: "节奏与连接" },
  { step: 3, label: "行程确认" },
];

const TRANSITIONS: Record<JourneyStatus, readonly JourneyStatus[]> = {
  draft: ["planned"],
  planned: ["active", "draft"],
  active: ["completed", "planned"],
  completed: [],
};

/** What the traveller may do right now, derived once and reused by every view. */
export type Capabilities = {
  /** The draft may still be edited. */
  canEdit: boolean;
  /** The draft is complete enough to send to the planning pipeline. */
  canGenerate: boolean;
  /** A generated, current plan is waiting to be started. */
  canStart: boolean;
  canReplan: boolean;
  canComplete: boolean;
  canRecordFeedback: boolean;
  canShare: boolean;
  canPlanNew: boolean;
  canDelete: boolean;
};

export type JourneyMachine = {
  status: JourneyStatus | null;
  label: string;
  /** Ordered lifecycle states, used for progress affordances. */
  phases: ReadonlyArray<{ status: JourneyStatus; label: string; done: boolean; current: boolean }>;
  can: Capabilities;
  /** The single most useful next action, or null when nothing is pending. */
  primary: { key: PrimaryAction; label: string } | null;
};

export type PrimaryAction =
  | "continue_draft"
  | "start"
  | "replan"
  | "complete"
  | "new_journey";

const STATUS_LABELS: Record<JourneyStatus, string> = {
  draft: "草稿", planned: "待出发", active: "旅途中", completed: "已完成",
};

const PHASE_ORDER: ReadonlyArray<JourneyStatus> = ["draft", "planned", "active", "completed"];

export function allowedTransitions(status: JourneyStatus | null): readonly JourneyStatus[] {
  return status ? TRANSITIONS[status] : [];
}

/** True when the traveller has a plan that reflects their current draft. */
export function hasCurrentPlan(journey: Journey | null): boolean {
  return Boolean(journey?.plan && journey.planCurrent);
}

export function journeyMachine(journey: Journey | null): JourneyMachine {
  const status = journey?.status ?? null;
  const current = hasCurrentPlan(journey);
  const travelling = status === "active";
  const finished = status === "completed";

  const can: Capabilities = {
    // Editing the draft once a current plan exists would invalidate it, so a
    // ready plan is changed through replanning instead. Editing while travelling
    // is blocked outright by the server and must never be offered.
    canEdit: !travelling && !finished && !current,
    canGenerate: !travelling && !finished,
    canStart: status === "planned" && current,
    canReplan: !finished && Boolean(journey?.plan),
    canComplete: travelling,
    canRecordFeedback: travelling || finished,
    canShare: Boolean(journey?.plan),
    canPlanNew: !journey || finished,
    canDelete: Boolean(journey),
  };

  let primary: JourneyMachine["primary"] = null;
  if (finished) primary = { key: "new_journey", label: "创建下一段旅程" };
  else if (travelling) primary = { key: "replan", label: "更新行程" };
  else if (status === "planned" && current) primary = { key: "start", label: "开始这段旅程" };
  else if (status === "draft") primary = { key: "continue_draft", label: "继续完善旅程" };
  else if (!journey) primary = { key: "new_journey", label: "创建旅程" };

  const phaseIndex = status ? PHASE_ORDER.indexOf(status) : -1;
  return {
    status,
    label: status ? STATUS_LABELS[status] : "尚未开始",
    phases: PHASE_ORDER.map((phase, index) => ({
      status: phase,
      label: STATUS_LABELS[phase],
      done: phaseIndex > index,
      current: phaseIndex === index,
    })),
    can,
    primary,
  };
}

/**
 * Whether the draft should be persisted in the background. The traveller never
 * presses save: a debounce writes the draft whenever it changed and editing is
 * still allowed, so navigating away or losing the tab loses nothing.
 */
export function shouldAutoSave(state: {
  dirty: boolean;
  saving: boolean;
  submitting: boolean;
  canEdit: boolean;
}): boolean {
  return state.dirty && !state.saving && !state.submitting && state.canEdit;
}