import { localDateTimeAsInstant, parseSchedule, planningDateError, scheduleError, validateInput, type PlannerInput } from "@/lib/planner-input";
import { listLearnedPreferences, preferenceDefaults } from "@/lib/preferences";
import { resolveTripTiming } from "@/lib/trip-timing";
import { adjustmentDraft, validateAdjustmentRequest } from "../adjust/request";
import { bindVisuals } from "./visuals";
import { getJourney, JourneyError } from "@/lib/journeys";
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
export async function memoryUsage(accountId: string, input: PlannerInput, includeMemory: boolean) {
  if (!includeMemory) return {
    input: { ...input, profileMemoryNotes: "" },
    memory: { applied: false, source: "none" as const, noteCount: 0 },
  };
  const preferences = await listLearnedPreferences(accountId);
  const defaults = preferenceDefaults(preferences);
  const learnedNotes = defaults.notes;
  const combined = [input.profileMemoryNotes, learnedNotes.join("；")]
    .filter(Boolean).join("\n").slice(0, 5000);
  return {
    input: { ...input, profileMemoryNotes: combined },
    memory: {
      applied: Boolean(input.profileMemoryNotes || learnedNotes.length),
      source: (learnedNotes.length ? "learned" : input.profileMemoryNotes ? "profile" : "none") as "learned" | "profile" | "none",
      noteCount: learnedNotes.length,
    },
  };
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
  const schedule = parseSchedule(input.trip.itineraryText) ?? [];
  for (const item of schedule) if (item.date && (item.date < timing.arrivalDate || item.date > timing.endDate))
    throw new JourneyError(400,"INVALID_SCHEDULE",`活动“${item.name}”的日期不在行程内。`);
  const usage = await memoryUsage(accountId,input,body.includeMemory !== false);
  return { ...usage, timing, fixedItems: schedule.filter(item=>item.fixed).map(item=>({...item,date:item.date ?? timing.arrivalDate})),
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
  const usage = await memoryUsage(accountId, input, adjustment.includeMemory);
  return { ...usage, journey, adjustment, draft, timing,
    fixedItems: journey.plan!.plan.itinerary.filter(item => item.fixed),
    includeWhoop: adjustment.includeWhoop, isNearOrOngoingTrip: isNearOrOngoingTrip(input, timing) };
}
