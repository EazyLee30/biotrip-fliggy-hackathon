import { randomUUID } from "node:crypto";
import { getDatabase } from "@/lib/auth";
import type { JourneyDraft, JourneyFeedbackInput } from "@/lib/journey-types";

/**
 * BioTrip remembers what the traveller actually chose, so the next trip starts
 * from their own habits instead of an empty form.
 *
 * Every signal here comes from an explicit action: a planning style, an ambience
 * chip, a service checkbox, a self-reported fatigue/stress score, or free text
 * the traveller typed. Nothing is inferred from WHOOP readings, and no
 * psychological or personality label is ever derived — a colour stays a colour.
 * Each row can be reviewed and deleted from the profile page.
 */

export const PREFERENCE_KINDS = [
  "rhythm",
  "ambience",
  "intention",
  "tone",
  "food",
  "service",
  "destination",
  "schedule",
] as const;
export type PreferenceKind = (typeof PREFERENCE_KINDS)[number];
type PreferenceSource = "choice" | "feedback" | "profile";

export type LearnedPreference = {
  id: string;
  kind: PreferenceKind;
  value: string;
  label: string;
  source: PreferenceSource;
  hits: number;
  lastSeenAt: string;
};

const RHYTHM_LABELS: Record<string, string> = {
  flexible: "留白探索",
  structured: "有序安排",
};
const INTENTION_LABELS: Record<string, string> = {
  安静恢复: "静心修复",
  慢慢探索: "平衡探索",
  补充活力: "自然感官之旅",
  未指定: "城市随心漫游",
};
const TONE_LABELS: Record<string, string> = {
  松林绿: "松林绿",
  湖水蓝: "湖水蓝",
  暖光橙: "暖光橙",
  不限色调: "不限色调",
  未指定: "未指定",
};
const SERVICE_LABELS: Record<string, string> = {
  flights: "航班",
  hotels: "住宿",
  attractions: "景点",
  transport: "当地交通",
  travel_insurance: "旅行保险",
  local_food: "当地餐食",
  relaxation: "放松体验",
  onsen: "温泉",
  massage: "按摩",
  medical_info: "医疗信息",
};
const SCHEDULE_LABELS: Record<string, string> = {
  rest_first_on_arrival: "抵达当天优先留出休息",
  slow_when_tired: "自觉疲惫时倾向放慢节奏",
};

export const PREFERENCE_LABELS: Record<PreferenceKind, Record<string, string>> = {
  rhythm: RHYTHM_LABELS,
  ambience: {},
  intention: INTENTION_LABELS,
  tone: TONE_LABELS,
  food: {},
  service: SERVICE_LABELS,
  destination: {},
  schedule: SCHEDULE_LABELS,
};

const FREE_TEXT_KINDS = new Set<PreferenceKind>(["food", "destination"]);
const MAX_PREFERENCE_KINDS_IN_TEXT = 4000;
const MAX_ROWS_PER_FREE_TEXT_KIND = 12;
/** A preference must be chosen twice before it silently prefills a new trip. */
export const PREFILL_MIN_HITS = 2;

type PreferenceRow = {
  id: string;
  kind: PreferenceKind;
  value: string;
  label: string;
  source: PreferenceSource;
  hits: number;
  last_seen_at: number;
};

type Signal = { kind: PreferenceKind; value: string; label: string; source: PreferenceSource };

function labelFor(kind: PreferenceKind, value: string) {
  if (FREE_TEXT_KINDS.has(kind)) return value.slice(0, 60);
  return PREFERENCE_LABELS[kind][value] ?? value;
}

function clean(value: unknown, maximum: number) {
  if (typeof value !== "string") return "";
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > maximum) return "";
  // Control characters would break the UI and the agent prompt alike.
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized) ? "" : normalized;
}

function addSignals(signals: Signal[], kind: PreferenceKind, values: Iterable<unknown>, source: PreferenceSource) {
  const seen = new Set<string>();
  for (const raw of values) {
    const value = clean(raw, kind === "food" ? 120 : kind === "destination" ? 60 : 40);
    if (!value || seen.has(value)) continue;
    if (!FREE_TEXT_KINDS.has(kind) && !PREFERENCE_LABELS[kind][value]) continue;
    seen.add(value);
    signals.push({ kind, value, label: labelFor(kind, value), source });
  }
}

/** Turns a validated journey draft into the choices worth remembering. */
export function signalsFromDraft(draft: JourneyDraft, source: PreferenceSource = "choice"): Signal[] {
  const signals: Signal[] = [];
  if (draft.trip?.planningStyle) addSignals(signals, "rhythm", [draft.trip.planningStyle], source);
  addSignals(signals, "ambience", draft.ambientPreferences ?? [], source);
  if (draft.intention) addSignals(signals, "intention", [draft.intention], source);
  if (draft.colorTone && draft.colorTone !== "未指定") addSignals(signals, "tone", [draft.colorTone], source);
  addSignals(signals, "service", draft.trip?.requestedServices ?? [], source);
  if (draft.trip?.foodPreferences) addSignals(signals, "food", [draft.trip.foodPreferences], source);
  if (draft.trip?.destinationCity) addSignals(signals, "destination", [draft.trip.destinationCity], source);

  // Derived only from what the traveller reported about themselves right now.
  const tired = (draft.fatigue ?? 0) >= 4 || (draft.subjectiveStress ?? 0) >= 4;
  if (tired) {
    addSignals(signals, "schedule", ["rest_first_on_arrival", "slow_when_tired"], source);
  }
  return signals;
}

/** Turns an in-trip feeling into the habits that should shape later trips. */
export function signalsFromFeedback(feedback: JourneyFeedbackInput): Signal[] {
  const signals: Signal[] = [];
  const reported = [feedback.fatigue, feedback.subjectiveStress].filter(
    (value): value is number => typeof value === "number",
  );
  if (reported.length && Math.max(...reported) >= 4) {
    addSignals(signals, "schedule", ["rest_first_on_arrival", "slow_when_tired"], "feedback");
  }
  if (feedback.moodFeedback && /安静|放松|轻松|不赶|慢|留白/.test(feedback.moodFeedback)) {
    addSignals(signals, "schedule", ["rest_first_on_arrival"], "feedback");
  }
  return signals;
}

async function db() {
  return getDatabase();
}

/**
 * Records the signals a choice produced. Repeated identical choices raise
 * `hits`, which is the only thing that promotes a preference to a default.
 */
export async function learnPreferences(accountId: string, signals: Signal[]) {
  if (!signals.length) return;
  try {
    const database = await db();
    const statements = signals.map((signal) =>
      database.prepare(`INSERT INTO learned_preferences
          (id, account_id, kind, value, label, source, hits, first_seen_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, unixepoch(), unixepoch())
        ON CONFLICT(account_id, kind, value) DO UPDATE SET hits = learned_preferences.hits + 1,
          label = excluded.label, last_seen_at = unixepoch()`)
        .bind(randomUUID(), accountId, signal.kind, signal.value, signal.label, signal.source),
    );
    for (const kind of FREE_TEXT_KINDS) {
      statements.push(database.prepare(`DELETE FROM learned_preferences WHERE account_id = ? AND kind = ?
          AND id NOT IN (SELECT id FROM learned_preferences WHERE account_id = ? AND kind = ?
            ORDER BY hits DESC, last_seen_at DESC LIMIT ${MAX_ROWS_PER_FREE_TEXT_KIND})`)
        .bind(accountId, kind, accountId, kind));
    }
    await database.batch(statements);
  } catch {
    // A preference is a convenience. Losing it must never fail the action the
    // traveller actually asked for.
  }
}

export async function learnFromDraft(accountId: string, draft: JourneyDraft, source?: PreferenceSource) {
  await learnPreferences(accountId, signalsFromDraft(draft, source));
}

export async function learnFromFeedback(accountId: string, feedback: JourneyFeedbackInput) {
  await learnPreferences(accountId, signalsFromFeedback(feedback));
}

export async function learnFromProfile(accountId: string, profile: {
  travelStyle: string; sensoryPreferences: string[]; foodPreferences: string; homeCity: string;
}) {
  await learnPreferences(accountId, signalsFromDraft({
    ambientPreferences: profile.sensoryPreferences,
    trip: {
      planningStyle: profile.travelStyle === "structured" ? "structured" : "flexible",
      foodPreferences: profile.foodPreferences,
      destinationCity: profile.homeCity,
    },
  }, "profile"));
}

export async function listLearnedPreferences(accountId: string): Promise<LearnedPreference[]> {
  try {
    const rows = await (await db()).prepare(`SELECT id, kind, value, label, source, hits, last_seen_at
        FROM learned_preferences WHERE account_id = ? ORDER BY hits DESC, last_seen_at DESC LIMIT 200`)
      .bind(accountId).all<PreferenceRow>();
    return rows.results.map((row) => ({
      id: row.id,
      kind: row.kind,
      value: row.value,
      label: row.label,
      source: row.source,
      hits: row.hits,
      lastSeenAt: new Date(row.last_seen_at * 1000).toISOString(),
    }));
  } catch {
    return [];
  }
}

export async function forgetLearnedPreference(accountId: string, id: string) {
  const result = await (await db()).prepare("DELETE FROM learned_preferences WHERE id = ? AND account_id = ?")
    .bind(id, accountId).run();
  if (result.meta.changes !== 1) throw new Error("这条记忆不存在。");
}

export async function clearLearnedPreferences(accountId: string) {
  await (await db()).prepare("DELETE FROM learned_preferences WHERE account_id = ?").bind(accountId).run();
}

function strongest(preferences: LearnedPreference[], kind: PreferenceKind, minimumHits = 1, limit = 99) {
  return preferences
    .filter((entry) => entry.kind === kind && entry.hits >= minimumHits)
    .sort((a, b) => b.hits - a.hits || b.lastSeenAt.localeCompare(a.lastSeenAt))
    .slice(0, limit);
}

export type PreferenceDefaults = {
  planningStyle?: "flexible" | "structured";
  intention?: string;
  colorTone?: string;
  ambientPreferences?: string[];
  requestedServices?: string[];
  foodPreferences?: string;
  /** Proven learned defaults, phrased for the traveller to read. */
  notes: string[];
  /** Familiar destinations offered as one-tap chips rather than prefilled. */
  destinations: string[];
  /** Cities the traveller departs from, offered first in the origin picker. */
  homeCities: string[];
  /** True once at least one preference has been repeated. */
  established: boolean;
};

/**
 * Turns remembered choices into defaults for a fresh trip. Only repeated
 * preferences are applied, so a single experiment never silently becomes a habit.
 */
export function preferenceDefaults(preferences: LearnedPreference[]): PreferenceDefaults {
  const rhythm = strongest(preferences, "rhythm", PREFILL_MIN_HITS, 1)[0];
  const intention = strongest(preferences, "intention", PREFILL_MIN_HITS, 1)[0];
  const tone = strongest(preferences, "tone", PREFILL_MIN_HITS, 1)[0];
  const ambience = strongest(preferences, "ambience", PREFILL_MIN_HITS, 3);
  const services = strongest(preferences, "service", PREFILL_MIN_HITS, 6);
  const food = strongest(preferences, "food", PREFILL_MIN_HITS, 1)[0];
  const schedule = strongest(preferences, "schedule", PREFILL_MIN_HITS);
  const destinations = strongest(preferences, "destination", PREFILL_MIN_HITS, 5);

  const notes = [
    ...schedule.map((entry) => entry.label),
    ...(ambience.length >= 2 ? [`偏好${ambience.map((entry) => entry.label).join("、")}的环境`] : []),
    ...(food ? [`饮食习惯：${food.label}`] : []),
  ]
    .filter((note, index, all) => all.indexOf(note) === index)
    .slice(0, 6)
    .map((note) => (note.length > MAX_PREFERENCE_KINDS_IN_TEXT ? `${note.slice(0, 120)}…` : note));

  return {
    planningStyle: rhythm?.value === "structured" || rhythm?.value === "flexible" ? rhythm.value : undefined,
    intention: intention?.value,
    colorTone: tone?.value,
    ambientPreferences: ambience.map((entry) => entry.value),
    requestedServices: services.map((entry) => entry.value),
    foodPreferences: food?.label,
    notes,
    destinations: destinations.map((entry) => entry.value),
    homeCities: strongest(preferences, "destination", 1, 5).map((entry) => entry.value),
    established: preferences.some((entry) => entry.hits >= PREFILL_MIN_HITS),
  };
}
