"use client";

import { useId, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronDown, Clock3, Footprints, LockKeyhole, Minus, Plus, Route, Sparkles } from "lucide-react";
import type { Journey, ItineraryActivity } from "@/lib/journey-types";
import type { PlanningJob } from "@/lib/planning/jobs";
import { compareItineraries } from "@/lib/itinerary-diff";
import { reviewBaselineItinerary } from "./plan-review-data";
import css from "./plan-review-page.module.css";

type Props = {
  current: Journey;
  candidate?: PlanningJob;
  busy: boolean;
  error: string;
  onDecision?: (action: "apply" | "discard") => Promise<void>;
  onClose: () => void;
};
type Side = "before" | "after";
type Change = "added" | "removed" | "changed";
const CHANGE_LABELS: Record<Change, string> = { added: "新加入", removed: "移出", changed: "有调整" };

function dateLabel(date: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${Number(date.slice(5, 7))} 月 ${Number(date.slice(8, 10))} 日` : "未标注日期";
}

function activityFacts(item: ItineraryActivity) {
  const facts: string[] = [];
  if (item.durationMin != null) facts.push(`${item.durationMin} 分钟停留`);
  if (item.move?.minutes != null) facts.push(`${item.move.mode === "walk" ? "步行" : "交通"} ${item.move.minutes} 分钟`);
  if (item.move?.costCny != null && item.move.basis === "amap") facts.push(`交通参考 ¥${item.move.costCny}`);
  return facts;
}

const typedFacts = (item: ItineraryActivity) => JSON.stringify([item.durationMin, item.kind, item.effort, item.move?.mode, item.move?.minutes, item.move?.km, item.move?.costCny, item.move?.basis]);

function Timeline({ side, items, changes, id }: { side: Side; items: ItineraryActivity[]; changes: Map<ItineraryActivity, Change>; id: string }) {
  return <section id={id} className={css.column} data-side={side} aria-label={side === "before" ? "原安排时间轴" : "新安排时间轴"}>
    <div className={css.columnHeading}><div><span>{side === "before" ? "BEFORE" : "AFTER"}</span><h2>{side === "before" ? "原来的安排" : "新的节奏"}</h2></div><small>{items.length} 项安排</small></div>
    {items.length ? <ol className={css.timeline}>{items.map((item, index) => {
      const change = changes.get(item);
      const progress = item.progress?.state;
      const facts = activityFacts(item);
      return <li key={`${item.id ?? index}:${index}`} className={css.activity} data-change={change}>
        <time className={css.time}>{item.time || "待定"}</time><span className={css.rail} aria-hidden="true"><i>{progress === "completed" ? <Check size={10}/> : null}</i></span>
        <div className={css.activityBody}>
          <div className={css.labels}>
            {change && <span className={css.changeLabel} data-change={change}>{change === "added" ? <Plus size={11}/> : change === "removed" ? <Minus size={11}/> : <Route size={11}/>} {CHANGE_LABELS[change]}</span>}
            {item.fixed && <span><LockKeyhole size={11}/> 固定预约</span>}
            {progress === "completed" && <span><Check size={12}/> 已完成</span>}
            {progress === "in_progress" && <span><Clock3 size={11}/> 正在进行</span>}
            {progress === "skipped" && <span>已跳过</span>}
          </div>
          <h3>{item.name}</h3>
          {facts.length > 0 && <p className={css.facts}><Footprints size={12}/><span>{facts.join(" · ")}</span></p>}
          {item.detail && <details className={css.detail}><summary>安排说明 <ChevronDown size={12}/></summary><p>{item.detail}</p></details>}
        </div>
      </li>;
    })}</ol> : <div className={css.empty}><span className={css.emptyLine}/><p>{side === "before" ? "这一天原本没有安排" : "这一天留给你自由安排"}</p></div>}
  </section>;
}

/** Full-page review: a candidate is never applied by opening or comparing it. */
export function PlanReviewPage({ current, candidate, busy, error, onDecision, onClose }: Props) {
  const [side, setSide] = useState<Side>("after");
  const [selectedDate, setSelectedDate] = useState("");
  const [submitting, setSubmitting] = useState<"apply" | "discard" | null>(null);
  const [localError, setLocalError] = useState("");
  const decisionLock = useRef(false);
  const panelId = useId();
  const next = candidate?.candidate;
  const before = reviewBaselineItinerary(current);
  const after = next?.plan.itinerary ?? [];
  const comparison = compareItineraries(before, after);
  const beforeChanges = new Map<ItineraryActivity, Change>(comparison.removed.map(item => [item, "removed"]));
  const afterChanges = new Map<ItineraryActivity, Change>(comparison.added.map(item => [item, "added"]));
  for (const change of comparison.changed) { beforeChanges.set(change.before, "changed"); afterChanges.set(change.after, "changed"); }
  // The shared comparison pairs stable IDs. Include typed timing/transport
  // changes too, which its older text-oriented summary does not compare.
  let extraChanges = 0;
  for (const item of comparison.retained) {
    const previous = before.find(old => old.id && item.id ? old.id === item.id : old.date === item.date && old.time === item.time && old.name === item.name);
    if (previous && typedFacts(previous) !== typedFacts(item)) {
      beforeChanges.set(previous, "changed"); afterChanges.set(item, "changed"); extraChanges++;
    }
  }
  const dateFor = (item: ItineraryActivity) => item.date || "undated";
  const dates = [...new Set([...before, ...after].map(dateFor))].sort();
  const changedDate = after.find(item => afterChanges.has(item)) ?? before.find(item => beforeChanges.has(item));
  const date = dates.includes(selectedDate) ? selectedDate : changedDate ? dateFor(changedDate) : dates[0] ?? "undated";
  const sorted = (items: ItineraryActivity[]) => items.filter(item => dateFor(item) === date).slice().sort((a, b) => a.time.localeCompare(b.time));
  const conflict = Boolean(candidate && current.version !== candidate.baseVersion);
  const blocked = busy || submitting !== null;
  const canApply = Boolean(next && candidate?.state === "awaiting_approval" && !conflict && current.status !== "completed" && onDecision);
  async function decide(action: "apply" | "discard") {
    if (blocked || decisionLock.current || !onDecision || (action === "apply" && !canApply)) return;
    decisionLock.current = true; setSubmitting(action); setLocalError("");
    try { await onDecision(action); }
    catch (caught) { setLocalError(caught instanceof Error ? caught.message : "暂时无法保存决定，请重试。"); }
    finally { decisionLock.current = false; setSubmitting(null); }
  }
  return <div className={css.root}>
    <header className={css.header}><button type="button" onClick={onClose} disabled={blocked} className={css.back}><ArrowLeft size={18}/> 返回旅程</button><span>重新安排 · 最后确认</span></header>
    <div className={css.intro}><span className={css.eyebrow}><Sparkles size={13}/> 给接下来的日子，换一种节奏</span><h1 className={css.title}>看看，新的安排。</h1><p>对照前后，喜欢再采用。</p></div>
    {next ? <>
      <dl className={css.stats} aria-label="本次行程变化"><div><dt><Plus size={14}/> 新增</dt><dd>{comparison.added.length}<small>项</small></dd></div><div><dt><Route size={14}/> 调整</dt><dd>{comparison.changed.length + extraChanges}<small>项</small></dd></div><div><dt><Minus size={14}/> 移出</dt><dd>{comparison.removed.length}<small>项</small></dd></div></dl>
      <p className={css.retained}><LockKeyhole size={13}/> 固定预约与活动进度，已在时间轴中标记。</p>
      {dates.length > 1 && <div className={css.dates} role="group" aria-label="选择对照日期">{dates.map(value => <button type="button" key={value} aria-pressed={date === value} onClick={() => setSelectedDate(value)}>{dateLabel(value)}</button>)}</div>}
      <div className={css.dayHeading}><h2>{dateLabel(date)}</h2><span>同一天，两种安排</span></div>
      <div className={css.switcher} role="group" aria-label="切换时间轴"><button type="button" aria-pressed={side === "before"} aria-controls={`${panelId}-before`} onClick={() => setSide("before")}>原安排</button><button type="button" aria-pressed={side === "after"} aria-controls={`${panelId}-after`} onClick={() => setSide("after")}>新安排 <ArrowRight size={14}/></button></div>
      <div className={css.comparison} data-mobile-side={side}><Timeline id={`${panelId}-before`} side="before" items={sorted(before)} changes={beforeChanges}/><Timeline id={`${panelId}-after`} side="after" items={sorted(after)} changes={afterChanges}/></div>
      <p className={css.priceNote}>未显示费用的项目，价格尚未核验。需要预订时，请再核对来源价格。</p>
      <details className={css.planNote}><summary>这次安排的思路 <ChevronDown size={14}/></summary><p>{next.plan.summary}</p>{next.plan.reason && <p>{next.plan.reason}</p>}</details>
    </> : <div className={css.unavailable}><h2>这份方案暂时无法打开</h2><p>返回旅程后，可以重新查看已保存的结果。</p></div>}
    {conflict && <p className={css.error} role="alert">行程刚刚有了变化。请保留原安排，再重新调整。</p>}
    {(error || localError) && <p className={css.error} role="alert">{error || localError}</p>}
    <footer className={css.footer}><p>{submitting ? "正在保存你的选择…" : "确认采用后，才会更新行程。"}</p><div><button type="button" className={css.secondary} disabled={blocked || !candidate || !onDecision} onClick={() => void decide("discard")}>{submitting === "discard" ? "正在保留…" : "保留原安排"}</button><button type="button" className={css.primary} disabled={blocked || !canApply} onClick={() => void decide("apply")}>{submitting === "apply" ? "正在采用…" : "采用新安排"}<Check size={17}/></button></div></footer>
  </div>;
}
