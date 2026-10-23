import { JourneyError } from "@/lib/journeys";
import { identifyGeneratedActivities, validActivityId } from "@/lib/itinerary-edit";
import { isCalendarDate, parseSchedule, type PlannerInput, type ScheduleItem } from "@/lib/planner-input";
import { resolveTripTiming } from "@/lib/trip-timing";
import type { Journey, JourneyGeneratedPlan } from "@/lib/journey-types";
import { activityIsProtected, assertNoNewOverlaps, assertProtectedActivities, type LocalClock } from "../adjust/protection";
import { destinationClock } from "../adjust/request";

/** Explicit pending authorization; identity, duration and progress remain server-owned. */
export type ReservationEdit = { activityId: string; date: string; time: string; fixed: boolean };
type DateWindow = { arrivalDate: string; endDate: string };
const signature = (item: ScheduleItem) => JSON.stringify([item.date ?? "", item.time, item.name]);
function clockFor(journey: Journey, now: Date): LocalClock | undefined {
  return journey.status === "active" ? destinationClock(journey.draft.trip?.destinationTimezone || "Asia/Shanghai", now) : undefined;
}
function protectedError(error: unknown): never {
  throw new JourneyError(409, "ACTIVITY_PROTECTED", error instanceof Error ? error.message : "预约时间需要保留，请重新确认。");
}

/** Old undated plans mean the original arrival day, never the new request's dates. */
function datedReservationJourney(journey: Journey): Journey {
  if (!journey.plan?.plan.itinerary.some(item => !item.date)) return journey;
  const trip = journey.draft.trip;
  if (journey.planCurrent === false || !isCalendarDate(trip?.departureDate) || !trip.departureTimezone || !trip.destinationTimezone)
    throw new JourneyError(409,"RESERVATION_DATE_UNKNOWN","旧行程的原始预约日期暂时无法确认，请先核对原旅行日期。");
  let arrivalDate: string;
  try { arrivalDate = resolveTripTiming({trip:{departureDate:trip.departureDate,departureTimezone:trip.departureTimezone,destinationTimezone:trip.destinationTimezone,returnDate:trip.returnDate ?? ""}}).arrivalDate; }
  catch { throw new JourneyError(409,"RESERVATION_DATE_UNKNOWN","旧行程的原始预约日期暂时无法确认，请先核对原旅行日期。"); }
  return {...journey,plan:{...journey.plan,plan:{...journey.plan.plan,itinerary:journey.plan.plan.itinerary.map(item=>item.date ? item : {...item,date:arrivalDate})}}};
}

/** A pure shadow copy: nothing is saved until the associated candidate is adopted. */
export function reservationBaseline(journey: Journey, raw: unknown, window?: DateWindow, now = new Date()) {
  if (raw !== undefined && (!Array.isArray(raw) || raw.length > 100)) throw new JourneyError(400, "INVALID_RESERVATION_EDITS", "预约修改无效，请重新打开预约卡片。");
  const edits: ReservationEdit[] = [], seen = new Set<string>();
  const originalJourney = datedReservationJourney(journey);
  const original = originalJourney.plan?.plan.itinerary ?? [];
  const clock = clockFor(journey, now);
  for (const value of (raw ?? []) as unknown[]) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new JourneyError(400, "INVALID_RESERVATION_EDITS", "预约修改无效。");
    const edit = value as Record<string, unknown>;
    if (Object.keys(edit).some(key => !["activityId", "date", "time", "fixed"].includes(key)) ||
      !validActivityId(edit.activityId) || seen.has(edit.activityId) || !isCalendarDate(edit.date) ||
      typeof edit.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(edit.time) || typeof edit.fixed !== "boolean")
      throw new JourneyError(400, "INVALID_RESERVATION_EDITS", "请在预约卡片确认日期、时间和保留方式。");
    const item = original.find(row => row.id === edit.activityId);
    if (!item) throw new JourneyError(409, "JOURNEY_CHANGED", "这项预约已变化，请刷新后重新选择。");
    const next = { ...item, date: edit.date, time: edit.time, fixed: edit.fixed };
    if (activityIsProtected(item, clock) && JSON.stringify(next) !== JSON.stringify(item))
      throw new JourneyError(409, "ACTIVITY_PROTECTED", `「${item.name}」已经开始、完成或跳过，不能随重新规划改动。`);
    seen.add(edit.activityId);
    edits.push({ activityId: edit.activityId, date: edit.date, time: edit.time, fixed: edit.fixed });
  }
  const itinerary = original.map(item => {
    const edit = edits.find(edit => edit.activityId === item.id);
    return edit ? { ...item, date: edit.date, time: edit.time, fixed: edit.fixed } : { ...item };
  }).sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
  const constraints = itinerary.filter(item => item.fixed || activityIsProtected(item, clock));
  if (window) for (const item of [...constraints, ...itinerary.filter(item => seen.has(item.id!))]) {
    if (!item.date || item.date < window.arrivalDate || item.date > window.endDate)
      throw new JourneyError(400, "INVALID_SCHEDULE", `预约「${item.name}」不在新的旅行日期内，请在卡片里选择日期。`);
  }
  // Old flexible activities may be displaced by this reservation; the model
  // reschedules those later. Two protected intervals cannot be displaced.
  try { assertNoNewOverlaps(original.filter(item => item.fixed || activityIsProtected(item, clock)), constraints); }
  catch (error) { protectedError(error); }
  const shadow: Journey = { ...journey, plan: journey.plan ? { ...journey.plan, plan: { ...journey.plan.plan, itinerary } } : null };
  return { original:originalJourney, shadow, edits, constraints };
}

/** Actual itinerary cards are authoritative; text only contributes new activities. */
export function planningReservations(journey: Journey, raw: unknown, input: PlannerInput, window: DateWindow, now = new Date()) {
  const baseline = reservationBaseline(journey, raw, window, now);
  const oldAndShadow = [...(baseline.original.plan?.plan.itinerary ?? []), ...(baseline.shadow.plan?.plan.itinerary ?? [])];
  const known = new Set(oldAndShadow.map(signature));
  const schedule = (parseSchedule(input.trip.itineraryText) ?? []).map(item => ({ ...item, date: item.date ?? window.arrivalDate }));
  const additions = schedule.filter(item => !known.has(signature(item)));
  // Persist a compatible canonical draft as well, so an older text-based
  // client cannot resurrect the previous time on the next replan.
  const normalized = schedule.map(item => {
    const originals = (baseline.original.plan?.plan.itinerary ?? []).filter(old => signature(old) === signature(item));
    return originals.length === 1 ? baseline.shadow.plan?.plan.itinerary.find(next => next.id === originals[0].id) ?? item : item;
  });
  const canonical = normalized.map(item => `${item.date} ${item.time} | ${item.name} | ${item.fixed ? "固定" : "灵活"}`).filter((line,index,lines) => lines.indexOf(line) === index).join("\n");
  const fixedItems = [
    ...baseline.constraints.map(item => ({ ...item, fixed: true })),
    ...additions.filter(item => item.fixed),
  ];
  const seen = new Set<string>();
  return { ...baseline, input: { ...input, trip: { ...input.trip, itineraryText: canonical } }, fixedItems: fixedItems.filter(item => { const key = signature(item); if (seen.has(key)) return false; seen.add(key); return true; }) };
}

/** Match by the authorized shadow slot, never trust an ID supplied by a model. */
export function identifyReservationCandidate(journey: Journey, shadow: Journey, generated: JourneyGeneratedPlan, now = new Date()) {
  const identified = identifyGeneratedActivities(generated, journey.id, shadow.plan);
  const clock = clockFor(journey, now);
  const locked = shadow.plan?.plan.itinerary.filter(item => item.fixed || activityIsProtected(item, clock)) ?? [];
  const itinerary = identified.plan.itinerary.map(item => {
    const matches = locked.filter(old => signature(old) === signature(item));
    const unique = identified.plan.itinerary.filter(other => signature(other) === signature(item)).length === 1;
    return matches.length === 1 && unique ? { ...matches[0] } : item;
  });
  return { ...identified, plan: { ...identified.plan, itinerary } };
}

/** Validate against the pending authorization and against the original overlap baseline. */
export function protectReservationCandidate(journey: Journey, shadow: Journey, next: JourneyGeneratedPlan, now = new Date()) {
  if (!journey.plan || !shadow.plan) return;
  try {
    assertProtectedActivities(shadow.plan.plan.itinerary, next.plan.itinerary, { clock: clockFor(journey, now), fixed: true });
    // A collision introduced by the pending edit is not a grandfathered overlap.
    assertNoNewOverlaps(datedReservationJourney(journey).plan!.plan.itinerary, next.plan.itinerary);
  } catch (error) { protectedError(error); }
}
