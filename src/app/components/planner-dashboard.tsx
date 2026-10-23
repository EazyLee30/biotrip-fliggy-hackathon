"use client";
import { MessageCircle } from "lucide-react";
import { DiscoveryExperience } from "./planner/discovery-experience";
import { TodayExperience } from "./planner/today-experience";
import { JourneyCollectionsView } from "./planner/journey-collections-view";
import { useBodyCheckIn } from "./planner/use-body-check-in";
import { MotionProvider } from "./ui/motion-provider";
import { ToggleSwitch } from "./toggle-switch";
import { EditorialImage } from "./planner/editorial-image";
import { JourneyVisualButton } from "./planner/journey-visual-button";

import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { SetStateAction } from "react";
import type { Journey, JourneyDraft, JourneyGeneratedPlan } from "@/lib/journey-types";
import { applyWhoopResponse, EMPTY_WHOOP_DISPLAY, readWhoopResponse, whoopMetricLabel, whoopReadFailed, whoopStatusLabel, type WhoopDisplay } from "@/lib/whoop-display";
import { Badge, BreathingSession, dismissSheetsBeforeNavigation, Icon, Modal } from "./zen-ui";
import { journeyMachine } from "./planner/machine";
import { ProvenanceBlock } from "./planner/blocks/provenance";
import { PlacePickerDialog } from "./planner/place-picker";
import { reservationTextError } from "./planner/reservations";
import { clearPendingReservations, readPendingReservations, savePendingReservations } from "./planner/pending-reservations";
import { PhraseInput, QuickRating } from "./planner/quick-inputs";
import { ShareDialog } from "./planner/share-dialog";
import { ItineraryEditor } from "./planner/itinerary-editor";
import { applyItineraryOperations, itineraryDates, rebasePendingReservations, syncItineraryReservations, type ItineraryOperation } from "@/lib/itinerary-edit";
import { decodePlanRecommendations, mergeRecommendations, type PlanRecommendation } from "@/lib/planning-recommendations";
import { resolveTripTiming } from "@/lib/trip-timing";
import { validateTravelRange } from "./planner/travel-dates";
import { parseSchedule, planningDateError, scheduleError } from "@/lib/planner-input";
import { PLACES } from "@/lib/places";
import { JourneyCover } from "./planner/journey-cover";
import { PlaceDetail } from "./planner/blocks/place-detail";
import { BreathingOverlay } from "./planner/breathing-overlay";
import ProfileView from "./profile-view";
import { AgentDock } from "./agent/agent-dock";
import type { MemoryItem } from "@/lib/agent/memory-types";
import { appJourneyUrl, readAppView, type AppView, type NavigationIntent } from "./planner/app-navigation";
import { useJourneyState } from "./planner/use-journey-state";
import { useDraftPersistence } from "./planner/use-draft-persistence";
import { useAppNavigation } from "./planner/use-app-navigation";
import { watchPlanningJob } from "./planner/planning-job-viewer";
import { AppDock } from "./planner/app-dock";
import { coverForDestination } from "@/lib/visual-assets";
import type { PlanningJob } from "@/lib/planning/jobs";
import { RequestError, submitPlanningJob } from "./planner/planning-job-submit";
import { createAccountRefresh } from "./planner/account-refresh";
import { usePlanDecisions } from "./planner/use-plan-decisions";
import { destinationDate, upcomingActivity } from "./planner/journey-reading";
import { Timeline } from "./planner/activity-timeline";
import { DayLoadChart } from "./planner/day-load-chart";
import { PlanningProgress } from "./planner/planning-progress";
import { PlanReviewDialog } from "./planner/plan-review-dialog";
import { PlanReviewPage } from "./planner/plan-review-page";
import styles from "./zen-dashboard.module.css";

import { RestView } from "./planner/rest-view";
import { SleepView } from "./planner/sleep-view";
import { AdjustmentRecords } from "./planner/adjust/adjustment-records";
import { AdjustmentView } from "./planner/adjust/adjustment-view";
import { WhoopSummary } from "./planner/whoop-summary";
import { BodyRecordsView } from "./planner/body-records-view";
import { PendingJourneyPlan } from "./planner/pending-journey-plan";
import journeyStyles from "./planner/journey-overview.module.css";
import { OnboardingView } from "./planner/onboarding-view";
import { ReplanWizard, type ReplanSubmission } from "./planner/replan-wizard";
import { CreateJourneyView } from "./planner/create-journey-view";
import { SERVICES, AMBIENCE, STEP_LABELS, number } from "./planner/view-values";

type View = AppView;
import { EMPTY_TRIP, usePlannerInputs, type TripForm } from "./planner/use-planner-inputs";
type TravelProfile = { homeCity: string; travelStyle: "flexible" | "structured"; foodPreferences: string; sensoryPreferences: string[]; memoryNotes: string };
type Place = JourneyGeneratedPlan["plan"]["places"][number];
type ItineraryItem = JourneyGeneratedPlan["plan"]["itinerary"][number] & { date?: string };
type ProgressState = "running" | "ok" | "skipped" | "degraded";





const VIEW_LABELS: Record<View, string> = { today: "今天", body: "身体记录", explore: "发现", profile: "我的", create: "创建旅程", breathing: "呼吸练习", sleep: "睡眠与时区", fatigue: "调整身体节奏", replan: "重新安排旅程", "adjust-day": "调整今天", itinerary: "行程", collections: "待安排与旅行清单", "plan-preview": "新方案预览" };
const STATUS_LABELS = { draft: "草稿", planned: "待出发", active: "旅途中", completed: "已完成" };
function timezoneFor(city: string) { return PLACES.find((place) => place.city === city)?.timezone ?? ""; }



function dateLabel(value?: string | null, withTime = false) { if (!value) return "尚未同步"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "时间未知" : new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium", ...(withTime ? { timeStyle: "short" as const } : {}) }).format(date); }
function publicUrl(value: string) { try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : ""; } catch { return ""; } }

function writeJourneyId(id: string | null) {
  try { if (id) window.localStorage.setItem("biotrip:last-journey:v1", id); else window.localStorage.removeItem("biotrip:last-journey:v1"); } catch { /* Storage is optional in private browsing. */ }
  window.history.replaceState(window.history.state, "", appJourneyUrl(window.location.search, window.location.hash, id));
}
function redirectForExpiredSession() {
  // A full document navigation drops the expired account's in-memory health and journey state.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search + window.location.hash)}`);
}
async function jsonRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...options });
  const payload = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (response.status === 401) { redirectForExpiredSession(); throw new RequestError("登录已过期，请重新登录。", 401); }
  if (!response.ok || !payload) throw new RequestError(payload?.error || "暂时无法完成操作，请稍后重试。", response.ok ? 502 : response.status);
  return payload;
}


export function PlannerDashboard() { return <MotionProvider><Dashboard /></MotionProvider>; }

function Dashboard() {
  const { form, setForm, scheduleOpen, setScheduleOpen, intention, setIntention, fatigue, setFatigue, stress, setStress, bodyFeedback, setBodyFeedback, moodFeedback, setMoodFeedback, ambient, setAmbient, colorTone, setColorTone, profileMemory, setProfileMemory, includeMemory, setIncludeMemory, includeWhoop, setIncludeWhoop, consent, setConsent } = usePlannerInputs();
  const [authReady, setAuthReady] = useState(false);
  const [initError, setInitError] = useState("");
  const [accountName, setAccountName] = useState("");
  const [step, setStep] = useState(0);
  const [agentOpenRequest,setAgentOpenRequest] = useState<{id:number;prompt?:string}>();
  const [profileSectionRequest,setProfileSectionRequest] = useState(0);
  const [profileSection, setProfileSection] = useState<"home" | "memory" | "devices">("home");
  const [collectionsRevision,setCollectionsRevision] = useState(0);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [memoryAllowed, setMemoryAllowed] = useState(false);
  const [serviceReady, setServiceReady] = useState<boolean | null>(null);
  const [whoopConfigured, setWhoopConfigured] = useState(false);
  const [whoopDisplay, setWhoopDisplay] = useState<WhoopDisplay>(EMPTY_WHOOP_DISPLAY);
  const whoopConnected = whoopDisplay.connected;
  const health = whoopDisplay.summary;
  const healthError = whoopDisplay.message;
  const healthLoading = ["checking", "syncing"].includes(whoopDisplay.status);
  const healthStatus = whoopStatusLabel(whoopDisplay.status);
  const {journeys,setJourneys,selectedId,setSelectedId,latestJourneyRef,draftSessionRef,journey,replaceJourney}=useJourneyState(writeJourneyId);
  const bodyCheckIn = useBodyCheckIn(journey,jsonRequest);
  const dailyFatigue = bodyCheckIn.fatigue;
  const setDailyFatigue = (value:string) => { void bodyCheckIn.save(value); };
  const askAssistant = (prompt?:string) => setAgentOpenRequest({id:Date.now(),prompt});


  const scheduleItems = useMemo(() => parseSchedule(form.itineraryText) ?? [], [form.itineraryText]);
  const reservationRange = useMemo(() => {
    try {
      const { arrivalDate, endDate } = resolveTripTiming({ trip: form });
      return { start: arrivalDate, end: endDate };
    } catch {
      return { start: form.departureDate, end: form.returnDate || form.departureDate };
    }
  }, [form]);
  const scheduleValidation = useMemo(() => reservationTextError(form.itineraryText, reservationRange.start, reservationRange.end), [form.itineraryText, reservationRange]);








  const [learnedDefaults, setLearnedDefaults] = useState<{ established?: boolean; paceLevel?: "gentle" | "balanced" | "active"; planningStyle?: "flexible" | "structured"; intention?: string; colorTone?: string; ambientPreferences?: string[]; requestedServices?: string[]; foodPreferences?: string; destinations?: string[]; homeCities?: string[] } | null>(null);
  const [memories, setMemories] = useState<MemoryItem[]>([]);



  const [progressOpen, setProgressOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [planningReady, setPlanningReady] = useState<"saved" | "review" | null>(null);
  const [progressStage, setProgressStage] = useState("preparing");
  const [progressMessage, setProgressMessage] = useState("");
  const [progressStates, setProgressStates] = useState<Record<string, ProgressState>>({});
  const [waitingItems, setWaitingItems] = useState<PlanRecommendation[]>([]);
  const [waitingDestination, setWaitingDestination] = useState("");
  const [waitingPlace, setWaitingPlace] = useState<PlanRecommendation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const clearNavigationError = useCallback(() => setError(""), []);
  const { view, profileVisited, navigateNow, resetScroll } = useAppNavigation(clearNavigationError);
  const [toast, setToast] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cityPicker, setCityPicker] = useState<"origin" | "destination" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Journey | null>(null);
  const [activity, setActivity] = useState<ItineraryItem | null>(null);
  const [dayDetail, setDayDetail] = useState("");
  const [metricDetail, setMetricDetail] = useState<"recovery" | "steps" | "strain" | null>(null);
  const [planEditor, setPlanEditor] = useState<{ initialDate?: string; initialIndex?: number } | null>(null);
  const [place, setPlace] = useState<Place | null>(null);
  const [dayPositions, setDayPositions] = useState<Record<string, number>>({});
  const [selectedDay, setSelectedDay] = useState("");
  const [consentOpen, setConsentOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [sharesRevision, setSharesRevision] = useState(0);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackNote, setFeedbackNote] = useState("");
  const [feedbackFatigue, setFeedbackFatigue] = useState("");
  const [feedbackStress, setFeedbackStress] = useState("");
  const [remember, setRemember] = useState(false);
  const [memoryNote, setMemoryNote] = useState("");
  const [activeJob, setActiveJob] = useState<PlanningJob | null>(null);
  const [, setPreviousPlan] = useState<JourneyGeneratedPlan | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const generation = useRef<AbortController | null>(null);
  const healthRequest = useRef<AbortController | null>(null);
  const dashboardAlive = useRef(true);
  const navigationPending = useRef(false);
  const plan = journey?.plan ?? null;
  // Lifecycle capabilities are derived once so every surface agrees on what is
  // possible right now, instead of re-deriving rules from status and planCurrent.
  const planner = { machine: journeyMachine(journey) };
  const memoryText = (memoryAllowed ? memories : []).filter(entry=>entry.enabled && (entry.scope === "global" || entry.journeyId === journey?.id)).map(entry=>entry.note).join("\n").slice(0,5000);
  const readyToPlan = serviceReady === true;

  const fillDraft = useCallback((draft: JourneyDraft) => {
    setScheduleOpen(false);
    setForm({ ...EMPTY_TRIP, ...draft.trip }); setIntention(draft.intention ?? "安静恢复"); setFatigue(draft.fatigue ? String(draft.fatigue) : ""); setStress(draft.subjectiveStress ? String(draft.subjectiveStress) : ""); setAmbient((draft.ambientPreferences ?? []).filter((entry) => AMBIENCE.includes(entry))); setColorTone(draft.colorTone ?? "未指定"); setBodyFeedback(draft.bodyFeedback ?? ""); setMoodFeedback(draft.moodFeedback ?? ""); setConsent(false);
  }, [setAmbient, setBodyFeedback, setColorTone, setConsent, setFatigue, setForm, setIntention, setMoodFeedback, setScheduleOpen, setStress]);
  const restoreJourneyDraft = useCallback((value: Journey) => {
    const capabilities = journeyMachine(value).can;
    if (!capabilities.canEdit && capabilities.canReplan) {
      const pending = readPendingReservations({ journeyId: value.id, version: value.version, baseItineraryText: value.draft.trip?.itineraryText ?? "" });
      if (pending !== null) { fillDraft({ ...value.draft, trip: { ...value.draft.trip, itineraryText: pending } }); return; }
    } else clearPendingReservations(value.id);
    fillDraft(value.draft);
  }, [fillDraft]);
  const { candidate, setCandidate, versions, setVersions, decideCandidate, showVersions, restoreVersion } = usePlanDecisions({
    alive: dashboardAlive, latestJourney:latestJourneyRef, session: draftSessionRef, lockRef: navigationPending, blocked: busy || loading,
    request: jsonRequest, replaceJourney, fillDraft, setBusy, setError, setToast, setPreviousPlan,
  });
  const receiveSavedJourney = useCallback((value: Journey) => {
    const previous = latestJourneyRef.current;
    if (previous?.id === value.id && previous.version >= value.version) return;
    draftSessionRef.current += 1;
    replaceJourney(value); fillDraft(value.draft); clearPendingReservations(value.id);
  }, [replaceJourney, fillDraft, latestJourneyRef, draftSessionRef]);
  const reloadBody = bodyCheckIn.reload;
  const receiveBodyJourney = useCallback((value: Journey) => { receiveSavedJourney(value); reloadBody(); }, [receiveSavedJourney, reloadBody]);
  const syncHealth = useCallback(async (checkConnection = false) => {
    if (healthRequest.current) return;
    const controller = new AbortController(); healthRequest.current = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]);
    setWhoopDisplay((current) => ({ ...current, status: "syncing", message: "" }));
    try {
      if (checkConnection) {
        const status = await jsonRequest<{ configured: boolean; connected: boolean }>("/api/whoop/status", { signal });
        if (!dashboardAlive.current || healthRequest.current !== controller) return;
        setWhoopConfigured(status.configured);
        setWhoopDisplay((current) => ({ ...current, connected: status.connected }));
      }
      const response = await fetch("/api/whoop/summary", { cache: "no-store", signal });
      if (response.status === 401) { redirectForExpiredSession(); return; }
      const payload = await readWhoopResponse(response);
      if (!dashboardAlive.current || healthRequest.current !== controller) return;
      setWhoopDisplay((current) => applyWhoopResponse(current, payload, response.ok));
      if (payload.connected === false || payload.reauthorizationRequired) setIncludeWhoop(false);
    } catch {
      if (dashboardAlive.current && healthRequest.current === controller && !controller.signal.aborted) setWhoopDisplay((current) => whoopReadFailed(current, signal.aborted ? "WHOOP 本次读取超时，请稍后重试。" : "WHOOP 暂时无法读取，请检查网络后重试。"));
    } finally { if (healthRequest.current === controller) healthRequest.current = null; }
  }, [setIncludeWhoop]);

  useEffect(() => {
    dashboardAlive.current = true;
    let alive = true;
    const query = new URLSearchParams(window.location.search);
    const initialView = readAppView(window.location.search, window.location.hash);
    void (async () => {
      const response = await fetch("/api/auth/me", { cache: "no-store" });
      if (!response.ok) throw new Error("账户服务暂时不可用，请重试。");
      const auth = await response.json() as { signedIn: boolean; account?: { display_name?: string; email: string } };
      if (!alive) return;
      navigateNow(initialView); setNow(Date.now());
      if (!auth.signedIn) { window.location.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search + window.location.hash)}`); return; }
      setAccountName(auth.account?.display_name || auth.account?.email.split("@")[0] || "旅行者");
      const responses = await Promise.allSettled([
        jsonRequest<{ ready: boolean }>("/api/plan/status"),
        jsonRequest<{ configured: boolean; connected: boolean }>("/api/whoop/status"),
        jsonRequest<{ profile: TravelProfile | null }>("/api/profile"),
        jsonRequest<{ journeys: Journey[] }>("/api/journeys"),
        jsonRequest<{ memories: MemoryItem[]; useMemory: boolean }>("/api/memory"),
        jsonRequest<{ defaults: NonNullable<typeof learnedDefaults> }>("/api/preferences"),
        jsonRequest<{needed:boolean}>("/api/onboarding"),
      ]);
      if (!alive) return;
      const [status, wearable, profile, trips, memory, learned, onboarding] = responses;
      if (onboarding.status === "fulfilled" && onboarding.value.needed) setOnboardingOpen(true);
      setServiceReady(status.status === "fulfilled" && status.value.ready);
      if (wearable.status === "fulfilled") {
        setWhoopConfigured(Boolean(wearable.value.configured)); setIncludeWhoop(Boolean(wearable.value.connected));
        setWhoopDisplay((current) => ({ ...current, connected: Boolean(wearable.value.connected), status: wearable.value.connected ? "connected" : "not_connected" }));
        if (wearable.value.connected && initialView !== "profile") void syncHealth();
      } else setWhoopDisplay((current) => whoopReadFailed(current, "WHOOP 授权状态暂时无法读取，请重试。"));
      let defaultDraft: JourneyDraft = {};
      if (profile.status === "fulfilled" && profile.value.profile) {
        const value = profile.value.profile; setProfileMemory(value.memoryNotes);
        defaultDraft = { trip: { originCity: value.homeCity, departureTimezone: timezoneFor(value.homeCity) || "Asia/Shanghai", planningStyle: value.travelStyle, foodPreferences: value.foodPreferences }, ambientPreferences: value.sensoryPreferences.filter((entry) => AMBIENCE.includes(entry)) };
      }
      if (memory.status === "fulfilled") { setMemories(memory.value.memories); setMemoryAllowed(memory.value.useMemory); setIncludeMemory(memory.value.useMemory); }
      if (learned.status === "fulfilled") {
        const defaults=learned.value.defaults;setLearnedDefaults(defaults);
        const home=defaults.homeCities?.find(city=>Boolean(timezoneFor(city)));
        defaultDraft={...defaultDraft,trip:{...defaultDraft.trip,...(defaults.paceLevel?{paceLevel:defaults.paceLevel}:{}),...(home?{originCity:home,departureTimezone:timezoneFor(home)}:{}),...(defaults.foodPreferences?{foodPreferences:defaults.foodPreferences}:{}),...(defaults.planningStyle?{planningStyle:defaults.planningStyle}:{})}};
      }
      if (trips.status === "fulfilled") {
        setJourneys(trips.value.journeys);
        const explicitId = query.get("journey");
        let rememberedId: string | null = null;
        try { rememberedId = window.localStorage.getItem("biotrip:last-journey:v1"); } catch { /* Optional preference. */ }
        const picked = explicitId ? trips.value.journeys.find((entry) => entry.id === explicitId)
          : initialView === "create" ? undefined
          : trips.value.journeys.find((entry) => entry.id === rememberedId) ?? trips.value.journeys.find((entry) => entry.status === "active") ?? trips.value.journeys.find((entry) => entry.status === "planned") ?? trips.value.journeys[0];
        if (picked) { replaceJourney(picked); restoreJourneyDraft(picked); setStep(picked.plan ? 3 : 0); }
        else { fillDraft(defaultDraft); writeJourneyId(null); if (explicitId) setError("这段旅程已删除或无法访问。可以选择其他旅程，或创建新的旅行计划。"); }
      } else { fillDraft(defaultDraft); setError("暂时无法读取旅程，请刷新重试。你可以先填写新的旅行计划。"); }
      setAuthReady(true);
      const outcome = query.get("whoop");
      if (outcome === "connected") setToast("WHOOP 授权已保存，正在单独核对身体记录。每次规划仍由你选择是否使用。");
      if ((outcome === "denied" || outcome === "failed") && !(wearable.status === "fulfilled" && wearable.value.connected)) setWhoopDisplay((current) => ({ ...current, message: "WHOOP 授权未完成，可重新连接，也可使用自评规划。" }));
    })().catch((caught) => { if (alive) { setInitError(caught instanceof Error ? caught.message : "暂时无法打开 BioTrip。"); setAuthReady(true); } });
    return () => { alive = false; dashboardAlive.current = false; generation.current?.abort(); healthRequest.current?.abort(); healthRequest.current = null; };
  }, [fillDraft, restoreJourneyDraft, replaceJourney, syncHealth, navigateNow, setIncludeWhoop, setIncludeMemory, setProfileMemory, setJourneys]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 5000); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(timer); }, []);
  const itineraryStart = journey?.draft.trip?.departureDate;
  const itineraryDays = useMemo(() => {
    const grouped = new Map<string, ItineraryItem[]>();
    for (const item of plan?.plan.itinerary ?? []) { const row = item as ItineraryItem; const key = row.date || itineraryStart || "行程"; grouped.set(key, [...(grouped.get(key) ?? []), row]); }
    return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [plan, itineraryStart]);
  const actualDay = itineraryDays.some(([day]) => day === selectedDay) ? selectedDay : itineraryDays.find(([day]) => journey?.status === "active" && now && day === destinationDate(now, journey?.draft.trip?.destinationTimezone || "Asia/Shanghai"))?.[0] ?? itineraryDays[0]?.[0] ?? "";
  const dayItems = itineraryDays.find(([day]) => day === actualDay)?.[1] ?? [];
  useEffect(() => {
    if (view !== "itinerary") return;
    const rail = document.querySelector<HTMLElement>('[aria-label="选择行程日期"]');
    const selected = rail ? Array.from(rail.querySelectorAll<HTMLElement>('[data-day]')).find(button => button.dataset.day === actualDay) : null;
    if (!rail || !selected) return;
    const offset = selected.getBoundingClientRect().left - rail.getBoundingClientRect().left;
    rail.scrollTo({ left: rail.scrollLeft + offset - (rail.clientWidth - selected.clientWidth) / 2, behavior: "instant" });
  }, [actualDay, view]);

  const places = useMemo(() => {
    const all: Place[] = [...(plan?.plan.places ?? []), ...(plan?.localServices ?? []).map((entry) => ({ sourceKind: entry.sourceKind ?? "reference" as const, name: entry.name, category: SERVICES.find(([key]) => key === entry.kind)?.[1] || entry.kind, reason: entry.detail, source: entry.source, url: entry.sourceUrl }))];
    return all.filter((entry, index) => publicUrl(entry.url) && all.findIndex((other) => other.url === entry.url || other.name === entry.name) === index);
  }, [plan]);
  const activitySource = activity?.sourceUrl ? places.find(entry => entry.url === activity.sourceUrl) : null;

  function update<K extends keyof TripForm>(key: K, value: TripForm[K]) {
    if (key === "itineraryText" && typeof value === "string" && journey && !planner.machine.can.canEdit && planner.machine.can.canReplan) {
      const baseItineraryText = journey.draft.trip?.itineraryText ?? "";
      if (value === baseItineraryText) clearPendingReservations(journey.id);
      else savePendingReservations({ journeyId: journey.id, version: journey.version, baseItineraryText }, value);
    }
    setForm((current) => ({ ...current, [key]: value })); setConsent(false);
  }
  /** Server day, so the date strip cannot disagree with the trip maths. */
  // `now` is set during bootstrap and the wizard only renders once authReady, so
// the strip never sees the empty fallback. Reading the clock during render
// would be an impure call the compiler rightly rejects.
const today = useMemo(
  () => (now === null ? "" : new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date(now))),
  [now],
);
  const planningFatigue = journey?.plan ? dailyFatigue : fatigue;
  const draftFor = useCallback((approved = false): JourneyDraft => ({ intention, colorTone, fatigue: planningFatigue ? Number(planningFatigue) : null, subjectiveStress: stress ? Number(stress) : null, ambientPreferences: ambient, bodyFeedback: bodyFeedback.trim(), moodFeedback: moodFeedback.trim(), profileMemoryNotes: includeMemory ? memoryText : "", consent: approved, trip: form }), [intention, colorTone, planningFatigue, stress, ambient, bodyFeedback, moodFeedback, includeMemory, memoryText, form]);
  function validateTrip() {
    if (![form.originCity, form.destinationCity, form.departureDate, form.departureTimezone, form.destinationTimezone].some((value) => value.trim()) || !form.originCity.trim() || !form.destinationCity.trim() || !form.departureDate.trim() || !form.departureTimezone.trim() || !form.destinationTimezone.trim()) {
      return "请选择出发地、目的地和出发日期，时区会自动带上。";
    }
    try { new Intl.DateTimeFormat("zh-CN", { timeZone: form.departureTimezone }).format(); new Intl.DateTimeFormat("zh-CN", { timeZone: form.destinationTimezone }).format(); } catch { return "请选择有效的出发地和目的地时区。"; }
    const dateError = validateTravelRange(form.departureDate, form.returnDate, today, journey?.status === "active") || planningDateError(form.departureDate, form.returnDate);
    if (dateError) return dateError;
    if (form.originCity.trim() === form.destinationCity.trim()) return "出发地和目的地相同；请填写不同的城市。";
    return "";
  }
  const { queueDraftSave, flushDraft } = useDraftPersistence({
    latestJourney:latestJourneyRef, draftSession:draftSessionRef, alive: dashboardAlive, draftFor,
    destinationCity: form.destinationCity, originCity: form.originCity, view,
    replaceJourney, setJourneys, request: jsonRequest,
  });
  const isDashboardAlive = useCallback(() => dashboardAlive.current, []);
  const accountRefresh = useMemo(() => createAccountRefresh({
    read: async () => {
      const [profile, memory, learned] = await Promise.all([
        jsonRequest<{ profile: TravelProfile | null; account: { display_name: string; email: string } }>("/api/profile"),
        jsonRequest<{ memories: MemoryItem[]; useMemory: boolean }>("/api/memory"),
        jsonRequest<{ defaults: NonNullable<typeof learnedDefaults> }>("/api/preferences"),
      ]);
      return { profile, memory, learned };
    },
    apply: ({ profile, memory, learned }) => {
      setProfileMemory(profile.profile?.memoryNotes ?? ""); setMemories(memory.memories); setLearnedDefaults(learned.defaults);
      setMemoryAllowed(memory.useMemory); if (!memory.useMemory) setIncludeMemory(false);
      setAccountName(profile.account.display_name || profile.account.email.split("@")[0] || "旅行者");
    },
  }), [setProfileMemory, setIncludeMemory]);
  const notifyAccountChanged = useCallback(() => {
    accountRefresh.changed(); setConsent(false);
    window.dispatchEvent(new Event("biotrip:memory-changed"));
  }, [accountRefresh, setConsent]);
  const receiveWhoopDisplay = useCallback((update: SetStateAction<WhoopDisplay>) => {
    if (typeof update !== "function" && !update.connected) {
      // A disconnect must cancel an older home read before clearing the shared state.
      healthRequest.current?.abort(); healthRequest.current = null;
      setIncludeWhoop(false);
    }
    setWhoopDisplay(update);
  }, [setIncludeWhoop]);
  const refreshSavedAccount = useCallback(async () => {
    const refreshed = await accountRefresh.refresh(isDashboardAlive);
    return refreshed?.learned.defaults ?? null;
  }, [accountRefresh, isDashboardAlive]);
  const navigate = useCallback(async (next: View, intent: NavigationIntent = "open") => {
    if (navigationPending.current || busy) return;
    setError("");
    await dismissSheetsBeforeNavigation();
    if (!dashboardAlive.current) return;
    setProgressOpen(false); navigateNow(next, intent);
    if (!generation.current) void flushDraft().catch((caught) => { if(dashboardAlive.current) setError(caught instanceof Error ? caught.message : "草稿保存失败，请重试。"); });
    void refreshSavedAccount().catch(() => undefined);
  }, [busy, flushDraft, navigateNow, refreshSavedAccount]);
  const navigateBack = useCallback(() => navigate("today", "back"), [navigate]);
  /** Save the current journey before changing which draft owns the form. */
  const newJourney = useCallback(async () => {
    if (generation.current || navigationPending.current || busy) return;
    navigationPending.current = true; setBusy(true); setError("");
    try {
      await dismissSheetsBeforeNavigation();
      await flushDraft(); const savedDefaults = await refreshSavedAccount(); if (!dashboardAlive.current) return;
      const defaults = savedDefaults ?? learnedDefaults;
      draftSessionRef.current += 1; latestJourneyRef.current = null; setSelectedId(null); writeJourneyId(null);
      const home = defaults?.homeCities?.find(city => Boolean(timezoneFor(city)));
      setForm((current) => ({ ...EMPTY_TRIP, originCity: home ?? current.originCity, departureTimezone: home ? timezoneFor(home) : current.departureTimezone, paceLevel: defaults?.paceLevel ?? EMPTY_TRIP.paceLevel, foodPreferences: defaults?.foodPreferences ?? current.foodPreferences, planningStyle: defaults?.planningStyle ?? current.planningStyle, ...(defaults?.requestedServices?.length ? { requestedServices: defaults.requestedServices } : {}) }));
      setFatigue(""); setStress(""); setBodyFeedback(""); setMoodFeedback(""); setIntention(defaults?.intention ?? "安静恢复"); setAmbient(defaults?.ambientPreferences ?? []); setColorTone(defaults?.colorTone ?? "未指定");
      setConsent(false); setStep(0); setPlanningReady(null); setWaitingPlace(null); setCandidate(null); setVersions(null); setPreviousPlan(null); setSelectedDay(""); setPickerOpen(false); navigateNow("create", "open");
    } catch (caught) { if (dashboardAlive.current) setError(caught instanceof Error ? caught.message : "草稿保存失败，请重试后再新建旅程。"); }
    finally { navigationPending.current = false; if (dashboardAlive.current) setBusy(false); }
  }, [setSelectedDay, setCandidate, setVersions, busy, flushDraft, learnedDefaults, draftSessionRef, latestJourneyRef, setSelectedId, navigateNow, refreshSavedAccount, setAmbient, setBodyFeedback, setColorTone, setConsent, setFatigue, setForm, setIntention, setMoodFeedback, setStress]);
  const selectJourney = useCallback(async (id: string) => {
    if (navigationPending.current || busy) return;
    navigationPending.current = true; setBusy(true); setError("");
    try {
      await dismissSheetsBeforeNavigation();
      if (!generation.current) await flushDraft(); if (!dashboardAlive.current) return;
      const value = journeys.find((entry) => entry.id === id);
      if (!value) throw new Error("这段旅程已删除，请刷新旅程列表。");
      draftSessionRef.current += 1; replaceJourney(value); restoreJourneyDraft(value); setProgressOpen(false); setWaitingPlace(null); setStep(value.plan ? 3 : 0); setSelectedDay(""); setCandidate(null); setVersions(null); setPreviousPlan(null); setPickerOpen(false); navigateNow(value.plan ? "itinerary" : "create");
    } catch (caught) { if (dashboardAlive.current) setError(caught instanceof Error ? caught.message : "草稿保存失败，请重试后再切换旅程。"); }
    finally { navigationPending.current = false; if (dashboardAlive.current) setBusy(false); }
  }, [setSelectedDay, setCandidate, setVersions, busy, flushDraft, journeys, draftSessionRef, replaceJourney, restoreJourneyDraft, navigateNow]);
  const openProfile = useCallback(() => { setProfileSection("home"); setProfileSectionRequest(value => value + 1); return navigate("profile"); }, [navigate]);
  const refreshJourneys = useCallback(async () => {
    const session = draftSessionRef.current;
    await flushDraft();
    const payload = await jsonRequest<{ journeys: Journey[] }>("/api/journeys");
    if (dashboardAlive.current && session === draftSessionRef.current) {
      setJourneys((current) => payload.journeys.map((entry) => {
        const newer = current.find((saved) => saved.id === entry.id && saved.version > entry.version);
        return newer ?? entry;
      }));
    }
  }, [flushDraft, draftSessionRef, setJourneys]);
  async function saveDraft(quiet = false): Promise<Journey | null> {
    if (generation.current || navigationPending.current || busy) return null;
    if (journey && ["active", "completed"].includes(journey.status)) { setError("旅途中请从行程页重新安排；已完成的旅程可作为下次旅行参考。"); return null; }
    navigationPending.current = true; setBusy(true); setError("");
    try { const value = await queueDraftSave(); if (value && !quiet) setToast(journeyMachine(value).can.canEdit ? "草稿已保存到你的账户，下次打开可以继续。" : "当前行程已保存。调整内容会在重新生成成功后保存。"); return value; }
    catch (caught) { setError(caught instanceof Error ? caught.message : "草稿保存失败。"); return null; }
    finally { navigationPending.current = false; setBusy(false); }
  }
  const autoSaveDraft = useEffectEvent(async () => { try { await queueDraftSave(); } catch { /* Manual save shows errors; unchanged drafts do not loop. */ } });
  /**
   * Silent persistence: the draft is written shortly after the traveller stops
   * typing, with no busy state, toast or error, so there is never a save button
   * to remember and losing the tab loses nothing. It only fires once a journey
   * exists or a destination has been chosen, so simply opening the app never
   * spawns an empty journey.
   */
  useEffect(() => {
    if (!authReady || loading || busy || !["create", "explore", "replan"].includes(view)) return;
    if (journey && planner.machine.status && !planner.machine.can.canEdit) return;
    const hasIntent = Boolean(journey || form.destinationCity.trim() || form.originCity.trim());
    if (!hasIntent) return;
    const timer = setTimeout(() => { void autoSaveDraft(); }, 1400);
    return () => clearTimeout(timer);
    // Re-arm whenever the draft content changes.
  }, [authReady, loading, busy, view, form, intention, fatigue, stress, ambient, colorTone, bodyFeedback, moodFeedback, includeMemory, profileMemory, memories, journey, planner.machine.can.canEdit, planner.machine.status]);
  async function advance() {
    if (step === 0) { const message = validateTrip(); if (message) { setError(message); return; } }
    setError(""); const saved = await saveDraft(true); if (!saved) return; setStep((current) => Math.min(2, current + 1)); window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function checkScheduleBeforePlanning() {
    if (!scheduleValidation) return true;
    setConsentOpen(false); setScheduleOpen(true); setStep(1); navigateNow("create"); setError("请先核对预约卡片的日期和时间，再继续生成。");
    return false;
  }
  function openPlanningConsent() {
    if (!checkScheduleBeforePlanning()) return;
    const validation = validateTrip();
    if (validation) { setStep(0); navigateNow("create"); setError(validation); return; }
    setError(""); setConsent(false); setConsentOpen(true);
  }
  async function followPlanningJob(job: PlanningJob, controller: AbortController) {
    setActiveJob(job); setPlanningReady(null); setLoading(true); setError("");
    try {
      await watchPlanningJob({
        signal: controller.signal,
        read: (cursor, signal) => jsonRequest(`/api/plan/jobs/${job.id}?after=${cursor}`, { signal }),
        onReconnect: () => setProgressMessage("连接暂时中断，后台继续执行，正在恢复进度…"),
        onUpdate: async (result) => {
          if (!dashboardAlive.current) return true;
          setActiveJob(result.job);
          for (const event of result.events) {
            if (event.kind === "progress") {
              const stage = String(event.payload.stage || "preparing"), status = String(event.payload.status || "running") as ProgressState;
              setProgressStage(stage); setProgressMessage(String(event.payload.message || "正在整理旅程…"));
              setProgressStates(current=>({...current,preparing:"ok",[stage]:status}));
            } else {
              const batch=decodePlanRecommendations(event.payload, String(event.payload.destination ?? ""));
              if(batch){setWaitingDestination(batch.destination);setWaitingItems(current=>mergeRecommendations(current,batch.items));}
            }
          }
          if (result.job.state === "awaiting_approval") { setPlanningReady("review");setProgressMessage("新方案已准备好，确认后才会替换当前行程。可以继续浏览，或查看调整方案。"); return true; }
          if (result.job.state === "completed") {
            const payload=await jsonRequest<{journey:Journey}>(`/api/journeys/${job.journeyId}`, { signal: controller.signal });
            if (!dashboardAlive.current || controller.signal.aborted) return true;
            clearPendingReservations(payload.journey.id);setJourneys(current => current.some(entry => entry.id === payload.journey.id && entry.version > payload.journey.version) ? current : [payload.journey, ...current.filter(entry => entry.id !== payload.journey.id)]);setPlanningReady("saved");setProgressMessage("行程已生成并保存。可以继续浏览推荐，准备好后再查看行程。");return true;
          }
          if (["failed","indeterminate"].includes(result.job.state)) {setError(result.job.error || "规划未完成，原行程仍保留。");return true;}
          if (result.job.state === "cancelled") {setToast("后台任务已停止，原行程仍保留。");return true;}
          return false;
        },
      });
    } catch (caught) {if(dashboardAlive.current)setError(caught instanceof Error?caught.message:"暂时无法读取后台进度。");}
    finally {if(generation.current===controller){generation.current=null;if(dashboardAlive.current)setLoading(false);}}
  }
  async function openPlanningResult() {
    if (!activeJob || busy) return;
    setBusy(true);
    try {
      await dismissSheetsBeforeNavigation();
      await flushDraft();
      const payload = await jsonRequest<{ journey: Journey }>(`/api/journeys/${activeJob.journeyId}`);
      if (!dashboardAlive.current) return;
      draftSessionRef.current += 1; replaceJourney(payload.journey); restoreJourneyDraft(payload.journey);
      setWaitingPlace(null); setProgressOpen(false); setPlanningReady(null);
      if (activeJob.state === "awaiting_approval") { setCandidate(activeJob); navigateNow("plan-preview", "open"); }
      else { setActiveJob(null); navigateNow("itinerary", "tab"); }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "暂时无法打开结果，请重试。"); }
    finally { if (dashboardAlive.current) setBusy(false); }
  }
  async function recoverPlanning() {
    if (generation.current || !dashboardAlive.current) return;
    try {
      const payload=await jsonRequest<{jobs:PlanningJob[]}>("/api/plan/jobs");
      if (!dashboardAlive.current) return;
      const planJobs=payload.jobs.filter(job=>job.mode !== "adjust");
      const saved=planJobs.find(job=>["queued","running","cancel_requested"].includes(job.state)) ?? planJobs.find(job=>job.state==="awaiting_approval" && job.journeyId===latestJourneyRef.current?.id) ?? planJobs.find(job=>job.state==="completed" && job.journeyId===latestJourneyRef.current?.id && (latestJourneyRef.current?.version ?? 0)<=job.baseVersion);
      if(!saved)return;
      if(saved.state==="awaiting_approval"){setActiveJob(saved);if(view === "plan-preview"){setCandidate(saved);setPlanningReady(null);setProgressOpen(false);}else setPlanningReady("review");return;}
      const trip=await jsonRequest<{journey:Journey}>(`/api/journeys/${saved.journeyId}`);
      if(!dashboardAlive.current || generation.current)return;
      setWaitingDestination(trip.journey.draft.trip?.destinationCity || "");
      const controller=new AbortController();generation.current=controller;void followPlanningJob(saved,controller);
    } catch { /* The saved task remains recoverable from the explicit progress button. */ }
  }
  const recoverOnMount = useEffectEvent(recoverPlanning);
  useEffect(()=>{if(authReady)void recoverOnMount();},[authReady, journey?.id]);
  async function generatePlan(replan?: ReplanSubmission) {
    if (generation.current || navigationPending.current || busy) return;
    const validation=validateTrip();if(validation){setError(validation);return;}
    if (!readyToPlan) { setError("规划服务暂时无法连接，请稍后再试。"); return; }
    if (replan) { const invalid = reservationTextError(replan.itineraryText, reservationRange.start, reservationRange.end); if (invalid) { setError("请核对预约卡片的日期与时间后再继续。"); return; } }
    else if (!checkScheduleBeforePlanning() || !consent) return;
    if(candidate){setError("请先采用或放弃待确认的方案，再重新调整。");return;}
    if (activeJob?.state === "awaiting_approval") { setProgressOpen(true); setToast("请先处理已经准备好的调整方案。"); return; }
    setActiveJob(null);
    setConsentOpen(false);setError("");setProgressOpen(true);setPlanningReady(null);setLoading(true);setWaitingItems([]);setWaitingDestination(form.destinationCity);setProgressStates({preparing:"running"});setProgressMessage("正在提交后台任务…");
    const controller=new AbortController();generation.current=controller;
    const baseDraft = draftFor(true);
    const requestDraft = replan ? { ...baseDraft, trip: { ...baseDraft.trip, itineraryText: replan.itineraryText }, bodyFeedback: replan.note, moodFeedback: "" } : baseDraft;
    try {
      const target=await queueDraftSave();if(!target)throw new Error("请先保存草稿。");
      const submitted = await submitPlanningJob({ request: jsonRequest, signal: controller.signal,
        body: { ...requestDraft, ...(replan ? { reservationEdits: replan.reservationEdits } : {}), includeWhoop: whoopConnected && includeWhoop, includeMemory, journeyId: target.id, expectedVersion: target.version },
      });
      await followPlanningJob(submitted, controller);
    } catch(caught){if(dashboardAlive.current){setProgressOpen(false);setError(caught instanceof Error?caught.message:"后台任务暂未启动，草稿保留。");}}
    finally {if(generation.current===controller){generation.current=null;if(dashboardAlive.current)setLoading(false);}}
  }
  const transition = useCallback(async (status: "active" | "completed") => {
    if (!journey || generation.current || navigationPending.current || busy) return; navigationPending.current = true; setBusy(true); setError("");
    try { const payload = await jsonRequest<{ journey: Journey }>(`/api/journeys/${journey.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: journey.version, status }) }); replaceJourney(payload.journey); setToast(status === "active" ? "旅程已开始，今天的安排和体验都在这里。" : "旅程已完成，可以记录这次最喜欢的安排。" ); navigateNow("today"); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "旅程状态更新失败。"); } finally { navigationPending.current = false; setBusy(false); }
  }, [journey, busy, replaceJourney, navigateNow]);
  async function removeJourney() {
    if (!deleteTarget || generation.current || navigationPending.current || busy) return;
    const deleted = deleteTarget;
    navigationPending.current = true; setBusy(true); setError("");
    try {
      // Drain automatic saves first so no late write can restore a deleted selection.
      await flushDraft();
      if (!dashboardAlive.current) return;
      const target = latestJourneyRef.current?.id === deleted.id ? latestJourneyRef.current : deleted;
      await jsonRequest(`/api/journeys/${target.id}?version=${target.version}`, { method: "DELETE" });
      if (!dashboardAlive.current) return;
      clearPendingReservations(target.id);
      setJourneys((current) => current.filter((entry) => entry.id !== target.id));
      if (latestJourneyRef.current?.id === target.id) {
        draftSessionRef.current += 1; latestJourneyRef.current = null; setSelectedId(null); writeJourneyId(null);
        setForm(EMPTY_TRIP); setStep(0); setSelectedDay(""); setPreviousPlan(null); setCandidate(null); setVersions(null);
        setActivity(null); setPlace(null); setShareOpen(false); setConsent(false); setPlanEditor(null);
      }
      setDeleteTarget(null); setToast("旅程已删除。");
    } catch (caught) { if (dashboardAlive.current) setError(caught instanceof Error ? caught.message : "暂时无法删除旅程。"); }
    finally { navigationPending.current = false; if (dashboardAlive.current) setBusy(false); }
  }
  async function sendFeedback(note = feedbackNote, completedBreathing = false) {
    if (!journey || navigationPending.current || generation.current || busy) return;
    navigationPending.current = true; setBusy(true); setError("");
    try {
      const payload = await jsonRequest<{ journey: Journey; remembered: boolean }>(`/api/journeys/${journey.id}/feedback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: journey.version, note, ...(completedBreathing ? {} : { fatigue: feedbackFatigue ? Number(feedbackFatigue) : null, subjectiveStress: feedbackStress ? Number(feedbackStress) : null, remember, ...(remember ? { memoryNote } : {}) }) }) });
      const baseItineraryText = payload.journey.draft.trip?.itineraryText ?? "";
      if (form.itineraryText !== baseItineraryText) savePendingReservations({ journeyId: payload.journey.id, version: payload.journey.version, baseItineraryText }, form.itineraryText);
      replaceJourney(payload.journey); setFeedbackOpen(false); setFeedbackNote(""); setFeedbackFatigue(""); setFeedbackStress(""); setMemoryNote(""); setRemember(false); setToast(payload.remembered ? "体验已记录，你选定的偏好已存入旅程记忆。" : "体验已记录。" );
      if (payload.remembered) { const payload = await jsonRequest<{ memories: MemoryItem[]; useMemory: boolean }>("/api/memory"); setMemories(payload.memories); }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "暂时无法记录体验。"); } finally { navigationPending.current = false; setBusy(false); }
  }
  function startAdjustment(light = false) {
    if (journey?.status === "completed") { setToast("这段旅程已完成，可以新建下一次旅程。"); return; }
    setConsent(false);
    void navigate(light ? "adjust-day" : "replan");
  }
  function openPlanEditor(item?: ItineraryItem) {
    if (!journey?.plan || journey.status === "completed" || loading || busy) return;
    if (!journey.planCurrent) { setToast("请先为当前偏好生成行程，再手动修改活动。"); return; }
    const initialIndex = item ? journey.plan.plan.itinerary.findIndex(row => item.id ? row.id === item.id : row === item) : -1;
    if (item && initialIndex < 0) { setToast("这项活动已变化，请重新打开当前行程。"); return; }
    setActivity(null); setDayDetail(""); setError("");
    setPlanEditor({ initialDate: item?.date || actualDay, ...(initialIndex >= 0 ? { initialIndex } : {}) });
  }
  async function saveManualItinerary(operations: ItineraryOperation[]) {
    if (!journey?.plan || generation.current || navigationPending.current || busy) throw new Error("请等当前操作完成后再保存。");
    const target = journey, session = draftSessionRef.current;
    const original = target.plan!.plan.itinerary;
    const changes = applyItineraryOperations(original, operations, target.draft.trip ?? {});
    const oldBase = target.draft.trip?.itineraryText ?? "";
    const nextBase = syncItineraryReservations(oldBase, original, changes.reservationChanges, itineraryDates(original, target.draft.trip ?? {})[0]);
    // Validate the merge before sending a write. Pending edits and deletions
    // still belong to the traveller, even when a saved fixed activity changes.
    const pending = rebasePendingReservations(oldBase, nextBase, form.itineraryText, changes.reservationChanges.filter((change) => !change.after).map((change) => change.before));
    navigationPending.current = true; setBusy(true);
    try {
      const payload = await jsonRequest<{ journey: Journey }>(`/api/journeys/${target.id}/itinerary`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: target.version, operations }) });
      const baseItineraryText = payload.journey.draft.trip?.itineraryText ?? "";
      if (pending === baseItineraryText) clearPendingReservations(target.id);
      else savePendingReservations({ journeyId: target.id, version: payload.journey.version, baseItineraryText }, pending);
      if (!dashboardAlive.current || session !== draftSessionRef.current || latestJourneyRef.current?.id !== target.id) return;
      replaceJourney(payload.journey);
      setForm((current) => ({ ...current, itineraryText: pending }));
      setPreviousPlan(target.plan); setConsent(false); setPlanEditor(null); setShareOpen(false);
      setToast("活动与顺序已保存，无需重新生成行程。");
    } finally { navigationPending.current = false; if (dashboardAlive.current) setBusy(false); }
  }
  const closeConsent = useCallback(() => setConsentOpen(false), []);
  const closePicker = useCallback(() => setPickerOpen(false), []);
  const closeShare = useCallback(() => setShareOpen(false), []);
  const closeFeedback = useCallback(() => setFeedbackOpen(false), []);
  const closePlace = useCallback(() => setPlace(null), []);
  const closeActivity = useCallback(() => setActivity(null), []);
  const closeDelete = useCallback(() => setDeleteTarget(null), []);

  function renderWhoopStatus() {
    const reconnect = whoopDisplay.status === "reauthorization_required";
    return <div className={styles.inset} role="status"><Icon name="pulse" size={18} /><div><strong>WHOOP · {healthStatus}</strong><p>{healthLoading ? "授权与身体记录分别核对；有读数才会显示读取成功。" : healthError || (whoopConnected ? whoopDisplay.status === "synced" ? "最近记录已更新，每次规划仍由你决定是否使用。" : "授权已保存，尚未读取身体记录。" : "授权后可读取身体记录，也可使用自己的感受规划。")}</p>{whoopDisplay.retrievedAt ? <small className={styles.note}>最近成功读取{whoopDisplay.status === "partial" ? "（部分）" : ""}：{dateLabel(whoopDisplay.retrievedAt, true)}{whoopDisplay.retained ? "。标注为上次读数的项目沿用此前结果。" : ""}</small> : null}{health?.measuredAt ? <small className={styles.note} style={{ display: "block" }}>记录时间：{dateLabel(health.measuredAt, true)}</small> : null}<div className={styles.actions}>{whoopConnected || whoopDisplay.status === "failed" ? <button className={styles.textButton} disabled={busy || healthLoading} onClick={() => void syncHealth(!whoopConnected)}><Icon name="sync" size={14} />{healthLoading ? "读取中…" : "重试读取"}</button> : null}{!whoopConnected && whoopConfigured ? <a className={styles.textButton} href="/api/whoop/connect">{reconnect ? "重新授权 WHOOP" : "连接 WHOOP"} ↗</a> : null}</div></div></div>;
  }
  function renderConsent() {
    return <div className={styles.stack}><p>{plan ? "生成后先预览新方案，确认采用才会更新行程。" : "本次规划只使用你确认的资料，生成后保存行程。"}</p><div className={styles.summaryList}><div className={styles.summaryRow}><span>旅行</span><strong>{form.originCity} → {form.destinationCity}</strong></div><div className={styles.summaryRow}><span>日期</span><strong>{dateLabel(`${form.departureDate}T12:00:00+08:00`)}{form.returnDate ? ` 至 ${form.returnDate}` : "（未定）"}</strong></div>{scheduleItems.length ? <div className={styles.summaryRow}><span>已确定安排</span><strong>{scheduleItems.slice(0, 3).map((item) => `${item.date || "抵达首日"} ${item.time} ${item.name}（${item.fixed ? "固定" : "灵活"}）`).join("；")}{scheduleItems.length > 3 ? `；共 ${scheduleItems.length} 项` : ""}</strong></div> : null}<div className={styles.summaryRow}><span>身体感受</span><strong>{fatigue ? `疲劳 ${fatigue}/5` : "未自评"}{stress ? ` · 压力 ${stress}/5` : ""}</strong></div>{bodyFeedback.trim() ? <div className={styles.summaryRow}><span>身体反馈</span><strong style={{ whiteSpace: "pre-wrap" }}>{bodyFeedback.trim()}</strong></div> : null}{moodFeedback.trim() ? <div className={styles.summaryRow}><span>心情反馈</span><strong style={{ whiteSpace: "pre-wrap" }}>{moodFeedback.trim()}</strong></div> : null}<div className={styles.summaryRow}><span>本次偏好</span><strong>{[intention, ...ambient, form.foodPreferences].filter(Boolean).join(" · ") || "未指定"}</strong></div><div className={styles.summaryRow}><span>WHOOP 记录</span><strong>{whoopConnected && includeWhoop ? "仅临近出发或旅途中使用最近记录，远期预案不读取" : "本次不使用"}</strong></div><div className={styles.summaryRow}><span>旅程记忆</span><strong>{includeMemory && memoryText ? "使用已保存的旅行偏好" : "本次不使用"}</strong></div></div><label className={styles.checkLabel}><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>{plan ? "确认使用以上资料生成待预览方案。" : "确认以上资料用于本次 AI 规划，并保存生成的行程。"}</span></label><button className={styles.primaryButton} disabled={!consent || loading || busy || !readyToPlan} onClick={() => void generatePlan()}><Icon name="leaf" />{plan ? "生成调整后的行程" : "生成并保存行程"}</button><a className={styles.note} href="/privacy">查看数据与隐私说明 ↗</a></div>;
  }

  function chooseDay(day: string) {
    const key = `${journey?.id}:${actualDay}`;
    const scrollTop = window.scrollY;
    setDayPositions(current => ({ ...current, [key]: scrollTop }));
    setSelectedDay(day);
    requestAnimationFrame(() => window.scrollTo({ top: dayPositions[`${journey?.id}:${day}`] ?? 0, behavior: "instant" }));
  }
  function renderDayTabs() {
    const currentDay = now ? destinationDate(now, journey?.draft.trip?.destinationTimezone || "Asia/Shanghai") : null;
    return itineraryDays.length ? <div className={styles.filterRow} aria-label="选择行程日期">{currentDay && itineraryDays.some(([day]) => day === currentDay) ? <button className={styles.chip} onClick={() => chooseDay(currentDay)}>回到今天</button> : null}{itineraryDays.map(([day], index) => <button key={day} className={`${styles.chip} ${actualDay === day ? styles.active : ""}`} aria-pressed={actualDay === day} data-day={day} onClick={() => chooseDay(day)}>第 {index + 1} 天 {/^\d{4}-/.test(day) ? day.slice(5).replace("-", "/") : ""}</button>)}</div> : null; }

  async function updateActivityProgress(item:ItineraryItem,state:"in_progress"|"completed"|"skipped") {
    if (!journey || !item.id || busy) return;
    setBusy(true);setError("");
    try {const result=await jsonRequest<{journey:Journey}>(`/api/journeys/${journey.id}/activities/${item.id}/state`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({version:journey.version,state})});receiveSavedJourney(result.journey);}
    catch(e){setError(e instanceof Error?e.message:"进度保存失败，请重试。");}finally{setBusy(false);}
  }
  function renderToday() {
    const upcoming = journey?.status === "active" && now ? upcomingActivity((plan?.plan.itinerary ?? []).filter(item=>!["completed","skipped"].includes(item.progress?.state ?? "planned")),now,journey.draft.trip?.destinationTimezone || "Asia/Shanghai") : null;
    const todayItems = itineraryDays.find(([date])=>date===bodyCheckIn.localDate)?.[1] ?? [];
    const current = todayItems.find(item=>item.progress?.state === "in_progress") ?? upcoming;
    const record = bodyCheckIn.current;
    const time = record ? new Intl.DateTimeFormat("zh-CN",{timeZone:bodyCheckIn.timezone,hour:"2-digit",minute:"2-digit"}).format(new Date(record.recordedAt)) : "";

    return <TodayExperience journey={journey} accountName={accountName} items={todayItems} next={current} date={bodyCheckIn.localDate} fatigue={dailyFatigue} recordedLabel={time} saving={bodyCheckIn.saving} error={bodyCheckIn.error} busy={busy || loading || bodyCheckIn.saving} onFatigue={setDailyFatigue} bodySummary={whoopConnected ? <WhoopSummary display={whoopDisplay} onOpen={() => void navigate("body")} /> : null} pendingPlan={journey ? <PendingJourneyPlan key={journey.id} journeyId={journey.id} version={journey.version} request={jsonRequest} onOpen={openJourneyPlan} disabled={busy}/> : null} followUp={journey ? <AdjustmentRecords compact journey={journey} request={jsonRequest} onSaved={receiveBodyJourney} onMemoryChanged={notifyAccountChanged}/> : null} onAdjust={()=>void navigate("adjust-day")} onCreate={()=>void newJourney()} onJourney={()=>void navigate("itinerary", "tab")} onCollections={()=>void navigate("collections")} onSelect={setActivity} onAsk={()=>askAssistant()} onSwitch={()=>setPickerOpen(true)} onStart={()=>void transition("active")} onBody={()=>void navigate("body")} onProgress={(item,state)=>void updateActivityProgress(item,state)}/>;
  }

  function renderItinerary() {
    return <div className={`${styles.stack} ${styles.journeyHome}`}>
      <section className={journeyStyles.heading}>
        <div><small>{journey ? STATUS_LABELS[journey.status] : "从容出发"}</small><h1>{journey?.draft.trip?.destinationCity || "我的行程"}</h1><p>{journey?.draft.trip?.departureDate}{journey?.draft.trip?.returnDate ? ` — ${journey.draft.trip.returnDate}` : ""}</p></div>
        <button type="button" disabled={busy} onClick={() => setPickerOpen(true)}>切换旅程 <Icon name="arrow" size={15} /></button>
      </section>
      {plan ? <>
        <div className={styles.journeyToolbar}><button className={styles.textButton} disabled={busy} onClick={() => void navigate("collections")}><Icon name="plus" size={16} />待安排与清单</button><div>{planner.machine.can.canReplan ? <button className={styles.textButton} disabled={busy} onClick={() => openPlanEditor()}><Icon name="edit" size={16} />编辑</button> : null}<button className={styles.textButton} disabled={busy} onClick={() => setShareOpen(true)}><Icon name="share" size={16} />分享</button></div></div>
        {renderDayTabs()}
        {journey ? <PendingJourneyPlan key={journey.id} journeyId={journey.id} version={journey.version} request={jsonRequest} onOpen={openJourneyPlan} disabled={busy} /> : null}

        {journey?.status !== "completed" ? <div className={journeyStyles.actions}><button type="button" disabled={busy || loading || bodyCheckIn.saving} onClick={() => void navigate("adjust-day")}><Icon name="leaf" size={16} />调整今天</button><button type="button" disabled={busy || loading} onClick={() => startAdjustment()}><Icon name="tune" size={16} />重新安排旅程</button></div> : null}
        <section className={styles.journeySchedule}><div className={styles.sectionHead}><h3>{journey?.status === "completed" ? "旅程回顾" : "当天安排"}</h3><button className={styles.textButton} onClick={() => setDayDetail(actualDay)}>{dayItems.length} 项 · 查看全天 <Icon name="arrow" size={14} /></button></div><Timeline items={dayItems} onSelect={setActivity} visuals={plan.visuals} /></section>

        <DayLoadChart title="这一天的安排" items={dayItems} />
        {!journey?.planCurrent ? <div className={styles.inset}><Icon name="tune" /><p>偏好已更新，当前保留上次保存的行程。可通过“重新安排旅程”更新。</p></div> : null}
        {journey ? <AdjustmentRecords key={journey.id} journey={journey} request={jsonRequest} onSaved={receiveBodyJourney} onMemoryChanged={notifyAccountChanged}/> : null}
        <details className={styles.journeyNotes}><summary>更多 · 旅程说明、版本与来源</summary><div className={styles.stack}><div className={styles.actions}><button className={styles.textButton} onClick={() => void showVersions()}>版本历史</button><button className={styles.textButton} onClick={() => void recoverPlanning()}>查看后台任务</button></div>{journey ? <JourneyVisualButton key={journey.id} journey={journey} onSaved={replaceJourney} /> : null}<h3>{plan.plan.headline}</h3><p>{plan.plan.summary}</p><p>{plan.plan.reason}</p>{plan.manualAdjustment ? <small>已手动调整 · {dateLabel(plan.manualAdjustment.updatedAt, true)}</small> : null}<ProvenanceBlock provenance={plan.provenance} /></div></details>
        {journey?.status === "planned" ? <button className={styles.primaryButton} disabled={busy} onClick={() => void transition("active")}>开始这段旅程 <Icon name="arrow" /></button> : null}
        {journey?.status === "active" ? <div className={styles.actions}><button className={styles.textButton} onClick={() => setFeedbackOpen(true)}><Icon name="edit" size={16} />记录感受</button><button className={styles.textButton} disabled={busy} onClick={() => void transition("completed")}>完成旅程 <Icon name="check" size={16} /></button></div> : null}
      </> : <><section className={styles.card}><h2>把想去的地方，变成自己的行程。</h2><p>点选目的地和日期，留好预约，再安排探索与休息。</p><button className={styles.primaryButton} onClick={() => void newJourney()}><Icon name="plus" />创建我的旅程</button></section>{journeys.length ? <section className={styles.card}><div className={styles.sectionHead}><h3>继续你的旅程</h3><button className={styles.textButton} onClick={() => setPickerOpen(true)}>全部旅程 ↗</button></div><div className={styles.journeyList}>{journeys.slice(0, 3).map((entry) => <div className={styles.journeyRow} key={entry.id}><JourneyCover compact images={entry.plan?.visuals?.cover} fallback={coverForDestination().thumbnail} alt={entry.title} /><button disabled={busy} onClick={() => void selectJourney(entry.id)}><strong>{entry.title}</strong><small>{STATUS_LABELS[entry.status]} · {dateLabel(entry.updatedAt)}</small></button><Icon name="arrow" size={16} /></div>)}</div></section> : null}</>}
    </div>;
  }

  function renderWizard() { return <CreateJourneyView preferencesReady={Boolean(learnedDefaults?.established)} step={step} plan={plan} loading={loading} setStep={setStep} setError={setError} setCityPicker={setCityPicker} form={form} setForm={setForm} setConsent={setConsent} today={today} intention={intention} setIntention={setIntention} fatigue={fatigue} setFatigue={setFatigue} busy={busy} update={update} reservationRange={reservationRange} scheduleOpen={scheduleOpen} setScheduleOpen={setScheduleOpen} stress={stress} bodyFeedback={bodyFeedback} ambient={ambient} setAmbient={setAmbient} setStress={setStress} setBodyFeedback={setBodyFeedback} healthStatus={healthStatus} whoopConnected={whoopConnected} health={health} healthLoading={healthLoading} healthError={healthError} includeWhoop={includeWhoop} setIncludeWhoop={setIncludeWhoop} whoopConfigured={whoopConfigured} memoryText={memoryText} includeMemory={includeMemory} setIncludeMemory={setIncludeMemory} serviceReady={serviceReady} journey={journey} setDayDetail={setDayDetail} setActivity={setActivity} openPlanEditor={openPlanEditor} setShareOpen={setShareOpen} planner={planner} transition={transition} navigate={navigate} renderConsent={renderConsent} />; }

  function renderReplan() { return journey?.plan ? <ReplanWizard whoopSummary={<WhoopSummary display={whoopDisplay} />} memoryAllowed={memoryAllowed} key={`${journey.id}:${journey.version}`} itinerary={journey.plan.plan.itinerary} form={form} fatigue={dailyFatigue} setFatigue={value=>setDailyFatigue(typeof value === "function" ? value(dailyFatigue) : value)} checkInError={bodyCheckIn.error} bodyFeedback={bodyFeedback} moodFeedback={moodFeedback} includeWhoop={includeWhoop} setIncludeWhoop={setIncludeWhoop} includeMemory={includeMemory} setIncludeMemory={setIncludeMemory} busy={busy || loading || bodyCheckIn.saving || journey.status === "completed"} whoopConnected={whoopConnected} reservationRange={reservationRange} update={update} onGenerate={value=>void generatePlan(value)} onExit={() => void navigateBack()} /> : <div className={styles.empty}><h2>先选择一段已有行程</h2><button className={styles.primaryButton} onClick={() => void navigate("itinerary", "tab")}>查看我的行程</button></div>; }
  function openTaskStatus() { if (activeJob?.state === "awaiting_approval") { void openPlanningResult(); return; } setProgressOpen(true); if (view === "profile") navigateNow("explore", "tab"); }
  async function openPendingCandidate() { if (activeJob) await openPlanningResult(); else await recoverPlanning(); }
  function renderPlanPreview() { return journey && candidate?.journeyId === journey.id ? <PlanReviewPage key={candidate.id} current={journey} candidate={candidate} busy={busy} error={error} onDecision={async action=>{if(await decideCandidate(action)){setActiveJob(null);setPlanningReady(null);navigateNow("itinerary", "tab");}}} onClose={()=>void navigateBack()}/> : <div className={styles.empty}><h2>查看准备好的新方案</h2><p>你的原行程仍然保留。</p><button className={styles.primaryButton} onClick={openPendingCandidate}>查看待确认方案</button><button className={styles.textButton} onClick={()=>navigateNow("itinerary", "tab")}>返回旅程</button></div>; }
  function renderDayAdjustment() { return journey?.plan ? <AdjustmentView whoopSummary={<WhoopSummary display={whoopDisplay} />} memoryAllowed={memoryAllowed} key={`${journey.id}:${bodyCheckIn.localDate}`} journey={journey} request={jsonRequest} onSaved={receiveBodyJourney} onBreathing={() => void navigate("breathing")} onVersions={() => void showVersions()} whoopConnected={whoopConnected} initialFatigue={dailyFatigue} onFatigueChange={setDailyFatigue} onMemoryChanged={notifyAccountChanged} /> : renderReplan(); }
  function openJourneyPlan(job: PlanningJob) {
    if (job.journeyId !== journey?.id || busy) return;
    if (job.mode === "adjust") { void navigate("adjust-day"); return; }
    setCandidate(job); setActiveJob(job); setPlanningReady(null);
    void navigate("plan-preview");
  }
  function renderBodyRecords() {
    const points = bodyCheckIn.history.filter(item=>item.fatigue != null).slice(0,14).reverse().map(item=>({label:new Intl.DateTimeFormat("zh-CN",{timeZone:bodyCheckIn.timezone,month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"}).format(new Date(item.recordedAt)),fatigue:item.fatigue!}));
    return <BodyRecordsView display={whoopDisplay} status={renderWhoopStatus()} onMetric={metric => { if (metric === "sleep") void navigate("sleep"); else setMetricDetail(metric); }} onDevices={() => { setProfileSection("devices"); setProfileSectionRequest(value => value + 1); void navigate("profile"); }} onBreathing={() => void navigate("breathing")} checkIn={journey ? { fatigue: dailyFatigue, saving: bodyCheckIn.saving, error: bodyCheckIn.error, onChange: setDailyFatigue, points, journeyName: journey.title } : undefined} />;
  }

  async function saveDiscoveredPlace(place:Place){
    if(!journey)throw new Error("请先选择一段旅程。");
    await jsonRequest(`/api/journeys/${journey.id}/collections`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({expectedVersion:journey.version,operation:"add",kind:"backlog",requestId:crypto.randomUUID(),items:[{title:place.name,sourceUrl:place.url}]})});setCollectionsRevision(value=>value+1);
  }
  function renderExplore() {return <DiscoveryExperience places={places} key={journey?.id || "empty"} journey={journey} onAsk={askAssistant} onSelect={setPlace} onSave={saveDiscoveredPlace} onCreate={()=>void newJourney()} busy={busy}/>;}
  function renderSleep() { return <SleepView journey={journey} plan={plan} health={health} whoopDisplay={whoopDisplay} renderWhoopStatus={renderWhoopStatus} whoopConnected={whoopConnected} busy={busy} healthLoading={healthLoading} syncHealth={syncHealth} whoopConfigured={whoopConfigured} setActivity={setActivity} setBodyFeedback={setBodyFeedback} startAdjustment={startAdjustment} />; }
  function renderFatigue() { return <RestView health={health} startAdjustment={startAdjustment} navigate={navigate} navigateBack={navigateBack} />; }

  if (!authReady) return <main className={styles.app}><div className={styles.loading}><div className={styles.spinner} /><strong>正在打开你的 BioTrip…</strong></div></main>;
  if (initError) return <main className={styles.app}><div className={styles.loading}><h2>暂时无法打开账户</h2><p role="alert">{initError}</p><button className={styles.primaryButton} onClick={() => window.location.reload()}>重新加载</button></div></main>;
  if (authReady && onboardingOpen) return <OnboardingView onDone={async () => {
    notifyAccountChanged();
    const defaults = await refreshSavedAccount();
    const home=defaults?.homeCities?.find(city=>Boolean(timezoneFor(city)));
    if (!journey && defaults) setForm(current=>({...current, paceLevel:defaults.paceLevel ?? current.paceLevel, originCity:home ?? current.originCity, departureTimezone:home ? timezoneFor(home) : current.departureTimezone, foodPreferences:defaults.foodPreferences ?? current.foodPreferences}));
    setOnboardingOpen(false);
  }}/>;
  const detailView = ["breathing", "sleep", "fatigue", "replan", "adjust-day", "body", "collections", "plan-preview"].includes(view);
  const headerDestination = journey?.draft.trip?.destinationCity;
  return <><AgentDock openRequest={agentOpenRequest} onBodyChanged={bodyCheckIn.reload} onCollectionsChanged={()=>setCollectionsRevision(v=>v+1)} onOpenMemory={()=>{setProfileSection("memory");setProfileSectionRequest(v=>v+1);void navigate("profile");}} hideLauncher journeys={journeys} journeyId={selectedId} request={jsonRequest} onSaved={receiveSavedJourney} beforeAction={flushDraft} onMemoryChanged={notifyAccountChanged} disabled={busy || loading} /><div hidden={view === "profile"}><main className={`${styles.app} ${detailView ? styles.detailApp : ""}`}>
    {view !== "plan-preview" && <header className={styles.header}><div className={styles.headerInner}>{view === "create" ? <><button className={styles.iconButton} aria-label={step > 0 ? "上一步" : "返回上一层"} disabled={loading || busy} onClick={() => { if (step > 0) { setStep(step - 1); resetScroll(); } else void navigateBack(); }}><Icon name="back" /></button><div className={styles.wizardHead}><Badge tone="muted">● 第 {Math.min(step, 2) + 1} 步 · {STEP_LABELS[step]}</Badge></div><div className={styles.headerActions}><button type="button" className={styles.avatar} aria-label="我的档案" disabled={busy} onClick={() => void openProfile()}><Icon name="person" size={17} /></button>{step > 0 && <button className={styles.iconButton} disabled={loading || busy} aria-label="关闭旅程创建" onClick={() => void navigateBack()}><Icon name="close" /></button>}</div></> : <><div className={styles.headerTitle}><div>{detailView ? <button className={styles.iconButton} aria-label="返回上一层" disabled={busy} onClick={() => void navigateBack()}><Icon name="back" /></button> : <Icon name="pin" size={15} />}<button style={{ border: 0, background: "transparent", padding: 0, textAlign: "left" }} disabled={busy} onClick={() => setPickerOpen(true)} aria-label="选择或管理旅程"><strong>{detailView ? VIEW_LABELS[view] : headerDestination ? `${headerDestination} · ${journey ? STATUS_LABELS[journey.status] : "我的旅程"}` : "BioTrip"}</strong></button></div><small>{detailView ? "跟随自己的节奏" : VIEW_LABELS[view]}</small></div><div className={styles.headerActions}><button type="button" className={styles.iconButton} aria-label="打开旅程助手" disabled={busy || loading} onClick={()=>askAssistant()}><MessageCircle size={22}/></button><button type="button" className={styles.avatar} aria-label="我的档案" disabled={busy} onClick={() => void openProfile()}><Icon name="person" size={17} /></button></div></>}</div></header>}
    <div className={`${styles.content} ${view === "create" ? styles.wizardContent : ""} ${detailView ? styles.detailContent : ""}`}>
      {error && view !== "plan-preview" ? <div className={styles.error} role="alert" style={{ margin: "16px 0" }}><span>{error}</span><button className={styles.iconButton} aria-label="关闭错误提示" onClick={() => setError("")}><Icon name="close" size={16} /></button></div> : null}

      {progressOpen && !activeJob && loading ? <section className={styles.loading}><div className={styles.spinner} /><h2>正在提交后台任务</h2><p role="status">草稿与本次资料确认后，会显示进度和当地推荐。</p></section> : null}
      {activeJob ? <div hidden={!progressOpen}><PlanningProgress ready={planningReady} onReady={() => void openPlanningResult()} progressMessage={progressMessage} progressStage={progressStage} progressStates={progressStates} activeJob={activeJob} waitingItems={waitingItems} waitingDestination={waitingDestination} onSelectPlace={setWaitingPlace} onPause={() => { setProgressOpen(false); navigateNow("explore", "tab"); }} onCancel={async () => { if (!activeJob) return; try { await jsonRequest(`/api/plan/jobs/${activeJob.id}`,{method:"DELETE"}); generation.current?.abort(); setLoading(false); setActiveJob(null); setProgressOpen(false); setPlanningReady(null); setToast("已停止后台任务。"); } catch(caught){setError(caught instanceof Error?caught.message:"正在确认停止状态。");} }} /></div> : null}
      <div hidden={progressOpen}>{view === "today" ? renderToday() : view === "itinerary" ? renderItinerary() : view === "collections" && journey ? <JourneyCollectionsView journey={journey} request={jsonRequest} onAsk={askAssistant} revision={collectionsRevision} onChanged={()=>setCollectionsRevision(v=>v+1)}/> : view === "create" ? renderWizard() : view === "body" ? renderBodyRecords() : view === "replan" ? renderReplan() : view === "plan-preview" ? renderPlanPreview() : view === "adjust-day" ? renderDayAdjustment() : view === "explore" ? renderExplore() : view === "sleep" ? renderSleep() : view === "fatigue" ? renderFatigue() : view === "profile" ? null : <BreathingOverlay open={view === "breathing"}>
          <BreathingSession restingHeartRate={health?.restingHeartRate} onComplete={async (completed) => { await navigateBack(); if (completed && journey && ["active", "completed"].includes(journey.status)) void sendFeedback("完成了一次 3 分钟舒缓呼吸练习。", true); else setToast(completed ? "3 分钟练习已完成，回到自己的节奏。" : "练习已结束，随时可以再开始。"); }} />
        </BreathingOverlay>}</div>
    </div>
    {!loading && !planningReady && view === "create" && step < 2 ? <footer className={styles.wizardFooter}><div><button className={styles.textButton} disabled={busy} onClick={() => void saveDraft()}>{busy ? "保存中…" : "保存草稿"}</button>{step < 2 ? <button className={styles.primaryButton} disabled={busy} onClick={() => void advance()}>继续 <Icon name="arrow" size={19} /></button> : <button className={styles.primaryButton} disabled={busy} onClick={openPlanningConsent}>确认并生成 <Icon name="arrow" size={17} /></button>}</div></footer> : !detailView && !progressOpen ? <AppDock view={view} disabled={busy} onNavigate={(next) => { void navigate(next, "tab"); }} /> : null}
    <PlacePickerDialog citiesOnly={cityPicker === "origin"} open={cityPicker !== null} onClose={() => setCityPicker(null)} title={cityPicker === "origin" ? "选择出发地" : "选择目的地"} current={PLACES.find((entry) => entry.city === (cityPicker === "origin" ? form.originCity : form.destinationCity))} exclude={cityPicker === "origin" ? form.destinationCity : form.originCity} suggestions={[form.originCity, ...journeys.map((entry) => cityPicker === "origin" ? entry.draft.trip?.originCity ?? "" : entry.draft.trip?.destinationCity ?? "")].filter(Boolean)} onSelect={(entry) => { setForm((current) => cityPicker === "origin" ? { ...current, originCity: entry.city, departureTimezone: entry.timezone } : { ...current, destinationCity: entry.city, destinationTimezone: entry.timezone }); setConsent(false); }} />
    {toast ? <div className={styles.toast} role="status">{toast}</div> : null}

    {versions && journey ? <PlanReviewDialog current={journey} versions={versions} busy={busy} error={error} onRestore={restoreVersion} onClose={() => setVersions(null)} /> : null}
    {pickerOpen ? <Modal title="我的旅程" onClose={closePicker}><button className={styles.primaryButton} disabled={loading || busy} onClick={() => void newJourney()}><Icon name="plus" />创建新旅程</button><div className={styles.journeyList}>{journeys.length ? journeys.map((entry) => <div className={styles.journeyRow} key={entry.id}><JourneyCover compact images={entry.plan?.visuals?.cover} fallback={coverForDestination().thumbnail} alt={entry.title} /><button disabled={busy} onClick={() => void selectJourney(entry.id)}><strong>{entry.title}</strong><small>{STATUS_LABELS[entry.status]} · {dateLabel(entry.updatedAt)}</small></button><button className={styles.iconButton} aria-label={`删除${entry.title}`} disabled={loading || busy} onClick={() => { setPickerOpen(false); setDeleteTarget(entry); }}><Icon name="trash" size={16} /></button></div>) : <p className={styles.note}>还没有保存的旅程。创建后可在这里继续。</p>}</div><button className={styles.textButton} disabled={busy} onClick={async () => { setBusy(true); try { const payload = await jsonRequest<{ journeys: Journey[] }>("/api/journeys"); setJourneys(payload.journeys); setToast("旅程列表已刷新。"); } catch (caught) { setError(caught instanceof Error ? caught.message : "刷新失败。"); } finally { setBusy(false); } }}><Icon name="sync" size={15} />刷新旅程列表</button></Modal> : null}
    {deleteTarget ? <Modal hideCloseButton title="删除这段旅程？" onClose={closeDelete} busy={busy}><p>“{deleteTarget.title}”的行程和关联体验记录将被删除。这个操作无法撤销。</p><button className={styles.primaryButton} style={{ background: "#b90538" }} disabled={busy} onClick={() => void removeJourney()}>{busy ? "正在删除…" : "确认删除旅程"}</button><button className={styles.secondaryButton} disabled={busy} onClick={closeDelete}>保留旅程</button></Modal> : null}
    {consentOpen ? <Modal title="确认这次规划" onClose={closeConsent}>{renderConsent()}</Modal> : null}
    {metricDetail ? <Modal title={metricDetail === "strain" ? "WHOOP 运动负荷" : metricDetail === "recovery" ? "恢复指数详情" : "步数记录详情"} onClose={() => setMetricDetail(null)}><div className={styles.stack}><h2>{metricDetail === "strain" ? number(health?.cycleStrain, 1) : metricDetail === "recovery" ? `${number(health?.recoveryScore)} / 100` : health?.cycleSteps?.toLocaleString("zh-CN") ?? "—"}</h2><p>{metricDetail === "strain" ? whoopMetricLabel(whoopDisplay, health?.cycleStrain, "cycleStrain") : metricDetail === "recovery" ? whoopMetricLabel(whoopDisplay, health?.recoveryScore, "recoveryScore") : whoopMetricLabel(whoopDisplay, health?.cycleSteps, "cycleSteps")}</p><p>{metricDetail === "strain" ? "来自 WHOOP 最近周期的运动负荷（Strain），反映身体消耗。你此刻的疲劳感可以在身体记录页单独自评；缺失记录显示为空。" : metricDetail === "recovery" ? "来自 WHOOP 最近一次恢复记录，不表示此刻或未来旅行时的状态。" : "来自 WHOOP 最近周期的步数记录；未收到测量值时显示为空，不把缺失数据当作零。"}</p>{whoopDisplay.retrievedAt ? <small>最近读取：{dateLabel(whoopDisplay.retrievedAt, true)}</small> : null}{health?.measuredAt ? <small>记录时间：{dateLabel(health.measuredAt, true)}</small> : null}{renderWhoopStatus()}</div></Modal> : null}
    {waitingPlace ? <Modal title="当地推荐详情" onClose={() => setWaitingPlace(null)} footer={<a className={styles.primaryButton} href={waitingPlace.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">打开原始来源 ↗</a>}><div className={styles.stack}><EditorialImage imageUrl={waitingPlace.imageUrl} product={waitingPlace.source === "飞猪实时搜索"} subject={waitingPlace.category + " " + waitingPlace.name} /><Badge tone="mint">{waitingPlace.category}</Badge><h3>{waitingPlace.name}</h3><p>{waitingPlace.reason}</p><small>来源：{waitingPlace.source}</small>{planningReady ? <div className={styles.inset} role="status"><Icon name="check" /><div><strong>{planningReady === "saved" ? "行程已生成并保存" : "调整方案已准备好"}</strong><p>你可以继续看完这里，再打开安排。</p><button className={styles.textButton} onClick={openPlanningResult}>{planningReady === "saved" ? "查看行程" : "查看调整方案"} <Icon name="arrow" /></button></div></div> : null}<p className={styles.note}>{loading ? "行程仍在后台编排，浏览这里不会中断生成。" : "这条资料来自本次检索。"}价格、余位及开放时间以原始页面为准。</p></div></Modal> : null}
    {shareOpen && journey ? <ShareDialog key={`${journey.id}:${journey.version}`} journey={journey} onClose={closeShare} onCreated={() => setSharesRevision((current) => current + 1)} /> : null}
    {feedbackOpen && journey ? <Modal title="记录这次旅行感受" onClose={closeFeedback} busy={busy} footer={<button type="button" className={styles.primaryButton} disabled={busy || (!feedbackNote.trim() && !feedbackFatigue && !feedbackStress) || (remember && !memoryNote.trim())} onClick={() => void sendFeedback()}>{busy ? "正在保存…" : "保存旅行感受"}</button>}><div className={styles.stack}><PhraseInput label="这次的感受" value={feedbackNote} onChange={setFeedbackNote} phrases={["午休后舒服一些", "步行有点多", "很喜欢今天的安排"]} placeholder="写下想记录的体验" maxLength={1000} rows={3} disabled={busy} /><div className={styles.ratingColumns}><QuickRating label="本次疲劳自评" value={feedbackFatigue} onChange={setFeedbackFatigue} disabled={busy} /><QuickRating label="本次压力自评" value={feedbackStress} onChange={setFeedbackStress} disabled={busy} /></div><label className={styles.checkLabel}><ToggleSwitch label="记住本次旅行偏好" checked={remember} disabled={busy} onChange={setRemember} /><span>为下次旅程记住一项偏好</span></label>{remember ? <PhraseInput label="想保留的偏好" value={memoryNote} onChange={setMemoryNote} phrases={["抵达当天留出休息", "减少连续步行"]} maxLength={1000} rows={2} disabled={busy} /> : null}{error ? <p role="alert" className={styles.error}>{error}</p> : null}</div></Modal> : null}
    {dayDetail && plan ? <Modal title={`${dayDetail} · 完整安排`} onClose={() => setDayDetail("")} footer={journey?.status !== "completed" ? <button type="button" className={styles.primaryButton} disabled={busy || !journey?.planCurrent} onClick={() => { setSelectedDay(dayDetail); setPlanEditor({ initialDate: dayDetail }); setDayDetail(""); }}><Icon name="edit" />编辑这一天与活动顺序</button> : undefined}><Timeline items={itineraryDays.find(([date]) => date === dayDetail)?.[1] ?? []} onSelect={(item) => { setDayDetail(""); setActivity(item); }} /></Modal> : null}
    {planEditor && journey ? <ItineraryEditor key={journey.id} journey={journey} onSave={saveManualItinerary} onClose={() => setPlanEditor(null)} initialDate={planEditor.initialDate} initialIndex={planEditor.initialIndex} busy={busy || loading} /> : null}
    {activity ? <Modal title={activity.name} onClose={closeActivity} footer={journey?.status !== "completed" ? <button type="button" className={styles.primaryButton} disabled={busy || loading} onClick={() => openPlanEditor(activity)}><Icon name="edit" />修改这项活动</button> : undefined}><div className={styles.stack}>{activitySource?.source === "飞猪实时搜索" ? <EditorialImage imageUrl={activitySource.imageUrl} product subject={activitySource.name} /> : null}<Badge tone={activity.fixed ? "green" : "muted"}><Icon name={activity.fixed ? "lock" : "clock"} size={14} />{activity.date ? `${activity.date} · ` : ""}{activity.time} · {activity.fixed ? "固定安排" : "可调整活动"}</Badge><p>{activity.detail}</p>{activitySource ? <button className={styles.textButton} onClick={() => { setActivity(null); setPlace(activitySource); }}>查看已关联来源 · {activitySource.source} <Icon name="arrow" /></button> : null}{activity.fixed ? <div className={styles.inset}><Icon name="lock" /><p>固定安排不会在排序时自动移动。手动修改时不会更改供应商的预约或订单。</p></div> : null}<button className={styles.secondaryButton} onClick={() => { setActivity(null); navigate("explore"); }}>查看当地体验与来源 <Icon name="arrow" /></button>{journey?.status !== "completed" ? <button className={styles.textButton} onClick={() => { setActivity(null); startAdjustment(); }}>让 AI 重新调整旅程节奏</button> : null}</div></Modal> : null}
    {place ? (
          <PlaceDetail
            key={place.url}
            place={place}
            tripStart={reservationRange.start}
            tripEnd={form.returnDate ? reservationRange.end : ""}
            initialDate={selectedDay}
            whoopConnected={whoopConnected}
            onClose={closePlace}
            busy={busy}
            onAddToDay={async (slot) => {
              if (!slot || journey?.status === "completed") return false;
              if (journey?.plan) {
                await saveManualItinerary([{ type: "add", date: slot.date, time: slot.time, name: slot.placeName,
                  detail: `${place.reason}\n来源：${place.source}`, sourceUrl: place.url, fixed: false }]);
                setPlace(null); setSelectedDay(slot.date); navigateNow("today");
                setToast("活动已保存到行程，无需重新生成。"); return true;
              }
              // The intent joins the traveller's own itinerary text, which the
              // planner reads as a real item on the next generation.
              const name = slot.placeName.replace(/[|｜\r\n]/g, " ").trim().slice(0, 120);
              const line = slot.date + " " + slot.time + " | " + name + " | 灵活";
              const next = form.itineraryText ? form.itineraryText + "\n" + line : line;
              if (!name || next.length > 6000 || scheduleError(next)) return false;
              update("itineraryText", next);
              setPlace(null);
              setToast("已添加「" + slot.placeName + " · " + slot.date + " " + slot.time + "」到待安排活动，重新规划后纳入行程。");
              return true;
            }}
          />
      ) : null}
  </main></div>
    {activeJob && !progressOpen && view !== "plan-preview" ? <button className={styles.taskBar} disabled={busy} onClick={openTaskStatus}><span role="status">{waitingDestination || "旅程"} · {planningReady === "saved" ? "已生成并保存" : planningReady === "review" || activeJob.state === "awaiting_approval" ? "调整方案待确认" : ["failed", "indeterminate"].includes(activeJob.state) ? "生成未完成" : activeJob.state === "cancelled" ? "已停止" : "正在整理"}</span><span>{activeJob.state === "awaiting_approval" ? "查看新方案 ↗" : "查看进度与推荐 ↗"}</span></button> : null}
    {profileVisited ? <div hidden={view !== "profile"} inert={busy}>
      {error ? <div className={styles.error} role="alert"><span>{error}</span><button type="button" className={styles.iconButton} aria-label="关闭错误提示" onClick={() => setError("")}><Icon name="close" size={16} /></button></div> : null}
      <ProfileView initialSection={profileSection} sectionRequestKey={profileSectionRequest} onNavigate={(next, intent) => { void (next === "create" ? newJourney() : navigate(next, intent)); }} navigationBusy={busy} whoopDisplay={whoopDisplay} onWhoopDisplayChange={receiveWhoopDisplay} onAccountChanged={notifyAccountChanged} onRefreshJourneys={refreshJourneys} onSyncWhoop={syncHealth} journeys={journeys} selectedJourneyId={selectedId} sharesRevision={sharesRevision} />
    </div> : null}
  </>;
}
