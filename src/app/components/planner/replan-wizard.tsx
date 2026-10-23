"use client";
import { StepTransition } from "../ui/motion-provider";
import { useRef, useState, type ReactNode } from "react";
import type { ItineraryActivity } from "@/lib/journey-types";
import type { PlannerInputs, TripForm } from "./use-planner-inputs";
import { FatigueCheckIn, FATIGUE_LABELS } from "./fatigue-check-in";
import { ReplanReservations } from "./replan-reservations";
import { initialReplanReservations, type ReservationEdit } from "./replan-reservations-state";
import { ToggleSwitch } from "../toggle-switch";
import { PACE_LEVELS } from "./blocks/pace-matrix";
import { Icon } from "../zen-ui";
import css from "./replan-wizard.module.css";
export type ReplanSubmission = { itineraryText: string; reservationEdits: ReservationEdit[]; note: string };
type Props = Pick<PlannerInputs, "form" | "fatigue" | "setFatigue" | "bodyFeedback" | "moodFeedback" | "includeWhoop" | "setIncludeWhoop" | "includeMemory" | "setIncludeMemory"> & {
  whoopSummary?: ReactNode;
  itinerary: ItineraryActivity[]; checkInError?: string; memoryAllowed: boolean; busy: boolean; whoopConnected: boolean; reservationRange: { start: string; end: string };
  update: <K extends keyof TripForm>(key: K, value: TripForm[K]) => void;
  onGenerate: (value: ReplanSubmission) => void; onExit: () => void;
};
const TITLES = ["给这段旅程，留多少空白？", "此刻，想走得慢一点吗？", "把重要的安排，留给自己", "新的节奏，从这里开始"];
const HINTS = ["已带入你的旅行节奏，点一下就能调整。", "今天的自评会自动带入，按现在的感受更新就好。", "预约已从当前行程带入。保留，或换一个时间。", "先核对重要安排，再生成完整的新时间轴。"];
function RhythmArt({ density }: { density: number }) {
  return <svg viewBox="0 0 240 60" fill="none" aria-hidden="true"><path d="M8 36C45 4 70 56 112 29S177 13 230 32" stroke="currentColor" strokeOpacity=".25" strokeWidth="2" />{Array.from({ length: density }, (_, i) => { const x = 20 + (i * 200) / (density - 1); const y = 28 + Math.sin(i * 1.8) * 10; return <g key={i}><circle cx={x} cy={y} r={i % 2 ? 5 : 9} fill="currentColor" opacity={i % 2 ? .35 : .8} /></g>; })}</svg>;
}
export function ReplanWizard(p: Props) {
  const [step, setStep] = useState(0), [direction, setDirection] = useState(1);
  const [initial] = useState(() => initialReplanReservations(p.itinerary, p.form.itineraryText, p.reservationRange.start, p.reservationRange.end));
  const [reservationText, setReservationText] = useState(initial.canonicalText ?? "");
  const [reservationEdits, setReservationEdits] = useState(initial.edits);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(() => [p.bodyFeedback, p.moodFeedback].filter(Boolean).join("；").slice(0, 80));
  const title = useRef<HTMLHeadingElement>(null);
  const appointments = initialReplanReservations(p.itinerary, reservationText, p.reservationRange.start, p.reservationRange.end, reservationEdits).items;
  const selectedPace = PACE_LEVELS.find(item => item.value === p.form.paceLevel) ?? PACE_LEVELS[1];
  function go(next: number) { setDirection(next > step ? 1 : -1); setStep(next); window.scrollTo({ top: 0, behavior: "smooth" }); requestAnimationFrame(() => title.current?.focus({ preventScroll: true })); }
  return <div className={css.root}>
    <div className={css.progress} aria-label={`第 ${step + 1} 步，共 4 步`}><span>重新安排 · {step + 1} / 4</span><div>{TITLES.map((_, i) => <i key={i} data-active={i <= step} />)}</div></div>
    <StepTransition step={step} className={css.card} direction={direction}>
      <span className={css.kicker}>{p.form.destinationCity} · 跟随身体的节奏</span><h1 ref={title} tabIndex={-1}>{TITLES[step]}</h1><p className={css.hint}>{HINTS[step]}</p>
      {step === 0 && <div className={css.rhythms} role="group" aria-label="旅行节奏">{PACE_LEVELS.map((item, index) => <button type="button" key={item.value} aria-pressed={p.form.paceLevel === item.value} disabled={p.busy} onClick={() => p.update("paceLevel", item.value)}><div><strong>{item.name}</strong><span className={css.selection}>{p.form.paceLevel === item.value && <Icon name="check" size={15} />}</span></div><RhythmArt density={3 + index * 2} /><span>{item.summary}</span><small>{item.dayShape}</small></button>)}</div>}
      {step === 1 && <><FatigueCheckIn value={p.fatigue} disabled={p.busy} onChange={p.setFatigue} />{p.checkInError && <p role="alert">{p.checkInError}</p>}<details className={css.optional}><summary>补充要求（选填）<span aria-hidden="true">＋</span></summary><label htmlFor="replan-note" className={css.srOnly}>补充要求</label><textarea id="replan-note" rows={2} maxLength={80} value={note} disabled={p.busy} placeholder="例如：今天想早点回酒店" onChange={event => setNote(event.target.value)} /><small>其他偏好已自动带入，不用再填一遍。</small></details></>}
      {step === 2 && <ReplanReservations itinerary={p.itinerary} value={reservationText} tripStart={p.reservationRange.start} tripEnd={p.reservationRange.end} disabled={p.busy} reservationEdits={reservationEdits} onEditsChange={setReservationEdits} onChange={setReservationText} onEditingChange={setEditing} />}
      {step === 3 && <><div className={css.recap}><div><span>旅行节奏</span><strong>{selectedPace.name}</strong><RhythmArt density={p.form.paceLevel === "gentle" ? 3 : p.form.paceLevel === "active" ? 7 : 5} /></div><div><span>今天的感受</span><strong>{p.fatigue ? FATIGUE_LABELS[Number(p.fatigue) - 1] : "暂未自评"}</strong><div className={css.feelingDots} aria-hidden="true">{[1, 2, 3, 4, 5].map(v => <i key={v} data-filled={v <= Number(p.fatigue)} />)}</div></div></div>
        <div className={css.anchors}><div className={css.anchorHead}><h2>重要安排</h2><span>{appointments.filter(item => item.fixed || item.locked).length} 项保留</span></div>{appointments.length ? <ol>{appointments.map(item => { const old = p.itinerary.find(activity => activity.id === item.activityId); const changed = old && ((old.date ?? p.reservationRange.start) !== item.date || old.time !== item.time); return <li key={item.key}><i aria-hidden="true" /><div><strong>{item.name}</strong><span>{changed && <del>{old.date?.slice(5)} {old.time}</del>}<b>{item.date?.slice(5)} · {item.time}</b></span></div><small>{item.locked ? item.progress === "completed" ? "已完成" : "进行中" : item.fixed ? "保留" : "可调整"}</small></li>; })}</ol> : <p>没有固定预约，为新体验留些空白。</p>}</div>
        {note && <p className={css.notePreview}>补充要求：{note}</p>}{p.whoopConnected ? p.whoopSummary : null}<div className={css.settings}>{p.whoopConnected && <label><span>参考 WHOOP 身体记录</span><ToggleSwitch label="本次规划使用 WHOOP" checked={p.includeWhoop} disabled={p.busy} onChange={p.setIncludeWhoop} /></label>}<label><span>{p.memoryAllowed ? "参考旅行记忆" : "旅行记忆已在设置中关闭"}</span><ToggleSwitch label="本次规划使用旅行记忆" checked={p.memoryAllowed && p.includeMemory} disabled={p.busy || !p.memoryAllowed} onChange={p.setIncludeMemory} /></label></div><p className={css.hint}>生成后逐日对比前后时间轴，确认采用才会更新行程。</p></>}
    </StepTransition>
    <footer className={css.footer}><button type="button" disabled={p.busy || editing} onClick={() => step ? go(step - 1) : p.onExit()}>{step ? "上一步" : "返回行程"}</button><button type="button" className={css.primary} disabled={p.busy || editing || initial.canonicalText === null} onClick={() => step < 3 ? go(step + 1) : p.onGenerate({ itineraryText: reservationText, reservationEdits, note })}>{p.busy ? "正在保存…" : step < 3 ? "下一步" : "确认，重新规划"}<Icon name="arrow" size={18} /></button></footer>
  </div>;
}
