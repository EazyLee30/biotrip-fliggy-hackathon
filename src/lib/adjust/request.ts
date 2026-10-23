import { isCalendarDate } from "../planner-input";
import type { Journey, JourneyDraft } from "../journey-types";
import { CHECK_IN_TAGS, STANCES, type AdjustScope, type CheckIn, type Stance } from "./types";

export type AdjustmentRequest = { mode: "adjust"; journeyId: string; expectedVersion: number; consent: true; includeWhoop: boolean; includeMemory: boolean; checkIn: CheckIn; stance: Stance; scope: AdjustScope; instruction?: string };
export class AdjustmentRequestError extends Error { readonly code = "INVALID_ADJUSTMENT_REQUEST"; }
const invalid = (message: string): never => { throw new AdjustmentRequestError(message); };
/** Destination wall-clock, shared by preview and server checks. */
export function destinationClock(timezone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const field = (name: string) => parts.find(part => part.type === name)!.value;
  return { date: `${field("year")}-${field("month")}-${field("day")}`, time: `${field("hour")}:${field("minute")}` };
}
export function adjustmentScope(journey: Journey, now = new Date()): AdjustScope {
  const dates = [...new Set(journey.plan?.plan.itinerary.map(item => item.date!).filter(Boolean))].sort();
  if (!dates.length) return invalid("请先保存一份行程。");
  const clock = destinationClock(journey.draft.trip?.destinationTimezone || "Asia/Shanghai", now);
  const date = clock.date < dates[0] ? dates[0] : clock.date;
  return { date, fromTime: date === clock.date ? clock.time : "00:00", throughDate: dates[dates.length - 1] };
}
/** Caller cannot supply itinerary, health records or a scope that reaches into the past. */
export function validateAdjustmentRequest(raw: unknown, journey: Journey, now = new Date()): AdjustmentRequest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid("调整资料无效。");
  const body = raw as Record<string, unknown>;
  const allowed = new Set(["mode", "journeyId", "expectedVersion", "consent", "includeWhoop", "includeMemory", "checkIn", "stance", "scope", "instruction"]);
  if(Object.keys(body).some(key => !allowed.has(key))) return invalid("本次调整包含未声明的资料，请重新提交。");
  if (body.mode !== "adjust" || body.consent !== true || body.journeyId !== journey.id || body.expectedVersion !== journey.version || !journey.plan || journey.status === "completed") return invalid("请核对当前旅程并确认本次授权。");
  if (typeof body.includeWhoop !== "boolean" || typeof body.includeMemory !== "boolean" || !STANCES.includes(body.stance as Stance)) return invalid("请确认本次数据与预算选择。");
  if(body.instruction!==undefined && (typeof body.instruction!=="string" || body.instruction.length>1000)) return invalid("调整说明过长。");
  const check = body.checkIn as CheckIn | undefined;
  if(check && Object.keys(check).some(key => !["fatigue", "stress", "tags"].includes(key))) return invalid("本次自评包含未声明的资料。");
  const score = (value: unknown) => value === null || typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;
  if (!check || !score(check.fatigue) || !score(check.stress) || !Array.isArray(check.tags) || check.tags.length > CHECK_IN_TAGS.length || check.tags.some(tag => !CHECK_IN_TAGS.includes(tag))) return invalid("此刻的感受选择无效。");
  const scope = body.scope as AdjustScope | undefined;
  const minimum = adjustmentScope(journey, now);
  if(scope && Object.keys(scope).some(key => !["date", "fromTime", "throughDate"].includes(key))) return invalid("本次范围包含未声明的资料。");
  if (!scope || !isCalendarDate(scope.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(scope.fromTime) || scope.date !== minimum.date || scope.throughDate !== minimum.throughDate || scope.date > scope.throughDate) return invalid("这次调整的日期已失效，请重新获取。");
  // A round trip between browser and Worker may cross a minute. Clamp forward;
  // never allow an old browser clock to change an activity that already happened.
  return { mode: "adjust", journeyId: journey.id, expectedVersion: journey.version, consent: true, includeWhoop: body.includeWhoop, includeMemory: body.includeMemory,
    ...(typeof body.instruction === "string" ? {instruction:body.instruction} : {}),
    checkIn: { fatigue: check.fatigue, stress: check.stress, tags: [...new Set(check.tags)] }, stance: body.stance as Stance,
    scope: { ...minimum, fromTime: scope.fromTime > minimum.fromTime ? scope.fromTime : minimum.fromTime } };
}
export function adjustmentDraft(journey: Journey, request: AdjustmentRequest): JourneyDraft {
  return { ...journey.draft, consent: true, fatigue: request.checkIn.fatigue, subjectiveStress: request.checkIn.stress };
}
