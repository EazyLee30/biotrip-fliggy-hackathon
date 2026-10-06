"use client";
import { useEffect } from "react";
import type * as React from "react";
import type { SetStateAction } from "react";
import type { PlannerInputs, TripForm } from "./use-planner-inputs";
import type { Journey, JourneyGeneratedPlan } from "@/lib/journey-types";
import type { AppView, NavigationIntent } from "./app-navigation";
type ItineraryItem = JourneyGeneratedPlan["plan"]["itinerary"][number];
import styles from "../zen-dashboard.module.css";
import { Badge, Icon } from "../zen-ui";
import { STEP_LABELS, INTENTS, AMBIENCE, toggle, number, sleepDuration, SERVICES } from "./view-values";
import { PLACES } from "@/lib/places";
import { DateRangePicker } from "./travel-date-picker";
import { MAX_TRIP_DAYS } from "@/lib/planner-input";
import { PaceMatrix } from "./blocks/pace-matrix";
import { ReservationEditor } from "./reservation-editor";
import { QuickRating, PhraseInput } from "./quick-inputs";
import { GuardrailToggles } from "./blocks/guardrails";
import { DayReview } from "./blocks/day-review";

type Props = Pick<PlannerInputs, "form" | "setForm" | "setConsent" | "intention" | "setIntention" | "fatigue" | "setFatigue" | "scheduleOpen" | "setScheduleOpen" | "stress" | "bodyFeedback" | "ambient" | "setAmbient" | "setStress" | "setBodyFeedback" | "includeWhoop" | "setIncludeWhoop" | "includeMemory" | "setIncludeMemory"> & {
  step: number;
  plan: JourneyGeneratedPlan | null;
  loading: boolean;
  setStep: React.Dispatch<SetStateAction<number>>;
  setError: React.Dispatch<SetStateAction<string>>;
  setCityPicker: React.Dispatch<SetStateAction<"origin" | "destination" | null>>;
  today: string;
  busy: boolean;
  update: <K extends keyof TripForm>(key: K, value: TripForm[K]) => void;
  reservationRange: { start: string; end: string; };
  healthStatus: string;
  whoopConnected: boolean;
  health: import("@/lib/whoop-display").WhoopSummary | null;
  healthLoading: boolean;
  healthError: string;
  whoopConfigured: boolean;
  memoryText: string;
  serviceReady: boolean | null;
  journey: Journey | null;
  setDayDetail: React.Dispatch<SetStateAction<string>>;
  setActivity: React.Dispatch<SetStateAction<ItineraryItem | null>>;
  openPlanEditor: (item?: ItineraryItem) => void;
  setShareOpen: React.Dispatch<SetStateAction<boolean>>;
  planner: { machine: import("@/app/components/planner/machine").JourneyMachine; };
  transition: (status: "active" | "completed") => Promise<void>;
  navigate: (next: AppView, intent?: NavigationIntent) => Promise<void>;
  renderConsent: () => React.JSX.Element;
};
export function CreateJourneyView({ step, plan, loading, setStep, setError, setCityPicker, form, setForm, setConsent, today, intention, setIntention, fatigue, setFatigue, busy, update, reservationRange, scheduleOpen, setScheduleOpen, stress, bodyFeedback, ambient, setAmbient, setStress, setBodyFeedback, healthStatus, whoopConnected, health, healthLoading, healthError, includeWhoop, setIncludeWhoop, whoopConfigured, memoryText, includeMemory, setIncludeMemory, serviceReady, journey, setDayDetail, setActivity, openPlanEditor, setShareOpen, planner, transition, navigate, renderConsent }: Props) {
    useEffect(() => {
      if (!PLACES.some(place => place.city === form.destinationCity)) return;
      const controller = new AbortController();
      const timer = setTimeout(() => {
        void fetch(`/api/destinations/visuals?city=${encodeURIComponent(form.destinationCity)}`, { signal: controller.signal }).catch(() => undefined);
      }, 800);
      return () => { clearTimeout(timer); controller.abort(); };
    }, [form.destinationCity]);
    return <div className={`${styles.stack} ${styles.wizardStack}`}>
      <div className={styles.wizardProgress}><Badge tone={step === 2 ? "mint" : "muted"}>● 第 {Math.min(step, 2) + 1} / 3 步 · {STEP_LABELS[step]}</Badge>{[0, 1, 2].map((index) => <button key={index} className={index <= step ? styles.active : ""} aria-label={`前往第 ${index + 1} 步，${STEP_LABELS[index]}`} disabled={index > step || (index === 3 && !plan) || loading} onClick={() => { setStep(index); setError(""); }} />)}</div>
      {step === 0 ? <>
        <div className={`${styles.pageIntro} ${styles.compactIntro}`}><h1>去哪里，待多久？</h1><p>点选城市和日期，一次确认整段旅程。仅用目的地城市预取景点实景。</p></div>
        <div className={styles.bookingGrid}>
          <section className={`${styles.card} ${styles.routeCard}`}>
            <div className={styles.sectionHead}><span><Icon name="compass" size={18} /><strong>城市与日期</strong></span><Badge tone="mint">自由选择</Badge></div>
            <div className={styles.routeRow}>
              <button type="button" className={styles.citySummary} onClick={() => setCityPicker("origin")} aria-haspopup="dialog" aria-label={`选择出发地，当前${form.originCity || "未选择"}`}><small>出发地</small><strong>{form.originCity || "选择城市"}</strong><span>{PLACES.find((entry) => entry.city === form.originCity)?.country || "从哪里出发"}</span></button>
              <button type="button" className={styles.swapButton} disabled={!form.originCity && !form.destinationCity} aria-label="互换出发地和目的地" onClick={() => { setForm((current) => ({ ...current, originCity: current.destinationCity, destinationCity: current.originCity, departureTimezone: current.destinationTimezone, destinationTimezone: current.departureTimezone })); setConsent(false); }}><Icon name="sync" size={19} /></button>
              <button type="button" className={styles.citySummary} onClick={() => setCityPicker("destination")} aria-haspopup="dialog" aria-label={`选择目的地，当前${form.destinationCity || "未选择"}`}><small>目的地</small><strong>{form.destinationCity || "选择城市"}</strong><span>{PLACES.find((entry) => entry.city === form.destinationCity)?.country || "想去哪里"}</span></button>
            </div>
            <div className={styles.divider} />
            <DateRangePicker start={form.departureDate} end={form.returnDate} today={today} onChange={(next) => { setForm((current) => ({ ...current, departureDate: next.start, returnDate: next.end })); setConsent(false); }} />
            <p className={styles.note}>行程按目的地当地日期安排，单次最多规划 {MAX_TRIP_DAYS} 天。</p>
          </section>
          <aside className={`${styles.card} ${styles.routeOverview}`}><div className={styles.sectionHead}><span><Icon name="leaf" size={18} /><strong>这次的旅行方向</strong></span></div><h3>{INTENTS.find((item) => item.value === intention)?.name || "跟随自己的节奏"}</h3><p>{INTENTS.find((item) => item.value === intention)?.detail}</p><div className={styles.inset}><Icon name="shield" size={16} /><p>先确认地点和日期，下一步再设置活动密度、固定安排和当地体验。</p></div><button className={styles.textButton} onClick={() => setStep(0)}>修改旅行意图 <Icon name="edit" size={14} /></button></aside>
        </div>
      </> : null}      {step === 1 ? <>
        <div className={`${styles.pageIntro} ${styles.compactIntro}`}><h1>这趟旅程，想怎样度过？</h1><p>选一个最贴近此刻的方向，途中也可以调整。</p></div>
        <div className={styles.compactIntentGrid}>{INTENTS.map((item) => <button key={item.value} className={`${styles.intentCard} ${styles.compactIntent} ${intention === item.value ? styles.selected : ""}`} aria-pressed={intention === item.value} onClick={() => { setIntention(item.value); setConsent(false); }}><div className={styles.intentHeader}><Icon name={item.icon} size={19} /><span className={styles.radio}>{intention === item.value ? <Icon name="check" size={13} /> : null}</span></div><strong>{item.name}</strong><small>{item.subtitle}</small></button>)}</div>
        <div className={styles.selectedIntent}><Icon name="leaf" size={16} /><p>{INTENTS.find((item) => item.value === intention)?.detail}</p></div>
        <section className={`${styles.card} ${styles.compactCard}`}><div className={styles.sectionHead}><span><Icon name="pulse" size={17} /><strong>现在的感受</strong></span><small>可选 · 主观自评</small></div><div className={styles.feelingOptions}>{[["1", "轻松有活力"], ["3", "想稍微放慢"], ["5", "需要好好休息"]].map(([value, name]) => <button key={value} className={fatigue === value ? styles.selected : ""} aria-pressed={fatigue === value} onClick={() => { setFatigue(fatigue === value ? "" : value); setConsent(false); }}>{name}</button>)}</div></section>
      </> : null}
{step === 1 ? <>

        <div className={`${styles.pageIntro} ${styles.compactIntro}`}><h1>按你的节奏安排。</h1><p>选择活动密度，其他偏好可以按需补充。</p></div>
        <div className={styles.wideGrid}>
          <div className={styles.stack}>
            <PaceMatrix value={form.paceLevel} disabled={loading || busy} onChange={(level) => { update("paceLevel", level); setConsent(false); }} />
            <section className={styles.card}>
              <div className={styles.sectionHead}><span><Icon name="tune" /><strong>安排方式</strong></span><Badge tone="muted">时间块密度</Badge></div>
              <div className={styles.segmented}><button className={form.planningStyle === "structured" ? styles.active : ""} onClick={() => { update("planningStyle", "structured"); setConsent(false); }}>有序清晰</button><button className={form.planningStyle === "flexible" ? styles.active : ""} onClick={() => { update("planningStyle", "flexible"); setConsent(false); }}>留白探索</button></div>
              <p className={styles.note}>{form.planningStyle === "structured" ? "时间安排更明确，预约与交通衔接清楚。" : "安排更宽松，留出探索和休息的空间。"}</p>
              <ReservationEditor value={form.itineraryText} tripStart={reservationRange.start} tripEnd={form.returnDate ? reservationRange.end : ""} disabled={loading || busy} onChange={(next) => { update("itineraryText", next); setError(""); }} />
              <details className={styles.advancedDetails} open={scheduleOpen} onToggle={(event) => setScheduleOpen(event.currentTarget.open)}><summary><span>身体感受与环境</span><small>{fatigue || stress || bodyFeedback || ambient.length ? "已填写偏好" : "选填"}</small></summary><div>

              <div className={styles.sectionHead}><strong>舒服的空间</strong><small>可多选</small></div>
              <div className={styles.chipRow}>{AMBIENCE.map((item) => <button className={`${styles.chip} ${ambient.includes(item) ? styles.active : ""}`} key={item} aria-pressed={ambient.includes(item)} onClick={() => setAmbient(toggle(ambient, item))}>{item}</button>)}</div>
              <div className={styles.ratingColumns}><QuickRating label="疲劳自评" value={fatigue} onChange={(next) => { setFatigue(next); setConsent(false); }} lowLabel="很轻" highLabel="明显" disabled={loading || busy} /><QuickRating label="压力自评" value={stress} onChange={(next) => { setStress(next); setConsent(false); }} lowLabel="很低" highLabel="很高" disabled={loading || busy} /></div><PhraseInput label="身体感受或活动偏好" value={bodyFeedback} onChange={(next) => { setBodyFeedback(next); setConsent(false); }} phrases={["减少步行", "下午坐下来休息", "晚上早点回住宿"]} maxLength={80} rows={2} placeholder="补充你的感受或想参加的活动" disabled={loading || busy} /></div></details>
            </section>
          </div>
          <div className={styles.stack}>
            <section className={`${styles.card} ${styles.preferencesCard}`}><details className={styles.advancedDetails}><summary><span>旅途守护</span><small>已开启 {Object.values(form.guardrails).filter(Boolean).length} 项</small></summary><div><GuardrailToggles value={form.guardrails} disabled={loading || busy} onChange={(next) => { update("guardrails", next); setConsent(false); }} /></div></details>
              <details className={styles.advancedDetails}><summary><span>身体记录与旅行记忆</span><small>{healthStatus}</small></summary><div>
              <div className={styles.inset}><Icon name="pulse" /><div><strong>WHOOP</strong><p>{whoopConnected ? health ? `最近记录：恢复 ${number(health.recoveryScore)}% · 睡眠 ${sleepDuration(health.sleepMinutes)}` : healthLoading ? "授权已保存，正在读取记录。" : healthError || "近期暂无可用记录。" : "连接后可结合近期恢复、睡眠与活动记录。"}</p></div></div>
              {whoopConnected ? <label className={styles.checkLabel}><input type="checkbox" checked={includeWhoop} onChange={(event) => { setIncludeWhoop(event.target.checked); setConsent(false); }} /><span>本次规划使用 WHOOP 近期记录</span></label> : whoopConfigured ? <a className={styles.secondaryButton} href="/api/whoop/connect">连接 WHOOP ↗</a> : <p className={styles.note}>目前可使用主观自评与旅行偏好继续规划。</p>}
              <p className={styles.note}>未来旅程的身体状态仍会变化，抵达后可以重新规划。</p>
              {memoryText ? <label className={styles.checkLabel}><input type="checkbox" checked={includeMemory} onChange={(event) => { setIncludeMemory(event.target.checked); setConsent(false); }} /><span>使用我的旅行偏好与旅程记忆</span></label> : null}</div></details>
            <details className={styles.advancedDetails}><summary><span>当地体验与饮食</span><small>已选 {form.requestedServices.length} 项</small></summary><div>
              <div className={styles.serviceGrid}>{SERVICES.map(([value, label]) => <label className={styles.serviceOption} key={value}><input type="checkbox" checked={form.requestedServices.includes(value)} onChange={() => update("requestedServices", toggle(form.requestedServices, value))} />{label}</label>)}</div>
              <PhraseInput label="饮食喜好或限制" value={form.foodPreferences} onChange={(next) => update("foodPreferences", next)} phrases={["少辣", "清淡", "素食", "不吃海鲜"]} maxLength={500} rows={2} placeholder="补充口味、忌口或过敏信息" disabled={loading || busy} /></div></details>
            </section>
          </div>
        </div>
        <p className={styles.note}>下一步会展示本次使用的资料，由你确认后再生成并保存行程。</p>
        {serviceReady === false ? <div className={styles.inset}><Icon name="clock" /><p>规划服务暂时未就绪。可先保存草稿；恢复后再生成。</p></div> : null}
      </> : null}{step >= 2 ? plan && journey?.planCurrent ? (
        <DayReview
          plan={plan}
          startDate={form.departureDate || "行程"}
          destination={form.destinationCity}
          travelHours={plan.timezone.travelHours}
          busy={loading || busy}
          onEditPace={() => { setStep(1); setError(""); }}
          onSelectDay={setDayDetail}
          onSelectActivity={setActivity}
          onEditActivities={journey?.status !== "completed" ? () => openPlanEditor() : undefined}
          onShare={() => setShareOpen(true)}
          launchLabel={planner.machine.can.canStart ? "确认并开始旅程" : "返回今日行程"}
          onLaunch={() => { if (planner.machine.can.canStart) void transition("active"); else navigate("today"); }}
        />
      ) : form.originCity && form.destinationCity && form.departureDate ? (
        <section className={styles.card}>{plan ? <p className={styles.note}>资料已更新；上一次行程仅作参考，请确认本次资料并生成新的行程。</p> : null}{renderConsent()}</section>
      ) : (
        <div className={styles.stack}>
          <div className={styles.pageIntro}><h1>还差一点点。</h1><p>先补全目的地与日期，然后确认本次使用的资料，就能生成行程。</p></div>
          <button className={styles.primaryButton} onClick={() => setStep(0)}><Icon name="arrow" />回到上一步补全</button>
        </div>
      ) : null}
    </div>;
  }
