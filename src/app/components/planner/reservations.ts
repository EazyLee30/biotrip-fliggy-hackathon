import { isCalendarDate, MAX_TRIP_DAYS, parseSchedule, scheduleError, type ScheduleItem } from "@/lib/planner-input";

export type ReservationDraft = { date: string; time: string; activity: string; location: string; fixed: boolean };
export type ReservationChange = { value: string; error: null } | { value: null; error: string };

const LOCATION_PREFIX = "（地点：";
const SEPARATORS = /[\r\n\u2028\u2029|｜]/;

/** Calendar days are independent of the browser's zone. An open trip currently plans its first day. */
export function reservationDates(start: string, end: string): string[] {
  if (!isCalendarDate(start) || (end && !isCalendarDate(end)) || (end && end < start)) return [];
  const first = Date.parse(`${start}T00:00:00Z`);
  const last = Date.parse(`${end || start}T00:00:00Z`);
  const count = Math.round((last - first) / 86_400_000) + 1;
  if (count > MAX_TRIP_DAYS) return [];
  return Array.from({ length: count }, (_, index) => new Date(first + index * 86_400_000).toISOString().slice(0, 10));
}

/** Only the explicit, complete trailing place suffix is interpreted as a place. */
export function decodeReservationName(name: string): { activity: string; location: string } {
  const position = name.indexOf(LOCATION_PREFIX);
  if (position <= 0 || !name.endsWith("）")) return { activity: name, location: "" };
  const activity = name.slice(0, position), location = name.slice(position + LOCATION_PREFIX.length, -1);
  return activity.trim() && location.trim() ? { activity, location } : { activity: name, location: "" };
}

export function reservationNameError(activity: string, location: string): string | null {
  if (!activity.trim()) return "请填写活动名称。";
  if (SEPARATORS.test(activity) || SEPARATORS.test(location)) return "活动和地点不能包含换行或竖线。";
  if (activity.includes(LOCATION_PREFIX)) return "请将地点填在地点栏。";
  const name = `${activity.trim()}${location.trim() ? `${LOCATION_PREFIX}${location.trim()}）` : ""}`;
  return name.length > 120 ? "活动与地点合计最多 120 个字符，请缩短填写内容。" : null;
}

export function encodeReservationName(activity: string, location: string): string | null {
  if (reservationNameError(activity, location)) return null;
  return `${activity.trim()}${location.trim() ? `${LOCATION_PREFIX}${location.trim()}）` : ""}`;
}

export function reservationDraftError(draft: ReservationDraft, start: string, end: string): string | null {
  const dates = reservationDates(start, end);
  if (!dates.length) return "请先选择有效的旅行日期。";
  if (!isCalendarDate(draft.date)) return "请选择这项预约的具体日期。";
  if (!dates.includes(draft.date)) return "预约日期必须在本次旅程内。";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.time)) return "请分别点选或滑动选择小时和分钟。";
  return reservationNameError(draft.activity, draft.location);
}

/** Serialize existing parsed entries directly, so editing another entry never rewrites its name or flag. */
export function serializeReservations(items: ScheduleItem[]): ReservationChange {
  if (items.length > 30) return { value: null, error: "最多添加 30 项预约。" };
  const value = items.map((item) => `${item.date ? `${item.date} ` : ""}${item.time} | ${item.name} | ${item.fixed ? "固定" : "灵活"}`).join("\n");
  if (value.length > 6000) return { value: null, error: "预约内容最多 6000 个字符。" };
  const error = scheduleError(value);
  return error ? { value: null, error } : { value, error: null };
}

export function reservationTextError(text: string, start: string, end: string): string | null {
  if (text.length > 6000) return "预约内容最多 6000 个字符。";
  const error = scheduleError(text);
  if (error) return error;
  const dates = reservationDates(start, end);
  // Empty content may be saved even before the trip dates are chosen.
  if (!text.trim()) return null;
  if (!dates.length) return "请先选择有效的旅行日期。";
  const lines = text.split(/\r\n|\n|\r/);
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].trim()) continue;
    const item = parseSchedule(lines[index])?.[0];
    if (item?.date && !dates.includes(item.date)) return `第 ${index + 1} 行：预约日期必须在本次旅程内。`;
  }
  return null;
}

/** Prepare a separate review draft. Callers keep the original untouched until explicit confirmation. */
export function recoverReservationCards(text: string, start: string, end: string) {
  const rows = text.split(/\r\n|\n|\r/).map(row => row.trim()).filter(Boolean);
  const items: ScheduleItem[] = [];
  const dates = reservationDates(start, end);
  for (const row of rows) {
    const item = parseSchedule(row)?.[0];
    if (!item || items.length >= 30 || !dates.includes(item.date ?? start)) continue;
    items.push({ ...item, date: item.date ?? start });
  }
  const result = serializeReservations(items);
  const recoveredCount = result.value === null ? 0 : items.length;
  return { value: result.value ?? "", totalCount: rows.length, recoveredCount, pendingCount: rows.length - recoveredCount };
}

export function replaceReservation(text: string, index: number | null, draft: ReservationDraft, start: string, end: string): ReservationChange {
  // A malformed legacy value must be repaired explicitly, never parsed as an empty list.
  const existingError = text.length > 6000 ? "原预约内容超过 6000 个字符，请先在批量编辑中修复。" : scheduleError(text);
  const items = existingError ? null : parseSchedule(text);
  if (!items) return { value: null, error: existingError || "原预约格式有误，请先修复，已有内容仍保留。" };
  if (index !== null && (!Number.isInteger(index) || index < 0 || index >= items.length)) return { value: null, error: "这项预约已变化，请重新打开。" };
  const error = reservationDraftError(draft, start, end);
  if (error) return { value: null, error };
  const item: ScheduleItem = { date: draft.date, time: draft.time, name: encodeReservationName(draft.activity, draft.location)!, fixed: draft.fixed };
  const next = [...items];
  if (index === null) next.push(item); else next[index] = item;
  return serializeReservations(next);
}

export function removeReservation(text: string, index: number): ReservationChange {
  const error = text.length > 6000 ? "原预约内容超过 6000 个字符，请先修复。" : scheduleError(text);
  const items = error ? null : parseSchedule(text);
  if (!items) return { value: null, error: error || "原预约格式有误，已有内容仍保留。" };
  if (!Number.isInteger(index) || index < 0 || index >= items.length) return { value: null, error: "这项预约已变化，请重新打开。" };
  return serializeReservations(items.filter((_, position) => position !== index));
}
