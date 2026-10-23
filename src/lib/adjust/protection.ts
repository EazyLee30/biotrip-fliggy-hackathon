import type { ItineraryActivity } from "../journey-types";
import { activityTags, minutesOf } from "./tags";
export class ActivityProtectionError extends Error { readonly code = "ACTIVITY_PROTECTED"; }
export type LocalClock = { date: string; time: string };
export function activityIsProtected(item: ItineraryActivity, clock?: LocalClock) {
  if (item.progress && item.progress.state !== "planned") return true;
  if (item.progress?.state === "planned") return false;
  return Boolean(clock && item.date && (item.date < clock.date || item.date === clock.date && item.time < clock.time));
}
function span(item: ItineraryActivity, day:readonly ItineraryActivity[]) {
  const start = minutesOf(item.time);
  // A legacy item without a duration only establishes a slot, not a verified
  // ninety-minute reservation. Explicit durations always retain the whole interval.
  const next = day.filter(row=>row!==item && row.date===item.date && row.progress?.state!=="skipped" && row.time>item.time).sort((a,b)=>a.time.localeCompare(b.time))[0];
  const inferred=next?Math.min(activityTags(item).durationMin,minutesOf(next.time)-start):activityTags(item).durationMin;
  return { start, end: start + (item.durationMin ?? inferred) };
}
function signature(item: ItineraryActivity) { return JSON.stringify(item); }
/** Reject newly introduced overlaps, while leaving untouched legacy plans reviewable. */
export function assertNoNewOverlaps(before: readonly ItineraryActivity[], after: readonly ItineraryActivity[]) {
  for (let i = 0; i < after.length; i++) {
    const a = after[i];
    if (a.progress?.state === "skipped") continue;
    for (let j = i + 1; j < after.length; j++) {
      const b = after[j];
      if (a.date !== b.date || b.progress?.state === "skipped") continue;
      const x = span(a,after), y = span(b,after);
      const first = x.start <= y.start ? a : b, second = first === a ? b : a;
      const overlap = Math.min(x.end, y.end) - Math.max(x.start, y.start);
      const travelOverlap = span(first,after).end + (second.move?.minutes ?? 0) - span(second,after).start;
      if (overlap <= 0 && travelOverlap <= 0) continue;
      const oldA = before.find(row => row.id === a.id), oldB = before.find(row => row.id === b.id);
      if (oldA && oldB && oldA.date === oldB.date) {
        const oldX = span(oldA,before), oldY = span(oldB,before);
        const oldFirst = oldX.start <= oldY.start ? oldA : oldB, oldSecond = oldFirst === oldA ? oldB : oldA;
        const oldOverlap = Math.min(oldX.end, oldY.end) - Math.max(oldX.start, oldY.start);
        const oldTravel = span(oldFirst,before).end + (oldSecond.move?.minutes ?? 0) - span(oldSecond,before).start;
        if (overlap <= oldOverlap && travelOverlap <= oldTravel && a.time === oldA.time && b.time === oldB.time && a.date === oldA.date && b.date === oldB.date) continue;
      }
      throw new ActivityProtectionError(`「${first.name}」与「${second.name}」的活动或交通时间重叠，请留出完整时间。`);
    }
  }
}
/** Shared by edits, automatic adjustments and complete candidate application. */
export function assertProtectedActivities(before: readonly ItineraryActivity[], after: readonly ItineraryActivity[], options: { clock?: LocalClock; fixed?: boolean } = {}) {
  for (const item of before) {
    const next = after.find(row => row.id === item.id);
    if (activityIsProtected(item, options.clock) && (!next || signature(item) !== signature(next)))
      throw new ActivityProtectionError(item.progress && item.progress.state!=="planned" ? `「${item.name}」已经进行、完成或跳过，不会被自动改动。请先更正活动状态。` : `「${item.name}」已过计划开始时间，先保留原安排；如果尚未开始，请把活动标为“未开始”后再调整。`);
    if (options.fixed && item.fixed && (!next || ["date", "time", "name", "durationMin", "fixed"].some(key => item[key as keyof ItineraryActivity] !== next[key as keyof ItineraryActivity])))
      throw new ActivityProtectionError(`固定预约「${item.name}」需要保留完整时间；如需修改，请单独编辑预约。`);
  }
  assertNoNewOverlaps(before, after);
}
