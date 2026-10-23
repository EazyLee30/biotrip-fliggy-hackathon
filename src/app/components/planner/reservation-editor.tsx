"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { parseSchedule, scheduleError } from "@/lib/planner-input";
import { Icon, Modal } from "../zen-ui";
import { decodeReservationName, recoverReservationCards, removeReservation, replaceReservation, reservationDates, reservationNameError, reservationTextError } from "./reservations";
import type { ReservationDraft } from "./reservations";
import styles from "./reservation-editor.module.css";

const ROW_HEIGHT = 44;
const TEMPLATES = ["入住", "交通", "用餐", "参观", "参加活动"];
const HOURS = 23;
const MINUTES = 59;

export type TimeWheelProps = {
  label: string;
  value: number | null;
  onChange: (value: number) => void;
  max: number;
  initialValue?: number;
  disabled?: boolean;
  onPendingChange?: (pending: boolean) => void;
};

/** A controlled numeric wheel. Programmatic alignment never commits an unchosen value. */
export function TimeWheel({ label, value, onChange, max, initialValue = 0, disabled = false, onPendingChange }: TimeWheelProps) {
  const list = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interacted = useRef(false);
  const pointerActive = useRef(false);
  const pending = useRef(false);
  const lastEmitted = useRef<number | null | undefined>(undefined);
  const id = useId();
  const limit = Math.max(0, Math.min(59, Math.floor(max)));
  const initial = Math.max(0, Math.min(limit, initialValue));
  const chosen = value !== null && Number.isInteger(value) && value >= 0 && value <= limit ? value : null;
  useLayoutEffect(() => {
    if (lastEmitted.current === chosen) return;
    lastEmitted.current = chosen;
    interacted.current = false;
    if (timer.current) clearTimeout(timer.current);
    list.current?.scrollTo({ top: (chosen ?? initial) * ROW_HEIGHT, behavior: "auto" });
  }, [chosen, initial, limit]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function markPending(next: boolean) {
    if (pending.current === next) return;
    pending.current = next;
    onPendingChange?.(next);
  }

  function choose(next: number) {
    if (disabled) return;
    const bounded = Math.max(0, Math.min(limit, next));
    if (timer.current) clearTimeout(timer.current);
    interacted.current = false;
    pointerActive.current = false;
    markPending(false);
    lastEmitted.current = bounded;
    onChange(bounded);
    list.current?.scrollTo({ top: bounded * ROW_HEIGHT, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
  function settleScroll() {
    if (!interacted.current || disabled) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const next = Math.max(0, Math.min(limit, Math.round((list.current?.scrollTop ?? 0) / ROW_HEIGHT)));
      lastEmitted.current = next;
      onChange(next);
      if (!pointerActive.current) { interacted.current = false; markPending(false); }
    }, 140);
  }
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = chosen ?? initial;
    const deltas: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, PageUp: -5, PageDown: 5 };
    if (Object.hasOwn(deltas, event.key)) { event.preventDefault(); choose(current + deltas[event.key]); }
    else if (event.key === "Home" || event.key === "End") { event.preventDefault(); choose(event.key === "Home" ? 0 : limit); }
    else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(current); }
  }
  return <div className={styles.wheelColumn}>
    <span className={styles.wheelLabel} id={`${id}-label`}>{label}</span>
    <div className={styles.wheelFrame}>
      <div className={styles.wheelHighlight} aria-hidden="true" />
      <div ref={list} className={styles.wheel} role="listbox" aria-labelledby={`${id}-label`} aria-disabled={disabled} aria-activedescendant={chosen === null ? undefined : `${id}-${chosen}`} tabIndex={disabled ? -1 : 0}
        onKeyDown={keyDown} onScroll={settleScroll} onWheel={() => { if (!disabled) { interacted.current = true; markPending(true); } }}
        onPointerDown={() => { if (!disabled) { interacted.current = true; pointerActive.current = true; markPending(true); } }}
        onPointerUp={() => { pointerActive.current = false; settleScroll(); }} onPointerCancel={(event) => { if (event.pointerType !== "touch") pointerActive.current = false; settleScroll(); }}
        onTouchStart={() => { if (!disabled) { interacted.current = true; pointerActive.current = true; markPending(true); } }} onTouchEnd={() => { pointerActive.current = false; settleScroll(); }} onTouchCancel={() => { pointerActive.current = false; settleScroll(); }}>
        {Array.from({ length: limit + 1 }, (_, number) => <button type="button" id={`${id}-${number}`} key={number} role="option" aria-selected={chosen === number} aria-label={`${number}${label}`} disabled={disabled} tabIndex={-1} className={`${styles.wheelOption} ${chosen === number ? styles.wheelSelected : ""}`} onClick={() => choose(number)}>{String(number).padStart(2, "0")}</button>)}
      </div>
    </div>
    <span className={styles.wheelHint}>{chosen === null ? "滑动或点选" : `已选 ${String(chosen).padStart(2, "0")}`}</span>
  </div>;
}

export type ReservationEditorProps = {
  value: string;
  onChange: (next: string) => void;
  /** Destination arrival date, not a departure date in another time zone. */
  tripStart: string;
  tripEnd: string;
  disabled?: boolean;
};
type Editing = ReservationDraft & { index: number | null; original: string; hour: number | null; minute: number | null };

function dateLabel(date: string) { return `${date.slice(0, 4)}年${Number(date.slice(5, 7))}月${Number(date.slice(8))}日`; }
function weekday(date: string) { return new Intl.DateTimeFormat("zh-CN", { timeZone: "UTC", weekday: "short" }).format(new Date(`${date}T12:00:00Z`)); }
function makeTime(hour: number | null, minute: number | null) { return hour === null || minute === null ? "" : `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`; }

export function ReservationEditor({ value, onChange, tripStart, tripEnd, disabled = false }: ReservationEditorProps) {
  const items = useMemo(() => parseSchedule(value), [value]);
  const dates = useMemo(() => reservationDates(tripStart, tripEnd), [tripStart, tripEnd]);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState("");
  const [editingError, setEditingError] = useState("");
  const [pendingHour, setPendingHour] = useState(false);
  const [pendingMinute, setPendingMinute] = useState(false);
  const [recovery, setRecovery] = useState<{ original: string; value: string; totalCount: number; recoveredCount: number; pendingCount: number } | null>(null);
  const [recoveryConfirmed, setRecoveryConfirmed] = useState(false);
  const [recoveryError, setRecoveryError] = useState("");
  const id = useId();
  const close = useCallback(() => { setEditing(null); setEditingError(""); }, []);
  const rawError = value.length > 6000 || Boolean(scheduleError(value));
  const canAdd = !disabled && !rawError && Boolean(dates.length) && (items?.length ?? 0) < 30;
  const nameError = editing?.activity ? reservationNameError(editing.activity, editing.location) : null;

  function open(index: number | null) {
    if (disabled || rawError || (index === null && !canAdd)) return;
    const existing = index === null ? null : items?.[index];
    if (index !== null && !existing) { setError("这项预约已变化，请重新打开。"); return; }
    const name = decodeReservationName(existing?.name ?? "");
    const [hour, minute] = existing ? existing.time.split(":").map(Number) : [null, null];
    setEditing({ index, original: value, date: existing ? existing.date ?? tripStart : "", time: existing?.time ?? "", activity: name.activity, location: name.location, fixed: existing?.fixed ?? true, hour, minute });
    setEditingError(""); setError("");
    setPendingHour(false); setPendingMinute(false);
  }
  function update(patch: Partial<Editing>) { setEditing((current) => current ? { ...current, ...patch } : null); setEditingError(""); }
  function updateTime(part: "hour" | "minute", next: number) {
    setEditing((current) => {
      if (!current) return null;
      const changed = { ...current, [part]: next };
      return { ...changed, time: makeTime(changed.hour, changed.minute) };
    }); setEditingError("");
  }
  function confirm() {
    if (!editing || disabled || pendingHour || pendingMinute) return;
    if (editing.original !== value) { setEditingError("预约内容已更新，请取消后重新打开，当前编辑仍保留。"); return; }
    const result = replaceReservation(value, editing.index, editing, tripStart, tripEnd);
    if (result.error !== null) { setEditingError(result.error); return; }
    onChange(result.value); close();
  }
  function remove(index: number) {
    if (disabled) return;
    const result = removeReservation(value, index);
    if (result.error !== null) { setError(result.error); return; }
    onChange(result.value); setError("");
  }
  function beginRecovery() {
    setRecovery({ original: value, ...recoverReservationCards(value, tripStart, tripEnd) });
    setRecoveryConfirmed(false); setRecoveryError("");
  }
  function confirmRecovery() {
    if (!recovery || disabled || !recoveryConfirmed) return;
    if (recovery.original !== value) { setRecoveryError("旧预约刚刚更新，请返回后再核对一次。"); return; }
    if (reservationTextError(recovery.value, tripStart, tripEnd)) { setRecoveryError("请先在卡片里确认每项安排的旅行日期。"); return; }
    onChange(recovery.value); setRecovery(null); setError("");
  }

  if (recovery) {
    const count = parseSchedule(recovery.value)?.length ?? 0;
    return <section className={styles.editor} aria-label="重新核对旧预约">
      <div className={styles.recoveryIntro}><h3>把旧安排，重新核对一下</h3><p>原来有 {recovery.totalCount} 项安排，已带入 {recovery.recoveredCount} 项。{recovery.pendingCount ? `还有 ${recovery.pendingCount} 项需要你重新添加或确认不保留。` : "你可以逐项核对时间。"}</p><small>确认前，原来的预约资料会完整保留。</small></div>
      <ReservationEditor value={recovery.value} tripStart={tripStart} tripEnd={tripEnd} disabled={disabled} onChange={next => { setRecovery(current => current ? { ...current, value: next } : null); setRecoveryConfirmed(false); }} />
      <label className={styles.recoveryConfirm}><input type="checkbox" checked={recoveryConfirmed} disabled={disabled} onChange={event => setRecoveryConfirmed(event.target.checked)} /><span>我已核对旧安排，确认{count ? `只保留以上 ${count} 项活动卡片` : "暂不保留旧预约"}。</span></label>
      {recoveryError && <p className={styles.error} role="alert">{recoveryError}</p>}
      <div className={styles.actions}><button type="button" className={styles.secondary} disabled={disabled} onClick={() => setRecovery(null)}>保留原资料</button><button type="button" className={styles.primary} disabled={disabled || !recoveryConfirmed} onClick={confirmRecovery}>{count ? `确认使用这 ${count} 项安排` : "确认暂不保留预约"}</button></div>
    </section>;
  }
  return <section className={styles.editor} aria-label="已确定的活动与预约">
    <div className={styles.listHead}><div><h3>已确定的活动与预约</h3><p>点选日期与时间，保留你已经安排好的活动。</p></div><span>{items?.length ?? 0}/30</span></div>
    {items?.length ? <ul className={styles.list}>{items.map((item, index) => {
      const name = decodeReservationName(item.name);
      const date = item.date ?? tripStart;
      const outside = Boolean(item.date && dates.length && !dates.includes(item.date));
      return <li className={styles.item} key={`${index}-${item.date ?? ""}-${item.time}-${item.name}`}>
        <button type="button" className={styles.itemEdit} disabled={disabled} onClick={() => open(index)} aria-label={`编辑预约：${item.name}`}><span className={styles.itemTime}>{item.time}</span><span className={styles.itemCopy}><strong>{name.activity}</strong>{name.location ? <small><Icon name="pin" size={12} />{name.location}</small> : null}<small>{date ? dateLabel(date) : "请先选择旅行日期"}{!item.date ? " · 抵达首日" : ""}{outside ? " · 超出旅程日期" : ""}</small><span className={item.fixed ? styles.fixedBadge : styles.flexBadge}>{item.fixed ? "固定安排" : "灵活调整"}</span></span><Icon name="edit" size={16} /></button>
        <button type="button" className={styles.delete} aria-label={`删除预约：${item.name}`} disabled={disabled} onClick={() => remove(index)}><Icon name="trash" size={17} /></button>
      </li>;
    })}</ul> : !rawError ? <div className={styles.empty}><Icon name="calendar" size={22} /><span>还没有添加预约</span><small>如入住、交通或已约好的活动</small></div> : null}
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    {rawError ? <div className={styles.recoveryIntro}><p>旧预约资料已保留，核对活动卡片后就可以继续。</p><button type="button" className={styles.add} disabled={disabled || !dates.length} onClick={beginRecovery}><Icon name="calendar" size={18} />{dates.length ? "重新核对预约" : "请先选择旅行日期"}</button></div> : <button type="button" className={styles.add} disabled={!canAdd} onClick={() => open(null)}><Icon name="plus" size={18} />{(items?.length ?? 0) >= 30 ? "已达到 30 项上限" : dates.length ? "添加活动或预约" : "请先选择旅行日期"}</button>}
    <p className={styles.note}>未写日期的旧预约按抵达首日显示。时间均为目的地当地时间。{!tripEnd ? "返程未定时仅可选抵达首日；要安排其他日期，请先补充旅行返程日期。" : ""}</p>
    {editing ? <Modal hideCloseButton title={editing.index === null ? "添加活动或预约" : "编辑活动或预约"} onClose={close} busy={disabled} footer={<div className={styles.actions}><button type="button" className={styles.secondary} onClick={close}>取消</button><button type="button" className={styles.primary} disabled={disabled || pendingHour || pendingMinute} onClick={confirm}>{pendingHour || pendingMinute ? "正在选择时间…" : `确认${editing.index === null ? "添加" : "修改"}`}</button></div>}>
      <div className={styles.form}>
        <div className={styles.fieldHead}><strong>日期</strong><span>{editing.date ? dateLabel(editing.date) : "请明确点选预约日期"} · 目的地当地</span></div>
        {dates.length ? <div className={styles.dateStrip} role="group" aria-label="旅程内预约日期">{dates.map((date) => <button type="button" key={date} className={`${styles.dateChip} ${date === editing.date ? styles.selectedDate : ""}`} aria-pressed={date === editing.date} aria-label={dateLabel(date)} disabled={disabled} onClick={() => update({ date })}><small>{date.slice(0, 4)}年</small><strong>{Number(date.slice(5, 7))}月{Number(date.slice(8))}日</strong><span>{weekday(date)}</span></button>)}</div> : <p className={styles.error}>旅行日期已变化，请取消后重新选择旅行日期。</p>}
        <div className={styles.fieldHead}><strong>时间</strong><span>{editing.time || "请分别选择小时与分钟"} · 目的地当地时间</span></div>
        <div className={styles.timeRow}><TimeWheel label="时" value={editing.hour} onChange={(hour) => updateTime("hour", hour)} max={HOURS} initialValue={9} disabled={disabled} onPendingChange={setPendingHour} /><span className={styles.colon} aria-hidden="true">:</span><TimeWheel label="分" value={editing.minute} onChange={(minute) => updateTime("minute", minute)} max={MINUTES} disabled={disabled} onPendingChange={setPendingMinute} /></div>
        <label className={styles.field} htmlFor={`${id}-activity`}><span>活动名称 <small>必填</small></span><input id={`${id}-activity`} value={editing.activity} disabled={disabled} autoComplete="off" placeholder="例如：参加线下活动" onChange={(event) => update({ activity: event.target.value })} /></label>
        <div className={styles.templates} aria-label="活动快捷填写">{TEMPLATES.map((template) => <button type="button" key={template} disabled={disabled} onClick={() => update({ activity: template })}>{template}</button>)}</div>
        <label className={styles.field} htmlFor={`${id}-location`}><span><Icon name="pin" size={15} /> 地点 <small>选填</small></span><input id={`${id}-location`} value={editing.location} disabled={disabled} autoComplete="off" placeholder="填写你实际预约的地点或地址" onChange={(event) => update({ location: event.target.value })} /></label>
        <div className={styles.segment} role="group" aria-label="预约可否调整">{[true, false].map((fixed) => <button type="button" key={String(fixed)} disabled={disabled} aria-pressed={editing.fixed === fixed} className={editing.fixed === fixed ? styles.segmentSelected : ""} onClick={() => update({ fixed })}><Icon name={fixed ? "lock" : "leaf"} size={15} />{fixed ? "固定安排" : "灵活调整"}</button>)}</div>
        <p className={styles.note}>{editing.fixed ? "生成行程时保留这项活动的日期、时间与名称。" : "保留这项活动偏好，时间可随行程节奏调整。"}</p>
        {editingError || nameError ? <p className={styles.error} role="alert">{editingError || nameError}</p> : null}
      </div>
    </Modal> : null}
  </section>;
}
