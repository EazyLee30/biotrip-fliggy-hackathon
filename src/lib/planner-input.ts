const SERVICE_TYPES = new Set([
  "flights", "hotels", "attractions", "transport", "travel_insurance",
  "local_food", "relaxation", "onsen", "massage", "medical_info",
]);
const ALLOWED_AMBIENCE = new Set(["安静少噪", "自然气息", "柔和光线", "人少宽松"]);
const INTENTIONS = new Set(["安静恢复", "慢慢探索", "补充活力", "未指定"]);
const COLORS = new Set(["松林绿", "湖水蓝", "暖光橙", "不限色调", "未指定"]);

export type ScheduleItem = { time: string; name: string; fixed: boolean; date?: string };

/**
 * The traveller picks dates, not clock times. Precise times become a labelled
 * planning assumption derived server-side, so the interface needs one tap per
 * trip while the itinerary can still reason about arrival windows and jet lag.
 */
export const ASSUMED_DEPARTURE_HOUR = 9;
export const ASSUMED_ARRIVAL_HOUR = 15;
export const MAX_TRIP_DAYS = 30;

export type TripInput = {
  originCity: string;
  destinationCity: string;
  /** First day of the trip, `YYYY-MM-DD`. */
  departureDate: string;
  departureTimezone: string;
  destinationTimezone: string;
  /** Last day of the trip, `YYYY-MM-DD`; empty means an open-ended trip. */
  returnDate: string;
  planningStyle: "flexible" | "structured";
  paceLevel?: "gentle" | "balanced" | "active";
  guardrails?: { morningLight: boolean; protectReservations: boolean; sensoryBreaks: boolean };
  itineraryText: string;
  requestedServices: string[];
  foodPreferences: string;
};
export type PlannerInput = {
  intention: string;
  colorTone: string;
  fatigue: number | null;
  subjectiveStress: number | null;
  ambientPreferences: string[];
  bodyFeedback?: string;
  moodFeedback?: string;
  profileMemoryNotes: string;
  trip: TripInput;
  consent: true;
};
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function hasRecentWhoopSignal(value: unknown) {
  if (!isRecord(value)) return false;
  return ["cycles", "recoveries", "sleeps", "workouts"].some(
    (key) => Array.isArray(value[key]) && (value[key] as unknown[]).length > 0,
  );
}

/** Local wall-clock string for a date under an assumed hour, e.g. `2026-10-12T15:00`. */
export function localDateTimeAt(date: string, hour: number) {
  return `${date}T${String(hour).padStart(2, "0")}:00`;
}

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
}

/** Bound one generated itinerary to the output and latency budget. */
export function planningDateError(start: unknown, end: unknown): string | null {
  if (!isCalendarDate(start) || (end !== "" && !isCalendarDate(end))) return "请选择有效的旅行日期。";
  if (end === "") return null;
  if (end < start) return "返程日期应晚于或等于出发日期。";
  const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
  return days > MAX_TRIP_DAYS ? `单次最多规划 ${MAX_TRIP_DAYS} 天，较长旅程请分段规划。` : null;
}

function hasTimezone(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 80) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

type ScheduleParseResult = { items: ScheduleItem[]; error: null } | { items: null; error: string };

function readSchedule(text: string): ScheduleParseResult {
  const rows = text.split(/\r\n|\n|\r/).map((line, index) => ({ text: line.trim(), line: index + 1 })).filter((row) => row.text);
  const fail = (line: number, message: string): ScheduleParseResult => ({ items: null, error: `第 ${line} 行：${message}` });
  if (rows.length > 30) return fail(rows[30].line, "最多填写 30 条活动，请减少活动数量。");
  const items: ScheduleItem[] = [];
  for (const row of rows) {
    let content = row.text;
    let date: string | undefined;
    const firstToken = content.match(/^(\S+)(?:\s+|$)/)?.[1];
    if (firstToken && /^\d{4}[-/]/.test(firstToken)) {
      if (!isCalendarDate(firstToken)) return fail(row.line, "日期无效，请使用真实的 YYYY-MM-DD 日期。");
      date = firstToken;
      content = content.slice(firstToken.length).trim();
    }
    const parts = content.split(/[|｜]/).map((part) => part.trim());
    if (parts.length > 3) return fail(row.line, "管道格式应为「13:00 | 活动名称 | 固定/灵活」。");
    const clock = parts[0].match(/^(\d{1,2})[:：](\d{2})(?:\s+(.*))?$/);
    if (!clock) return fail(row.line, "时间格式无效，请使用 H:mm 或 HH:mm（如 13:00），并与活动名称分开。");
    const hour = Number(clock[1]);
    const minute = Number(clock[2]);
    if (hour > 23 || minute > 59) return fail(row.line, "时间无效：小时应为 0–23，分钟应为 00–59。");

    let name = clock[3]?.trim() ?? "";
    let marker: string | undefined;
    if (parts.length === 3) {
      if (name) return fail(row.line, "管道格式应为「13:00 | 活动名称 | 固定/灵活」。");
      name = parts[1];
      marker = parts[2];
    } else if (parts.length === 2) {
      marker = parts[1];
    }
    if (!name) return fail(row.line, "请填写活动名称（如「13:00 活动名称」）。");
    if (name.length > 120) return fail(row.line, "活动名称最多 120 个字符。");
    if (marker !== undefined && marker !== "固定" && marker !== "灵活") {
      return fail(row.line, "活动标记只能填写「固定」或「灵活」。");
    }
    const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    items.push({ time, name, fixed: marker !== "灵活", ...(date ? { date } : {}) });
  }
  return { items, error: null };
}

/** Shared strict parser: existing reservations default to fixed; omitted dates remain unset. */
export function parseSchedule(text: string): ScheduleItem[] | null {
  return readSchedule(text).items;
}

/** Returns the first actionable error using the original text's line numbers. */
export function scheduleError(text: string): string | null {
  return readSchedule(text).error;
}

export function validateInput(value: unknown): PlannerInput | null {
  if (!isRecord(value) || !isRecord(value.trip)) return null;
  const { intention, colorTone, fatigue, subjectiveStress, ambientPreferences, bodyFeedback, moodFeedback, profileMemoryNotes, consent } = value;
  const trip = value.trip;
  const requestedServices = trip.requestedServices;
  if (
    typeof intention !== "string" || !INTENTIONS.has(intention) ||
    typeof colorTone !== "string" || !COLORS.has(colorTone) ||
    (fatigue !== null && (typeof fatigue !== "number" || !Number.isInteger(fatigue) || fatigue < 1 || fatigue > 5)) ||
    (subjectiveStress !== null && (typeof subjectiveStress !== "number" || !Number.isInteger(subjectiveStress) || subjectiveStress < 1 || subjectiveStress > 5)) ||
    !Array.isArray(ambientPreferences) || ambientPreferences.length > 4 ||
    ambientPreferences.some((item) => typeof item !== "string" || !ALLOWED_AMBIENCE.has(item)) ||
    consent !== true ||
    (bodyFeedback !== undefined && (typeof bodyFeedback !== "string" || bodyFeedback.length > 80)) ||
    (moodFeedback !== undefined && (typeof moodFeedback !== "string" || moodFeedback.length > 80)) ||
    typeof profileMemoryNotes !== "string" || profileMemoryNotes.length > 5000 ||
    typeof trip.originCity !== "string" || !trip.originCity.trim() || trip.originCity.length > 100 ||
    typeof trip.destinationCity !== "string" || !trip.destinationCity.trim() || trip.destinationCity.length > 100 ||
    !isCalendarDate(trip.departureDate) ||
    !hasTimezone(trip.departureTimezone) || !hasTimezone(trip.destinationTimezone) ||
    typeof trip.returnDate !== "string" || (trip.returnDate !== "" && !isCalendarDate(trip.returnDate)) ||
    typeof trip.planningStyle !== "string" || !["flexible", "structured"].includes(trip.planningStyle) ||
    typeof trip.itineraryText !== "string" || trip.itineraryText.length > 6000 ||
    !Array.isArray(requestedServices) || requestedServices.length > SERVICE_TYPES.size ||
    requestedServices.some((item) => typeof item !== "string" || !SERVICE_TYPES.has(item)) ||
    typeof trip.foodPreferences !== "string" || trip.foodPreferences.length > 500
  ) return null;

  if (!parseSchedule(trip.itineraryText)) return null;
  // A return date earlier than departure is a picker mistake, not a request to
  // invert the trip.
  if (planningDateError(trip.departureDate, trip.returnDate)) return null;
  const paceLevel = trip.paceLevel === undefined ? undefined : String(trip.paceLevel);
  if (paceLevel !== undefined && !["gentle", "balanced", "active"].includes(paceLevel)) return null;
  const rawGuardrails = trip.guardrails;
  const guardrails = isRecord(rawGuardrails) ? {
    morningLight: rawGuardrails.morningLight === true,
    protectReservations: rawGuardrails.protectReservations === true,
    sensoryBreaks: rawGuardrails.sensoryBreaks === true,
  } : undefined;
  return {
    intention,
    colorTone,
    fatigue: typeof fatigue === "number" ? fatigue : null,
    subjectiveStress: typeof subjectiveStress === "number" ? subjectiveStress : null,
    ambientPreferences: ambientPreferences as string[],
    ...(typeof bodyFeedback === "string" ? { bodyFeedback } : {}),
    ...(typeof moodFeedback === "string" ? { moodFeedback } : {}),
    profileMemoryNotes: profileMemoryNotes.trim(),
    consent: true,
    trip: {
      originCity: trip.originCity.trim(),
      destinationCity: trip.destinationCity.trim(),
      departureDate: trip.departureDate as string,
      departureTimezone: trip.departureTimezone,
      destinationTimezone: trip.destinationTimezone,
      returnDate: trip.returnDate,
      planningStyle: trip.planningStyle as "flexible" | "structured",
      ...(paceLevel ? { paceLevel: paceLevel as "gentle" | "balanced" | "active" } : {}),
      ...(guardrails ? { guardrails } : {}),
      itineraryText: trip.itineraryText.trim(),
      requestedServices: requestedServices as string[],
      foodPreferences: trip.foodPreferences.trim(),
    },
  };
}

export function offsetMinutesAt(instant: Date, timezone: string) {
  const zoneLabel = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "shortOffset" })
    .formatToParts(instant).find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = zoneLabel.match(/GMT(?:(\+|−|-)(\d{1,2})(?::?(\d{2}))?)?/);
  if (!match) throw new Error("Could not resolve a time zone offset.");
  const sign = match[1] === "-" || match[1] === "−" ? -1 : 1;
  return sign * ((Number(match[2] ?? 0) * 60) + Number(match[3] ?? 0));
}

export function localDateTimeAsInstant(local: string, timezone: string) {
  const [date, time] = local.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const nominalUtc = Date.UTC(year, month - 1, day, hour, minute);
  let guess = nominalUtc;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    guess = nominalUtc - offsetMinutesAt(new Date(guess), timezone) * 60_000;
  }
  const resolved = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(guess));
  const fields = Object.fromEntries(resolved.map(({ type, value }) => [type, value]));
  const resolvedLocal = `${fields.year}-${fields.month}-${fields.day}T${fields.hour}:${fields.minute}`;
  if (resolvedLocal !== local) throw new Error("行程时间落在目的地夏令时切换缺口内，请换一个当地时间。");
  return new Date(guess);
}
