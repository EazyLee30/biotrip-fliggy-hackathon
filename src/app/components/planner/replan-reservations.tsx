"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AnimatePresence, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { CalendarDays, Check, ChevronRight, Clock3, LockKeyhole, MapPin, Plus, Ticket, X } from "lucide-react";
import type { ItineraryActivity } from "@/lib/journey-types";
import { TimeWheel } from "./reservation-editor";
import { decodeReservationName, encodeReservationName, reservationDates, reservationDraftError, type ReservationDraft } from "./reservations";
import { initialReplanReservations, replanReservationText, reservationEditsFromItems, type ReplanReservation, type ReservationEdit } from "./replan-reservations-state";
import css from "./replan-reservations.module.css";

export type ReplanReservationsProps = {
  itinerary: ItineraryActivity[];
  value: string;
  tripStart: string;
  tripEnd: string;
  onChange: (canonicalText: string) => void;
  reservationEdits?: ReservationEdit[];
  onEditsChange?: (edits: ReservationEdit[]) => void;
  onEditingChange?: (editing: boolean) => void;
  disabled?: boolean;
};
type Editing = ReservationDraft & { key: string | null; original: string; hour: number | null; minute: number | null };
const dayLabel = (date: string) => `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日`;
const weekday = (date: string) => new Intl.DateTimeFormat("zh-CN", { weekday: "short", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

export function ReplanReservations({ itinerary, value, tripStart, tripEnd, onChange, reservationEdits, onEditsChange, onEditingChange, disabled = false }: ReplanReservationsProps) {
  const state = useMemo(() => initialReplanReservations(itinerary, value, tripStart, tripEnd, reservationEdits), [itinerary, value, tripStart, tripEnd, reservationEdits]);
  const dates = useMemo(() => reservationDates(tripStart, tripEnd), [tripStart, tripEnd]);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState("");
  const [pendingHour, setPendingHour] = useState(false), [pendingMinute, setPendingMinute] = useState(false);
  const editor = useRef<HTMLDivElement>(null);
  const lastTrigger = useRef<HTMLButtonElement | null>(null);
  const reducedMotion = useReducedMotion();
  const id = useId();
  const canonicalText = state.canonicalText;
  const editingOpen = editing !== null;
  useEffect(() => {
    onEditingChange?.(editingOpen);
    return () => { if (editingOpen) onEditingChange?.(false); };
  }, [editingOpen, onEditingChange]);
  useEffect(() => {
    if (!disabled && canonicalText !== null && canonicalText !== value) onChange(canonicalText);
  }, [canonicalText, value, onChange, disabled]);
  useEffect(() => {
    if (!disabled && JSON.stringify(state.edits) !== JSON.stringify(reservationEdits ?? [])) onEditsChange?.(state.edits);
  }, [state.edits, reservationEdits, onEditsChange, disabled]);
  const retained = state.items.filter(item => item.fixed || item.locked).length;
  const lockCount = state.items.filter(item => item.locked).length;

  function closeEditor() { setEditing(null); setError(""); requestAnimationFrame(() => lastTrigger.current?.focus({ preventScroll: true })); }
  function openEditor(item: ReplanReservation | null, trigger: HTMLButtonElement) {
    if (disabled || item?.locked) return;
    const name = decodeReservationName(item?.name ?? "");
    const [hour, minute] = item ? item.time.split(":").map(Number) : [null, null];
    setEditing({ key: item?.key ?? null, original: canonicalText ?? value, date: item?.date ?? tripStart, time: item?.time ?? "", activity: name.activity, location: name.location, fixed: item?.fixed ?? true, hour, minute });
    setPendingHour(false); setPendingMinute(false); setError(""); lastTrigger.current = trigger;
    requestAnimationFrame(() => { editor.current?.focus({ preventScroll: true }); editor.current?.scrollIntoView({ block: "nearest", behavior: reducedMotion ? "auto" : "smooth" }); });
  }
  function write(items: ReplanReservation[]) {
    const result = replanReservationText(items);
    if (result.value === null) { setError(items.length > 30 ? "这次最多保留 30 项，请先精简一些活动。" : "活动名称有些长，请缩短后再保存。"); return false; }
    onChange(result.value); onEditsChange?.(reservationEditsFromItems(items, itinerary, tripStart)); setError(""); return true;
  }
  function toggle(item: ReplanReservation) {
    if (disabled || item.locked) return;
    write(state.items.map(current => current.key === item.key ? { ...current, fixed: !current.fixed } : current));
  }
  function update(patch: Partial<Editing>) { setEditing(current => current ? { ...current, ...patch } : null); setError(""); }
  function updateTime(part: "hour" | "minute", next: number) {
    setEditing(current => {
      if (!current) return null;
      const changed = { ...current, [part]: next };
      return { ...changed, time: changed.hour === null || changed.minute === null ? "" : `${String(changed.hour).padStart(2, "0")}:${String(changed.minute).padStart(2, "0")}` };
    }); setError("");
  }
  function save() {
    if (!editing || disabled || pendingHour || pendingMinute) return;
    if (editing.original !== canonicalText) { setError("安排刚刚更新了，请返回活动卡片后再试。"); return; }
    const current = state.items.find(item => item.key === editing.key);
    if (current?.locked) { setError("这项活动已经开始，会保留原来的安排。"); return; }
    const validation = reservationDraftError(editing, tripStart, tripEnd);
    if (validation) { setError(validation.includes("换行") || validation.includes("竖线") ? "用一个简短的名称就好。" : validation); return; }
    if (!current && state.items.some(item => decodeReservationName(item.name).activity === editing.activity.trim())) { setError("已有同名安排，换一个容易区分的名称吧。"); return; }
    const changed: ReplanReservation = { ...(current ?? { key: "new", origin: "draft", locked: false }), date: editing.date, time: editing.time, name: encodeReservationName(editing.activity, editing.location)!, fixed: editing.fixed };
    const next = current ? state.items.map(item => item.key === current.key ? changed : item) : [...state.items, changed];
    if (write(next)) closeEditor();
  }

  return <section className={css.root} aria-label="保留重要安排">
    <div className={css.summary}><span className={css.summaryIcon}><Ticket size={22} aria-hidden="true" /></span><div><strong>{retained ? `${retained} 项安排，已经为你留好` : "把重要的安排留给自己"}</strong><p>{state.items.length ? "保留的活动按原时间安排，其余可以换个节奏。" : "没有固定预约，可以直接继续。"}</p></div></div>
    {state.recovered && <p className={css.note} role="status">已从当前行程带入预约，直接核对卡片就好。</p>}
    <ul className={css.cards}>{state.items.map(item => {
      const name = decodeReservationName(item.name);
      return <li key={item.key} className={css.card} data-retained={item.fixed || item.locked}>
        <div className={css.cardMain}><span className={css.day}><small>{item.date ? `${Number(item.date.slice(5, 7))} 月` : "行程"}</small><strong>{item.date ? Number(item.date.slice(8)) : "·"}</strong>{item.date && <small>{weekday(item.date)}</small>}</span><div className={css.details}><strong>{name.activity}</strong><span><Clock3 size={14} aria-hidden="true" />{item.time}{item.durationMin ? ` · ${item.durationMin} 分钟` : ""}</span>{name.location && <span><MapPin size={14} aria-hidden="true" />{name.location}</span>}</div></div>
        <div className={css.cardActions}>{item.locked ? <span className={css.locked}><LockKeyhole size={14} />{item.progress === "completed" ? "已完成 · 保留足迹" : "进行中 · 原样保留"}</span> : <><button type="button" className={css.keep} aria-pressed={item.fixed} aria-label={`${item.fixed ? "允许灵活调整" : "保留"}${name.activity}`} disabled={disabled || Boolean(editing)} onClick={() => toggle(item)}><span className={css.check}>{item.fixed && <Check size={14} />}</span>{item.fixed ? "保留" : "可调整"}</button><button type="button" className={css.edit} disabled={disabled || Boolean(editing)} onClick={event => openEditor(item, event.currentTarget)} aria-label={`修改${name.activity}的日期和时间`}>改时间<ChevronRight size={15} /></button></>}</div>
      </li>;
    })}</ul>
    {!editing && <button type="button" className={css.add} disabled={disabled || !dates.length || state.items.length >= 30} onClick={event => openEditor(null, event.currentTarget)}><Plus size={18} />再留一个安排</button>}
    <AnimatePresence initial={false}>{editing && <m.div key="reservation-editor" className={css.editor} ref={editor} tabIndex={-1} aria-labelledby={`${id}-title`} initial={{ opacity: 0, y: reducedMotion ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: reducedMotion ? 0 : .24 }}>
      <div className={css.editorHead}><h3 id={`${id}-title`}>{editing.key ? "换一个合适的时间" : "留一个重要安排"}</h3><button type="button" disabled={disabled} aria-label="取消编辑安排" onClick={closeEditor}><X size={20} /></button></div>
      {editing.key ? <p className={css.activityName}>{editing.activity}</p> : <><label className={css.field}><span>活动名称</span><input type="text" value={editing.activity} disabled={disabled} maxLength={120} autoComplete="off" placeholder="例如：朋友晚餐" onChange={event => update({ activity: event.target.value })} /></label><div className={css.templates}>{["入住", "朋友晚餐", "参观展览"].map(name => <button type="button" key={name} disabled={disabled} onClick={() => update({ activity: name })}>{name}</button>)}</div></>}
      <div className={css.fieldHead}><span><CalendarDays size={16} />选一天</span><small>目的地当地日期</small></div>
      <div className={css.dateStrip} role="group" aria-label="选择活动日期">{dates.map(date => <button type="button" key={date} aria-pressed={date === editing.date} disabled={disabled} onClick={() => update({ date })}><small>{weekday(date)}</small><strong>{dayLabel(date)}</strong></button>)}</div>
      <div className={css.fieldHead}><span><Clock3 size={16} />选时间</span><small>{editing.time || "滑动小时与分钟"}</small></div>
      <div className={css.time}><TimeWheel label="时" value={editing.hour} max={23} initialValue={9} disabled={disabled} onChange={hour => updateTime("hour", hour)} onPendingChange={setPendingHour} /><span aria-hidden="true">:</span><TimeWheel label="分" value={editing.minute} max={59} disabled={disabled} onChange={minute => updateTime("minute", minute)} onPendingChange={setPendingMinute} /></div>
      {error && <p className={css.error} role="alert">{error}</p>}
      <div className={css.editorActions}><button type="button" className={css.cancel} disabled={disabled} onClick={closeEditor}>取消</button><button type="button" className={css.save} disabled={disabled || pendingHour || pendingMinute} onClick={save}>{pendingHour || pendingMinute ? "正在选时间…" : "保存安排"}<Check size={18} /></button></div>
    </m.div>}</AnimatePresence>
    {!editing && error && <p className={css.error} role="alert">{error}</p>}
    <p className={css.note}>{lockCount ? "进行中和已完成的活动保持原样。" : ""}这里的修改会先生成预览，确认采用后才更新行程。</p>
  </section>;
}
