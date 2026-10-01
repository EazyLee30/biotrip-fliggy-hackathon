"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Journey, JourneyDraft, JourneyFeedback, JourneyGeneratedPlan, JourneyMemory } from "@/lib/journey-types";
import { Ambience, Badge, BreathingSession, Gauge, Icon, Modal } from "./zen-ui";
import { journeyMachine } from "./planner/machine";
import { ProvenanceBlock } from "./planner/blocks/provenance";
import styles from "./zen-dashboard.module.css";

type View = "today" | "adjust" | "explore" | "create" | "breathing" | "sleep" | "fatigue";
type WhoopSummary = { recoveryScore: number | null; hrvRmssdMilli: number | null; restingHeartRate: number | null; sleepMinutes: number | null; sleepPerformance: number | null; cycleStrain: number | null; cycleSteps: number | null; measuredAt: string | null };
type TripForm = Required<NonNullable<JourneyDraft["trip"]>>;
type PlanPayload = Partial<JourneyGeneratedPlan> & { journey?: Journey; error?: string; diagnostic?: { stage?: string; status?: number; code?: string } };
type TravelProfile = { homeCity: string; travelStyle: "flexible" | "structured"; foodPreferences: string; sensoryPreferences: string[]; memoryNotes: string };
type Place = JourneyGeneratedPlan["plan"]["places"][number];
type ItineraryItem = JourneyGeneratedPlan["plan"]["itinerary"][number] & { date?: string };
const EMPTY_TRIP: TripForm = { originCity: "", destinationCity: "", departureLocal: "", arrivalLocal: "", departureTimezone: "Asia/Shanghai", destinationTimezone: "", returnDate: "", planningStyle: "flexible", itineraryText: "", requestedServices: ["hotels", "attractions", "transport", "local_food", "relaxation"], foodPreferences: "" };
const SERVICES = [["flights", "航班"], ["hotels", "住宿"], ["attractions", "景点"], ["transport", "当地交通"], ["local_food", "当地餐食"], ["relaxation", "放松体验"], ["onsen", "温泉"], ["massage", "按摩"], ["travel_insurance", "旅行保险"], ["medical_info", "医疗信息"]] as const;
const AMBIENCE = ["安静少噪", "自然气息", "柔和光线", "人少宽松"];
const ZONES = [["Asia/Shanghai", "中国标准时间"], ["Asia/Tokyo", "日本标准时间"], ["Asia/Seoul", "韩国标准时间"], ["Asia/Hong_Kong", "香港时间"], ["Asia/Taipei", "台北时间"], ["Asia/Singapore", "新加坡时间"], ["Asia/Bangkok", "泰国时间"], ["Asia/Makassar", "巴厘岛时间"], ["Asia/Kolkata", "印度时间"], ["Europe/London", "英国时间"], ["Europe/Paris", "中欧时间"], ["America/New_York", "美国东部时间"], ["America/Los_Angeles", "美国西部时间"], ["Australia/Sydney", "悉尼时间"], ["Pacific/Auckland", "新西兰时间"]] as const;
const CITY_ZONES: Array<[RegExp, string]> = [[/东京|大阪|京都|箱根|日本|tokyo|osaka|kyoto|japan/i, "Asia/Tokyo"], [/首尔|韩国|seoul|korea/i, "Asia/Seoul"], [/台北|台湾|taipei/i, "Asia/Taipei"], [/香港|hong kong/i, "Asia/Hong_Kong"], [/新加坡|singapore/i, "Asia/Singapore"], [/曼谷|清迈|泰国|bangkok|chiang mai/i, "Asia/Bangkok"], [/巴厘|乌布|印尼|bali|ubud/i, "Asia/Makassar"], [/伦敦|英国|london/i, "Europe/London"], [/巴黎|法国|paris/i, "Europe/Paris"], [/纽约|new york/i, "America/New_York"], [/洛杉矶|旧金山|西雅图|los angeles|san francisco|seattle/i, "America/Los_Angeles"], [/悉尼|墨尔本|澳大利亚|sydney|melbourne/i, "Australia/Sydney"], [/奥克兰|新西兰|auckland/i, "Pacific/Auckland"], [/上海|北京|广州|深圳|杭州|成都|重庆|中国|shanghai|beijing|china/i, "Asia/Shanghai"]];
const INTENTS = [
  { value: "安静恢复", name: "静心修复", subtitle: "深度休息与舒缓", icon: "leaf" as const, detail: "给睡眠、安静空间和休息多留一些时间，以轻松的节奏重新充电。", tags: ["轻松步行", "充足留白"] },
  { value: "慢慢探索", name: "平衡探索", subtitle: "温柔发现，一路从容", icon: "compass" as const, detail: "在街巷、展馆和当地文化之间慢慢走，把探索与坐下来休息安排在一起。", tags: ["文化体验", "灵活衔接"] },
  { value: "补充活力", name: "自然感官之旅", subtitle: "靠近自然，补充活力", icon: "forest" as const, detail: "寻找绿意、自然光和开阔空间，结合你实际的身体感受安排活动密度。", tags: ["自然气息", "适度活动"] },
  { value: "未指定", name: "城市随心漫游", subtitle: "美食与城市生活", icon: "food" as const, detail: "不用设定目标，跟随你的口味与兴趣，把喜欢的餐食、空间和体验连成旅程。", tags: ["地方餐食", "自由选择"] },
];
const STEP_LABELS = ["旅行意图", "目的地与时间", "节奏与连接", "行程确认"];
const VIEW_LABELS: Record<View, string> = { today: "今日", adjust: "调整", explore: "探索", create: "创建旅程", breathing: "呼吸练习", sleep: "睡眠与时区", fatigue: "调整身体节奏" };
const STATUS_LABELS = { draft: "草稿", planned: "待出发", active: "旅途中", completed: "已完成" };
function timezoneFor(city: string) { return CITY_ZONES.find(([pattern]) => pattern.test(city))?.[1] ?? ""; }
function toggle(items: string[], item: string) { return items.includes(item) ? items.filter((value) => value !== item) : [...items, item]; }
function number(value: number | null | undefined, digits = 0) { return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—"; }
function sleepDuration(value: number | null | undefined) { return typeof value === "number" ? `${Math.floor(value / 60)} 时 ${Math.round(value % 60)} 分` : "—"; }
function dateLabel(value?: string | null, withTime = false) { if (!value) return "尚未同步"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "时间未知" : new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium", ...(withTime ? { timeStyle: "short" as const } : {}) }).format(date); }
function publicUrl(value: string) { try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : ""; } catch { return ""; } }
function activityIcon(name: string) { return /交通|地铁|列车|巴士|航班|机场|乘车/.test(name) ? "train" as const : /茶|咖啡|餐|食/.test(name) ? "cup" as const : /酒店|住宿|睡|午休|休息/.test(name) ? "bed" as const : /公园|森林|自然|庭院/.test(name) ? "forest" as const : "compass" as const; }
function requestedView(value: string | null): View { return value && Object.hasOwn(VIEW_LABELS, value) ? value as View : "today"; }
async function jsonRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...options });
  const payload = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (response.status === 401) { window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`); throw new Error("登录已过期，请重新登录。"); }
  if (!response.ok || !payload) throw new Error(payload?.error || "暂时无法完成操作，请稍后重试。");
  return payload;
}
async function readPlanResponse(response: Response, onProgress: (stage: string, message: string) => void): Promise<PlanPayload> {
  if (!response.headers.get("Content-Type")?.includes("text/event-stream")) return response.json();
  if (!response.body) throw new Error("连接中断，你填写的信息仍然保留。");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = "", result: PlanPayload | undefined;
  function frame(value: string) {
    const lines = value.split(/\r?\n/), event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
    const data = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
    if (!data) return;
    const payload = JSON.parse(data);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("规划服务返回了无法读取的结果。");
    if (event === "progress") onProgress(typeof payload.stage === "string" ? payload.stage : "preparing", typeof payload.message === "string" ? payload.message.slice(0, 160) : "正在整理旅程…");
    if (event === "result" || event === "error") result = payload as PlanPayload;
  }
  try {
    while (!result) {
      const { value, done } = await reader.read(); buffer += decoder.decode(value, { stream: !done });
      const frames = buffer.split(/\r?\n\r?\n/); buffer = frames.pop() ?? ""; for (const part of frames) frame(part);
      if (done) { if (buffer.trim()) frame(buffer); break; }
    }
  } finally { await reader.cancel().catch(() => undefined); }
  if (!result) throw new Error("连接中断，你填写的信息仍然保留。请重新尝试。");
  return result;
}

function Timeline({ items, onSelect }: { items: ItineraryItem[]; onSelect: (item: ItineraryItem) => void }) {
  return <div className={styles.timeline}>{items.map((item, index) => <button className={styles.stop} key={`${item.date ?? ""}-${item.time}-${index}`} onClick={() => onSelect(item)}><div className={styles.stopTop}><span className={styles.time}>{item.time}</span><Badge tone={item.fixed ? "green" : "muted"}><Icon name={item.fixed ? "lock" : "leaf"} size={12} />{item.fixed ? "固定安排" : "可灵活调整"}</Badge></div><div className={styles.stopBody}><div className={styles.stopIcon}><Icon name={activityIcon(item.name)} size={29} /><small>{item.fixed ? "保留安排" : "旅程节点"}</small></div><div className={styles.stopCopy}><h4>{item.name}</h4><p>{item.detail}</p><small>查看安排 <Icon name="arrow" size={13} /></small></div></div></button>)}</div>;
}

export function PlannerDashboard() {
  const [authReady, setAuthReady] = useState(false);
  const [initError, setInitError] = useState("");
  const [accountName, setAccountName] = useState("");
  const [view, setView] = useState<View>("today");
  const [step, setStep] = useState(0);
  const [serviceReady, setServiceReady] = useState<boolean | null>(null);
  const [whoopConfigured, setWhoopConfigured] = useState(false);
  const [whoopConnected, setWhoopConnected] = useState(false);
  const [health, setHealth] = useState<WhoopSummary | null>(null);
  const [healthError, setHealthError] = useState("");
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<TripForm>(EMPTY_TRIP);
  const [intention, setIntention] = useState("安静恢复");
  const [fatigue, setFatigue] = useState("");
  const [stress, setStress] = useState("");
  const [bodyFeedback, setBodyFeedback] = useState("");
  const [moodFeedback, setMoodFeedback] = useState("");
  const [ambient, setAmbient] = useState<string[]>([]);
  const [colorTone, setColorTone] = useState("未指定");
  const [profileMemory, setProfileMemory] = useState("");
  const [learnedDefaults, setLearnedDefaults] = useState<{ planningStyle?: "flexible" | "structured"; intention?: string; colorTone?: string; ambientPreferences?: string[]; requestedServices?: string[]; foodPreferences?: string; destinations?: string[] } | null>(null);
  const [memories, setMemories] = useState<JourneyMemory[]>([]);
  const [includeMemory, setIncludeMemory] = useState(true);
  const [includeWhoop, setIncludeWhoop] = useState(true);
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progressStage, setProgressStage] = useState("preparing");
  const [progressMessage, setProgressMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Journey | null>(null);
  const [activity, setActivity] = useState<ItineraryItem | null>(null);
  const [place, setPlace] = useState<Place | null>(null);
  const [filter, setFilter] = useState("全部");
  const [selectedDay, setSelectedDay] = useState("");
  const [consentOpen, setConsentOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [sharePath, setSharePath] = useState("");
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackNote, setFeedbackNote] = useState("");
  const [remember, setRemember] = useState(false);
  const [memoryNote, setMemoryNote] = useState("");
  const [feedback, setFeedback] = useState<{ key: string; items: JourneyFeedback[] }>({ key: "", items: [] });
  const [previousPlan, setPreviousPlan] = useState<JourneyGeneratedPlan | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const generation = useRef<AbortController | null>(null);
  const journey = journeys.find((entry) => entry.id === selectedId) ?? null;
  const plan = journey?.plan ?? null;
  // Lifecycle capabilities are derived once so every surface agrees on what is
  // possible right now, instead of re-deriving rules from status and planCurrent.
  const planner = { machine: journeyMachine(journey) };
  const memoryText = [profileMemory, ...memories.map((entry) => entry.note)].filter(Boolean).join("\n").slice(0, 5000);
  const readyToPlan = serviceReady === true;

  const fillDraft = useCallback((draft: JourneyDraft) => {
    setForm({ ...EMPTY_TRIP, ...draft.trip }); setIntention(draft.intention ?? "安静恢复"); setFatigue(draft.fatigue ? String(draft.fatigue) : ""); setStress(draft.subjectiveStress ? String(draft.subjectiveStress) : ""); setAmbient((draft.ambientPreferences ?? []).filter((entry) => AMBIENCE.includes(entry))); setColorTone(draft.colorTone ?? "未指定"); setBodyFeedback(draft.bodyFeedback ?? ""); setMoodFeedback(draft.moodFeedback ?? ""); setConsent(false);
  }, []);
  const replaceJourney = useCallback((value: Journey) => {
    setJourneys((current) => [value, ...current.filter((entry) => entry.id !== value.id)]); setSelectedId(value.id);
  }, []);
  const navigate = useCallback((next: View) => {
    setView(next); setError(""); const params = new URLSearchParams(window.location.search); params.set("view", next); window.history.replaceState(null, "", `/?${params}`); window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  useEffect(() => {
    let alive = true;
    const query = new URLSearchParams(window.location.search); setView(requestedView(query.get("view"))); setNow(Date.now());
    const listener = () => setView(requestedView(new URLSearchParams(window.location.search).get("view")));
    window.addEventListener("popstate", listener);
    void (async () => {
      const response = await fetch("/api/auth/me", { cache: "no-store" });
      if (!response.ok) throw new Error("账户服务暂时不可用，请重试。");
      const auth = await response.json() as { signedIn: boolean; account?: { display_name?: string; email: string } };
      if (!alive) return;
      if (!auth.signedIn) { window.location.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`); return; }
      setAccountName(auth.account?.display_name || auth.account?.email.split("@")[0] || "旅行者");
      const responses = await Promise.allSettled([
        jsonRequest<{ ready: boolean }>("/api/plan/status"),
        jsonRequest<{ configured: boolean; connected: boolean }>("/api/whoop/status"),
        jsonRequest<{ profile: TravelProfile | null }>("/api/profile"),
        jsonRequest<{ journeys: Journey[] }>("/api/journeys"),
        jsonRequest<{ memories: JourneyMemory[] }>("/api/memory"),
        jsonRequest<{ defaults: { planningStyle?: "flexible" | "structured"; intention?: string; colorTone?: string; ambientPreferences?: string[]; requestedServices?: string[]; foodPreferences?: string; destinations?: string[] } }>("/api/preferences"),
      ]);
      if (!alive) return;
      const [status, wearable, profile, trips, memory, learned] = responses;
      setServiceReady(status.status === "fulfilled" && status.value.ready);
      if (wearable.status === "fulfilled") {
        setWhoopConfigured(Boolean(wearable.value.configured)); setWhoopConnected(Boolean(wearable.value.connected)); setIncludeWhoop(Boolean(wearable.value.connected));
        if (wearable.value.connected) void jsonRequest<{ connected: boolean; summary?: WhoopSummary }>("/api/whoop/summary").then((value) => { if (alive) { setWhoopConnected(value.connected); setHealth(value.summary ?? null); } }).catch((caught) => { if (alive) setHealthError(caught instanceof Error ? caught.message : "WHOOP 同步暂时失败，可继续使用自评规划。"); });
      }
      let defaultDraft: JourneyDraft = {};
      if (profile.status === "fulfilled" && profile.value.profile) {
        const value = profile.value.profile; setProfileMemory(value.memoryNotes);
        defaultDraft = { trip: { originCity: value.homeCity, departureTimezone: timezoneFor(value.homeCity) || "Asia/Shanghai", planningStyle: value.travelStyle, foodPreferences: value.foodPreferences }, ambientPreferences: value.sensoryPreferences.filter((entry) => AMBIENCE.includes(entry)) };
      }
      if (memory.status === "fulfilled") setMemories(memory.value.memories);
      if (learned.status === "fulfilled") setLearnedDefaults(learned.value.defaults);
      if (trips.status === "fulfilled") {
        setJourneys(trips.value.journeys);
        const picked = trips.value.journeys.find((entry) => entry.id === query.get("journey")) ?? trips.value.journeys.find((entry) => entry.status === "active") ?? trips.value.journeys.find((entry) => entry.status === "planned") ?? trips.value.journeys[0];
        if (picked && query.get("view") !== "create") { setSelectedId(picked.id); fillDraft(picked.draft); if (picked.plan) setStep(3); }
        else fillDraft(defaultDraft);
      } else { fillDraft(defaultDraft); setError("暂时无法读取旅程，请刷新重试。你可以先填写新的旅行计划。"); }
      setAuthReady(true);
      const outcome = query.get("whoop");
      if (outcome === "connected") setToast("WHOOP 已连接；每次规划都可以选择是否使用身体数据。");
      if (outcome === "denied" || outcome === "failed") setHealthError("WHOOP 连接未完成，请重试连接。仍可使用自评规划。");
    })().catch((caught) => { if (alive) { setInitError(caught instanceof Error ? caught.message : "暂时无法打开 BioTrip。"); setAuthReady(true); } });
    return () => { alive = false; generation.current?.abort(); window.removeEventListener("popstate", listener); };
  }, [fillDraft]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 5000); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    const current = journey;
    if (!current || !["active", "completed"].includes(current.status)) return;
    const journeyKey = `${current.id}:${current.version}`;
    let alive = true;
    void jsonRequest<{ feedback: JourneyFeedback[] }>(`/api/journeys/${current.id}/feedback`).then((value) => { if (alive) setFeedback({ key: journeyKey, items: value.feedback }); }).catch(() => undefined);
    return () => { alive = false; };
  }, [journey?.id, journey?.version, journey?.status]);
  // Feedback belongs to a specific journey version, so a stale list is simply
  // not shown rather than being cleared with an extra render.
  const feedbackKey = journey && ["active", "completed"].includes(journey.status) ? `${journey.id}:${journey.version}` : "";
  const feedbackHistory = feedback.key === feedbackKey ? feedback.items : [];

  const itineraryDays = useMemo(() => {
    const grouped = new Map<string, ItineraryItem[]>();
    for (const item of plan?.plan.itinerary ?? []) { const row = item as ItineraryItem; const key = row.date || journey?.draft.trip?.arrivalLocal?.slice(0, 10) || "行程"; grouped.set(key, [...(grouped.get(key) ?? []), row]); }
    return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [plan, journey?.draft.trip?.arrivalLocal]);
  const actualDay = itineraryDays.some(([day]) => day === selectedDay) ? selectedDay : itineraryDays.find(([day]) => now && day === new Intl.DateTimeFormat("sv-SE", { timeZone: journey?.draft.trip?.destinationTimezone || "Asia/Shanghai" }).format(new Date(now)))?.[0] ?? itineraryDays[0]?.[0] ?? "";
  const dayItems = itineraryDays.find(([day]) => day === actualDay)?.[1] ?? [];
  const places = useMemo(() => {
    const all: Place[] = [...(plan?.plan.places ?? []), ...(plan?.localServices ?? []).map((entry) => ({ name: entry.name, category: SERVICES.find(([key]) => key === entry.kind)?.[1] || entry.kind, reason: entry.detail, source: entry.source, url: entry.sourceUrl }))];
    return all.filter((entry, index) => publicUrl(entry.url) && all.findIndex((other) => other.url === entry.url || other.name === entry.name) === index);
  }, [plan]);
  const filteredPlaces = places.filter((entry) => filter === "全部" || (filter === "餐食茶饮" ? /餐|食|茶|咖啡/.test(entry.category + entry.name) : filter === "休息放松" ? /休|放松|温泉|按摩|住宿|酒店/.test(entry.category + entry.name) : /交通|航班|地铁|运输/.test(entry.category + entry.name)));

  function update<K extends keyof TripForm>(key: K, value: TripForm[K]) { setForm((current) => ({ ...current, [key]: value })); setConsent(false); }
  function updateCity(key: "originCity" | "destinationCity", value: string) { setForm((current) => ({ ...current, [key]: value, [key === "originCity" ? "departureTimezone" : "destinationTimezone"]: timezoneFor(value) })); setConsent(false); }
  function draftFor(approved = false): JourneyDraft { return { intention, colorTone, fatigue: fatigue ? Number(fatigue) : null, subjectiveStress: stress ? Number(stress) : null, ambientPreferences: ambient, bodyFeedback: bodyFeedback.trim(), moodFeedback: moodFeedback.trim(), profileMemoryNotes: includeMemory ? memoryText : "", consent: approved, trip: form }; }
  /** A new journey starts from defaults the traveller already proved they want. */
  function newJourney() {
    setSelectedId(null);
    setForm((current) => ({
      ...EMPTY_TRIP,
      originCity: current.originCity,
      departureTimezone: current.departureTimezone,
      foodPreferences: learnedDefaults?.foodPreferences ?? current.foodPreferences,
      planningStyle: learnedDefaults?.planningStyle ?? current.planningStyle,
      ...(learnedDefaults?.requestedServices?.length ? { requestedServices: learnedDefaults.requestedServices } : {}),
    }));
    setFatigue(""); setStress(""); setBodyFeedback(""); setMoodFeedback("");
    setIntention(learnedDefaults?.intention ?? "安静恢复");
    if (learnedDefaults?.ambientPreferences?.length) setAmbient(learnedDefaults.ambientPreferences);
    setConsent(false); setStep(0); setPreviousPlan(null); setSelectedDay(""); setSharePath(""); setPickerOpen(false); navigate("create");
  }
  function selectJourney(value: Journey) { setSelectedId(value.id); fillDraft(value.draft); setStep(value.plan ? 3 : 0); setSelectedDay(""); setPreviousPlan(null); setSharePath(""); setPickerOpen(false); const params = new URLSearchParams(window.location.search); params.set("journey", value.id); window.history.replaceState(null, "", `/?${params}`); navigate(value.plan ? "today" : "create"); }
  function validateTrip() {
    if ([form.originCity, form.destinationCity, form.departureLocal, form.arrivalLocal, form.departureTimezone, form.destinationTimezone].some((value) => !value.trim())) return "请补全出发地、目的地、出发与抵达时间，以及对应时区。";
    try { new Intl.DateTimeFormat("zh-CN", { timeZone: form.departureTimezone }).format(); new Intl.DateTimeFormat("zh-CN", { timeZone: form.destinationTimezone }).format(); } catch { return "请选择有效的出发地和目的地时区。"; }
    if (form.returnDate && form.returnDate < form.arrivalLocal.slice(0, 10)) return "返程日期应晚于或等于抵达日期。";
    if (form.originCity.trim() === form.destinationCity.trim()) return "出发地和目的地相同；请填写不同的城市。";
    return "";
  }
  async function saveDraft(quiet = false): Promise<Journey | null> {
    if (journey && ["active", "completed"].includes(journey.status)) { setError("旅途中请使用调整页重新规划；已完成的旅程可作为下次旅行参考。"); return null; }
    setBusy(true); setError("");
    try {
      const payload = await jsonRequest<{ journey: Journey }>(journey ? `/api/journeys/${journey.id}` : "/api/journeys", { method: journey ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(journey ? { version: journey.version } : {}), title: form.destinationCity ? `${form.destinationCity}之旅` : "新的旅程", draft: draftFor() }) });
      replaceJourney(payload.journey); if (!quiet) setToast("草稿已保存到你的账户，下次打开可以继续。"); return payload.journey;
    } catch (caught) { setError(caught instanceof Error ? caught.message : "草稿保存失败。"); return null; }
    finally { setBusy(false); }
  }
  async function autoSaveDraft(): Promise<void> {
    if (journey && planner.machine.status && !planner.machine.can.canEdit) return;
    try {
      const payload = await jsonRequest<{ journey: Journey }>(journey ? `/api/journeys/${journey.id}` : "/api/journeys", { method: journey ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(journey ? { version: journey.version } : {}), title: form.destinationCity ? `${form.destinationCity}之旅` : "新的旅程", draft: draftFor() }) });
      replaceJourney(payload.journey);
    } catch { /* Silent by design: the next change or navigation retries it. */ }
  }
  /**
   * Silent persistence: the draft is written shortly after the traveller stops
   * typing, with no busy state, toast or error, so there is never a save button
   * to remember and losing the tab loses nothing. It only fires once a journey
   * exists or a destination has been chosen, so simply opening the app never
   * spawns an empty journey.
   */
  useEffect(() => {
    if (!authReady || loading) return;
    if (journey && planner.machine.status && !planner.machine.can.canEdit) return;
    const hasIntent = Boolean(journey || form.destinationCity.trim() || form.originCity.trim());
    if (!hasIntent) return;
    const timer = setTimeout(() => { void autoSaveDraft(); }, 1400);
    return () => clearTimeout(timer);
    // Re-arm whenever the draft content changes.
  }, [authReady, loading, form, intention, fatigue, stress, ambient, colorTone, bodyFeedback, moodFeedback, journey?.id, journey?.version, journey?.status]);
  async function advance() {
    if (step === 1) { const message = validateTrip(); if (message) { setError(message); return; } }
    setError(""); const saved = await saveDraft(true); if (!saved) return; setStep((current) => Math.min(3, current + 1)); window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function generatePlan() {
    const validation = validateTrip(); if (validation) { setError(validation); setStep(1); navigate("create"); return; }
    if (!readyToPlan) { setError("旅行规划服务暂时未就绪。草稿可以正常保存，请稍后重试。"); return; }
    if (!consent) { setError("请确认本次使用的资料，再开始生成。"); return; }
    setConsentOpen(false); setError(""); setLoading(true); setProgressStage("preparing"); setProgressMessage("正在准备这次旅程…");
    const controller = new AbortController(); generation.current = controller;
    const timeout = setTimeout(() => controller.abort(), 400_000);
    let target = journey;
    try {
      if (!target) {
        const payload = await jsonRequest<{ journey: Journey }>("/api/journeys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draft: draftFor() }) });
        target = payload.journey; replaceJourney(target);
      }
      if (controller.signal.aborted) return;
      const response = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json", Accept: "text/event-stream" }, signal: controller.signal, body: JSON.stringify({ ...draftFor(true), includeWhoop: whoopConnected && includeWhoop, journeyId: target.id, expectedVersion: target.version }) });
      const payload = await readPlanResponse(response, (stage, message) => { setProgressStage(stage); setProgressMessage(message); });
      if (!response.ok || payload.error) {
        const diagnostics = payload.diagnostic; const code = typeof diagnostics?.code === "string" && /^[A-Za-z0-9_.:-]{1,64}$/.test(diagnostics.code) ? diagnostics.code : "";
        throw new Error(`${payload.error || "这次规划未能完成，请重试。"}${code ? `（${code}）` : ""}`);
      }
      if (payload.source !== "live" || !payload.journey || !payload.plan?.itinerary?.length) throw new Error("规划没有完整保存，请刷新旅程列表确认后重试。");
      setPreviousPlan(target.plan); replaceJourney(payload.journey); fillDraft(payload.journey.draft); setStep(3); setSelectedDay(""); setSharePath(""); setToast("行程已生成并保存到你的账户。"); navigate("create");
    } catch (caught) {
      if (controller.signal.aborted) {
        setToast("已停止等待，草稿保留。正在核对服务器保存状态。");
        try { const values = await jsonRequest<{ journeys: Journey[] }>("/api/journeys"); setJourneys(values.journeys); const saved = values.journeys.find((entry) => entry.id === target?.id); if (saved?.plan && saved.version !== target?.version) { fillDraft(saved.draft); setStep(3); setToast("服务已完成；已恢复保存好的行程。"); } } catch { setError("已取消等待。请稍后刷新旅程列表，核对是否已完成。"); }
      } else setError(caught instanceof Error ? caught.message : "规划暂时失败。你的原行程和草稿仍然保留。");
    } finally { clearTimeout(timeout); generation.current = null; setLoading(false); }
  }
  async function transition(status: "active" | "completed") {
    if (!journey) return; setBusy(true); setError("");
    try { const payload = await jsonRequest<{ journey: Journey }>(`/api/journeys/${journey.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: journey.version, status }) }); replaceJourney(payload.journey); setToast(status === "active" ? "旅程已开始，今天的安排和体验都在这里。" : "旅程已完成，可以记录这次最喜欢的安排。" ); navigate("today"); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "旅程状态更新失败。"); } finally { setBusy(false); }
  }
  async function removeJourney() {
    if (!deleteTarget) return; setBusy(true);
    try { await jsonRequest(`/api/journeys/${deleteTarget.id}?version=${deleteTarget.version}`, { method: "DELETE" }); setJourneys((current) => current.filter((entry) => entry.id !== deleteTarget.id)); if (selectedId === deleteTarget.id) { setSelectedId(null); setForm(EMPTY_TRIP); setStep(0); } setDeleteTarget(null); setToast("旅程已删除。"); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "暂时无法删除旅程。"); } finally { setBusy(false); }
  }
  async function syncHealth() {
    setBusy(true); setHealthError("");
    try { const payload = await jsonRequest<{ connected: boolean; summary?: WhoopSummary }>("/api/whoop/summary"); setHealth(payload.summary ?? null); setWhoopConnected(payload.connected); setToast(payload.summary ? "已读取最新的 WHOOP 记录。" : "暂无可用身体记录，可使用主观感受继续规划。"); }
    catch (caught) { setHealthError(caught instanceof Error ? caught.message : "WHOOP 同步失败。"); } finally { setBusy(false); }
  }
  async function sendFeedback(note = feedbackNote, completedBreathing = false) {
    if (!journey) return; setBusy(true); setError("");
    try {
      const payload = await jsonRequest<{ journey: Journey; remembered: boolean }>(`/api/journeys/${journey.id}/feedback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: journey.version, note, ...(completedBreathing ? {} : { fatigue: fatigue ? Number(fatigue) : null, subjectiveStress: stress ? Number(stress) : null, bodyFeedback, moodFeedback, remember, ...(remember ? { memoryNote } : {}) }) }) });
      replaceJourney(payload.journey); setFeedbackOpen(false); setFeedbackNote(""); setMemoryNote(""); setRemember(false); setToast(payload.remembered ? "体验已记录，你选定的偏好已存入旅程记忆。" : "体验已记录。" );
      if (payload.remembered) { const payload = await jsonRequest<{ memories: JourneyMemory[] }>("/api/memory"); setMemories(payload.memories); }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "暂时无法记录体验。"); } finally { setBusy(false); }
  }
  async function createShare() {
    if (!plan) return; setBusy(true); setError("");
    try { const payload = await jsonRequest<{ path: string }>("/api/share", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trip: { destinationCity: journey?.draft.trip?.destinationCity || form.destinationCity }, plan: { headline: plan.plan.headline, summary: plan.plan.summary, places: plan.plan.places.map(({ name, category, url }) => ({ name, category, url })) } }) }); setSharePath(payload.path); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "分享链接创建失败。"); } finally { setBusy(false); }
  }
  async function copyShare() { try { await navigator.clipboard.writeText(new URL(sharePath, window.location.origin).href); setToast("分享链接已复制。"); } catch { setError("复制失败，可以长按链接手动复制。"); } }
  function startAdjustment(light = false) { if (journey?.status === "completed") { setToast("这段旅程已完成，可以新建下一次旅程。"); return; } if (light) { setIntention("安静恢复"); setFatigue("4"); setBodyFeedback("希望减少步行，多安排坐下来休息，保留所有固定安排。"); } setConsent(false); navigate("adjust"); }
  const closeConsent = useCallback(() => setConsentOpen(false), []);
  const closePicker = useCallback(() => setPickerOpen(false), []);
  const closeShare = useCallback(() => setShareOpen(false), []);
  const closeFeedback = useCallback(() => setFeedbackOpen(false), []);
  const closePlace = useCallback(() => setPlace(null), []);
  const closeActivity = useCallback(() => setActivity(null), []);
  const closeDelete = useCallback(() => setDeleteTarget(null), []);

  function renderConsent() {
    return <div className={styles.stack}><p>本次规划只使用你在这里确认的资料。规划完成后会保存行程，不执行预订或支付。</p><div className={styles.summaryList}><div className={styles.summaryRow}><span>旅行</span><strong>{form.originCity} → {form.destinationCity}</strong></div><div className={styles.summaryRow}><span>时间</span><strong>{form.arrivalLocal.replace("T", " ")}{form.returnDate ? ` 至 ${form.returnDate}` : ""}</strong></div><div className={styles.summaryRow}><span>身体感受</span><strong>{fatigue ? `疲劳 ${fatigue}/5` : "未自评"}{stress ? ` · 压力 ${stress}/5` : ""}</strong></div><div className={styles.summaryRow}><span>WHOOP 记录</span><strong>{whoopConnected && includeWhoop ? health ? "使用最近同步的身体记录" : "读取授权范围内的最近记录" : "本次不使用"}</strong></div><div className={styles.summaryRow}><span>旅程记忆</span><strong>{includeMemory && memoryText ? "使用已保存的旅行偏好" : "本次不使用"}</strong></div></div><label className={styles.checkLabel}><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>确认以上资料用于本次 AI 规划，并保存生成的行程。</span></label><button className={styles.primaryButton} disabled={!consent || loading || !readyToPlan} onClick={() => void generatePlan()}><Icon name="leaf" />{plan ? "生成调整后的行程" : "生成并保存行程"}</button><a className={styles.note} href="/privacy">查看数据与隐私说明 ↗</a></div>;
  }
  function renderMetrics() { return <div className={styles.metrics}><div className={styles.metric}><span><Icon name="pulse" size={15} />恢复指数</span><strong>{number(health?.recoveryScore)}<small> / 100</small></strong><small>{health ? "WHOOP 最近记录" : "等待设备同步"}</small></div><button className={styles.metric} style={{ border: 0, textAlign: "left" }} onClick={() => navigate("sleep")}><span><Icon name="moon" size={15} />睡眠</span><strong>{health?.sleepMinutes != null ? number(health.sleepMinutes / 60, 1) : "—"}<small> 小时</small></strong><small>查看睡眠与时区 ↗</small></button><div className={styles.metric}><span><Icon name="walk" size={15} />步数</span><strong>{health?.cycleSteps != null ? health.cycleSteps.toLocaleString("zh-CN") : "—"}</strong><small>{health ? "WHOOP 周期记录" : "暂无测量数据"}</small></div></div>; }
  function renderDayTabs() { return itineraryDays.length > 1 ? <div className={styles.filterRow} aria-label="选择行程日期">{itineraryDays.map(([day], index) => <button key={day} className={`${styles.chip} ${actualDay === day ? styles.active : ""}`} onClick={() => setSelectedDay(day)}>第 {index + 1} 天 {/^\d{4}-/.test(day) ? day.slice(5).replace("-", "/") : ""}</button>)}</div> : null; }
  function renderPlanActions() { const { can, primary } = planner.machine; return <div className={styles.stack}>{primary?.key === "start" && can.canStart ? <button className={`${styles.primaryButton} ${styles.roundButton}`} disabled={busy} onClick={() => void transition("active")}>{primary.label} <Icon name="arrow" /></button> : primary?.key === "replan" && can.canRecordFeedback ? <div className={styles.actions}><button className={styles.secondaryButton} onClick={() => setFeedbackOpen(true)}><Icon name="edit" />记录感受</button><button className={styles.primaryButton} onClick={() => setConsentOpen(true)}><Icon name="tune" />{primary.label}</button></div> : primary?.key === "new_journey" && can.canPlanNew ? <button className={styles.primaryButton} onClick={() => newJourney()}><Icon name="plus" />{primary.label}</button> : can.canGenerate ? <button className={styles.primaryButton} onClick={() => { setStep(2); navigate("create"); }}>{primary?.label ?? "继续完善旅程"} <Icon name="arrow" /></button> : null}{can.canShare && <div className={styles.actions}><button className={styles.textButton} onClick={() => { setShareOpen(true); setSharePath(""); }}><Icon name="share" size={16} />分享旅程</button>{can.canReplan ? <button className={styles.textButton} onClick={() => startAdjustment()}><Icon name="tune" size={16} />自定义节奏</button> : can.canRecordFeedback ? <button className={styles.textButton} onClick={() => setFeedbackOpen(true)}>记录回忆</button> : null}</div>}</div>; }

  function renderToday() {
    return <div className={styles.stack}>
      <div className={styles.syncBar}><span><i />{plan ? `目的地节奏 · ${journey?.draft.trip?.destinationCity}` : "跟随身体的节奏，开始下一段旅程"}</span><span className={styles.greenText}>{plan ? journey && STATUS_LABELS[journey.status] : "从容出发"}</span></div>
      <div className={styles.wideGrid}><section className={`${styles.card} ${styles.hero}`}><div className={styles.heroTop}><div className={styles.heroCopy}><Badge><Icon name="leaf" size={14} />{health?.recoveryScore != null ? `恢复指数 ${number(health.recoveryScore)}%` : "你的旅程，你的节奏"}</Badge><h2>{plan?.plan.headline || `${accountName || "旅行者"}，把旅程调成刚刚好。`}</h2><p>{plan?.plan.summary || "从当下的身体感受出发，寻找安静的角落、真实的当地体验和舒服的旅行节奏。"}</p></div><Gauge value={health?.recoveryScore} /></div>{renderMetrics()}<small className={styles.note}>{health ? `测量时间：${dateLabel(health.measuredAt, true)}` : "连接 WHOOP 可同步身体记录，也可以使用自己的感受规划。"}</small>{!plan ? <button className={`${styles.primaryButton} ${styles.roundButton}`} onClick={newJourney}><Icon name="plus" />创建我的旅程</button> : null}</section>
      <section className={styles.card}><div className={styles.sectionHead}><span><Icon name="tune" /><strong>节奏校准</strong></span><Badge tone="mint">随你调整</Badge></div><div className={styles.segmented}><button className={styles.active} onClick={() => plan ? setToast("当前显示的是账户中保存的行程。") : newJourney()}><Icon name="clock" size={16} />当前安排</button><button onClick={() => plan ? startAdjustment(true) : newJourney()}><Icon name="leaf" size={16} />轻松一些</button></div><div className={styles.inset}><Icon name="shield" size={18} /><p>{plan?.plan.reason || "旅行中的感受会变化。行程生成后，你可以保留固定预约，重新安排可调整的活动。"}</p></div><div className={styles.sectionHead}><small>{whoopConnected ? "WHOOP 已连接" : "身体记录由你掌控"}</small>{whoopConnected ? <button className={styles.textButton} disabled={busy} onClick={() => void syncHealth()}><Icon name="sync" size={14} />同步</button> : whoopConfigured ? <a className={styles.textButton} href="/api/whoop/connect">连接 WHOOP ↗</a> : <span className={styles.note}>支持主观感受规划</span>}</div></section></div>
      {healthError ? <div className={styles.error} role="status">{healthError}<button className={styles.iconButton} aria-label="关闭设备提示" onClick={() => setHealthError("")}><Icon name="close" size={15} /></button></div> : null}
      {plan ? <><div className={styles.sectionHead}><div><h3>{journey?.status === "completed" ? "旅程回顾" : "今日的旅程"}</h3><small className={styles.mutedText}>{actualDay && /^\d{4}-/.test(actualDay) ? dateLabel(`${actualDay}T12:00:00+08:00`) : "按你的旅行节奏安排"}</small></div><button className={styles.textButton} onClick={() => navigate("explore")}>{dayItems.length} 个节点 <Icon name="arrow" size={14} /></button></div>{renderDayTabs()}<Timeline items={dayItems} onSelect={setActivity} />{!journey?.planCurrent ? <div className={styles.inset}><Icon name="tune" /><p>偏好已经更新。这里显示上次生成的行程，重新生成后会保存新安排。</p></div> : null}<ProvenanceBlock provenance={plan.provenance} /></> : <><Ambience image="retreat" label="从安静的角落开始" title="留一点时间，给此刻的自己。" />{journeys.length ? <section className={styles.card}><div className={styles.sectionHead}><h3>继续你的旅程</h3><button className={styles.textButton} onClick={() => setPickerOpen(true)}>查看全部 ↗</button></div><div className={styles.journeyList}>{journeys.slice(0, 3).map((entry) => <div className={styles.journeyRow} key={entry.id}><button onClick={() => selectJourney(entry)}><strong>{entry.title}</strong><small>{STATUS_LABELS[entry.status]} · {dateLabel(entry.updatedAt)}</small></button><Icon name="arrow" size={16} /></div>)}</div></section> : null}</>}
      <div className={styles.breathingPrompt}><div><span className={styles.iconTile}><Icon name="wind" /></span><div><strong>3 分钟舒缓呼吸</strong><small>给忙碌的旅途一个轻轻的停顿</small></div></div><button onClick={() => navigate("breathing")}>开始</button></div>
      {plan ? renderPlanActions() : null}
      {journey?.status === "active" ? <div className={styles.actions}><button className={styles.textButton} onClick={() => navigate("fatigue")}><Icon name="leaf" size={16} />我有点累</button><button className={styles.textButton} disabled={busy} onClick={() => void transition("completed")}>完成这段旅程 <Icon name="check" size={16} /></button></div> : null}
      {feedbackHistory.length ? <section className={styles.card}><div className={styles.sectionHead}><h3>最近的旅行感受</h3><Badge tone="muted">已保存</Badge></div>{feedbackHistory.slice(0, 3).map((entry) => <div className={styles.inset} key={entry.id}><Icon name="edit" size={16} /><div><p>{entry.note || [entry.bodyFeedback, entry.moodFeedback].filter(Boolean).join(" · ") || `疲劳自评 ${entry.fatigue ?? "—"}/5`}</p><small className={styles.mutedText}>{dateLabel(entry.createdAt, true)}{entry.remembered ? " · 已加入旅程记忆" : ""}</small></div></div>)}</section> : null}
    </div>;
  }

  function renderWizard() {
    return <div className={styles.stack}>
      <div className={styles.wizardProgress}><Badge tone={step === 2 ? "mint" : "muted"}>● 第 {step + 1} / 4 步 · {STEP_LABELS[step]}</Badge>{[0, 1, 2, 3].map((index) => <button key={index} className={index <= step ? styles.active : ""} aria-label={`前往第 ${index + 1} 步，${STEP_LABELS[index]}`} disabled={index > step || (index === 3 && !plan) || loading} onClick={() => { setStep(index); setError(""); }} />)}</div>
      {step === 0 ? <><div className={styles.pageIntro}><h1>这趟旅程，<br />最想照顾什么？</h1><p>从旅行的初衷开始。活动密度、休息和当地体验，都会跟随你选择的节奏。</p></div><Ambience image="forest" label="身心与旅程，自然相连" title="把时间留给重要的感受。" /><div className={`${styles.stack} ${styles.intentGrid}`}>{INTENTS.map((item) => <button key={item.value} className={`${styles.intentCard} ${intention === item.value ? styles.selected : ""}`} aria-pressed={intention === item.value} onClick={() => { setIntention(item.value); setConsent(false); }}><div className={styles.intentHeader}><Icon name={item.icon} /><div><strong>{item.name}</strong><small>{item.subtitle}</small></div><span className={styles.radio}>{intention === item.value ? <Icon name="check" size={13} /> : null}</span></div><p>{item.detail}</p><div className={styles.chipRow}>{item.tags.map((tag) => <Badge key={tag} tone="muted">{tag}</Badge>)}</div></button>)}</div><section className={styles.card}><div className={styles.sectionHead}><span><Icon name="pulse" /><strong>现在的身体感受</strong></span><small>主观自评</small></div><p className={styles.note}>可以留空。未来出发时的身体状态，抵达后仍可更新。</p><div className={styles.scaleOptions}>{[["1", "轻松有活力", "疲劳较轻"], ["3", "想稍微放慢", "适量休息"], ["5", "需要好好休息", "疲劳明显"]].map(([value, name, note]) => <button key={value} className={fatigue === value ? styles.selected : ""} aria-pressed={fatigue === value} onClick={() => setFatigue(fatigue === value ? "" : value)}><i className={styles.statusDot} />{name}<small>{note}</small></button>)}</div></section><div className={styles.inset}><Icon name="leaf" /><p>没有标准答案。你可以在旅途中的每个阶段，重新告诉我什么让你舒服。</p></div></> : null}
      {step === 1 ? <><div className={styles.pageIntro}><h1>从哪里出发，<br />什么时候去？</h1><p>填写两地的当地时间，方便安排抵达后的休息、时区变化和返程。</p></div><div className={styles.wideGrid}><section className={styles.card}><div className={styles.sectionHead}><span><Icon name="compass" /><strong>旅行目的地</strong></span><Badge tone="muted">城市与时区</Badge></div><label className={styles.field}>出发城市<input maxLength={100} value={form.originCity} onChange={(event) => updateCity("originCity", event.target.value)} placeholder="例如：上海" autoComplete="address-level2" /></label><label className={styles.field}>目的地<input maxLength={100} value={form.destinationCity} onChange={(event) => updateCity("destinationCity", event.target.value)} placeholder="例如：东京" /></label><span className={styles.note}>你可能想去</span><div className={styles.chipRow}>{[...new Set([...(learnedDefaults?.destinations ?? []), "东京", "京都", "巴厘岛", "箱根", "清迈"])].map((city) => <button key={city} className={`${styles.chip} ${form.destinationCity === city ? styles.active : ""}`} onClick={() => updateCity("destinationCity", city)}>{form.destinationCity === city ? <Icon name="check" size={13} /> : null}{city}</button>)}</div><Ambience image="retreat" label="目的地由你决定" title={form.destinationCity ? `${form.destinationCity}，慢慢相遇。` : "寻找你的下一个安静角落。"} /></section><section className={styles.card}><div className={styles.sectionHead}><span><Icon name="calendar" /><strong>旅行时间</strong></span><small>使用当地时间</small></div><label className={styles.field}>出发日期与时间<input type="datetime-local" value={form.departureLocal} onChange={(event) => update("departureLocal", event.target.value)} /></label><label className={styles.field}>出发时区<select value={form.departureTimezone} onChange={(event) => update("departureTimezone", event.target.value)}><option value="">请选择出发时区</option>{ZONES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label className={styles.field}>抵达日期与时间<input type="datetime-local" value={form.arrivalLocal} onChange={(event) => update("arrivalLocal", event.target.value)} /></label><label className={styles.field}>目的地时区<select value={form.destinationTimezone} onChange={(event) => update("destinationTimezone", event.target.value)}><option value="">请选择目的地时区</option>{ZONES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label className={styles.field}>返程日期<input type="date" min={form.arrivalLocal.slice(0, 10) || undefined} value={form.returnDate} onChange={(event) => update("returnDate", event.target.value)} /><small>可选。填写后可以规划整段旅行。</small></label><div className={styles.inset}><Icon name="sun" /><p>时区已根据城市预选，请核对。航班跨日或跨时区时，抵达时间仍填写目的地当地时间。</p></div></section></div></> : null}
      {step === 2 ? <><div className={styles.pageIntro}><h1>调一调，<br />让旅程更合身。</h1><p>选择安排方式，连接身体记录，保护已经确定的预约，再开始生成。</p></div><div className={styles.wideGrid}><section className={styles.card}><div className={styles.sectionHead}><span><Icon name="tune" /><strong>旅行节奏</strong></span><Badge tone="muted">安排偏好</Badge></div><div className={styles.segmented}><button className={form.planningStyle === "structured" ? styles.active : ""} onClick={() => update("planningStyle", "structured")}>有序清晰</button><button className={form.planningStyle === "flexible" ? styles.active : ""} onClick={() => update("planningStyle", "flexible")}>留白探索</button></div><div className={styles.inset}><Icon name="leaf" /><p>{form.planningStyle === "structured" ? "时间块与衔接更清楚，让预约和交通有明确安排。" : "把活动安排得宽松一些，保留临场探索和休息的空间。"} 已有的固定安排会纳入规划。</p></div><label className={styles.field}>已确定的活动或预约<textarea maxLength={6000} rows={4} value={form.itineraryText} onChange={(event) => update("itineraryText", event.target.value)} placeholder={"09:00 | 美术馆预约 | 固定\n14:00 | 午餐 | 灵活"} /><small>每行：HH:mm | 活动名称 | 固定 / 灵活</small></label><div className={styles.sectionHead}><strong>舒服的空间</strong><small>可多选</small></div><div className={styles.chipRow}>{AMBIENCE.map((item) => <button className={`${styles.chip} ${ambient.includes(item) ? styles.active : ""}`} key={item} aria-pressed={ambient.includes(item)} onClick={() => setAmbient(toggle(ambient, item))}>{item}</button>)}</div><div className={styles.twoColumns}><label className={styles.field}>疲劳自评<select value={fatigue} onChange={(event) => setFatigue(event.target.value)}><option value="">未填写</option>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} / 5{value === 1 ? " · 很轻" : value === 5 ? " · 明显" : ""}</option>)}</select></label><label className={styles.field}>压力自评<select value={stress} onChange={(event) => setStress(event.target.value)}><option value="">未填写</option>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} / 5{value === 1 ? " · 很低" : value === 5 ? " · 很高" : ""}</option>)}</select></label></div><label className={styles.field}>身体或活动偏好<textarea maxLength={80} rows={2} value={bodyFeedback} onChange={(event) => setBodyFeedback(event.target.value)} placeholder="例如：希望少走路，每天下午安排一段休息" /></label></section><div className={styles.stack}><section className={styles.card}><div className={styles.sectionHead}><span><Icon name="sync" /><strong>连接身体节奏</strong></span><Badge tone={whoopConnected ? "mint" : "muted"}>{whoopConnected ? "已连接" : "可选"}</Badge></div><div className={styles.inset}><Icon name="pulse" /><div><strong>WHOOP</strong><p>{whoopConnected ? health ? `最近记录：恢复 ${number(health.recoveryScore)}% · 睡眠 ${sleepDuration(health.sleepMinutes)}` : "已连接，暂无最近同步的完整记录。" : "连接后可结合近期恢复、睡眠与活动记录。"}</p></div></div>{whoopConnected ? <label className={styles.checkLabel}><input type="checkbox" checked={includeWhoop} onChange={(event) => { setIncludeWhoop(event.target.checked); setConsent(false); }} /><span>本次规划使用 WHOOP 近期记录</span></label> : whoopConfigured ? <a className={styles.secondaryButton} href="/api/whoop/connect">连接 WHOOP ↗</a> : <p className={styles.note}>目前可使用主观自评与旅行偏好继续规划。</p>}<p className={styles.note}>未来旅程的身体状态仍会变化，抵达后可以重新规划。</p>{memoryText ? <label className={styles.checkLabel}><input type="checkbox" checked={includeMemory} onChange={(event) => { setIncludeMemory(event.target.checked); setConsent(false); }} /><span>使用我的旅行偏好与旅程记忆</span></label> : null}</section><section className={styles.card}><div className={styles.sectionHead}><span><Icon name="compass" /><strong>当地旅行服务</strong></span><Badge tone="mint">真实检索</Badge></div><div className={styles.serviceGrid}>{SERVICES.map(([value, label]) => <label className={styles.serviceOption} key={value}><input type="checkbox" checked={form.requestedServices.includes(value)} onChange={() => update("requestedServices", toggle(form.requestedServices, value))} />{label}</label>)}</div><label className={styles.field}>饮食喜好或限制<input maxLength={500} value={form.foodPreferences} onChange={(event) => update("foodPreferences", event.target.value)} placeholder="例如：素食、少辣、对花生过敏" /></label></section><Ambience image="sleep" label="给恢复留出空间" title="享受探索，也享受休息。" /></div></div><section className={styles.card}><div className={styles.sectionHead}><span><Icon name="shield" /><strong>本次资料确认</strong></span><Badge tone="green">由你决定</Badge></div>{renderConsent()}</section>{serviceReady === false ? <div className={styles.inset}><Icon name="clock" /><p>规划服务暂时未就绪。可先保存草稿；恢复后再生成。</p></div> : null}</> : null}
      {step === 3 ? plan ? <><div className={styles.pageIntro}><div className={styles.sectionHead}><span className={styles.eyebrow}>旅程已经整理好了</span><Badge tone="mint"><Icon name="check" size={12} />已保存</Badge></div><h1>{plan.plan.headline}</h1><p>为{accountName || "你"}安排 · {INTENTS.find((item) => item.value === journey?.draft.intention)?.name || "自己的节奏"}</p></div><div className={styles.wideGrid}><section className={styles.card}><div className={styles.sectionHead}><span><Icon name="pulse" /><strong>这次规划的依据</strong></span><Badge tone="muted">真实资料</Badge></div><p>{plan.plan.summary}</p><div className={styles.summaryList}><div className={styles.summaryRow}><span>旅行路线</span><strong>{journey?.draft.trip?.originCity} → {journey?.draft.trip?.destinationCity}</strong></div><div className={styles.summaryRow}><span>时区变化</span><strong>{plan.timezone.shiftMinutes > 0 ? "+" : ""}{number(plan.timezone.shiftMinutes / 60, 1)} 小时</strong></div><div className={styles.summaryRow}><span>身体资料</span><strong>{plan.healthContext.basis === "whoop_recent" ? "WHOOP 近期记录" : plan.healthContext.basis === "self_report" ? "本次主观感受" : "旅行偏好"}</strong></div><div className={styles.summaryRow}><span>整理时间</span><strong>{dateLabel(plan.retrievedAt, true)}</strong></div></div><div className={styles.inset}><Icon name="leaf" /><p>{plan.plan.reason}</p></div>{plan.healthContext.provisional ? <p className={styles.note}>出发时的身体状态可能变化。抵达后更新感受，可以重新调整当天的安排。</p> : null}</section><section className={styles.card}><div className={styles.sectionHead}><span><Icon name="lock" /><strong>固定安排</strong></span><Badge tone="green">规划时保留</Badge></div>{plan.plan.itinerary.filter((item) => item.fixed).length ? plan.plan.itinerary.filter((item) => item.fixed).map((item, index) => <div className={styles.summaryRow} key={index}><span>{item.time}</span><strong>{item.name}</strong></div>) : <p className={styles.note}>本次没有填写固定预约，可以按自己的节奏灵活调整。</p>}<p className={styles.note}>“固定安排”来自你填写的日程；预订状态以供应商订单为准。</p><Ambience image="tea" label="从容旅行的小小约定" title="把休息也当作旅程的一部分。" /></section><section className={`${styles.card} ${styles.fullWidth}`}><div className={styles.sectionHead}><span><Icon name="calendar" /><strong>完整行程序列</strong></span><Badge tone="muted">{plan.plan.itinerary.length} 个节点</Badge></div>{renderDayTabs()}<Timeline items={dayItems} onSelect={setActivity} /></section></div>{renderPlanActions()}<button className={styles.secondaryButton} onClick={() => startAdjustment()}><Icon name="tune" />自定义时间或调整节奏</button></> : <div className={`${styles.card} ${styles.empty}`}><Icon name="calendar" /><h2>还差一步，行程就能生成。</h2><p>确认节奏与本次资料，再开始真实检索。</p><button className={styles.primaryButton} onClick={() => setStep(2)}>返回资料确认</button></div> : null}
    </div>;
  }

  function renderAdjust() {
    if (!plan) return <div className={`${styles.card} ${styles.empty}`}><Icon name="tune" /><h2>从一段真实的旅程开始。</h2><p>生成行程后，随时根据自己的感受调整当天的安排。</p><button className={styles.primaryButton} onClick={newJourney}>创建旅程 <Icon name="arrow" /></button></div>;
    return <div className={styles.stack}><div className={styles.pageIntro}><span className={styles.eyebrow}><Icon name="tune" size={16} />跟随当下的身体节奏</span><h1>让行程，舒服一点。</h1><p>告诉我现在的感觉。固定安排会一起纳入规划，新的行程生成后会保存到这段旅程。</p></div><div className={styles.successBanner}><Icon name="leaf" /><div><strong>{journey?.status === "completed" ? "这段旅程已完成" : "保留重要安排，重新整理节奏"}</strong><p>{plan.plan.itinerary.filter((item) => item.fixed).length} 个固定安排 · {plan.plan.itinerary.filter((item) => !item.fixed).length} 个灵活节点</p></div></div><div className={styles.wideGrid}><section className={styles.card}><div className={styles.sectionHead}><h3>现在想怎样安排？</h3><Badge tone="mint">主观自评</Badge></div><div className={styles.segmented}><button className={intention === "安静恢复" ? styles.active : ""} onClick={() => setIntention("安静恢复")}><Icon name="leaf" size={16} />慢下来</button><button className={intention === "慢慢探索" ? styles.active : ""} onClick={() => setIntention("慢慢探索")}><Icon name="compass" size={16} />继续探索</button></div><div className={styles.twoColumns}><label className={styles.field}>身体疲劳<select value={fatigue} onChange={(event) => setFatigue(event.target.value)}><option value="">未填写</option>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} / 5{value === 5 ? " · 很明显" : value === 1 ? " · 很轻" : ""}</option>)}</select></label><label className={styles.field}>主观压力<select value={stress} onChange={(event) => setStress(event.target.value)}><option value="">未填写</option>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} / 5</option>)}</select></label></div><label className={styles.field}>身体感受<textarea maxLength={80} rows={3} value={bodyFeedback} onChange={(event) => setBodyFeedback(event.target.value)} placeholder="例如：走得有些久，想找一个坐下来喝茶的地方" /></label><label className={styles.field}>心情与兴趣<textarea maxLength={80} rows={2} value={moodFeedback} onChange={(event) => setMoodFeedback(event.target.value)} placeholder="例如：希望下午去安静的展馆" /></label><div className={styles.chipRow}>{AMBIENCE.map((item) => <button className={`${styles.chip} ${ambient.includes(item) ? styles.active : ""}`} key={item} aria-pressed={ambient.includes(item)} onClick={() => setAmbient(toggle(ambient, item))}>{item}</button>)}</div>{whoopConnected ? <label className={styles.checkLabel}><input type="checkbox" checked={includeWhoop} onChange={(event) => setIncludeWhoop(event.target.checked)} /><span>本次重新读取 WHOOP 近期身体记录</span></label> : null}<button className={styles.primaryButton} disabled={loading || journey?.status === "completed" || !readyToPlan} onClick={() => { setConsent(false); setConsentOpen(true); }}><Icon name="sync" />重新规划并保存</button></section><div className={styles.stack}><section className={styles.card}><div className={styles.sectionHead}><h3>当前安排的调整说明</h3><Badge tone="muted">{plan.plan.adjustments.length} 条</Badge></div>{plan.plan.adjustments.length ? plan.plan.adjustments.map((detail, index) => <div className={styles.diff} key={index}><span className={styles.eyebrow}><Icon name="check" size={15} />安排 {index + 1}</span><p>{detail}</p></div>) : <p>{plan.plan.reason}</p>}</section>{previousPlan ? <section className={styles.card}><h3>上一次与当前版本</h3><div className={styles.twoColumns}><div className={styles.inset}><div><small>上一次 · {previousPlan.plan.itinerary.length} 个节点</small><strong>{previousPlan.plan.headline}</strong></div></div><div className={styles.inset}><div><small>当前 · {plan.plan.itinerary.length} 个节点</small><strong>{plan.plan.headline}</strong></div></div></div><p className={styles.note}>生成成功后使用当前版本。固定活动与供应商订单仍需以原始预约为准。</p></section> : null}<Ambience image="tea" label="不赶路，也能抵达" title="留一个停顿，重新找回节奏。" /><div className={styles.breathingPrompt}><div><span className={styles.iconTile}><Icon name="wind" /></span><div><strong>先休息 3 分钟</strong><small>跟随呼吸，给自己一点空间</small></div></div><button onClick={() => navigate("breathing")}>开始</button></div></div></div><button className={styles.textButton} onClick={() => { if (journey) fillDraft(journey.draft); navigate("today"); }}><Icon name="back" size={16} />保留当前行程并返回今日</button></div>;
  }

  function renderExplore() { return <div className={styles.stack}><div className={styles.pageIntro}><span className={styles.eyebrow}><Icon name="leaf" size={15} />真实的当地体验</span><h1>寻找下一处，<br />舒服的停靠点。</h1><p>{plan ? `从${journey?.draft.trip?.destinationCity}的真实检索结果里，看看适合你的餐食、休息和当地服务。` : "先告诉我目的地，我会为你的行程寻找有来源的真实体验。"}</p></div><div className={styles.filterRow}>{["全部", "餐食茶饮", "休息放松", "旅行交通"].map((item) => <button key={item} className={`${styles.chip} ${filter === item ? styles.active : ""}`} onClick={() => setFilter(item)}><Icon name={item === "全部" ? "compass" : item === "餐食茶饮" ? "cup" : item === "休息放松" ? "leaf" : "train"} size={14} />{item}</button>)}</div>{filteredPlaces.length ? <div className={styles.placeGrid}>{filteredPlaces.map((entry) => <article className={styles.placeCard} key={`${entry.name}-${entry.url}`}><button className={styles.placeCover} style={{ border: 0, cursor: "pointer" }} onClick={() => setPlace(entry)} aria-label={`查看${entry.name}`}><Badge tone="green"><Icon name="shield" size={12} />有来源的旅行信息</Badge><Icon name={activityIcon(entry.name + entry.category)} /><small>{entry.category} · 来源：{entry.source}</small></button><div><h3>{entry.name}</h3><p>{entry.reason}</p></div><button className={styles.primaryButton} onClick={() => setPlace(entry)}><Icon name="compass" size={16} />查看详情与预订来源</button></article>)}</div> : <section className={`${styles.card} ${styles.empty}`}><Icon name="compass" /><h2>{plan ? "这个分类暂时没有结果。" : "你的目的地，等你来选。"}</h2><p>{plan ? "试试全部结果，或回到调整页修改想检索的服务。" : "创建旅程后，会在这里展示来自真实检索的地点与商品链接。"}</p><button className={styles.primaryButton} onClick={() => plan ? setFilter("全部") : newJourney()}>{plan ? "查看全部结果" : "创建旅程"}</button></section>}<div className={styles.inset}><Icon name="shield" /><div><strong>真实来源，自己决定</strong><p>商品价格、营业时间和可订状态，以打开后的供应商页面为准。BioTrip 不会代你下单或支付。</p></div></div></div>; }
  function renderSleep() { return <div className={styles.stack}><div className={styles.eyebrow}><Icon name="moon" size={16} />睡眠与目的地时区</div><div className={styles.wideGrid}><section className={`${styles.card} ${styles.hero}`}><div className={styles.sectionHead}><span><Icon name="pin" /><strong>{journey?.draft.trip?.destinationCity || "当前旅行节奏"}</strong></span><Badge tone="mint">{plan ? "时区已核对" : "等待旅行信息"}</Badge></div><div className={styles.sleepGauge}><div><strong>{plan ? `${plan.timezone.shiftMinutes > 0 ? "+" : ""}${number(plan.timezone.shiftMinutes / 60, 1)} 小时` : "—"}</strong><small>相对出发地的时区变化</small></div></div><div className={styles.inset}><Icon name="sun" /><p>{plan ? `旅行时间约 ${number(plan.timezone.travelHours, 1)} 小时。抵达后留意当地光照与自己实际的睡意，按目的地时间逐步安排作息。` : "选择目的地并生成行程后，可查看两地时区变化。"}</p></div><p className={styles.note}>身体适应程度与睡眠窗口尚无测量依据，页面只显示已同步的真实记录。</p></section><section className={styles.card}><div className={styles.sectionHead}><h3>最近睡眠记录</h3><Badge tone="green">WHOOP</Badge></div><div><small className={styles.mutedText}>总睡眠时长</small><h1>{sleepDuration(health?.sleepMinutes)}</h1></div><div className={styles.metrics}><div className={styles.metric}><span><Icon name="moon" size={14} />睡眠表现</span><strong>{number(health?.sleepPerformance)}<small>%</small></strong><small>设备记录</small></div><div className={styles.metric}><span><Icon name="heart" size={14} />静息心率</span><strong>{number(health?.restingHeartRate)}</strong><small>次 / 分</small></div><div className={styles.metric}><span><Icon name="pulse" size={14} />心率变异</span><strong>{number(health?.hrvRmssdMilli, 1)}</strong><small>毫秒</small></div></div><p className={styles.note}>测量时间：{dateLabel(health?.measuredAt, true)}。这是最近的记录，未在旅途中持续测量。</p>{whoopConnected ? <button className={styles.secondaryButton} disabled={busy} onClick={() => void syncHealth()}><Icon name="sync" />同步最新记录</button> : whoopConfigured ? <a className={styles.primaryButton} href="/api/whoop/connect">连接 WHOOP</a> : null}</section></div>{plan ? <section className={styles.card}><div className={styles.sectionHead}><h3>行程里的休息节点</h3><small>来源：当前计划</small></div>{plan.plan.itinerary.filter((item) => /休息|睡|午休|住宿|酒店|放松|茶|咖啡/.test(item.name + item.detail)).slice(0, 5).map((item, index) => <div className={styles.summaryRow} key={index}><span>{item.time}</span><strong>{item.name}</strong></div>)}<p className={styles.note}>想更早休息，可以在调整页告诉我；已确定的预约仍会纳入新规划。</p></section> : null}<Ambience image="sleep" label="夜晚也是旅程的一部分" title="把一天温柔地收好。" />{plan && journey?.status !== "completed" ? <button className={styles.primaryButton} onClick={() => { setBodyFeedback("希望晚上早点回到住宿休息，保留固定预约，减少夜间活动。"); startAdjustment(); }}><Icon name="moon" />调整行程，早点休息</button> : null}</div>; }
  function renderFatigue() { return <div className={styles.stack}><div className={styles.dangerBanner}><Icon name="heart" size={14} />身体感受由你告诉我 · 不是自动健康诊断</div><section className={styles.card}><span className={styles.eyebrow}>给旅程留一个停顿</span><div className={styles.sectionHead}><h1>累了，<br />就慢一点。</h1><Badge tone="rose"><Icon name="leaf" /></Badge></div><p>可以减少步行、安排坐下来休息的地方，或者提前结束今天的探索。你的固定安排会一起纳入重新规划。</p><div className={styles.metrics}><div className={styles.metric}><span>心率变异</span><strong>{number(health?.hrvRmssdMilli, 1)}</strong><small>毫秒 · 最近记录</small></div><div className={styles.metric}><span>活动负荷</span><strong>{number(health?.cycleStrain, 1)}</strong><small>WHOOP 周期记录</small></div><div className={styles.metric}><span>恢复指数</span><strong>{number(health?.recoveryScore)}<small>%</small></strong><small>最近记录</small></div></div><p className={styles.note}>这些历史记录不能证明此刻疲劳；新安排以你本次填写的感受为依据。</p></section><section className={styles.card}><div className={styles.sectionHead}><span><Icon name="leaf" /><h3>更从容的下一步</h3></span><Badge tone="mint">由你选择</Badge></div><Ambience image="tea" label="一处可以坐下来的安静角落" title="喝口水，休息一下。" /><div className={styles.inset}><Icon name="train" /><div><strong>减少走路，增加衔接空间</strong><p>告诉我你想放慢，我会检索适合的当地交通和休息体验，再生成完整的新安排。</p></div></div><button className={styles.primaryButton} onClick={() => startAdjustment(true)}>调整为轻松节奏 <Icon name="arrow" /></button><button className={styles.secondaryButton} onClick={() => navigate("breathing")}><Icon name="wind" />先做 3 分钟呼吸练习</button></section><button className={styles.textButton} onClick={() => navigate("today")}>保留当前行程并返回</button></div>; }

  if (!authReady) return <main className={styles.app}><div className={styles.loading}><div className={styles.spinner} /><strong>正在打开你的 BioTrip…</strong></div></main>;
  if (initError) return <main className={styles.app}><div className={styles.loading}><h2>暂时无法打开账户</h2><p role="alert">{initError}</p><button className={styles.primaryButton} onClick={() => window.location.reload()}>重新加载</button></div></main>;
  const detailView = ["breathing", "sleep", "fatigue"].includes(view);
  const headerDestination = journey?.draft.trip?.destinationCity;
  return <main className={styles.app}>
    <header className={styles.header}><div className={styles.headerInner}>{view === "create" ? <><button className={styles.iconButton} aria-label={step > 0 ? "上一步" : "返回今日"} disabled={loading || busy} onClick={() => step > 0 ? setStep(step - 1) : navigate("today")}><Icon name="back" /></button><div className={styles.wizardHead}><Badge tone="muted">● 第 {step + 1} 步 · {STEP_LABELS[step]}</Badge></div><div className={styles.headerActions}><a className={styles.avatar} href="/profile" aria-label="我的档案"><Icon name="person" size={17} /></a><button className={styles.iconButton} disabled={loading} aria-label="关闭旅程创建" onClick={() => navigate("today")}><Icon name="close" /></button></div></> : <><div className={styles.headerTitle}><div>{detailView ? <button className={styles.iconButton} aria-label="返回今日" onClick={() => navigate("today")}><Icon name="back" /></button> : <Icon name="pin" size={15} />}<button style={{ border: 0, background: "transparent", padding: 0, textAlign: "left" }} onClick={() => setPickerOpen(true)} aria-label="选择或管理旅程"><strong>{detailView ? VIEW_LABELS[view] : headerDestination ? `${headerDestination} · ${journey ? STATUS_LABELS[journey.status] : "我的旅程"}` : "BioTrip"}</strong></button></div><small>{detailView ? "跟随自己的节奏" : VIEW_LABELS[view]}</small></div><div className={styles.headerActions}>{whoopConnected ? <Badge tone="mint"><span className={styles.statusDot} /><Icon name="sync" size={12} />已连接</Badge> : <Badge tone="muted">我的旅程</Badge>}<a className={styles.avatar} href="/profile" aria-label="我的档案"><Icon name="person" size={17} /></a></div></>}</div></header>
    <div className={`${styles.content} ${view === "create" ? styles.wizardContent : ""}`}>
      {error ? <div className={styles.error} role="alert" style={{ margin: "16px 0" }}><span>{error}</span><button className={styles.iconButton} aria-label="关闭错误提示" onClick={() => setError("")}><Icon name="close" size={16} /></button></div> : null}
      {loading ? <section className={styles.loading} aria-live="polite"><div className={styles.spinner} /><h2>正在整理你的旅程</h2><p>{progressMessage}</p><div className={styles.loadingSteps}>{[["preparing", "准备旅行资料"], ["health_insight", "结合身体感受与偏好"], ["local_info", "检索真实目的地信息"], ["flyai_planning", "安排路线与当地体验"]].map(([stage, label], index) => <div className={progressStage === stage ? styles.active : ""} key={stage}><span>{index + 1}</span>{label}</div>)}</div><p className={styles.note}>完成后会保存到你的账户。等候期间可以停止，你的原行程仍会保留。</p><button className={styles.secondaryButton} style={{ maxWidth: 300 }} onClick={() => generation.current?.abort()}>停止本次生成</button></section> : view === "today" ? renderToday() : view === "create" ? renderWizard() : view === "adjust" ? renderAdjust() : view === "explore" ? renderExplore() : view === "sleep" ? renderSleep() : view === "fatigue" ? renderFatigue() : <BreathingSession restingHeartRate={health?.restingHeartRate} onComplete={(completed) => { navigate("today"); if (completed && journey && ["active", "completed"].includes(journey.status)) void sendFeedback("完成了一次 3 分钟舒缓呼吸练习。", true); else setToast(completed ? "3 分钟练习已完成，回到自己的节奏。" : "练习已结束，随时可以再开始。"); }} />}
    </div>
    {!loading && view === "create" && step < 3 ? <footer className={styles.wizardFooter}><div><button className={styles.textButton} disabled={busy} onClick={() => void saveDraft()}>{busy ? "保存中…" : "保存草稿"}</button>{step < 2 ? <button className={styles.primaryButton} disabled={busy} onClick={() => void advance()}>继续 <Icon name="arrow" size={19} /></button> : <button className={styles.textButton} onClick={() => { setConsent(false); setConsentOpen(true); }}>确认并生成 <Icon name="arrow" size={17} /></button>}</div></footer> : !detailView && !loading ? <nav className={styles.dock} aria-label="主导航"><button className={view === "today" ? styles.active : ""} aria-current={view === "today" ? "page" : undefined} onClick={() => navigate("today")}><Icon name="sun" />今日</button><button className={view === "adjust" ? styles.active : ""} aria-current={view === "adjust" ? "page" : undefined} onClick={() => navigate("adjust")}><Icon name="tune" />调整</button><button className={view === "explore" ? styles.active : ""} aria-current={view === "explore" ? "page" : undefined} onClick={() => navigate("explore")}><Icon name="compass" />探索</button><a href="/profile"><Icon name="person" />我的</a></nav> : null}
    {toast ? <div className={styles.toast} role="status">{toast}</div> : null}
    {pickerOpen ? <Modal title="我的旅程" onClose={closePicker}><button className={styles.primaryButton} onClick={newJourney}><Icon name="plus" />创建新旅程</button><div className={styles.journeyList}>{journeys.length ? journeys.map((entry) => <div className={styles.journeyRow} key={entry.id}><button onClick={() => selectJourney(entry)}><strong>{entry.title}</strong><small>{STATUS_LABELS[entry.status]} · {dateLabel(entry.updatedAt)}</small></button><button className={styles.iconButton} aria-label={`删除${entry.title}`} onClick={() => { setPickerOpen(false); setDeleteTarget(entry); }}><Icon name="trash" size={16} /></button></div>) : <p className={styles.note}>还没有保存的旅程。创建后可在这里继续。</p>}</div><button className={styles.textButton} disabled={busy} onClick={async () => { setBusy(true); try { const payload = await jsonRequest<{ journeys: Journey[] }>("/api/journeys"); setJourneys(payload.journeys); setToast("旅程列表已刷新。"); } catch (caught) { setError(caught instanceof Error ? caught.message : "刷新失败。"); } finally { setBusy(false); } }}><Icon name="sync" size={15} />刷新旅程列表</button></Modal> : null}
    {deleteTarget ? <Modal title="删除这段旅程？" onClose={closeDelete} busy={busy}><p>“{deleteTarget.title}”的行程和关联体验记录将被删除。这个操作无法撤销。</p><button className={styles.primaryButton} style={{ background: "#b90538" }} disabled={busy} onClick={() => void removeJourney()}>{busy ? "正在删除…" : "确认删除旅程"}</button><button className={styles.secondaryButton} disabled={busy} onClick={closeDelete}>保留旅程</button></Modal> : null}
    {consentOpen ? <Modal title="确认这次规划" onClose={closeConsent}>{renderConsent()}</Modal> : null}
    {activity ? <Modal title={activity.name} onClose={closeActivity}><Badge tone={activity.fixed ? "green" : "muted"}><Icon name={activity.fixed ? "lock" : "clock"} size={14} />{activity.date ? `${activity.date} · ` : ""}{activity.time} · {activity.fixed ? "固定安排" : "可调整活动"}</Badge><p>{activity.detail}</p>{activity.fixed ? <div className={styles.inset}><Icon name="lock" /><p>规划时会保留你填写的固定安排，预订确认请以原始订单为准。</p></div> : null}<button className={styles.primaryButton} onClick={() => { setActivity(null); navigate("explore"); }}>查看当地体验与来源 <Icon name="arrow" /></button>{journey?.status !== "completed" ? <button className={styles.secondaryButton} onClick={() => { setActivity(null); startAdjustment(); }}>调整这段旅程的节奏</button> : null}</Modal> : null}
    {place ? <Modal title="当地体验详情" onClose={closePlace}><div className={`${styles.placeCover} ${styles.placeDetailHero}`}><Badge><Icon name="shield" size={13} />真实来源</Badge><Icon name={activityIcon(place.name + place.category)} /><small>{place.category} · {place.source}</small></div><h2>{place.name}</h2><p>{place.reason}</p><div className={styles.inset}><Icon name="clock" /><p>价格、时间、可订状态与取消规则，请在供应商页面核对。页面不会显示未经检索确认的报价。</p></div><a className={styles.primaryButton} href={publicUrl(place.url)} target="_blank" rel="noopener noreferrer"><Icon name="compass" />打开{(/飞猪|fliggy|flyai/i.test(place.source + place.url) ? "飞猪" : "官方来源")}并查看预订 <Icon name="arrow" /></a><button className={styles.secondaryButton} onClick={() => { setBodyFeedback(`希望纳入${place.name}，安排充分休息，保留固定预约。`.slice(0, 80)); setPlace(null); startAdjustment(); }}>把这个体验纳入重新规划</button><p className={styles.note}>BioTrip 不会代你完成订单。购买后可将预约时间填写为固定安排。</p></Modal> : null}
    {shareOpen ? <Modal title="分享这段旅程" onClose={closeShare} busy={busy}><p>创建公开链接后，任何获得链接的人都可查看目的地、旅程摘要与地点来源。链接不包含健康数据、个人档案或出行日期。</p>{sharePath ? <><a className={styles.inset} style={{ overflowWrap: "anywhere" }} href={sharePath} target="_blank" rel="noopener noreferrer">{typeof window !== "undefined" ? new URL(sharePath, window.location.origin).href : sharePath}</a><button className={styles.primaryButton} onClick={() => void copyShare()}><Icon name="share" />复制分享链接</button><p className={styles.note}>分享链接 90 天后到期，可以在“我的”中提前撤回。</p></> : <button className={styles.primaryButton} disabled={busy} onClick={() => void createShare()}>{busy ? "正在创建…" : "确认创建公开分享链接"}</button>}</Modal> : null}
    {feedbackOpen ? <Modal title="记录这次旅行的感受" onClose={closeFeedback} busy={busy}><label className={styles.field}>这一刻，感觉怎么样？<textarea rows={4} maxLength={1000} value={feedbackNote} onChange={(event) => setFeedbackNote(event.target.value)} placeholder="例如：下午留出休息后，晚餐时更有精神。" /></label><div className={styles.twoColumns}><label className={styles.field}>疲劳自评<select value={fatigue} onChange={(event) => setFatigue(event.target.value)}><option value="">未填写</option>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} / 5</option>)}</select></label><label className={styles.field}>压力自评<select value={stress} onChange={(event) => setStress(event.target.value)}><option value="">未填写</option>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} / 5</option>)}</select></label></div><label className={styles.checkLabel}><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />下次旅行也记住一个偏好</label>{remember ? <label className={styles.field}>希望记住什么<textarea rows={2} maxLength={500} value={memoryNote} onChange={(event) => setMemoryNote(event.target.value)} placeholder="例如：长途抵达当天，午后安排至少一小时休息。" /></label> : null}<button className={styles.primaryButton} disabled={busy || (!feedbackNote.trim() && !fatigue && !stress) || (remember && !memoryNote.trim())} onClick={() => void sendFeedback()}>{busy ? "保存中…" : "保存这次感受"}</button></Modal> : null}
  </main>;
}
