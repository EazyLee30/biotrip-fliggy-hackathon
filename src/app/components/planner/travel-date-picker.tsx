"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Icon } from "../zen-ui";
import { addTravelDays, isTravelDate, monthDates, nextTravelMonth, selectTravelDate, travelDateLabel, travelDuration, validateTravelRange } from "./travel-dates";
import type { DateSelection, TravelDateRange } from "./travel-dates";
import { MAX_TRIP_DAYS, planningDateError } from "@/lib/planner-input";
import { beginSheetDrag, moveSheetDrag, shouldDismissSheet, type SheetDrag } from "./sheet-gesture";
import styles from "./travel-date-picker.module.css";

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];
export function DateRangePicker({ start, end, today, onChange, allowPast = false }: TravelDateRange & { today: string; onChange: (next: TravelDateRange) => void; allowPast?: boolean }) {
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<DateSelection>({ start: "", end: "", phase: "departure" });
  const [month, setMonth] = useState("");
  const [returnUndecided, setReturnUndecided] = useState(false);
  const [focusedDay, setFocusedDay] = useState("");
  const [dragOffset, setDragOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const sheetDrag = useRef<SheetDrag | null>(null);
  const headingId = useId();
  const close = useCallback(() => {
    sheetDrag.current = null; setDragging(false); setDragOffset(0); setOpen(false);
  }, []);
  const beginDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0 || !window.matchMedia("(max-width: 699px)").matches || event.target instanceof Element && event.target.closest("button,a,input")) return;
    sheetDrag.current = beginSheetDrag(event.pointerId, event.clientX, event.clientY, event.timeStamp);
    event.currentTarget.setPointerCapture(event.pointerId); setDragging(true); event.preventDefault();
  }, []);
  const moveDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const current = sheetDrag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    sheetDrag.current = moveSheetDrag(current, event.clientX, event.clientY, event.timeStamp);
    setDragOffset(sheetDrag.current.offset);
  }, []);
  const endDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const current = sheetDrag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const result = moveSheetDrag(current, event.clientX, event.clientY, event.timeStamp);
    sheetDrag.current = null; setDragging(false); setDragOffset(0);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (shouldDismissSheet(result, panel.current?.clientHeight ?? 600)) close();
  }, [close]);
  const cancelDrag = useCallback(() => { sheetDrag.current = null; setDragging(false); setDragOffset(0); }, []);
  const duration = travelDuration(start, end);
  const pendingDuration = travelDuration(selection.start, selection.end);
  const minimumMonth = !allowPast && isTravelDate(today) ? today.slice(0, 7) : "";
  const rangeError = validateTravelRange(selection.start, selection.end, today, allowPast) || planningDateError(selection.start, selection.end);
  const canConfirm = !rangeError && Boolean(selection.end || returnUndecided);
  function showCalendar() {
    const validStart = isTravelDate(start) && (allowPast || start >= today) ? start : "";
    const validEnd = validStart && isTravelDate(end) && end >= validStart ? end : "";
    setSelection({ start: validStart, end: validEnd, phase: validStart && !validEnd ? "return" : "departure" });
    setReturnUndecided(Boolean(validStart && !end));
    const firstMonth = validStart || today; setMonth(firstMonth.slice(0, 7)); setFocusedDay(firstMonth); setOpen(true);
  }
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null, returnTarget = trigger.current, overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; panel.current?.focus();
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(); return; }
      if (event.key !== "Tab") return;
      const nodes = panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),[tabindex="0"]');
      if (!nodes?.length) { event.preventDefault(); return; }
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", listener);
    return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", listener); (previous ?? returnTarget)?.focus(); };
  }, [open, close]);
  function pick(day: string) {
    if (!isTravelDate(day) || (!allowPast && day < today)) return;
    const next = selectTravelDate(selection, day); setSelection(next); setFocusedDay(day);
    if (next.end) setReturnUndecided(false);
  }
  function changeMonth(delta: number) {
    const next = nextTravelMonth(month, delta);
    if (!next || (minimumMonth && next < minimumMonth)) return;
    setMonth(next); setFocusedDay(next === minimumMonth ? today : `${next}-01`);
    panel.current?.querySelector<HTMLElement>('[data-calendar-body]')?.scrollTo({ top: 0 });
  }
  function focusDate(day: string) {
    if (!isTravelDate(day) || (!allowPast && day < today)) return;
    if (day.slice(0, 7) !== month && day.slice(0, 7) !== nextTravelMonth(month, 1)) setMonth(day.slice(0, 7));
    setFocusedDay(day); requestAnimationFrame(() => panel.current?.querySelector<HTMLButtonElement>(`[data-date="${day}"]`)?.focus());
  }
  function dayKey(event: React.KeyboardEvent<HTMLButtonElement>, day: string) {
    const delta: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (Object.hasOwn(delta, event.key)) { event.preventDefault(); focusDate(addTravelDays(day, delta[event.key])); }
    else if (event.key === "Home") { event.preventDefault(); focusDate(`${day.slice(0, 7)}-01`); }
    else if (event.key === "PageUp" || event.key === "PageDown") { event.preventDefault(); changeMonth(event.key === "PageUp" ? -1 : 1); }
  }
  function chooseEndpoint(phase: DateSelection["phase"]) { setSelection((current) => ({ ...current, phase })); const date = phase === "departure" ? selection.start : selection.end || selection.start; if (date) setMonth(date.slice(0, 7)); }
  return <>
    <button ref={trigger} type="button" className={styles.summary} aria-haspopup="dialog" aria-expanded={open} onClick={showCalendar}><span className={styles.dateBlock}><small>出发日期</small><strong>{travelDateLabel(start)}</strong>{isTravelDate(start) ? <span>{new Intl.DateTimeFormat("zh-CN", { timeZone: "UTC", weekday: "short" }).format(new Date(`${start}T12:00:00Z`))}</span> : null}</span><span className={styles.duration}>{duration ? `${duration.days} 天` : <Icon name="arrow" size={17} />}</span><span className={styles.dateBlock}><small>返程日期</small><strong>{end ? travelDateLabel(end) : start ? "返程未定" : "请选择"}</strong>{duration ? <span>{duration.nights} 晚</span> : null}</span><Icon name="calendar" size={18} /></button>
    {open ? <div className={styles.backdrop} onClick={(event) => { if (event.target === event.currentTarget) close(); }}><div className={`${styles.sheet} ${dragging ? styles.dragging : ""}`} style={dragOffset ? { translate: `0 ${dragOffset}px` } : undefined} ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={headingId}>
      <header className={styles.header}><div className={styles.sheetTop} data-sheet-drag-handle="dates" onPointerDown={beginDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag}><div className={styles.grab} aria-hidden="true" /><div className={styles.titleRow}><h2 id={headingId}>选择旅行日期</h2><button type="button" className={styles.iconButton} aria-label="关闭日期选择" onClick={close}><Icon name="close" /></button></div></div><div className={styles.endpoints}><button type="button" className={selection.phase === "departure" ? styles.endpointActive : ""} onClick={() => chooseEndpoint("departure")}><small>出发</small><strong>{travelDateLabel(selection.start)}</strong></button><span><Icon name="arrow" size={18} /></span><button type="button" className={selection.phase === "return" ? styles.endpointActive : ""} onClick={() => chooseEndpoint("return")}><small>返程</small><strong>{selection.end ? travelDateLabel(selection.end) : returnUndecided ? "返程未定" : "请选择"}</strong></button></div><div className={styles.monthNavigation}><button type="button" className={styles.iconButton} aria-label="上个月" disabled={Boolean(minimumMonth && month <= minimumMonth)} onClick={() => changeMonth(-1)}><Icon name="back" size={18} /></button><span aria-live="polite">{selection.start && selection.end ? "日期已选好，请确认" : selection.phase === "departure" ? "先选出发日期" : "再选返程日期"}</span><button type="button" className={styles.iconButton} aria-label="下个月" onClick={() => changeMonth(1)}><Icon name="arrow" size={18} /></button></div><div className={styles.weekdays}>{WEEKDAYS.map((day) => <span key={day}>{day}</span>)}</div></header>
      <div className={styles.body} data-calendar-body>{[month, nextTravelMonth(month, 1)].filter(Boolean).map((currentMonth) => <section className={styles.month} key={currentMonth} aria-label={`${currentMonth.slice(0, 4)}年${Number(currentMonth.slice(5))}月`}><h3>{currentMonth.slice(0, 4)} 年 {Number(currentMonth.slice(5))} 月</h3><div className={`${styles.weekdays} ${styles.monthWeekdays}`} aria-hidden="true">{WEEKDAYS.map((day) => <span key={day}>{day}</span>)}</div><div className={styles.calendarGrid} role="group" aria-label={`${currentMonth}日期`}>{monthDates(currentMonth).map((day, index) => {
        if (!day) return <span key={`empty-${index}`} />;
        const disabled = !allowPast && day < today, departure = selection.start === day, returning = selection.end === day;
        const selected = Boolean(selection.start && selection.end && day >= selection.start && day <= selection.end), single = departure && returning;
        return <button type="button" key={day} data-date={day} onFocus={() => setFocusedDay(day)} onKeyDown={(event) => dayKey(event, day)} tabIndex={day === focusedDay ? 0 : -1} disabled={disabled} aria-label={`${travelDateLabel(day, true)}${departure ? "，出发" : ""}${returning ? "，返程" : ""}${day === today ? "，今天" : ""}`} aria-pressed={selected || departure || returning} className={`${styles.day} ${selected ? styles.inRange : ""} ${departure ? styles.departure : ""} ${returning ? styles.returning : ""} ${single ? styles.single : ""}`} onClick={() => pick(day)}><strong>{Number(day.slice(8))}</strong><small>{single ? "出发/返程" : departure ? "出发" : returning ? "返程" : day === today ? "今天" : ""}</small></button>;
      })}</div></section>)}</div>
      <footer className={styles.footer}><div className={styles.footerTop}><button type="button" className={`${styles.undecided} ${returnUndecided ? styles.undecidedActive : ""}`} aria-pressed={returnUndecided} onClick={() => { setReturnUndecided(!returnUndecided); setSelection((current) => ({ ...current, end: "", phase: current.start ? "return" : "departure" })); }}>返程未定</button><span aria-live="polite">{selection.start && rangeError ? rangeError : pendingDuration ? `${pendingDuration.days} 天 ${pendingDuration.nights} 晚` : selection.start ? returnUndecided ? "先按出发日期规划" : "请选择返程日期" : `单次最多规划 ${MAX_TRIP_DAYS} 天`}</span></div><button type="button" className={styles.confirm} disabled={!canConfirm} onClick={() => { onChange({ start: selection.start, end: returnUndecided ? "" : selection.end }); close(); }}>{canConfirm ? `确认${pendingDuration && !returnUndecided ? ` · ${pendingDuration.days} 天` : "日期"}` : "请选择旅行日期"}</button></footer>
    </div></div> : null}
  </>;
}
