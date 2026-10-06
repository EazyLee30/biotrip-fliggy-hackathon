import type { ActivityEffort, ActivityKind, MoveMode } from "../journey-types";

/**
 * The adjustment vocabulary.
 *
 * An adjustment is never a rewritten itinerary. It is a small set of proposals,
 * each one a typed edit with a stated reason, a stated cost and — when it names
 * a place — a source the server bound itself. The traveller accepts them one by
 * one, so nothing here can change a day without an explicit choice.
 */

/** One-tap self check-in. The traveller's own words outrank any device record. */
export const CHECK_IN_TAGS = ["legs_tired", "poor_sleep", "irritable", "hungry", "want_quiet", "energetic"] as const;
export type CheckInTag = (typeof CHECK_IN_TAGS)[number];
export const CHECK_IN_LABELS: Record<CheckInTag, string> = {
  legs_tired: "腿脚累", poor_sleep: "没睡好", irritable: "有点烦躁",
  hungry: "饿了", want_quiet: "想安静", energetic: "精力不错",
};
export type CheckIn = { fatigue: number | null; stress: number | null; tags: CheckInTag[] };

/** How freely to spend on comfort today. A preference, never inferred from income or history alone. */
export const STANCES = ["save", "balanced", "treat"] as const;
export type Stance = (typeof STANCES)[number];
export const STANCE_LABELS: Record<Stance, string> = { save: "能省则省", balanced: "适中", treat: "今天对自己好一点" };

export const ANGLES = ["pace", "mobility", "food", "relief", "sleep"] as const;
export type Angle = (typeof ANGLES)[number];
export const ANGLE_LABELS: Record<Angle, string> = { pace: "节奏", mobility: "交通", food: "餐食", relief: "放松", sleep: "作息" };

/** Which input motivated a proposal, so every suggestion can show its evidence. */
export const SIGNALS = [
  "self_fatigue", "self_stress", "self_tag", "whoop_recovery", "whoop_sleep",
  "steps_today", "jet_lag", "schedule_density", "preference",
] as const;
export type Signal = (typeof SIGNALS)[number];
export const SIGNAL_LABELS: Record<Signal, string> = {
  self_fatigue: "你的疲劳自评", self_stress: "你的压力自评", self_tag: "你刚才的选择",
  whoop_recovery: "WHOOP 恢复记录", whoop_sleep: "WHOOP 睡眠记录", steps_today: "今天已走步数",
  jet_lag: "时区变化", schedule_density: "今天的安排密度", preference: "你的旅行偏好",
};

/** Abstract needs. Raw body metrics never travel past the stage that derived these. */
export const NEEDS = ["less_walking", "rest", "quiet", "comfort_food", "relaxation", "early_night", "late_start"] as const;
export type Need = (typeof NEEDS)[number];
export type Energy = "low" | "moderate" | "high";

/** Generic stops name no venue. A named place must arrive with a verified source instead. */
export const GENERIC_STOPS = ["rest", "meal", "quiet", "stay"] as const;
export type GenericStop = (typeof GENERIC_STOPS)[number];
export const GENERIC_STOP_COPY: Record<GenericStop, { name: string; detail: string; kind: ActivityKind }> = {
  rest: { name: "坐下来歇一会儿", detail: "找个能坐的地方，喝点水，不赶时间。", kind: "rest" },
  meal: { name: "找个地方吃点东西", detail: "就近坐下来吃点热的，具体店家由你决定。", kind: "meal" },
  quiet: { name: "安静地待一会儿", detail: "离开人多的地方，找一处安静的角落。", kind: "rest" },
  stay: { name: "回住处休息", detail: "先回住处歇一歇，之后的安排看状态再定。", kind: "stay" },
};

/**
 * The only shapes a proposal can take. Models fill these in; they never write
 * list positions or cascade times, which are computed by `reflow`.
 */
export type AdjustTemplate =
  | { type: "swap_move"; activityId: string; fromActivityId?: string; fromActivityName?: string; mode: Exclude<MoveMode, "none">; minutes?: number; km?: number; costCny?: number; basis: "amap" | "unverified" }
  | { type: "add_stop"; afterActivityId?: string; date: string; time?: string; durationMin: number; name: string; detail: string; kind: ActivityKind; effort: ActivityEffort; sourceUrl?: string }
  | { type: "replace_stop"; activityId: string; name: string; detail: string; kind?: ActivityKind; effort?: ActivityEffort; sourceUrl: string }
  | { type: "shift"; activityId: string; minutes: number }
  | { type: "postpone"; activityId: string; date: string; time: string }
  | { type: "shorten"; activityId: string; durationMin: number }
  | { type: "drop"; activityId: string }
  | { type: "end_early"; afterActivityId: string };

/** Signed deltas the traveller can weigh. A figure exists only where its basis says where it came from. */
export type ProposalEffect = {
  walkMinutes?: number;
  restMinutes?: number;
  timeMinutes?: number;
  costCny?: [number, number];
  basis: "amap" | "source" | "estimate" | "none";
};
export type ProposalSource = {
  url: string; name: string; kind: "fliggy_product" | "fliggy_poi" | "amap_poi" | "reference";
  imageUrl?: string; price?: string;
};
export type Proposal = {
  id: string;
  /** `instant` proposals come from rules alone; `advisor` proposals carry agent-gathered sources. */
  tier: "instant" | "advisor";
  angle: Angle;
  title: string;
  reason: string;
  signals: Signal[];
  effect: ProposalEffect;
  templates: AdjustTemplate[];
  source?: ProposalSource;
  /** A suggestion that changes nothing in the itinerary, e.g. a breathing pause. */
  action?: "breathing";
  conflictsWith?: string[];
};

/** Where an adjustment may act. Anything before `fromTime` on `date` has already happened. */
export type AdjustScope = { date: string; fromTime: string; throughDate: string };
