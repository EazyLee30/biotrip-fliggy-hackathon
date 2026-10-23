import type { ItineraryItem } from "../itinerary-edit";
import type { JourneyTripDraft } from "../journey-types";
import { feasible } from "./reflow";
import { activityIsProtected } from "./protection";
import type { BodyStatus } from "./status";
import { clockOf, dayLoad, minutesOf, type ActivityLoad } from "./tags";
import { GENERIC_STOP_COPY, type AdjustScope, type AdjustTemplate, type Proposal, type Signal, type Stance } from "./types";

/**
 * The instant tier: adjustments that need no model and no search.
 *
 * These only rearrange the traveller's own day — a pause, a different way to
 * cover a stretch, an earlier evening — so they can appear the moment a state
 * is known and remain available when every advisor fails. They never name a
 * venue or quote a figure: a real massage or restaurant, and any distance or
 * fare, can only come from the advisor tier's verified sources.
 */

export type InstantInput = {
  itinerary: readonly ItineraryItem[];
  trip: JourneyTripDraft;
  scope: AdjustScope;
  status: BodyStatus;
  stance: Stance;
};

const MAXIMUM = 4;

function nextDate(date: string) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}
function signalsFor(status: BodyStatus, ...preferred: Signal[]): Signal[] {
  const present = new Set(status.reasons.map((reason) => reason.signal));
  const chosen = preferred.filter((signal) => present.has(signal));
  return chosen.length ? chosen : [...present].slice(0, 2);
}
const BODY: Signal[] = ["self_fatigue", "self_tag", "whoop_recovery", "steps_today"];
const SLEEP: Signal[] = ["whoop_sleep", "self_tag", "jet_lag"];

export function instantProposals(input: InstantInput): Proposal[] {
  const { itinerary, trip, scope, status, stance } = input;
  const needs = new Set(status.needs);
  const eligible=itinerary.filter(item=>!activityIsProtected(item,{date:scope.date,time:scope.fromTime}));
  const today = dayLoad(eligible, scope.date).filter((item) => item.time >= scope.fromTime);
  const proposals: Proposal[] = [];
  const offer = (proposal: Proposal) => {
    if (proposals.length >= MAXIMUM || proposals.some((entry) => entry.id === proposal.id)) return;
    if (proposal.templates.length && !feasible(itinerary, proposal.templates, trip, scope)) return;
    proposals.push(proposal);
  };
  const low = status.energy === "low";

  // A pause before the most demanding stretch still ahead.
  if (needs.has("rest") || low) {
    const hardest = today.filter((item) => item.effort >= 2).sort((a, b) => b.effort * b.minutes - a.effort * a.minutes)[0];
    if (hardest) {
      const position = today.findIndex((item) => item.id === hardest.id);
      const before: ActivityLoad | undefined = today[position - 1];
      const length = low ? 45 : 30;
      if (!before || !["rest", "meal", "relax", "stay"].includes(before.kind)) {
        const template: AdjustTemplate = { type: "add_stop", date: scope.date, durationMin: length, effort: 1,
          ...GENERIC_STOP_COPY.rest,
          ...(before ? { afterActivityId: before.id } : { time: clockOf(Math.max(minutesOf(scope.fromTime), minutesOf(hardest.time) - length)) }) };
        offer({ id: `instant:rest:${hardest.id}`, tier: "instant", angle: "pace",
          title: `「${hardest.name}」之前先歇 ${length} 分钟`,
          reason: `这是今天接下来最费体力的一段，先坐下来缓一缓；后面的灵活安排会顺延，固定预约不动。`,
          signals: signalsFor(status, ...BODY, "schedule_density"), effect: { restMinutes: length, timeMinutes: length, basis: "estimate" }, templates: [template] });
      }
    }
  }

  // A different way to cover the next stretch that would otherwise be walked.
  if (needs.has("less_walking") || low) {
    const leg = today.find((item) => !["rest", "stay"].includes(item.kind) && item.effort >= 2)
      ?? today.find((item) => !["rest", "stay"].includes(item.kind));
    const current = leg && itinerary.find((item) => item.id === leg.id)?.move?.mode;
    if (leg && current !== "taxi") {
      const mode = stance === "treat" || (low && stance !== "save") ? "taxi" as const : "transit" as const;
      if (current !== mode) offer({ id: `instant:move:${leg.id}`, tier: "instant", angle: "mobility",
        title: mode === "taxi" ? `去「${leg.name}」这一段，打车过去` : `去「${leg.name}」这一段，改坐公共交通`,
        reason: mode === "taxi" ? "少走一段路，把体力留给到了以后。距离与车费以地图和打车软件为准。" : "少走一段路，也不多花什么钱。线路与时长以地图为准。",
        signals: signalsFor(status, ...BODY), effect: { basis: "none" },
        templates: [{ type: "swap_move", activityId: leg.id, mode, basis: "unverified" }] });
    }
  }

  // Something warm to eat when the next meal is still far off.
  if (needs.has("comfort_food") && !today.some((item) => item.kind === "meal" && minutesOf(item.time) - minutesOf(scope.fromTime) <= 120)) {
    // Now if the day allows it; otherwise right after whatever comes next.
    const stop = { type: "add_stop" as const, date: scope.date, durationMin: 40, effort: 1 as const, ...GENERIC_STOP_COPY.meal };
    const now: AdjustTemplate = { ...stop, time: scope.fromTime };
    const anchor = today[0];
    const template = feasible(itinerary, [now], trip, scope) || !anchor ? now : { ...stop, afterActivityId: anchor.id };
    offer({ id: `instant:meal:${scope.date}`, tier: "instant", angle: "food",
      title: "先坐下来吃点热的",
      reason: "离下一顿正餐还有一阵子，先垫一垫。这里只留出时间，具体吃什么由你决定。",
      signals: signalsFor(status, "self_tag"), effect: { restMinutes: 40, timeMinutes: 40, basis: "estimate" },
      templates: [template] });
  }

  // A quiet pause after the next stop, when calm matters more than rest.
  if (needs.has("quiet") && !needs.has("rest") && today[0]) {
    offer({ id: `instant:quiet:${today[0].id}`, tier: "instant", angle: "relief",
      title: `「${today[0].name}」之后安静待 20 分钟`,
      reason: "离开人多的地方缓一缓，再决定后面去不去。",
      signals: signalsFor(status, "self_stress", "self_tag"), effect: { restMinutes: 20, timeMinutes: 20, basis: "estimate" },
      templates: [{ type: "add_stop", date: scope.date, afterActivityId: today[0].id, durationMin: 20, effort: 1, ...GENERIC_STOP_COPY.quiet }] });
  }

  // Move the last optional outing to tomorrow, or shorten it on the final day.
  if (low && today.filter((item) => !item.fixed).length >= 2) {
    const last = [...today].reverse().find((item) => !item.fixed && ["sight", "experience", "other"].includes(item.kind));
    const tomorrow = nextDate(scope.date);
    if (last && tomorrow <= scope.throughDate) {
      const ahead = dayLoad(eligible, tomorrow);
      const end = ahead.length ? ahead[ahead.length - 1].endsAt : 9 * 60 + 30;
      const slot = !ahead.length || minutesOf(ahead[0].time) - (9 * 60 + 30) >= last.minutes ? 9 * 60 + 30 : Math.ceil(end / 30) * 30;
      offer({ id: `instant:postpone:${last.id}`, tier: "instant", angle: "pace",
        title: `「${last.name}」挪到明天`,
        reason: "今天少排一项，明天精神好一点再去。开放时间与预约请自行核对。",
        signals: signalsFor(status, ...BODY, "schedule_density"), effect: { timeMinutes: -last.minutes, basis: "estimate" },
        templates: [{ type: "postpone", activityId: last.id, date: tomorrow, time: clockOf(slot) }] });
    } else if (last && last.minutes >= 60) {
      const shorter = Math.max(30, Math.round(last.minutes * 0.6 / 5) * 5);
      offer({ id: `instant:shorten:${last.id}`, tier: "instant", angle: "pace",
        title: `「${last.name}」少待一会儿`,
        reason: "不用走完全程，挑最想看的部分就好。",
        signals: signalsFor(status, ...BODY), effect: { timeMinutes: shorter - last.minutes, basis: "estimate" },
        templates: [{ type: "shorten", activityId: last.id, durationMin: shorter }] });
    }
  }

  // An earlier evening tonight and a later start tomorrow.
  if (needs.has("early_night")) {
    const evening = today.filter((item) => !item.fixed && minutesOf(item.time) >= 19 * 60 + 30);
    const anchor = [...today].reverse().find((item) => minutesOf(item.time) < 19 * 60 + 30);
    if (evening.length && anchor) offer({ id: `instant:evening:${anchor.id}`, tier: "instant", angle: "sleep",
      title: "今晚早点收尾",
      reason: `把 19:30 之后的 ${evening.length} 项灵活安排先放下，早点回住处。`,
      signals: signalsFor(status, ...SLEEP), effect: { timeMinutes: -evening.reduce((total, item) => total + item.minutes, 0), basis: "estimate" },
      templates: [{ type: "end_early", afterActivityId: anchor.id }] });
  }
  if (needs.has("late_start")) {
    const tomorrow = nextDate(scope.date);
    const first = tomorrow <= scope.throughDate ? dayLoad(eligible, tomorrow)[0] : undefined;
    if (first && !first.fixed && minutesOf(first.time) < 9 * 60 + 30) offer({ id: `instant:morning:${first.id}`, tier: "instant", angle: "sleep",
      title: "明早晚一小时出发",
      reason: `明天第一项「${first.name}」顺延一小时，多睡一会儿；后面的灵活安排一起顺延。`,
      signals: signalsFor(status, ...SLEEP), effect: { restMinutes: 60, basis: "estimate" },
      templates: [{ type: "shift", activityId: first.id, minutes: 60 }] });
  }

  // Even when the only remaining item is the current reservation, a pause can
  // start once its occupied interval ends. Reflow resolves that exact boundary.
  if ((needs.has("rest") || low) && !proposals.some(proposal=>proposal.templates.length)) {
    const length=low?45:30;
    offer({id:`instant:rest:${scope.date}`,tier:"instant",angle:"pace",title:`下一段空档，先歇 ${length} 分钟`,
      reason:"把已经开始的安排完整留住，在它结束后留一段休息时间。",signals:signalsFor(status,...BODY),
      effect:{restMinutes:length,timeMinutes:length,basis:"estimate"},
      templates:[{type:"add_stop",date:scope.date,time:scope.fromTime,durationMin:length,effort:1,...GENERIC_STOP_COPY.rest}]});
  }

  // A pause that changes nothing in the day.
  if (needs.has("quiet") || needs.has("relaxation")) {
    offer({ id: "instant:breathing", tier: "instant", angle: "relief", action: "breathing",
      title: "先做 3 分钟呼吸",
      reason: "找个能坐下的地方，跟着节奏吸气 4 秒、呼气 6 秒。不改动任何安排。",
      signals: signalsFor(status, "self_stress", "self_tag"), effect: { restMinutes: 3, basis: "none" }, templates: [] });
  }
  return proposals;
}
