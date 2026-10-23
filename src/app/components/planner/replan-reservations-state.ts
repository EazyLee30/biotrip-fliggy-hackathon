import type { ItineraryActivity, ActivityState } from "@/lib/journey-types";
import type { ReservationEdit } from "@/lib/planning/reservations";
import { isCalendarDate, parseSchedule, type ScheduleItem } from "@/lib/planner-input";
import { reservationTextError, serializeReservations } from "./reservations";

export type { ReservationEdit } from "@/lib/planning/reservations";

export type ReplanReservation = ScheduleItem & {
  key: string;
  activityId?: string;
  origin: "itinerary" | "draft";
  locked: boolean;
  progress?: ActivityState;
  durationMin?: number;
};

const safeName = (value: string) => value.replace(/[\r\n\u2028\u2029|｜]+/g, " ").trim().slice(0, 120);
const identity = (value: string) => safeName(value);
const sameName = (a: string, b: string) => identity(a) === identity(b);
const locked = (item: ItineraryActivity) => item.progress?.state === "in_progress" || item.progress?.state === "completed";

/** Actual activities supply appointments missing from old drafts. Progress always wins over draft edits. */
export function initialReplanReservations(itinerary: ItineraryActivity[], value: string, tripStart: string, tripEnd: string, reservationEdits: ReservationEdit[] = []) {
  const recovered = Boolean(reservationTextError(value, tripStart, tripEnd));
  const parsed = recovered ? [] : (parseSchedule(value) ?? []);
  const drafts = parsed.map(item => ({ ...item, date: item.date ?? tripStart }));
  const used = new Set<number>();
  const items: ReplanReservation[] = [];
  const skipped = itinerary.filter(item => item.progress?.state === "skipped");

  for (const [index, activity] of itinerary.entries()) {
    if (activity.progress?.state === "skipped") continue;
    const date = activity.date ?? tripStart;
    if (!isCalendarDate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(activity.time) || !safeName(activity.name)) continue;
    const edit = !locked(activity) && activity.id ? reservationEdits.find(change => change.activityId === activity.id && isCalendarDate(change.date) && change.date >= tripStart && change.date <= (tripEnd || tripStart) && /^([01]\d|2[0-3]):[0-5]\d$/.test(change.time)) : undefined;
    const candidates = drafts.map((draft, draftIndex) => ({ draft, draftIndex })).filter(({ draft, draftIndex }) => !used.has(draftIndex) && sameName(draft.name, activity.name));
    const uniqueName = itinerary.filter(item => sameName(item.name, activity.name)).length === 1;
    const match = (edit ? candidates.find(({ draft }) => draft.date === edit.date && draft.time === edit.time) : undefined)
      ?? candidates.find(({ draft }) => draft.date === date && draft.time === activity.time)
      ?? (uniqueName && candidates.length === 1 ? candidates[0] : undefined);
    if (!activity.fixed && !locked(activity) && !match) continue;
    if (match) used.add(match.draftIndex);
    const base: ScheduleItem = { date, time: activity.time, name: safeName(activity.name), fixed: activity.fixed };
    const selected = locked(activity) ? base : edit ? { ...base, date: edit.date, time: edit.time, fixed: edit.fixed } : match?.draft ?? base;
    items.push({ ...selected, key: `activity-${activity.id ?? index}`, activityId: activity.id, origin: "itinerary", locked: locked(activity), progress: activity.progress?.state, durationMin: activity.durationMin });
  }
  drafts.forEach((draft, index) => {
    if (used.has(index) || skipped.some(activity => sameName(activity.name, draft.name) && (activity.date ?? tripStart) === draft.date)) return;
    // A text row cannot identify which of two same-named appointments was changed.
    // Keep both actual records; explicit edits carry the activity ID when the user changes a card.
    if (itinerary.some(activity => sameName(activity.name, draft.name))) return;
    items.push({ ...draft, key: `draft-${index}`, origin: "draft", locked: false });
  });
  items.sort((a, b) => `${a.date ?? ""} ${a.time}`.localeCompare(`${b.date ?? ""} ${b.time}`));
  const serialized = serializeReservations(items);
  return { items, canonicalText: serialized.value, recovered, edits: reservationEditsFromItems(items, itinerary, tripStart) };
}

export function reservationEditsFromItems(items: ReplanReservation[], itinerary: ItineraryActivity[], tripStart: string): ReservationEdit[] {
  return items.flatMap(item => {
    if (!item.activityId || item.locked || !item.date) return [];
    const actual = itinerary.find(activity => activity.id === item.activityId);
    if (!actual || locked(actual) || ((actual.date ?? tripStart) === item.date && actual.time === item.time && actual.fixed === item.fixed)) return [];
    return [{ activityId: item.activityId, date: item.date, time: item.time, fixed: item.fixed }];
  });
}

export function replanReservationText(items: ReplanReservation[]) {
  return serializeReservations(items);
}
