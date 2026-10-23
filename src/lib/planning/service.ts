import { localDateTimeAsInstant, parseSchedule, planningDateError, scheduleError, validateInput, type PlannerInput, type ScheduleItem } from "@/lib/planner-input";
import { applicableMemories, listMemoryItems, memorySettings } from "@/lib/agent/memory";
import { listAdjustmentRecords } from "@/lib/body-journey";
import { resolveTripTiming } from "@/lib/trip-timing";
import { adjustmentDraft, validateAdjustmentRequest } from "../adjust/request";
import { bindVisuals } from "./visuals";
import { getJourney, checkJourneyForGeneration, JourneyError } from "@/lib/journeys";
import { planningReservations, reservationBaseline } from "./reservations";
import type { TripTiming } from "./contract";
import type { JourneyGeneratedPlan } from "@/lib/journey-types";
import type { PlanningOutcome } from "./pipeline";
export function isNearOrOngoingTrip(input: PlannerInput, timing: TripTiming) {
  const now = Date.now();
  const returnDayEnd = input.trip.returnDate
    ? localDateTimeAsInstant(`${input.trip.returnDate}T23:59`, input.trip.destinationTimezone).getTime()
    : timing.arrivalInstant.getTime() + 24 * 60 * 60 * 1000;
  // WHOOP describes the traveller today, so it only informs a trip that is
  // imminent or under way. A distant trip is planned as a contingency.
  return timing.departureInstant.getTime() <= now + 36 * 60 * 60 * 1000 && returnDayEnd >= now - 24 * 60 * 60 * 1000;
}

/** Learned defaults only ever extend what the traveller explicitly confirmed. */
export async function memoryUsage(accountId: string, input: PlannerInput, includeMemory: boolean, journeyId: string | null = null) {
  if (!includeMemory || !(await memorySettings(accountId)).useMemory) return {
    input: { ...input, profileMemoryNotes: "" },
    memory: { applied: false, source: "none" as const, noteCount: 0 },
  };
  const notes = applicableMemories(await listMemoryItems(accountId),journeyId,new Intl.DateTimeFormat('en-CA',{timeZone:input.trip.destinationTimezone}).format(new Date())).map(m=>m.category === "home" ? `常住城市：${m.note}` : m.note);
  return { input: {...input,profileMemoryNotes:notes.join("\n").slice(0,5000)},
    memory: {applied:notes.length>0,source:notes.length?"learned" as const:"none" as const,noteCount:notes.length} };
}


export async function preparePlanning(accountId: string, raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new JourneyError(400,"INVALID_INPUT","旅行资料无效。");
  const body = raw as Record<string, unknown>;
  const input = validateInput(raw);
  if (!input || (body.includeWhoop !== undefined && typeof body.includeWhoop !== "boolean") ||
    (body.includeMemory !== undefined && typeof body.includeMemory !== "boolean") || !input.consent) {
    throw new JourneyError(400,"INVALID_INPUT","请核对旅行资料并确认本次授权。");
  }
  const error = planningDateError(input.trip.departureDate, input.trip.returnDate) || scheduleError(input.trip.itineraryText);
  if (error) throw new JourneyError(400,"INVALID_INPUT",error);
  const timing = resolveTripTiming(input);
  const target = typeof body.journeyId === "string" ? await checkJourneyForGeneration(accountId,body.journeyId,body.expectedVersion) : null;
  if (body.reservationEdits !== undefined && !target) throw new JourneyError(400,"JOURNEY_REQUIRED","请先选择要重新规划的旅程。");
  const schedule = parseSchedule(input.trip.itineraryText) ?? [];
  for (const item of schedule) if (item.date && (item.date < timing.arrivalDate || item.date > timing.endDate))
    throw new JourneyError(400,"INVALID_SCHEDULE",`活动“${item.name}”的日期不在行程内。`);
  if (target && !target.plan) reservationBaseline(target,body.reservationEdits,timing);
  const reservations = target?.plan ? planningReservations(target,body.reservationEdits,input,timing) : null;
  const fixedItems:ScheduleItem[] = reservations?.fixedItems ?? schedule.filter(item=>item.fixed).map(item=>({...item,date:item.date ?? timing.arrivalDate}));
  const usage = await memoryUsage(accountId,reservations?.input ?? input,body.includeMemory !== false, typeof body.journeyId === "string" ? body.journeyId : null);
  return { ...usage, mode:"plan" as const, timing, fixedItems,
    includeWhoop:body.includeWhoop === true, isNearOrOngoingTrip:isNearOrOngoingTrip(input,timing) };
}
export function generatedPlan(outcome: PlanningOutcome, timing: TripTiming): JourneyGeneratedPlan {
  const generated: JourneyGeneratedPlan = { source:"live",retrievedAt:outcome.provenance.requestedAt,
    timezone:{shiftMinutes:timing.timezoneShiftMinutes,travelHours:timing.travelHours},
    healthContext:{basis:outcome.provenance.health.basis,provisional:outcome.provenance.health.basis !== "whoop_recent"},
    localServices:(outcome.local?.services ?? []).map(service => ({ ...service, sourceKind: "reference" as const })),
    plan:{ ...outcome.plan, places:outcome.plan.places.map(place => ({ ...place, sourceKind:place.source === "飞猪实时搜索" ? "fliggy_product" as const : "reference" as const })) },provenance:outcome.provenance };
  const unverified=[...outcome.inventory.failedCategories,...(outcome.provenance.local.reason ? [outcome.provenance.local.reason] : [])];
  if(unverified.length) generated.plan.adjustments.push(`${unverified.join("、")}本次未核验，请自行确认后再使用。`);
  if(outcome.provenance.health.whoopUnavailable) generated.plan.adjustments.push("WHOOP 授权已失效，本次按你的自评规划；可在个人档案重新连接。");
  const bound = bindVisuals(generated.plan.itinerary, { city: outcome.destinationCity ?? "", pois: outcome.pois ?? [], products: outcome.inventory.sources });
  generated.plan.itinerary = bound.itinerary;
  if (bound.visuals.cover.length || Object.keys(bound.visuals.images).length) generated.visuals = bound.visuals;
  return generated;
}

/** Adjustment input is rebuilt from the account-owned saved journey. */
export async function prepareAdjustment(accountId: string, raw: unknown) {
  const body = raw as Record<string, unknown>;
  if(typeof body?.journeyId !== "string") throw new JourneyError(400,"INVALID_INPUT","请先选择当前旅程。");
  const journey = await getJourney(accountId, body.journeyId);
  let adjustment;
  try { adjustment = validateAdjustmentRequest(raw, journey); }
  catch (error) { throw new JourneyError(400, "INVALID_ADJUSTMENT_REQUEST", error instanceof Error ? error.message : "调整资料无效。"); }
  const draft = adjustmentDraft(journey, adjustment);
  const input = validateInput(draft);
  if (!input) throw new JourneyError(400, "INVALID_INPUT", "当前旅程资料不完整，请先补充。");
  const timing = resolveTripTiming(input);
  const usage = await memoryUsage(accountId, input, adjustment.includeMemory, journey.id);
  const recentAdjustments=await listAdjustmentRecords(accountId,journey.id);
  return { ...usage, mode:"adjust" as const, journey, adjustment, draft, timing, recentAdjustments,
    fixedItems: journey.plan!.plan.itinerary.filter(item => item.fixed),
    includeWhoop: adjustment.includeWhoop, isNearOrOngoingTrip: isNearOrOngoingTrip(input, timing) };
}
