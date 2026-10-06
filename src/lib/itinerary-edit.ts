import { isCalendarDate, MAX_TRIP_DAYS, parseSchedule, type ScheduleItem } from "./planner-input";
import type { ActivityEffort, ActivityKind, ActivityMove, JourneyGeneratedPlan, JourneyTripDraft } from "./journey-types";

export type ItineraryItem = JourneyGeneratedPlan["plan"]["itinerary"][number];
/** Structured facts about an activity; a closed vocabulary rather than free text. */
export type ActivityTagFields = { kind?: ActivityKind; effort?: ActivityEffort; durationMin?: number; move?: ActivityMove };
export type ItineraryOperation =
  | ({ type: "add"; id?: string; sourceUrl?: string; date: string; time: string; name: string; detail: string; fixed: boolean } & ActivityTagFields)
  | { type: "remove"; index: number; activityId?: string; confirmFixed?: boolean }
  | ({ type: "edit"; index: number; activityId?: string; date?: string; time?: string; name?: string; detail?: string; fixed?: boolean; sourceUrl?: string } & ActivityTagFields)
  | { type: "move"; index: number; activityId?: string; toIndex: number; toActivityId?: string };
/** IDs are internal identity, never a model-provided claim or an ownership credential. */
export function validActivityId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{8,100}$/.test(value);
}
function legacyActivityId(namespace: string, item: ItineraryItem, index: number): string {
  const text = JSON.stringify([namespace, index, item.date, item.time, item.name]);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `activity_${index}_${(hash >>> 0).toString(16)}`;
}
/** Legacy reads are deterministic; manual changes and restored versions retain assigned IDs. */
export function withActivityIds(generated: JourneyGeneratedPlan, namespace: string): JourneyGeneratedPlan {
  const used = new Set<string>();
  return { ...generated, plan: { ...generated.plan, itinerary: generated.plan.itinerary.map((item, index) => {
    let id = validActivityId(item.id) && !used.has(item.id) ? item.id : legacyActivityId(namespace, item, index);
    while (used.has(id)) id += "_";
    used.add(id);
    return { ...item, id };
  }) } };
}
/** Only uniquely identified matches inherit IDs. Ambiguous repeated activities stay distinct. */
export function identifyGeneratedActivities(generated: JourneyGeneratedPlan, namespace: string, previous?: JourneyGeneratedPlan | null): JourneyGeneratedPlan {
  const old = previous ? withActivityIds(previous, namespace).plan.itinerary : [];
  const used = new Set<string>();
  const signature = (item: ItineraryItem, exact: boolean) => JSON.stringify([item.date ?? "", item.name, ...(exact ? [item.time] : [])]);
  const next = generated.plan.itinerary;
  const itinerary = next.map(item => {
    let match: ItineraryItem | undefined;
    for (const exact of [true, false]) {
      const key = signature(item, exact);
      const candidates = old.filter(row => signature(row, exact) === key);
      if (candidates.length === 1 && next.filter(row => signature(row, exact) === key).length === 1 && !used.has(candidates[0].id!)) { match = candidates[0]; break; }
    }
    const id = match?.id ?? crypto.randomUUID();
    used.add(id);
    return { ...item, id };
  });
  return { ...generated, plan: { ...generated.plan, itinerary } };
}

export type ReservationChange = { beforeIndex: number; before: ItineraryItem; after: ItineraryItem | null };
export const MAX_ITINERARY_OPERATIONS = 100;

/** Browser-safe validation shared with the authenticated save endpoint. */
export class ItineraryEditError extends Error {
  readonly code = "INVALID_ITINERARY";
  constructor(message: string) { super(message); }
}
function fail(message: string): never { throw new ItineraryEditError(message); }
function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) fail("行程修改包含不支持的字段。");
}
function index(value: unknown, length: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value >= length) fail("这项安排已变化，请重新打开行程。");
  return value;
}
function boundedText(value: unknown, maximum: number, name: boolean): string {
  if (typeof value !== "string" || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) fail(`内容最多 ${maximum} 个字符，请精简后重试。`);
  const result = value.trim();
  if (name && (!result || /[\r\n|｜]/.test(result))) fail("活动名称不能为空，也不能包含换行或竖线。");
  return result;
}
function clock(value: unknown): string {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) fail("请选择有效的小时和分钟。");
  return value;
}

const ACTIVITY_KINDS: ReadonlySet<string> = new Set(["sight", "meal", "rest", "relax", "stay", "experience", "transit", "other"]);
const MOVE_MODES: ReadonlySet<string> = new Set(["walk", "transit", "taxi", "none"]);
function sourceLink(value: unknown): string {
  if (typeof value !== "string" || value.length > 4096) fail("活动来源无效。");
  try { const url = new URL(value); if (url.protocol !== "https:" || url.username || url.password) fail("活动来源必须是公开 HTTPS 链接。"); }
  catch { fail("活动来源必须是公开 HTTPS 链接。"); }
  return value;
}
function bounded(value: unknown, maximum: number, integer: boolean, message: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > maximum || (integer && !Number.isInteger(value))) fail(message);
  return value;
}
/** Tags only ever hold enumerations and bounded numbers, so no prose or link can travel through them. */
function tagFields(operation: Record<string, unknown>): ActivityTagFields {
  const tags: ActivityTagFields = {};
  if (operation.kind !== undefined) {
    if (typeof operation.kind !== "string" || !ACTIVITY_KINDS.has(operation.kind)) fail("活动类型无效。");
    tags.kind = operation.kind as ActivityKind;
  }
  if (operation.effort !== undefined) {
    if (operation.effort !== 1 && operation.effort !== 2 && operation.effort !== 3) fail("活动强度无效。");
    tags.effort = operation.effort;
  }
  if (operation.durationMin !== undefined) {
    const minutes = bounded(operation.durationMin, 720, true, "活动时长请填写 5–720 分钟。");
    if (minutes < 5) fail("活动时长请填写 5–720 分钟。");
    tags.durationMin = minutes;
  }
  if (operation.move !== undefined) {
    const move = operation.move;
    if (!record(move)) fail("交通方式无效。");
    keys(move, ["mode", "minutes", "km", "costCny", "basis"]);
    if (typeof move.mode !== "string" || !MOVE_MODES.has(move.mode)) fail("交通方式无效。");
    if (move.basis !== undefined && move.basis !== "amap" && move.basis !== "unverified") fail("交通数据来源无效。");
    tags.move = {
      mode: move.mode as ActivityMove["mode"],
      ...(move.minutes !== undefined ? { minutes: bounded(move.minutes, 600, true, "交通时长无效。") } : {}),
      ...(move.km !== undefined ? { km: bounded(move.km, 500, false, "交通距离无效。") } : {}),
      ...(move.costCny !== undefined ? { costCny: bounded(move.costCny, 5000, false, "交通费用无效。") } : {}),
      ...(move.basis !== undefined ? { basis: move.basis } : {}),
    };
  }
  return tags;
}

/** Existing dated plans may start a day after departure when crossing time zones. */
export function itineraryDates(itinerary: readonly ItineraryItem[], trip: JourneyTripDraft): string[] {
  const existing = itinerary.map((item) => item.date).filter(isCalendarDate).sort();
  const start = existing[0] ?? trip.departureDate;
  const end = trip.returnDate || existing[existing.length - 1] || start;
  if (!isCalendarDate(start) || !isCalendarDate(end) || end < start) fail("请先确认这份旅程的旅行日期。");
  const first = Date.parse(`${start}T00:00:00Z`), last = Date.parse(`${end}T00:00:00Z`);
  const count = Math.round((last - first) / 86_400_000) + 1;
  if (count > MAX_TRIP_DAYS) fail(`单份行程最多 ${MAX_TRIP_DAYS} 天。`);
  return Array.from({ length: count }, (_, day) => new Date(first + day * 86_400_000).toISOString().slice(0, 10));
}

/**
 * Indices refer to the current list after each preceding operation. Moving a
 * flexible activity reuses the original flexible time slots; fixed rows keep
 * their position and clock time even when a move crosses them.
 */
export function applyItineraryOperations(
  itinerary: readonly ItineraryItem[], operations: readonly ItineraryOperation[], trip: JourneyTripDraft,
): { itinerary: ItineraryItem[]; reservationChanges: ReservationChange[] } {
  if (!Array.isArray(itinerary) || !itinerary.length || itinerary.length > 100) fail("这份行程无法手动调整，请重新生成。");
  if (!Array.isArray(operations) || !operations.length || operations.length > MAX_ITINERARY_OPERATIONS) fail(`一次请提交 1–${MAX_ITINERARY_OPERATIONS} 项调整。`);
  const dates = itineraryDates(itinerary, trip);
  const rows = itinerary.map((item, sourceIndex) => ({ sourceIndex, item: { ...item, date: item.date ?? dates[0] } }));
  const explicitlyEdited = new Set<number>();
  const removed: ReservationChange[] = [];
  const originalSlots = new Map<string, number>();
  for (const { item } of rows) {
    const slot = `${item.date}T${item.time}`;
    originalSlots.set(slot, (originalSlots.get(slot) ?? 0) + 1);
  }
  for (const operation of operations as readonly unknown[]) {
    if (!record(operation)) fail("行程修改格式无效。");
    if (operation.type === "add") {
      keys(operation, ["type", "id", "sourceUrl", "date", "time", "name", "detail", "fixed", "kind", "effort", "durationMin", "move"]);
      if (rows.length >= 100) fail("一份行程最多 100 项安排。");
      if (!isCalendarDate(operation.date) || !dates.includes(operation.date)) fail("活动日期必须在本次旅程内。");
      if (typeof operation.fixed !== "boolean") fail("请选择固定或灵活安排。");
      if (operation.sourceUrl !== undefined) sourceLink(operation.sourceUrl);
      const id = operation.id ?? crypto.randomUUID();
      if (!validActivityId(id) || rows.some(row => row.item.id === id) || itinerary.some(row => row.id === id)) fail("新增活动标识无效或重复。");
      rows.push({ sourceIndex: -1, item: { id, ...(operation.sourceUrl ? { sourceUrl: operation.sourceUrl as string } : {}), date: operation.date, time: clock(operation.time),
        name: boundedText(operation.name, 120, true), detail: boundedText(operation.detail, 1500, false), fixed: operation.fixed, ...tagFields(operation) } });
      rows.sort((a, b) => `${a.item.date}T${a.item.time}`.localeCompare(`${b.item.date}T${b.item.time}`));
      continue;
    }
    const position = index(operation.index, rows.length);
    if (operation.activityId !== undefined && (!validActivityId(operation.activityId) || rows[position].item.id !== operation.activityId)) fail("活动位置已变化，请重新打开后再修改。");
    if (operation.type === "remove") {
      keys(operation, ["type", "index", "activityId", "confirmFixed"]);
      if (operation.confirmFixed !== undefined && typeof operation.confirmFixed !== "boolean") fail("请明确确认移除固定预约。");
      if (rows[position].item.fixed && operation.confirmFixed !== true) fail("移除固定预约需要单独确认；不会取消供应商的订单。");
      const [row] = rows.splice(position, 1);
      if (row.sourceIndex >= 0) removed.push({ beforeIndex: row.sourceIndex, before: { ...itinerary[row.sourceIndex] }, after: null });
    } else if (operation.type === "move") {
      keys(operation, ["type", "index", "activityId", "toIndex", "toActivityId"]);
      const target = index(operation.toIndex, rows.length);
      if (operation.toActivityId !== undefined && (!validActivityId(operation.toActivityId) || rows[target].item.id !== operation.toActivityId)) fail("目标活动已变化，请重新打开后再排序。");
      if (rows[position].item.fixed || rows[target].item.fixed) fail("固定预约不能自动移动；如需修改，请明确编辑日期和时分。");
      if (rows[position].item.date !== rows[target].item.date) fail("排序只能调整同一天的灵活安排，跨日请编辑日期。");
      const slots = rows.map((row, slot) => ({ row, slot })).filter(({ row }) => row.item.date === rows[position].item.date && !row.item.fixed);
      const times = slots.map(({ row }) => row.item.time);
      const from = slots.findIndex(({ slot }) => slot === position), to = slots.findIndex(({ slot }) => slot === target);
      const reordered = slots.map(({ row }) => row);
      reordered.splice(to, 0, reordered.splice(from, 1)[0]);
      slots.forEach(({ slot }, ordinal) => { rows[slot] = { ...reordered[ordinal], item: { ...reordered[ordinal].item, time: times[ordinal] } }; });
    } else if (operation.type === "edit") {
      keys(operation, ["type", "index", "activityId", "date", "time", "name", "detail", "fixed", "sourceUrl", "kind", "effort", "durationMin", "move"]);
      if (!Object.keys(operation).some((key) => key !== "type" && key !== "index" && key !== "activityId")) fail("请填写需要修改的内容。");
      const item = { ...rows[position].item };
      explicitlyEdited.add(rows[position].sourceIndex);
      if (operation.date !== undefined) {
        if (!isCalendarDate(operation.date) || !dates.includes(operation.date)) fail("活动日期必须在本次旅程内。");
        item.date = operation.date;
      }
      if (operation.time !== undefined) item.time = clock(operation.time);
      if (operation.name !== undefined) item.name = boundedText(operation.name, 120, true);
      if (operation.detail !== undefined) item.detail = boundedText(operation.detail, 1500, false);
      if (operation.fixed !== undefined) {
        if (typeof operation.fixed !== "boolean") fail("请选择固定或灵活安排。");
        item.fixed = operation.fixed;
      }
      if (operation.sourceUrl !== undefined) item.sourceUrl = sourceLink(operation.sourceUrl);
      Object.assign(item, tagFields(operation));
      rows[position].item = item;
      rows.sort((a, b) => `${a.item.date}T${a.item.time}`.localeCompare(`${b.item.date}T${b.item.time}`));
    } else fail("不支持这项行程修改。");
  }
  const covered = new Set<string>();
  const finalSlots = new Map<string, number>();
  let previous = "";
  for (const { item } of rows) {
    if (!item.date || !dates.includes(item.date)) fail("活动日期必须在本次旅程内。");
    clock(item.time);
    const instant = `${item.date}T${item.time}`;
    if (instant < previous) fail("行程时间不能倒序，请先修改时分再排序。");
    previous = instant;
    finalSlots.set(instant, (finalSlots.get(instant) ?? 0) + 1);
    covered.add(item.date);
  }
  if (dates.some((date) => !covered.has(date))) fail("每天至少保留一项安排，不能让某一天的行程为空。");
  if ([...finalSlots].some(([slot, count]) => count > 1 && count > (originalSlots.get(slot) ?? 0))) fail("这一天已有同一时分的安排，请选择其他时间。");
  const reservationChanges: ReservationChange[] = [...removed, ...rows.flatMap(({ sourceIndex, item }) => {
    if (sourceIndex === -1) return item.fixed ? [{ beforeIndex: -1, before: { ...item }, after: { ...item } }] : [];
    const before = itinerary[sourceIndex];
    return (before.date ?? dates[0]) !== item.date || ["time", "name", "fixed"].some((key) => before[key as keyof ItineraryItem] !== item[key as keyof ItineraryItem]) || (item.fixed && explicitlyEdited.has(sourceIndex))
      ? [{ beforeIndex: sourceIndex, before: { ...before }, after: { ...item } }] : [];
  })];
  return { itinerary: rows.map(({ item }) => item), reservationChanges };
}

/** Update matched original reservations, including those explicitly marked flexible. */
export function syncItineraryReservations(
  text: string, original: readonly ItineraryItem[], changes: readonly ReservationChange[], firstDate: string,
): string {
  const reservations = parseSchedule(text);
  if (!reservations) fail("原预约格式有误，请先修复预约内容；已有行程仍保留。");
  let changed = false;
  const used = new Set<number>();
  const next: ScheduleItem[] = reservations.flatMap((reservation) => {
    const candidates = original.map((item, position) => ({ item, position })).filter(({ item, position }) =>
      !used.has(position) && item.name === reservation.name && item.fixed === reservation.fixed &&
      (!reservation.date || (item.date ?? firstDate) === reservation.date));
    const match = candidates.find(({ item }) => item.time === reservation.time) ??
      (!reservation.fixed && candidates.length === 1 ? candidates[0] : undefined);
    if (!match) return [reservation];
    used.add(match.position);
    const change = changes.find((item) => item.beforeIndex === match.position);
    if (!change) return [reservation];
    const after = change.after;
    if (!after) { changed = true; return []; }
    const result = { ...reservation, time: after.time, name: after.name, fixed: after.fixed,
      ...(reservation.date || after.date !== (match.item.date ?? firstDate) ? { date: after.date } : {}) };
    if (JSON.stringify(result) !== JSON.stringify(reservation)) changed = true;
    return [result];
  });
  for (const change of changes) {
    // A generated flexible item explicitly protected by the traveller becomes
    // a draft reservation too, so a subsequent generation cannot discard it.
    if (!used.has(change.beforeIndex) && change.after?.fixed) {
      next.push({ date: change.after.date ?? firstDate, time: change.after.time, name: change.after.name, fixed: true });
      changed = true;
    }
  }
  if (!changed) return text;
  const result = next.map((item) => `${item.date ? `${item.date} ` : ""}${item.time} | ${item.name} | ${item.fixed ? "固定" : "灵活"}`).join("\n");
  if (result.length > 6000 || !parseSchedule(result)) fail("修改后的预约最多 30 项、6000 字；请精简活动名称。");
  return result;
}

/**
 * Rebase untouched pending reservations only. Manual edits preserve the saved
 * reservation order; any new protected generated item is appended. Pending
 * edits and deletions remain owned by the traveller, while newly protected
 * generated items are carried forward to the next replan.
 */
export function rebasePendingReservations(oldBaseText: string, newBaseText: string, pendingText: string, removedItems: readonly ItineraryItem[] = []): string {
  const beforeRows = parseSchedule(oldBaseText), after = parseSchedule(newBaseText), pendingRows = parseSchedule(pendingText);
  const removed = (item: ScheduleItem) => removedItems.some((row) => row.name === item.name && row.time === item.time && row.fixed === item.fixed && (!item.date || item.date === row.date));
  const before = beforeRows?.filter((item) => !removed(item)), pending = pendingRows?.filter((item) => !removed(item));
  if (!before || !after || !pending || before.length > after.length) fail("未保存预约无法安全合并，请先保留并检查这些预约。");
  if (pendingText === oldBaseText) return newBaseText;
  const canonical = (item: ScheduleItem) => JSON.stringify({ date: item.date ?? "", time: item.time, name: item.name, fixed: item.fixed });
  const used = new Set<number>();
  let changed = pendingRows!.length !== pending.length;
  const next = pending.map((item) => {
    const position = before.findIndex((old, index) => !used.has(index) && canonical(old) === canonical(item));
    if (position < 0) return item;
    used.add(position);
    if (canonical(before[position]) === canonical(after[position])) return item;
    changed = true;
    return after[position];
  });
  for (const item of after.slice(before.length)) {
    if (!next.some((existing) => canonical(existing) === canonical(item))) { next.push(item); changed = true; }
  }
  if (!changed) return pendingText;
  const result = next.map((item) => `${item.date ? `${item.date} ` : ""}${item.time} | ${item.name} | ${item.fixed ? "固定" : "灵活"}`).join("\n");
  if (result.length > 6000 || !parseSchedule(result)) fail("合并后的预约超过 30 项或 6000 字，请先保留未保存预约并精简内容。");
  return result;
}
