import { withActivityIds, identifyGeneratedActivities } from "@/lib/itinerary-edit";
export { withActivityIds, identifyGeneratedActivities } from "@/lib/itinerary-edit";
import { createHash, randomUUID } from "node:crypto";
import { getDatabase } from "@/lib/database";
import { learnFromDraft, learnFromFeedback } from "@/lib/preferences";
import type { Journey, JourneyDraft, JourneyFeedback, JourneyFeedbackInput, JourneyGeneratedPlan, JourneyMemory, JourneyStatus, JourneyTripDraft } from "@/lib/journey-types";
import { applyItineraryOperations, assertProtectedActivities, ActivityProtectionError, ItineraryEditError, itineraryDates, syncItineraryReservations, type ItineraryOperation } from "@/lib/itinerary-edit";

export type { Journey, JourneyDraft, JourneyFeedback, JourneyFeedbackInput, JourneyGeneratedPlan, JourneyMemory, JourneyStatus } from "@/lib/journey-types";

const DRAFT_LIMIT = 20_000;
const PLAN_LIMIT = 64_000;
const SERVICE_TYPES = new Set(["flights", "hotels", "attractions", "transport", "travel_insurance", "local_food", "relaxation", "onsen", "massage", "medical_info"]);
const AMBIENCE = new Set(["安静少噪", "自然气息", "柔和光线", "人少宽松"]);
const INTENTIONS = new Set(["安静恢复", "慢慢探索", "补充活力", "未指定"]);
const COLORS = new Set(["松林绿", "湖水蓝", "暖光橙", "不限色调", "未指定"]);

type JourneyRow = {
  id: string; title: string; status: JourneyStatus; draft_json: string; plan_json: string | null;
  plan_draft_json: string | null; version: number; created_at: number; updated_at: number;
  started_at: number | null; completed_at: number | null;
};
const SELECT_COLUMNS = "id, title, status, draft_json, plan_json, plan_draft_json, version, created_at, updated_at, started_at, completed_at";

export class JourneyError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}

function invalid(message = "旅程内容无效，请检查后重试。"): never { throw new JourneyError(400, "INVALID_JOURNEY", message); }
export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
export function requireJourneyId(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new JourneyError(404, "JOURNEY_NOT_FOUND", "旅程不存在。");
  }
  return value;
}
export function requireVersion(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) invalid("请刷新旅程后重试。");
  return value;
}
export function onlyKeys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) invalid();
}
function text(value: unknown, max: number, allowEmpty = true) {
  if (typeof value !== "string" || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) invalid();
  const normalized = value.trim();
  if (!allowEmpty && !normalized) invalid();
  return normalized;
}
function scale(value: unknown) {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 5) invalid();
  return value;
}
function stringArray(value: unknown, allowed: Set<string>, max: number) {
  if (!Array.isArray(value) || value.length > max || value.some((item) => typeof item !== "string" || !allowed.has(item))) invalid();
  return [...new Set(value)] as string[];
}
function date(value: unknown, withTime: boolean) {
  const result = text(value, withTime ? 16 : 10);
  if (!result) return result;
  const pattern = withTime ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/ : /^\d{4}-\d{2}-\d{2}$/;
  if (!pattern.test(result)) invalid();
  const instant = new Date(`${result}${withTime ? ":00" : "T00:00:00"}Z`);
  if (!Number.isFinite(instant.getTime()) || instant.toISOString().slice(0, withTime ? 16 : 10) !== result) invalid();
  return result;
}
function timezone(value: unknown) {
  const result = text(value, 80);
  if (result) { try { new Intl.DateTimeFormat("en", { timeZone: result }).format(); } catch { invalid(); } }
  return result;
}
function choice(value: unknown, allowed: Set<string>) {
  if (typeof value !== "string" || !allowed.has(value)) invalid();
  return value;
}

/** Reject unknown fields, particularly plan/source/account identifiers. */
export function parseJourneyDraft(value: unknown): JourneyDraft {
  if (!isRecord(value)) invalid();
  onlyKeys(value, ["intention", "colorTone", "fatigue", "subjectiveStress", "ambientPreferences", "bodyFeedback", "moodFeedback", "profileMemoryNotes", "consent", "trip"]);
  const result: JourneyDraft = {};
  if (value.intention !== undefined) result.intention = choice(value.intention, INTENTIONS);
  if (value.colorTone !== undefined) result.colorTone = choice(value.colorTone, COLORS);
  if (value.fatigue !== undefined) result.fatigue = scale(value.fatigue);
  if (value.subjectiveStress !== undefined) result.subjectiveStress = scale(value.subjectiveStress);
  if (value.ambientPreferences !== undefined) result.ambientPreferences = stringArray(value.ambientPreferences, AMBIENCE, 4);
  if (value.bodyFeedback !== undefined) result.bodyFeedback = text(value.bodyFeedback, 80);
  if (value.moodFeedback !== undefined) result.moodFeedback = text(value.moodFeedback, 80);
  if (value.profileMemoryNotes !== undefined) result.profileMemoryNotes = text(value.profileMemoryNotes, 5000);
  if (value.consent !== undefined) { if (typeof value.consent !== "boolean") invalid(); result.consent = value.consent; }
  if (value.trip !== undefined) {
    if (!isRecord(value.trip)) invalid();
    const input = value.trip;
    onlyKeys(input, ["originCity", "destinationCity", "departureDate", "departureTimezone", "destinationTimezone", "returnDate", "planningStyle", "paceLevel", "guardrails", "itineraryText", "requestedServices", "foodPreferences"]);
    const trip: JourneyTripDraft = {};
    if (input.originCity !== undefined) trip.originCity = text(input.originCity, 100);
    if (input.destinationCity !== undefined) trip.destinationCity = text(input.destinationCity, 100);
    if (input.departureDate !== undefined) trip.departureDate = date(input.departureDate, false);
    if (input.departureTimezone !== undefined) trip.departureTimezone = timezone(input.departureTimezone);
    if (input.destinationTimezone !== undefined) trip.destinationTimezone = timezone(input.destinationTimezone);
    if (input.returnDate !== undefined) trip.returnDate = date(input.returnDate, false);
    if (input.planningStyle !== undefined) trip.planningStyle = choice(input.planningStyle, new Set(["flexible", "structured"])) as "flexible" | "structured";
    if (input.paceLevel !== undefined) trip.paceLevel = choice(input.paceLevel, new Set(["gentle", "balanced", "active"])) as JourneyTripDraft["paceLevel"];
    if (input.guardrails !== undefined) {
      if (!isRecord(input.guardrails)) invalid();
      onlyKeys(input.guardrails, ["morningLight", "protectReservations", "sensoryBreaks"]);
      if (Object.values(input.guardrails).some((value) => typeof value !== "boolean")) invalid();
      trip.guardrails = {
        morningLight: input.guardrails.morningLight === true,
        protectReservations: input.guardrails.protectReservations === true,
        sensoryBreaks: input.guardrails.sensoryBreaks === true,
      };
    }
    if (input.itineraryText !== undefined) trip.itineraryText = text(input.itineraryText, 6000);
    if (input.requestedServices !== undefined) trip.requestedServices = stringArray(input.requestedServices, SERVICE_TYPES, 10);
    if (input.foodPreferences !== undefined) trip.foodPreferences = text(input.foodPreferences, 500);
    result.trip = trip;
  }
  if (JSON.stringify(result).length > DRAFT_LIMIT) invalid();
  return result;
}

function iso(seconds: number | null) { return seconds === null ? null : new Date(seconds * 1000).toISOString(); }
function fromRow(row: JourneyRow): Journey {
  return { id: row.id, title: row.title, status: row.status, draft: JSON.parse(row.draft_json) as JourneyDraft,
    plan: row.plan_json ? withActivityIds(JSON.parse(row.plan_json) as JourneyGeneratedPlan, row.id) : null,
    planCurrent: Boolean(row.plan_json && row.plan_draft_json === row.draft_json), version: row.version,
    createdAt: iso(row.created_at)!, updatedAt: iso(row.updated_at)!, startedAt: iso(row.started_at), completedAt: iso(row.completed_at) };
}
function journeyTitle(draft: JourneyDraft, value?: unknown) {
  if (value !== undefined) return text(value, 100, false);
  return draft.trip?.destinationCity ? `${draft.trip.destinationCity}之旅` : "新的旅程";
}

export async function listJourneys(accountId: string) {
  const rows = await getDatabase().prepare(`SELECT ${SELECT_COLUMNS} FROM journeys WHERE account_id = ? ORDER BY updated_at DESC, id DESC LIMIT 100`)
    .bind(accountId).all<JourneyRow>();
  return rows.results.map(fromRow);
}
export async function getJourney(accountId: string, id: string) {
  requireJourneyId(id);
  const row = await getDatabase().prepare(`SELECT ${SELECT_COLUMNS} FROM journeys WHERE id = ? AND account_id = ?`).bind(id, accountId).first<JourneyRow>();
  if (!row) throw new JourneyError(404, "JOURNEY_NOT_FOUND", "旅程不存在。");
  return fromRow(row);
}
export async function createJourney(accountId: string, value: unknown) {
  if (!isRecord(value)) invalid();
  onlyKeys(value, ["title", "draft"]);
  const draft = parseJourneyDraft(value.draft ?? {});
  const title = journeyTitle(draft, value.title);
  const id = randomUUID();
  await getDatabase().prepare("INSERT INTO journeys (id, account_id, title, draft_json) VALUES (?, ?, ?, ?)")
    .bind(id, accountId, title, JSON.stringify(draft)).run();
  // Starting a trip is the moment the traveller states their preferences.
  await learnFromDraft(accountId, draft);
  return getJourney(accountId, id);
}

function conflict(): never { throw new JourneyError(409, "JOURNEY_CHANGED", "旅程已在另一页面更新，请刷新后再操作。"); }

/** One protection boundary for manual edits, candidate application and legacy generation. */
export function protectJourneyActivities(current: Journey, next: JourneyGeneratedPlan, fixed = true, now = new Date()) {
  if (!current.plan) return;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: current.draft.trip?.destinationTimezone || "Asia/Shanghai", year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hourCycle:"h23" }).formatToParts(now);
  const p = (name:string) => parts.find(part=>part.type===name)!.value;
  const clock = current.status === "active" ? {date:`${p("year")}-${p("month")}-${p("day")}`,time:`${p("hour")}:${p("minute")}`} : undefined;
  try { assertProtectedActivities(current.plan.plan.itinerary, next.plan.itinerary, {clock,fixed}); }
  catch(error) { if(error instanceof ActivityProtectionError) throw new JourneyError(409,error.code,error.message); throw error; }
}

/** Reject invalid or stale targets before spending time on provider calls. */
export async function checkJourneyForGeneration(accountId: string, journeyId: unknown, expectedVersion: unknown) {
  if (journeyId === undefined) {
    if (expectedVersion !== undefined) invalid("请刷新旅程后重试。");
    return null;
  }
  if (typeof journeyId !== "string") invalid("旅程标识无效，请刷新后重试。");
  requireJourneyId(journeyId);
  const version = requireVersion(expectedVersion);
  const current = await getJourney(accountId, journeyId);
  if (current.version !== version) conflict();
  if (current.status === "completed") throw new JourneyError(409, "JOURNEY_COMPLETED", "已完成的旅程不能重新规划。");
  return current;
}

export async function updateJourney(accountId: string, id: string, value: unknown) {
  if (!isRecord(value)) invalid();
  onlyKeys(value, ["version", "title", "draft", "status"]);
  const version = requireVersion(value.version);
  const current = await getJourney(accountId, id);
  if (version !== current.version) conflict();
  if (value.title === undefined && value.draft === undefined && value.status === undefined) invalid();
  if (current.status === "completed" && (value.draft !== undefined || value.status !== undefined)) {
    throw new JourneyError(409, "JOURNEY_COMPLETED", "已完成的旅程不能改写行程，可新建下一次旅程。");
  }
  const draft = value.draft === undefined ? current.draft : parseJourneyDraft(value.draft);
  const title = value.title === undefined ? current.title : journeyTitle(draft, value.title);
  let status = current.status;
  const draftChanged = JSON.stringify(draft) !== JSON.stringify(current.draft);
  if (draftChanged) {
    if (current.status === "active") throw new JourneyError(409, "ACTIVE_JOURNEY_EDIT", "旅途中请通过重新规划更新行程，以保留当前安排。");
    status = "draft";
  }
  if (value.status !== undefined) {
    if (draftChanged || !["active", "completed"].includes(String(value.status))) invalid();
    if (value.status === "active" && current.status === "planned" && current.planCurrent) status = "active";
    else if (value.status === "completed" && current.status === "active") status = "completed";
    else throw new JourneyError(409, "INVALID_JOURNEY_TRANSITION", "请先生成旅程、开始旅行，再记录完成。");
  }
  const result = await getDatabase().prepare(`UPDATE journeys SET title = ?, draft_json = ?, status = ?, version = version + 1,
    updated_at = unixepoch(), started_at = CASE WHEN ? = 'active' THEN COALESCE(started_at, unixepoch()) ELSE started_at END,
    completed_at = CASE WHEN ? = 'completed' THEN unixepoch() ELSE completed_at END
    WHERE id = ? AND account_id = ? AND version = ? RETURNING version`).bind(title, JSON.stringify(draft), status, status, status, id, accountId, version).first<{ version: number }>();
  if (!result) conflict();
  if (draftChanged) await learnFromDraft(accountId, draft);
  return getJourney(accountId, id);
}

/** Invoke only after the server has verified provider evidence and parsed the final plan. Never expose this as client POST input. */
export async function saveGeneratedJourney(accountId: string, value: {
  journeyId?: string; expectedVersion?: number; draft: unknown; generated: JourneyGeneratedPlan;
}) {
  const draft = parseJourneyDraft(value.draft);
  const encodedDraft = JSON.stringify(draft);
  const encodedPlan = JSON.stringify(value.generated);
  if (value.generated.source !== "live" || !value.generated.plan.itinerary.length || encodedPlan.length > PLAN_LIMIT) {
    throw new JourneyError(502, "INVALID_GENERATED_PLAN", "规划结果无法完整保存，请重试。");
  }
  if (!value.journeyId) {
    const id = randomUUID();
    await getDatabase().prepare(`INSERT INTO journeys (id, account_id, title, status, draft_json, plan_json, plan_draft_json)
      VALUES (?, ?, ?, 'planned', ?, ?, ?)`)
      .bind(id, accountId, journeyTitle(draft), encodedDraft, JSON.stringify(identifyGeneratedActivities(value.generated, id)), encodedDraft).run();
    return getJourney(accountId, id);
  }
  requireJourneyId(value.journeyId);
  const version = requireVersion(value.expectedVersion);
  const current = await getJourney(accountId, value.journeyId);
  if (current.version !== version) conflict();
  if (current.status === "completed") throw new JourneyError(409, "JOURNEY_COMPLETED", "已完成的旅程不能重新规划。");
  const generated = identifyGeneratedActivities(value.generated, value.journeyId, current.plan);
  protectJourneyActivities(current, generated);
  const result = await getDatabase().prepare(`UPDATE journeys SET draft_json = ?, plan_json = ?, plan_draft_json = ?,
    status = CASE WHEN status = 'active' THEN 'active' ELSE 'planned' END,
    version = version + 1, updated_at = unixepoch() WHERE id = ? AND account_id = ? AND version = ? AND status <> 'completed' RETURNING version`)
    .bind(encodedDraft, JSON.stringify(generated), encodedDraft, value.journeyId, accountId, version).first<{ version: number }>();
  if (!result) conflict();
  return getJourney(accountId, value.journeyId);
}

/** Persist only explicit edits; product URLs, health context and provenance cannot be submitted by the client. */
export async function updateJourneyItinerary(accountId: string, id: string, value: unknown, trustedSources:readonly {name:string;url:string;category?:string;imageUrl?:string;retrievedAt?:string}[] = []) {
  if (!isRecord(value)) invalid();
  onlyKeys(value, ["version", "operations"]);
  const version = requireVersion(value.version);
  const current = await getJourney(accountId, id);
  if (current.version !== version) conflict();
  if (current.status === "completed") throw new JourneyError(409, "JOURNEY_COMPLETED", "已完成的旅程不能修改行程。");
  if (!current.plan || !current.planCurrent) throw new JourneyError(409, "PLAN_NOT_CURRENT", "请先为当前偏好生成行程，再手动调整。");
  // Same digest as reservePlanning. The final conditional UPDATE also checks
  // this lease, closing the race between the preliminary read and this save.
  const lockKey = createHash("sha256").update(`plan:active:${accountId}`).digest("hex");
  const hasGeneration = async () => Boolean(await getDatabase().prepare("SELECT 1 AS active FROM auth_rate_limits WHERE limit_key = ? AND reset_at > unixepoch()")
    .bind(lockKey).first());
  const inProgress = () => new JourneyError(409, "PLANNING_IN_PROGRESS", "行程正在重新生成，请等待完成或取消后再调整。");
  if (await hasGeneration()) throw inProgress();
  let itinerary, draft;
  try {
    const original = current.plan.plan.itinerary;
    if (Array.isArray(value.operations)) {
      const known = new Set([...trustedSources.map(source=>source.url), ...current.plan.plan.places.map(place => place.url), ...current.plan.localServices.map(place => place.sourceUrl), ...(current.plan.visuals?.cover ?? []).map(image => image.url), ...Object.keys(current.plan.visuals?.images ?? {})]);
      for (const operation of value.operations) if (isRecord(operation) && operation.sourceUrl !== undefined && !known.has(operation.sourceUrl as string)) throw new ItineraryEditError("请选择这份行程中已检索的来源，不能关联其他链接。");
    }
    const result = applyItineraryOperations(original, value.operations as ItineraryOperation[], current.draft.trip ?? {});
    itinerary = result.itinerary;
    const firstDate = itineraryDates(original, current.draft.trip ?? {})[0];
    const itineraryText = syncItineraryReservations(current.draft.trip?.itineraryText ?? "", original, result.reservationChanges, firstDate);
    draft = parseJourneyDraft({ ...current.draft, trip: { ...current.draft.trip, itineraryText } });
  } catch (error) {
    if (error instanceof ItineraryEditError) throw new JourneyError(400, error.code, error.message);
    throw error;
  }
  const operationCount = (value.operations as ItineraryOperation[]).length;
  const generated: JourneyGeneratedPlan = { ...current.plan,
    plan: { ...current.plan.plan, itinerary, places:[...current.plan.plan.places,...trustedSources.filter((source,index)=>itinerary.some(item=>item.sourceUrl===source.url) && !current.plan!.plan.places.some(place=>place.url===source.url) && trustedSources.findIndex(other=>other.url===source.url)===index).map(source=>({name:source.name,url:source.url,category:source.category??"地点与体验",source:"飞猪实时搜索",reason:"从本次对话的已检索结果加入",...(source.imageUrl?{imageUrl:source.imageUrl}:{})}))] },
    manualAdjustment: { id:randomUUID(), updatedAt: new Date().toISOString(), revision: (current.plan.manualAdjustment?.revision ?? 0) + 1, operationCount },
  };
  protectJourneyActivities(current, generated, false);
  const encodedDraft = JSON.stringify(draft), encodedPlan = JSON.stringify(generated);
  if (encodedPlan.length > PLAN_LIMIT) invalid("调整后的行程内容过长，请精简详情。");
  const removed=current.plan.plan.itinerary.filter(item=>!itinerary.some(next=>next.id===item.id));
  const sql=`UPDATE journeys SET draft_json = ?, plan_json = ?, plan_draft_json = ?,
    version = version + 1, updated_at = unixepoch()
    WHERE id = ? AND account_id = ? AND version = ? AND status <> 'completed'
    AND NOT EXISTS (SELECT 1 FROM auth_rate_limits WHERE limit_key = ? AND reset_at > unixepoch())`;
  let result:unknown;
  if(removed.length){
    const {backlogInsertStatements}=await import("@/lib/journey-collections");
    const changes=await getDatabase().batch([
      getDatabase().prepare(sql).bind(encodedDraft,encodedPlan,encodedDraft,id,accountId,version,lockKey),
      ...backlogInsertStatements(accountId,id,removed,generated.manualAdjustment!.id!,version+1,undefined,generated.manualAdjustment!.id),
    ]);
    result=changes[0].meta.changes===1;
  } else result=await getDatabase().prepare(`${sql} RETURNING version`).bind(encodedDraft,encodedPlan,encodedDraft,id,accountId,version,lockKey).first<{version:number}>();
  if (!result) {
    if (await hasGeneration()) throw inProgress();
    conflict();
  }
  return getJourney(accountId, id);
}

export async function deleteJourney(accountId: string, id: string, version: number) {
  requireJourneyId(id); requireVersion(version);
  const current = await getJourney(accountId, id);
  if (current.version !== version) conflict();
  const active = await getDatabase().prepare("SELECT id FROM planning_jobs WHERE journey_id=? AND account_id=? AND state IN ('queued','running','cancel_requested')").bind(id,accountId).first();
  if (active) throw new JourneyError(409,"PLANNING_IN_PROGRESS","请先停止后台任务，再删除旅程。");
  const result = await getDatabase().prepare("DELETE FROM journeys WHERE id = ? AND account_id = ? AND version = ? RETURNING id").bind(id, accountId, version).first<{ id: string }>();
  if (!result) conflict();
}

/** Actual progress is an explicit traveller action, never a model inference from the clock. */
export async function updateActivityState(accountId:string,id:string,activityId:string,value:unknown,now=new Date()) {
  if(!isRecord(value))invalid();
  onlyKeys(value,["version","state"]);
  const version=requireVersion(value.version),states=["planned","in_progress","completed","skipped"] as const;
  if(!states.includes(value.state as typeof states[number]))invalid("请选择有效的活动状态。");
  const current=await getJourney(accountId,id);
  if(!current.plan || current.status!=="active")throw new JourneyError(409,"JOURNEY_NOT_STARTED","开始旅程后即可记录活动进度。");
  const item=current.plan.plan.itinerary.find(row=>row.id===activityId);
  if(!item)throw new JourneyError(404,"ACTIVITY_NOT_FOUND","这项活动不存在。");
  if(item.progress?.state===value.state)return current;
  if(current.version!==version)conflict();
  if(value.state==="in_progress" && current.plan.plan.itinerary.some(row=>row.id!==activityId&&row.progress?.state==="in_progress"))throw new JourneyError(409,"ACTIVITY_IN_PROGRESS","请先结束当前正在进行的活动。");
  const state=value.state as typeof states[number];
  const plan={...current.plan,plan:{...current.plan.plan,itinerary:current.plan.plan.itinerary.map(row=>row.id===activityId?{...row,progress:{state,updatedAt:now.toISOString()}}:row)}};
  const changed=await getDatabase().prepare("UPDATE journeys SET plan_json=?,version=version+1,updated_at=unixepoch() WHERE id=? AND account_id=? AND version=? AND status='active' RETURNING version").bind(JSON.stringify(plan),id,accountId,version).first();
  if(!changed)conflict();
  return getJourney(accountId,id);
}

export function parseFeedback(value: unknown) {
  if (!isRecord(value)) invalid();
  onlyKeys(value, ["version", "bodyFeedback", "moodFeedback", "fatigue", "subjectiveStress", "note", "remember", "memoryNote", "adjustmentAt"]);
  const version = requireVersion(value.version);
  const feedback: JourneyFeedbackInput = {};
  if (value.adjustmentAt !== undefined) {
    if (typeof value.adjustmentAt !== "string" || value.adjustmentAt.length > 40 || !Number.isFinite(Date.parse(value.adjustmentAt))) invalid("调整记录标识无效。");
    feedback.adjustmentAt = value.adjustmentAt;
  }
  if (value.bodyFeedback !== undefined) feedback.bodyFeedback = text(value.bodyFeedback, 80);
  if (value.moodFeedback !== undefined) feedback.moodFeedback = text(value.moodFeedback, 80);
  if (value.fatigue !== undefined) feedback.fatigue = scale(value.fatigue);
  if (value.subjectiveStress !== undefined) feedback.subjectiveStress = scale(value.subjectiveStress);
  if (value.note !== undefined) feedback.note = text(value.note, 1000);
  if (!feedback.bodyFeedback && !feedback.moodFeedback && feedback.fatigue == null && feedback.subjectiveStress == null && !feedback.note) invalid("请填写一项感受或反馈。");
  if (value.remember !== undefined && typeof value.remember !== "boolean") invalid();
  const memoryNote = value.memoryNote === undefined ? "" : text(value.memoryNote, 500);
  if (value.remember === true && !memoryNote) invalid("请写下你希望保存的个人偏好。");
  if (memoryNote && value.remember !== true) invalid("请明确选择保存这条个人偏好。");
  return { version, feedback, memoryNote: value.remember === true ? memoryNote : null };
}

export async function recordJourneyFeedback(accountId: string, id: string, value: unknown) {
  const { version, feedback, memoryNote } = parseFeedback(value);
  const current = await getJourney(accountId, id);
  if (current.version !== version) conflict();
  if (feedback.adjustmentAt && feedback.adjustmentAt !== current.plan?.bodyAdjustment?.updatedAt) throw new JourneyError(409, "ADJUSTMENT_CHANGED", "这次调整已变化，请返回最新行程再记录感受。");
  if (!["active", "completed"].includes(current.status)) throw new JourneyError(409, "JOURNEY_NOT_STARTED", "开始旅程后即可记录感受。");
  const feedbackId = randomUUID();
  // D1 batches are atomic. Every insert is conditional on the successful version update;
  // a concurrently edited/deleted journey cannot acquire orphan feedback or memory.
  const database = getDatabase();
  const statements = [
    database.prepare("UPDATE journeys SET version = version + 1, updated_at = unixepoch() WHERE id = ? AND account_id = ? AND version = ? AND status IN ('active', 'completed')").bind(id, accountId, version),
    database.prepare(`INSERT INTO journey_feedback (id, journey_id, account_id, payload_json)
      SELECT ?, id, account_id, ? FROM journeys WHERE id = ? AND account_id = ? AND version = ? AND changes() = 1`)
      .bind(feedbackId, JSON.stringify(feedback), id, accountId, version + 1),
  ];
  if (memoryNote) statements.push(database.prepare(`INSERT INTO journey_memories (id, account_id, feedback_id, note)
    SELECT ?, account_id, id, ? FROM journey_feedback WHERE id = ? AND account_id = ? AND changes() = 1`)
    .bind(randomUUID(), memoryNote, feedbackId, accountId));
  const timezone=current.draft.trip?.destinationTimezone || "Asia/Shanghai",now=new Date();
  const localDate=new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
  if(feedback.fatigue!=null || feedback.subjectiveStress!=null)statements.push(database.prepare(`INSERT INTO body_check_ins(id,account_id,journey_id,local_date,timezone,payload_json,request_key,request_hash)
    SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM journey_feedback WHERE id=? AND account_id=?)`).bind(randomUUID(),accountId,id,localDate,timezone,JSON.stringify({fatigue:feedback.fatigue??null,stress:feedback.subjectiveStress??null,tags:[],source:feedback.adjustmentAt?"adjustment_outcome":"self_report"}),`legacy:${feedbackId}`,feedbackId,feedbackId,accountId));
  const adjustmentId=feedback.adjustmentAt?current.plan?.bodyAdjustment?.id:undefined;
  if(adjustmentId){
    const before=current.plan?.bodyAdjustment?.fatigueBefore,after=feedback.fatigue;
    const feeling=after!=null && before!=null?(after<before?"lighter":after>before?"still_tired":"same"):/还是.*累/.test(feedback.note??"")?"still_tired":/轻松/.test(feedback.note??"")?"lighter":/差不多/.test(feedback.note??"")?"same":null;
    if(feeling)statements.push(database.prepare(`UPDATE journey_adjustments SET outcome_json=?,outcome_key=?,outcome_hash=? WHERE id=? AND account_id=? AND journey_id=? AND outcome_json IS NULL AND EXISTS(SELECT 1 FROM journey_feedback WHERE id=? AND account_id=?)`).bind(JSON.stringify({id:feedbackId,adjustmentId,journeyId:id,recordedAt:now.toISOString(),localDate,feeling,fatigue:after??null,stress:feedback.subjectiveStress??null,note:feedback.note??""}),`legacy:${feedbackId}`,feedbackId,adjustmentId,accountId,id,feedbackId,accountId));
  }
  const results = await database.batch(statements);
  if (results[0].meta.changes !== 1) conflict();
  // An in-trip feeling is the strongest signal BioTrip gets about what the
  // traveller wants next time.
  await learnFromFeedback(accountId, feedback);
  return { journey: await getJourney(accountId, id), feedbackId, remembered: Boolean(memoryNote) };
}

export async function listJourneyFeedback(accountId: string, id: string): Promise<JourneyFeedback[]> {
  await getJourney(accountId, id);
  const rows = await getDatabase().prepare(`SELECT f.id, f.payload_json, f.created_at,
    EXISTS (SELECT 1 FROM journey_memories m WHERE m.feedback_id = f.id AND m.account_id = f.account_id) AS remembered
    FROM journey_feedback f WHERE f.journey_id = ? AND f.account_id = ? ORDER BY f.created_at DESC, f.id DESC LIMIT 100`)
    .bind(id, accountId).all<{ id: string; payload_json: string; created_at: number; remembered: number }>();
  return rows.results.map((row) => ({ ...JSON.parse(row.payload_json) as JourneyFeedbackInput, id: row.id, journeyId: id, createdAt: iso(row.created_at)!, remembered: Boolean(row.remembered) }));
}

export async function listJourneyMemories(accountId: string): Promise<JourneyMemory[]> {
  const rows = await getDatabase().prepare(`SELECT m.id, f.journey_id, m.note, m.created_at FROM journey_memories m
    JOIN journey_feedback f ON f.id = m.feedback_id AND f.account_id = m.account_id
    WHERE m.account_id = ? ORDER BY m.created_at DESC, m.id DESC LIMIT 50`).bind(accountId)
    .all<{ id: string; journey_id: string; note: string; created_at: number }>();
  return rows.results.map((row) => ({ id: row.id, journeyId: row.journey_id, note: row.note, createdAt: iso(row.created_at)! }));
}
export async function forgetJourneyMemory(accountId: string, id: string) {
  requireJourneyId(id);
  const result = await getDatabase().prepare("DELETE FROM journey_memories WHERE id = ? AND account_id = ?").bind(id, accountId).run();
  if (result.meta.changes !== 1) throw new JourneyError(404, "MEMORY_NOT_FOUND", "这条偏好不存在。");
}
