const SERVICE_TYPES = new Set([
  "flights", "hotels", "attractions", "transport", "travel_insurance",
  "local_food", "relaxation", "onsen", "massage", "medical_info",
]);
const ALLOWED_AMBIENCE = new Set(["安静少噪", "自然气息", "柔和光线", "人少宽松"]);
const INTENTIONS = new Set(["安静恢复", "慢慢探索", "补充活力", "未指定"]);
const COLORS = new Set(["松林绿", "湖水蓝", "暖光橙", "不限色调", "未指定"]);

export type ScheduleItem = { time: string; name: string; fixed: boolean; date?: string };
export type TripInput = {
  originCity: string;
  destinationCity: string;
  departureLocal: string;
  arrivalLocal: string;
  departureTimezone: string;
  destinationTimezone: string;
  returnDate: string;
  planningStyle: "flexible" | "structured";
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

function isLocalDateTime(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return false;
  const [date, time] = value.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const check = new Date(Date.UTC(year, month - 1, day, hour, minute));
  return check.getUTCFullYear() === year && check.getUTCMonth() + 1 === month &&
    check.getUTCDate() === day && hour < 24 && minute < 60;
}

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
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

export function parseSchedule(text: string): ScheduleItem[] | null {
  if (!text.trim()) return [];
  const rows = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (rows.length > 30) return null;
  const items: ScheduleItem[] = [];
  for (const row of rows) {
    const match = row.match(/^(?:(\d{4}-\d{2}-\d{2})\s+)?(\d{2}:\d{2})\s*\|\s*(.{1,120}?)\s*\|\s*(固定|灵活)$/);
    if (!match) return null;
    const [, date, time, name, marker] = match;
    if (date && !isCalendarDate(date)) return null;
    const [hour, minute] = time.split(":").map(Number);
    if (hour > 23 || minute > 59) return null;
    items.push({ time, name: name.trim(), fixed: marker === "固定", ...(date ? { date } : {}) });
  }
  return items;
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
    !isLocalDateTime(trip.departureLocal) || !isLocalDateTime(trip.arrivalLocal) ||
    !hasTimezone(trip.departureTimezone) || !hasTimezone(trip.destinationTimezone) ||
    typeof trip.returnDate !== "string" || (trip.returnDate !== "" && !isCalendarDate(trip.returnDate)) ||
    typeof trip.planningStyle !== "string" || !["flexible", "structured"].includes(trip.planningStyle) ||
    typeof trip.itineraryText !== "string" || trip.itineraryText.length > 6000 ||
    !Array.isArray(requestedServices) || requestedServices.length > SERVICE_TYPES.size ||
    requestedServices.some((item) => typeof item !== "string" || !SERVICE_TYPES.has(item)) ||
    typeof trip.foodPreferences !== "string" || trip.foodPreferences.length > 500
  ) return null;

  if (!parseSchedule(trip.itineraryText)) return null;
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
      departureLocal: trip.departureLocal as string,
      arrivalLocal: trip.arrivalLocal as string,
      departureTimezone: trip.departureTimezone,
      destinationTimezone: trip.destinationTimezone,
      returnDate: trip.returnDate,
      planningStyle: trip.planningStyle as "flexible" | "structured",
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
