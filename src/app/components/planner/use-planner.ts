import { useCallback, useEffect, useMemo, useState } from "react";
import type { Journey, JourneyDraft, JourneyGeneratedPlan, JourneyMemory } from "@/lib/journey-types";
import type { LearnedPreference, PreferenceDefaults } from "@/lib/preferences";
import { journeyMachine, shouldAutoSave } from "./machine";

export type WhoopSummary = {
  recoveryScore: number | null;
  hrvRmssdMilli: number | null;
  restingHeartRate: number | null;
  sleepMinutes: number | null;
  sleepPerformance: number | null;
  cycleStrain: number | null;
  cycleSteps: number | null;
  measuredAt: string | null;
};

export type WhoopStatus = {
  configured: boolean;
  connected: boolean;
  memberName: string | null;
  connectedAt: string | null;
};

export type TravelProfile = {
  homeCity: string;
  travelStyle: "flexible" | "structured";
  foodPreferences: string;
  sensoryPreferences: string[];
  memoryNotes: string;
};

export type TripForm = {
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

export const EMPTY_TRIP: TripForm = {
  originCity: "", destinationCity: "",
  departureLocal: "", arrivalLocal: "",
  departureTimezone: "Asia/Shanghai", destinationTimezone: "",
  returnDate: "", planningStyle: "flexible",
  itineraryText: "",
  requestedServices: ["hotels", "attractions", "transport", "local_food", "relaxation"],
  foodPreferences: "",
};

export const SERVICES = [
  ["flights", "航班"], ["hotels", "住宿"], ["attractions", "景点"], ["transport", "当地交通"],
  ["local_food", "当地餐食"], ["relaxation", "放松体验"], ["onsen", "温泉"],
  ["massage", "按摩"], ["travel_insurance", "旅行保险"], ["medical_info", "医疗信息"],
] as const;

export const AMBIENCE = ["安静少噪", "自然气息", "柔和光线", "人少宽松"];

export const ZONES = [
  ["Asia/Shanghai", "中国标准时间"], ["Asia/Tokyo", "日本标准时间"], ["Asia/Seoul", "韩国标准时间"],
  ["Asia/Hong_Kong", "香港时间"], ["Asia/Taipei", "台北时间"], ["Asia/Singapore", "新加坡时间"],
  ["Asia/Bangkok", "泰国时间"], ["Asia/Makassar", "巴厘岛时间"], ["Asia/Kolkata", "印度时间"],
  ["Europe/London", "英国时间"], ["Europe/Paris", "中欧时间"], ["America/New_York", "美国东部时间"],
  ["America/Los_Angeles", "美国西部时间"], ["Australia/Sydney", "悉尼时间"], ["Pacific/Auckland", "新西兰时间"],
] as const;

/** Cities imply a time zone; the traveller still confirms it. */
const CITY_ZONES: Array<[RegExp, string]> = [
  [/东京|大阪|京都|箱根|日本|tokyo|osaka|kyoto|japan/i, "Asia/Tokyo"],
  [/首尔|韩国|seoul|korea/i, "Asia/Seoul"],
  [/台北|台湾|taipei/i, "Asia/Taipei"],
  [/香港|hong kong/i, "Asia/Hong_Kong"],
  [/新加坡|singapore/i, "Asia/Singapore"],
  [/曼谷|清迈|泰国|bangkok|chiang mai/i, "Asia/Bangkok"],
  [/巴厘|乌布|印尼|bali|ubud/i, "Asia/Makassar"],
  [/伦敦|英国|london/i, "Europe/London"],
  [/巴黎|法国|paris/i, "Europe/Paris"],
  [/纽约|new york/i, "America/New_York"],
  [/洛杉矶|旧金山|西雅图|los angeles|san francisco|seattle/i, "America/Los_Angeles"],
  [/悉尼|墨尔本|澳大利亚|sydney|melbourne/i, "Australia/Sydney"],
  [/奥克兰|新西兰|auckland/i, "Pacific/Auckland"],
  [/吉隆坡|马来西亚|kuala lumpur/i, "Asia/Singapore"],
  [/胡志明|河内|越南|vietnam/i, "Asia/Bangkok"],
];

export function timezoneFor(city: string) {
  return CITY_ZONES.find(([pattern]) => pattern.test(city))?.[1] ?? "";
}
export function toggle<T>(items: T[], item: T): T[] {
  return items.includes(item) ? items.filter((value) => value !== item) : [...items, item];
}

export async function jsonRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...options });
  const payload = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (response.status === 401) {
    window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    throw new Error("登录已过期，请重新登录。");
  }
  if (!response.ok || !payload) throw new Error(payload?.error || "暂时无法完成操作，请稍后重试。");
  return payload;
}

export type PlannerApi = {
  authReady: boolean;
  initError: string;
  accountName: string;
  serviceReady: boolean | null;
  journeys: Journey[];
  journey: Journey | null;
  plan: JourneyGeneratedPlan | null;
  machine: ReturnType<typeof journeyMachine>;
  form: TripForm;
  intention: string;
  fatigue: string;
  stress: string;
  ambient: string[];
  colorTone: string;
  bodyFeedback: string;
  moodFeedback: string;
  memoryText: string;
  memories: JourneyMemory[];
  preferences: LearnedPreference[];
  preferenceNotes: string[];
  destinations: string[];
  whoop: WhoopStatus;
  health: WhoopSummary | null;
  healthError: string;
  includeMemory: boolean;
  includeWhoop: boolean;
  readyToPlan: boolean;
  draft: () => JourneyDraft;
  update: <K extends keyof TripForm>(key: K, value: TripForm[K]) => void;
  updateCity: (key: "originCity" | "destinationCity", value: string) => void;
  setIntention: (value: string) => void;
  setFatigue: (value: string) => void;
  setStress: (value: string) => void;
  setAmbient: (value: string[]) => void;
  setColorTone: (value: string) => void;
  setBodyFeedback: (value: string) => void;
  setMoodFeedback: (value: string) => void;
  setIncludeMemory: (value: boolean) => void;
  setIncludeWhoop: (value: boolean) => void;
  newJourney: (defaults?: PreferenceDefaults | null) => void;
  selectJourney: (value: Journey) => void;
  saveDraft: (options?: { quiet?: boolean }) => Promise<Journey | null>;
  validateTrip: () => string;
  reloadJourneys: () => Promise<Journey[]>;
};

/**
 * Owns everything the planner needs: bootstrap, the draft, silent persistence
 * and the actions a view can trigger.
 *
 * Two behaviours here exist purely to remove friction. The draft is written on
 * a debounce, so there is no save button to forget; and a new journey starts
 * from preferences the traveller already proved they want, so the common case
 * needs almost no input. Consent is deliberately *not* remembered — each
 * generation is confirmed individually, because that is a privacy promise the
 * product makes in writing.
 */
export function usePlanner(): PlannerApi {
  const [authReady, setAuthReady] = useState(false);
  const [initError, setInitError] = useState("");
  const [accountName, setAccountName] = useState("");
  const [serviceReady, setServiceReady] = useState<boolean | null>(null);
  const [whoop, setWhoop] = useState<WhoopStatus>({ configured: false, connected: false, memberName: null, connectedAt: null });
  const [health, setHealth] = useState<WhoopSummary | null>(null);
  const [healthError, setHealthError] = useState("");
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<TripForm>(EMPTY_TRIP);
  const [intention, setIntention] = useState("安静恢复");
  const [fatigue, setFatigue] = useState("");
  const [stress, setStress] = useState("");
  const [ambient, setAmbient] = useState<string[]>([]);
  const [colorTone, setColorTone] = useState("未指定");
  const [bodyFeedback, setBodyFeedback] = useState("");
  const [moodFeedback, setMoodFeedback] = useState("");
  const [profileMemory, setProfileMemory] = useState("");
  const [memories, setMemories] = useState<JourneyMemory[]>([]);
  const [preferences, setPreferences] = useState<LearnedPreference[]>([]);
  const [preferenceDefaults, setPreferenceDefaults] = useState<PreferenceDefaults | null>(null);
  const [includeMemory, setIncludeMemory] = useState(true);
  const [includeWhoop, setIncludeWhoop] = useState(true);

  const journey = useMemo(() => journeys.find((entry) => entry.id === selectedId) ?? null, [journeys, selectedId]);
  const plan = journey?.plan ?? null;
  const machine = useMemo(() => journeyMachine(journey), [journey]);
  const memoryText = useMemo(
    () => [profileMemory, ...memories.map((entry) => entry.note)].filter(Boolean).join("\n").slice(0, 5000),
    [profileMemory, memories],
  );

  const draft = useCallback((): JourneyDraft => ({
    intention,
    colorTone,
    fatigue: fatigue ? Number(fatigue) : null,
    subjectiveStress: stress ? Number(stress) : null,
    ambientPreferences: ambient,
    bodyFeedback: bodyFeedback.trim(),
    moodFeedback: moodFeedback.trim(),
    profileMemoryNotes: includeMemory ? memoryText : "",
    consent: false,
    trip: form,
  }), [intention, colorTone, fatigue, stress, ambient, bodyFeedback, moodFeedback, includeMemory, memoryText, form]);

  /** Stable signature of everything that belongs to the draft. */
  const signature = useMemo(() => JSON.stringify(draft()), [draft]);
  const applyDraft = useCallback((value: JourneyDraft) => {
    setForm({ ...EMPTY_TRIP, ...value.trip });
    setIntention(value.intention ?? "安静恢复");
    setFatigue(value.fatigue ? String(value.fatigue) : "");
    setStress(value.subjectiveStress ? String(value.subjectiveStress) : "");
    setAmbient((value.ambientPreferences ?? []).filter((entry) => AMBIENCE.includes(entry)));
    setColorTone(value.colorTone ?? "未指定");
    setBodyFeedback(value.bodyFeedback ?? "");
    setMoodFeedback(value.moodFeedback ?? "");
    setSavedSnapshot(JSON.stringify({ ...value, consent: false }));
  }, []);

  /** Fills a fresh draft from the traveller's own recorded defaults. */
  const applyDefaults = useCallback((defaults: PreferenceDefaults | null, base: Partial<TripForm> = {}) => {
    const services = defaults?.requestedServices ?? [];
    const ambience = defaults?.ambientPreferences ?? [];
    setForm((current) => ({
      ...current,
      ...base,
      ...(defaults?.planningStyle ? { planningStyle: defaults.planningStyle } : {}),
      ...(services.length ? { requestedServices: services } : {}),
      ...(!current.foodPreferences && defaults?.foodPreferences ? { foodPreferences: defaults.foodPreferences } : {}),
    }));
    if (defaults?.intention) setIntention(defaults.intention);
    if (ambience.length) setAmbient(ambience);
    if (defaults?.colorTone) setColorTone(defaults.colorTone);
  }, []);

  const replaceJourney = useCallback((value: Journey) => {
    setJourneys((current) => [value, ...current.filter((entry) => entry.id !== value.id)]);
    setSelectedId(value.id);
    setSavedSnapshot(JSON.stringify({ ...value.draft, consent: false }));
  }, []);

  const reloadJourneys = useCallback(async () => {
    const payload = await jsonRequest<{ journeys: Journey[] }>("/api/journeys");
    setJourneys(payload.journeys);
    return payload.journeys;
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const auth = await jsonRequest<{ signedIn: boolean; account?: { display_name?: string; email: string } }>("/api/auth/me");
      if (!alive) return;
      if (!auth.signedIn) {
        window.location.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        return;
      }
      setAccountName(auth.account?.display_name || auth.account?.email.split("@")[0] || "旅行者");
      const results = await Promise.allSettled([
        jsonRequest<{ ready: boolean }>("/api/plan/status"),
        jsonRequest<WhoopStatus>("/api/whoop/status"),
        jsonRequest<{ profile: TravelProfile | null }>("/api/profile"),
        jsonRequest<{ journeys: Journey[] }>("/api/journeys"),
        jsonRequest<{ memories: JourneyMemory[] }>("/api/memory"),
        jsonRequest<{ preferences: LearnedPreference[]; defaults: PreferenceDefaults }>("/api/preferences"),
      ]);
      if (!alive) return;
      const [status, wearable, profile, trips, memory, learned] = results;
      setServiceReady(status.status === "fulfilled" && status.value.ready);
      if (wearable.status === "fulfilled") {
        setWhoop(wearable.value);
        setIncludeWhoop(wearable.value.connected);
      }
      let base: Partial<TripForm> = {};
      if (profile.status === "fulfilled" && profile.value.profile) {
        const value = profile.value.profile;
        setProfileMemory(value.memoryNotes);
        base = {
          originCity: value.homeCity,
          departureTimezone: timezoneFor(value.homeCity) || "Asia/Shanghai",
          planningStyle: value.travelStyle,
          foodPreferences: value.foodPreferences,
        };
        if (value.sensoryPreferences.length) setAmbient(value.sensoryPreferences.filter((entry) => AMBIENCE.includes(entry)));
      }
      if (memory.status === "fulfilled") setMemories(memory.value.memories);
      if (learned.status === "fulfilled") {
        setPreferences(learned.value.preferences);
        setPreferenceDefaults(learned.value.defaults);
      }
      // WHOOP refreshes silently; a failure only leaves the summary empty.
      if (wearable.status === "fulfilled" && wearable.value.connected) {
        void jsonRequest<{ connected: boolean; summary?: WhoopSummary }>("/api/whoop/summary")
          .then((value) => { if (alive) { setHealth(value.summary ?? null); setHealthError(""); } })
          .catch((error) => { if (alive) setHealthError(error instanceof Error ? error.message : "身体记录暂时无法同步。"); });
      }
      if (trips.status === "fulfilled") {
        setJourneys(trips.value.journeys);
        const picked = trips.value.journeys[0];
        if (picked) { setSelectedId(picked.id); applyDraft(picked.draft); }
        else { applyDefaults(learned.status === "fulfilled" ? learned.value.defaults : null, base); setSavedSnapshot(JSON.stringify({ consent: false })); }
      } else {
        applyDefaults(learned.status === "fulfilled" ? learned.value.defaults : null, base);
        setHealthError("");
      }
      setAuthReady(true);
    })().catch((error) => {
      if (alive) { setInitError(error instanceof Error ? error.message : "暂时无法打开 BioTrip。"); setAuthReady(true); }
    });
    return () => { alive = false; };
  }, [applyDefaults, applyDraft]);

  const saveDraft = useCallback(async (options: { quiet?: boolean } = {}) => {
    if (!machine.can.canEdit || saving) return null;
    setSaving(true);
    try {
      const payload = await jsonRequest<{ journey: Journey }>(
        journey ? `/api/journeys/${journey.id}` : "/api/journeys",
        {
          method: journey ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(journey ? { version: journey.version } : {}),
            title: form.destinationCity ? `${form.destinationCity}之旅` : "新的旅程",
            draft: { ...draft(), consent: undefined },
          }),
        },
      );
      replaceJourney(payload.journey);
      if (!options.quiet) setSavedSnapshot(signature);
      return payload.journey;
    } catch {
      // A silent save must never interrupt the traveller; the draft stays in
      // memory and the next change or navigation retries it.
      return null;
    } finally {
      setSaving(false);
    }
  }, [draft, form.destinationCity, journey, machine.can.canEdit, replaceJourney, saving, signature]);

  // Silent persistence: a debounce is enough, so no save button is needed.
  useEffect(() => {
    if (!authReady || signature === savedSnapshot) return;
    if (!shouldAutoSave({ dirty: true, saving, submitting: false, canEdit: machine.can.canEdit })) return;
    const timer = setTimeout(() => { void saveDraft({ quiet: true }); }, 1200);
    return () => clearTimeout(timer);
  }, [authReady, signature, savedSnapshot, saving, saveDraft, machine.can.canEdit]);

  const validateTrip = useCallback(() => {
    if ([form.originCity, form.destinationCity, form.departureLocal, form.arrivalLocal, form.departureTimezone, form.destinationTimezone].some((value) => !value.trim())) {
      return "请补全出发地、目的地、出发与抵达时间，以及对应时区。";
    }
    try {
      new Intl.DateTimeFormat("zh-CN", { timeZone: form.departureTimezone }).format();
      new Intl.DateTimeFormat("zh-CN", { timeZone: form.destinationTimezone }).format();
    } catch { return "请选择有效的出发地和目的地时区。"; }
    if (form.returnDate && form.returnDate < form.arrivalLocal.slice(0, 10)) return "返程日期应晚于或等于抵达日期。";
    if (form.originCity.trim() === form.destinationCity.trim()) return "出发地和目的地相同；请填写不同的城市。";
    return "";
  }, [form]);

  const newJourney = useCallback((defaults: PreferenceDefaults | null = null) => {
    setSelectedId(null);
    setForm((current) => ({
      ...EMPTY_TRIP,
      originCity: current.originCity,
      departureTimezone: current.departureTimezone,
      planningStyle: current.planningStyle,
    }));
    applyDefaults(defaults ?? preferenceDefaults, {});
    setFatigue(""); setStress(""); setBodyFeedback(""); setMoodFeedback("");
    setIntention(preferenceDefaults?.intention ?? "安静恢复");
    setIncludeWhoop(whoop.connected);
    setSavedSnapshot("");
  }, [applyDefaults, preferenceDefaults, whoop.connected]);

  const selectJourney = useCallback((value: Journey) => {
    setSelectedId(value.id);
    applyDraft(value.draft);
    setIncludeWhoop(whoop.connected);
  }, [applyDraft, whoop.connected]);

  return {
    authReady, initError, accountName, serviceReady,
    journeys, journey, plan, machine,
    form, intention, fatigue, stress, ambient, colorTone, bodyFeedback, moodFeedback,
    memoryText, memories, preferences,
    preferenceNotes: preferenceDefaults?.notes ?? [],
    destinations: preferenceDefaults?.destinations ?? [],
    whoop, health, healthError,
    includeMemory, includeWhoop,
    readyToPlan: serviceReady === true,
    draft,
    update: (key, value) => setForm((current) => ({ ...current, [key]: value })),
    updateCity: (key, value) => setForm((current) => ({
      ...current,
      [key]: value,
      [key === "originCity" ? "departureTimezone" : "destinationTimezone"]: timezoneFor(value),
    })),
    setIntention, setFatigue, setStress, setAmbient, setColorTone, setBodyFeedback, setMoodFeedback,
    setIncludeMemory, setIncludeWhoop,
    newJourney, selectJourney, saveDraft, validateTrip, reloadJourneys,
  };
}