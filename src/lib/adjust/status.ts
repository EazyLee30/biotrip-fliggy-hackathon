import type { ActivityLoad } from "./tags";
import type { CheckIn, Energy, Need, Signal } from "./types";

/**
 * Reads the traveller's state from records they can already see on screen.
 *
 * Everything here is a fixed, published rule — no model is involved and nothing
 * leaves the device or Worker that computed it. The output is a reason to offer
 * a gentler day, never a statement about health: a low recovery record is
 * reported as a low record, not as a diagnosis.
 */

export type BodyLevel = "good" | "watch" | "low" | "unknown";
export type BodyReason = { signal: Signal; text: string };
export type BodyStatus = { level: BodyLevel; energy: Energy | null; needs: Need[]; reasons: BodyReason[] };

export type BodySignals = {
  /** The same summary the rhythm page displays; absent when WHOOP is not used. */
  summary?: { recoveryScore: number | null; sleepMinutes: number | null; cycleSteps: number | null } | null;
  checkIn?: CheckIn | null;
  /** Hours the destination clock is shifted from home, and how many days into the trip. */
  timezoneShiftHours?: number;
  tripDayIndex?: number;
  /** What is still ahead today, used only to judge whether a high step count matters. */
  remaining?: readonly ActivityLoad[];
};

// WHOOP publishes these recovery bands itself: 0–33 red, 34–66 yellow, 67–100 green.
const RECOVERY_LOW = 34, RECOVERY_GOOD = 67;
const SHORT_SLEEP_MINUTES = 360, VERY_SHORT_SLEEP_MINUTES = 300;
const HIGH_STEPS = 12_000;
const RANK: Record<BodyLevel, number> = { unknown: 0, good: 1, watch: 2, low: 3 };

export function bodyStatus(signals: BodySignals): BodyStatus {
  const reasons: BodyReason[] = [];
  // Device-derived and self-reported needs are kept apart so the traveller's own
  // report can overrule what a record alone would suggest.
  const deviceNeeds = new Set<Need>();
  const needs = new Set<Need>();
  let device: BodyLevel = "unknown";
  let self: BodyLevel = "unknown";
  const raise = (current: BodyLevel, next: BodyLevel) => (RANK[next] > RANK[current] ? next : current);

  const summary = signals.summary;
  if (typeof summary?.recoveryScore === "number") {
    const score = Math.round(summary.recoveryScore);
    if (score < RECOVERY_LOW) {
      device = raise(device, "low"); deviceNeeds.add("rest"); deviceNeeds.add("less_walking");
      reasons.push({ signal: "whoop_recovery", text: `WHOOP 最近恢复记录 ${score}，在它的偏低区间` });
    } else if (score < RECOVERY_GOOD) {
      device = raise(device, "watch");
      reasons.push({ signal: "whoop_recovery", text: `WHOOP 最近恢复记录 ${score}，在它的中间区间` });
    } else {
      device = raise(device, "good");
      reasons.push({ signal: "whoop_recovery", text: `WHOOP 最近恢复记录 ${score}，在它的较高区间` });
    }
  }
  if (typeof summary?.sleepMinutes === "number" && summary.sleepMinutes < SHORT_SLEEP_MINUTES) {
    device = raise(device, summary.sleepMinutes < VERY_SHORT_SLEEP_MINUTES ? "low" : "watch");
    deviceNeeds.add("early_night"); deviceNeeds.add("late_start");
    reasons.push({ signal: "whoop_sleep", text: `最近一次睡眠记录约 ${Math.floor(summary.sleepMinutes / 60)} 小时 ${Math.round(summary.sleepMinutes % 60)} 分` });
  }
  if (typeof summary?.cycleSteps === "number" && summary.cycleSteps >= HIGH_STEPS && signals.remaining?.some((item) => item.effort >= 2)) {
    device = raise(device, "watch"); deviceNeeds.add("less_walking");
    reasons.push({ signal: "steps_today", text: `今天已记录 ${summary.cycleSteps.toLocaleString("zh-CN")} 步，后面还有要走路的安排` });
  }
  if (Math.abs(signals.timezoneShiftHours ?? 0) >= 3 && (signals.tripDayIndex ?? 99) <= 1) {
    device = raise(device, "watch"); deviceNeeds.add("early_night");
    reasons.push({ signal: "jet_lag", text: `目的地与出发地相差 ${Math.abs(signals.timezoneShiftHours ?? 0)} 小时，刚到的头两天` });
  }

  const checkIn = signals.checkIn;
  if (checkIn) {
    if (typeof checkIn.fatigue === "number") {
      self = raise(self, checkIn.fatigue >= 4 ? "low" : checkIn.fatigue === 3 ? "watch" : "good");
      if (checkIn.fatigue >= 3) { needs.add("rest"); if (checkIn.fatigue >= 4) needs.add("less_walking"); }
      reasons.push({ signal: "self_fatigue", text: `你给疲劳打了 ${checkIn.fatigue} / 5` });
    }
    if (typeof checkIn.stress === "number" && checkIn.stress >= 3) {
      self = raise(self, checkIn.stress >= 4 ? "watch" : self === "unknown" ? "good" : self);
      if (checkIn.stress >= 4) { needs.add("quiet"); needs.add("relaxation"); }
      reasons.push({ signal: "self_stress", text: `你给压力打了 ${checkIn.stress} / 5` });
    }
    const tagged = (text: string, level: BodyLevel, ...added: Need[]) => {
      self = raise(self, level);
      for (const need of added) needs.add(need);
      reasons.push({ signal: "self_tag", text });
    };
    if (checkIn.tags.includes("legs_tired")) tagged("你说腿脚累了", "watch", "less_walking", "rest");
    if (checkIn.tags.includes("poor_sleep")) tagged("你说没睡好", "watch", "early_night", "late_start");
    if (checkIn.tags.includes("irritable")) tagged("你说有点烦躁", "watch", "quiet", "relaxation");
    if (checkIn.tags.includes("hungry")) tagged("你说饿了", self === "unknown" ? "good" : self, "comfort_food");
    if (checkIn.tags.includes("want_quiet")) tagged("你说想安静一会儿", self === "unknown" ? "good" : self, "quiet");
    if (checkIn.tags.includes("energetic")) tagged("你说精力不错", self === "unknown" ? "good" : self);
  }

  // The traveller's own report is the authority. A low device record alongside
  // "I feel fine" stays visible as a reason, but only as something to watch.
  let level: BodyLevel = self === "unknown" ? device : self;
  if (self === "good" && RANK[device] >= RANK.watch) level = "watch";
  if (self !== "unknown" && self !== "good") level = raise(level, device === "low" ? "low" : level);
  for (const need of deviceNeeds) {
    if (self === "good" && (need === "rest" || need === "less_walking")) continue;
    needs.add(need);
  }

  return {
    level,
    energy: level === "unknown" ? null : level === "low" ? "low" : level === "watch" ? "moderate" : "high",
    needs: [...needs],
    reasons,
  };
}

export const BODY_LEVEL_COPY: Record<BodyLevel, { title: string; hint: string }> = {
  good: { title: "状态不错", hint: "按原计划走，也可以看看有没有想换的安排。" },
  watch: { title: "可以稍微放慢", hint: "有几处可以让今天轻松一点，要不要看看？" },
  low: { title: "今天建议放慢一点", hint: "看看哪些安排可以换个更省力的方式。" },
  unknown: { title: "告诉我现在的感觉", hint: "点一下此刻的状态，我来给出调整建议。" },
};
