import { randomUUID } from "node:crypto";
import { getDatabase } from "@/lib/auth";
import { learnFromDraft, learnFromFeedback } from "@/lib/preferences";
import type { Journey, JourneyDraft, JourneyFeedback, JourneyFeedbackInput, JourneyGeneratedPlan, JourneyMemory, JourneyStatus, JourneyTripDraft } from "@/lib/journey-types";

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
    onlyKeys(input, ["originCity", "destinationCity", "departureLocal", "arrivalLocal", "departureTimezone", "destinationTimezone", "returnDate", "planningStyle", "itineraryText", "requestedServices", "foodPreferences"]);
    const trip: JourneyTripDraft = {};
    if (input.originCity !== undefined) trip.originCity = text(input.originCity, 100);
    if (input.destinationCity !== undefined) trip.destinationCity = text(input.destinationCity, 100);
    if (input.departureLocal !== undefined) trip.departureLocal = date(input.departureLocal, true);
    if (input.arrivalLocal !== undefined) trip.arrivalLocal = date(input.arrivalLocal, true);
    if (input.departureTimezone !== undefined) trip.departureTimezone = timezone(input.departureTimezone);
    if (input.destinationTimezone !== undefined) trip.destinationTimezone = timezone(input.destinationTimezone);
    if (input.returnDate !== undefined) trip.returnDate = date(input.returnDate, false);
    if (input.planningStyle !== undefined) trip.planningStyle = choice(input.planningStyle, new Set(["flexible", "structured"])) as "flexible" | "structured";
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
    plan: row.plan_json ? JSON.parse(row.plan_json) as JourneyGeneratedPlan : null,
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
    WHERE id = ? AND account_id = ? AND version = ?`).bind(title, JSON.stringify(draft), status, status, status, id, accountId, version).run();
  if (result.meta.changes !== 1) conflict();
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
      .bind(id, accountId, journeyTitle(draft), encodedDraft, encodedPlan, encodedDraft).run();
    return getJourney(accountId, id);
  }
  requireJourneyId(value.journeyId);
  const version = requireVersion(value.expectedVersion);
  const current = await getJourney(accountId, value.journeyId);
  if (current.version !== version) conflict();
  if (current.status === "completed") throw new JourneyError(409, "JOURNEY_COMPLETED", "已完成的旅程不能重新规划。");
  const result = await getDatabase().prepare(`UPDATE journeys SET draft_json = ?, plan_json = ?, plan_draft_json = ?,
    status = CASE WHEN status = 'active' THEN 'active' ELSE 'planned' END,
    version = version + 1, updated_at = unixepoch() WHERE id = ? AND account_id = ? AND version = ? AND status <> 'completed'`)
    .bind(encodedDraft, encodedPlan, encodedDraft, value.journeyId, accountId, version).run();
  if (result.meta.changes !== 1) conflict();
  return getJourney(accountId, value.journeyId);
}

export async function deleteJourney(accountId: string, id: string, version: number) {
  requireJourneyId(id); requireVersion(version);
  const current = await getJourney(accountId, id);
  if (current.version !== version) conflict();
  const result = await getDatabase().prepare("DELETE FROM journeys WHERE id = ? AND account_id = ? AND version = ?").bind(id, accountId, version).run();
  if (result.meta.changes !== 1) conflict();
}

export function parseFeedback(value: unknown) {
  if (!isRecord(value)) invalid();
  onlyKeys(value, ["version", "bodyFeedback", "moodFeedback", "fatigue", "subjectiveStress", "note", "remember", "memoryNote"]);
  const version = requireVersion(value.version);
  const feedback: JourneyFeedbackInput = {};
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
