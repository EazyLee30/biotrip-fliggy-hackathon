"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Journey } from "@/lib/journey-types";
import { applyItineraryOperations, itineraryDates, MAX_ITINERARY_OPERATIONS, type ItineraryItem, type ItineraryOperation } from "@/lib/itinerary-edit";
import { Icon, Modal } from "../zen-ui";
import { TimeWheel } from "./reservation-editor";
import { activateItineraryDrag, beginItineraryDrag, ITINERARY_HOLD_MS, itineraryDropTarget, itineraryEdgeVelocity, moveItineraryDrag, type ItineraryDrag } from "./itinerary-drag";
import styles from "./itinerary-editor.module.css";

export type ItineraryEditorProps = {
  journey: Journey;
  onSave: (operations: ItineraryOperation[]) => Promise<void>;
  onClose: () => void;
  busy?: boolean;
  initialDate?: string;
  initialIndex?: number;
};
type Editing = ItineraryItem & { index: number; date: string; hour: number | null; minute: number | null };
type DragSession = { gesture: ItineraryDrag; index: number; target: number; card: HTMLElement; handle: HTMLButtonElement; scrollStart: number; frameAt: number };

function labelDate(date: string) { return `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日`; }
function weekday(date: string) { return new Intl.DateTimeFormat("zh-CN", { timeZone: "UTC", weekday: "short" }).format(new Date(`${date}T12:00:00Z`)); }
function editItem(item: ItineraryItem, index: number, date: string): Editing {
  const [hour, minute] = item.time.split(":").map(Number);
  return { ...item, index, date, hour: Number.isFinite(hour) ? hour : null, minute: Number.isFinite(minute) ? minute : null };
}
function initialCopy(journey: Journey) {
  const source = journey.plan?.plan.itinerary ?? [];
  try {
    const dates = itineraryDates(source, journey.draft.trip ?? {});
    return { items: source.map((item) => ({ ...item, date: item.date ?? dates[0] })), dates, error: "", id: journey.id, version: journey.version };
  } catch (error) {
    return { items: source.map((item) => ({ ...item })), dates: [] as string[], error: error instanceof Error ? error.message : "这份行程暂时无法调整。", id: journey.id, version: journey.version };
  }
}

/** All edits stay in a local copy until the explicit account save succeeds. */
export function ItineraryEditor({ journey, onSave, onClose, busy = false, initialDate, initialIndex }: ItineraryEditorProps) {
  const [initial] = useState(() => initialCopy(journey));
  const [items, setItems] = useState<ItineraryItem[]>(initial.items);
  const [operations, setOperations] = useState<ItineraryOperation[]>([]);
  const history = useRef<ItineraryItem[][]>([]);
  const [removing, setRemoving] = useState<number | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => initialIndex !== undefined && initial.items[initialIndex] ? initial.items[initialIndex].date ?? initial.dates[0] : initialDate && initial.dates.includes(initialDate) ? initialDate : initial.dates[0] ?? "");
  const [editing, setEditing] = useState<Editing | null>(() => initialIndex !== undefined && initial.items[initialIndex] && !initial.error ? editItem(initial.items[initialIndex], initialIndex, initial.items[initialIndex].date ?? initial.dates[0]) : null);
  const [error, setError] = useState(initial.error);
  const [announcement, setAnnouncement] = useState("");
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingHour, setPendingHour] = useState(false);
  const [pendingMinute, setPendingMinute] = useState(false);
  const [dragPreview, setDragPreview] = useState<{ index: number; target: number } | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const drag = useRef<DragSession | null>(null);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frame = useRef(0);
  const datesRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const disabled = busy || saving;
  const stale = initial.id !== journey.id || initial.version !== journey.version;
  const rows = items.map((item, index) => ({ item, index })).filter(({ item }) => (item.date ?? initial.dates[0]) === selectedDate);
  const flexible = rows.filter(({ item }) => !item.fixed);
  const canChange = !disabled && !initial.error && !stale && operations.length < MAX_ITINERARY_OPERATIONS;

  useEffect(() => () => {
    if (hold.current) clearTimeout(hold.current);
    window.cancelAnimationFrame(frame.current);
  }, []);

  function stopDrag() {
    const current = drag.current;
    drag.current = null;
    if (hold.current) clearTimeout(hold.current);
    hold.current = null;
    window.cancelAnimationFrame(frame.current);
    if (current) {
      delete current.card.dataset.dragging; delete current.card.dataset.pending;
      current.card.style.removeProperty("--drag-offset");
      if (current.handle.hasPointerCapture(current.gesture.pointerId)) current.handle.releasePointerCapture(current.gesture.pointerId);
    }
    setDragPreview(null);
  }
  function apply(operation: ItineraryOperation): boolean {
    if (!canChange) return false;
    try {
      const identified: ItineraryOperation = operation.type === "add"
        ? { ...operation, id: operation.id ?? crypto.randomUUID() }
        : { ...operation, activityId: items[operation.index]?.id, ...(operation.type === "move" ? { toActivityId: items[operation.toIndex]?.id } : {}) };
      const result = applyItineraryOperations(items, [identified], journey.draft.trip ?? {});
      history.current.push(items.map((item) => ({ ...item })));
      setItems(result.itinerary); setOperations((current) => [...current, identified]); setError("");
      return true;
    } catch (caught) { setError(caught instanceof Error ? caught.message : "这项修改暂时无法应用。原有副本仍保留。"); return false; }
  }
  function undo() {
    if (disabled || stale || drag.current) return;
    const previous = history.current.pop();
    if (!previous) return;
    setItems(previous); setOperations((current) => current.slice(0, -1));
    setRemoving(null); setError(""); setAnnouncement("已撤销上一步修改。");
  }
  function remove() {
    if (removing === null || !items[removing] || !canChange) return;
    const item = items[removing];
    if (apply({ type: "remove", index: removing, ...(item.fixed ? { confirmFixed: true } : {}) })) {
      setRemoving(null); setEditing(null); setAnnouncement(`已从副本移除「${item.name}」，可以撤销。`);
    }
  }
  function nudge(index: number, direction: -1 | 1) {
    const at = flexible.findIndex((row) => row.index === index), target = flexible[at + direction];
    if (!target || drag.current) return;
    if (apply({ type: "move", index, toIndex: target.index })) setAnnouncement(`已${direction < 0 ? "上移" : "下移"}「${items[index].name}」，固定预约的时间保持不变。`);
  }
  function updateVisual() {
    const current = drag.current, scroller = list.current;
    if (!current || current.gesture.phase !== "dragging" || !scroller) return;
    current.card.style.setProperty("--drag-offset", `${current.gesture.y - current.gesture.startY + scroller.scrollTop - current.scrollStart}px`);
    const centers = Array.from(scroller.querySelectorAll<HTMLElement>("li[data-flexible='true']")).map((node) => {
      const bounds = node.getBoundingClientRect();
      return { index: Number(node.dataset.itineraryIndex), center: bounds.top + bounds.height / 2 };
    });
    const target = itineraryDropTarget(current.gesture.y, centers);
    if (target >= 0 && target !== current.target) {
      current.target = target;
      setDragPreview({ index: current.index, target });
    }
  }
  function scrollFrame(at: number) {
    const current = drag.current, scroller = list.current;
    if (!current || current.gesture.phase !== "dragging" || !scroller) return;
    const bounds = scroller.getBoundingClientRect(), elapsed = current.frameAt ? Math.min(32, at - current.frameAt) : 16;
    current.frameAt = at;
    const speed = itineraryEdgeVelocity(current.gesture.y, bounds.top, bounds.bottom);
    if (speed) { scroller.scrollTop += speed * elapsed; updateVisual(); }
    frame.current = window.requestAnimationFrame(scrollFrame);
  }
  function activate() {
    const current = drag.current;
    if (!current || current.gesture.phase !== "dragging") return;
    delete current.card.dataset.pending; current.card.dataset.dragging = "true";
    setDragPreview({ index: current.index, target: current.target });
    setAnnouncement(`正在移动「${items[current.index].name}」。松开后应用到副本。`);
    if ("vibrate" in navigator) navigator.vibrate(15);
    frame.current = window.requestAnimationFrame(scrollFrame);
  }
  function pointerDown(event: ReactPointerEvent<HTMLButtonElement>, index: number) {
    if (!canChange || !event.isPrimary || event.button !== 0 || items[index].fixed || flexible.length < 2 || drag.current) return;
    const card = event.currentTarget.closest("li")?.querySelector<HTMLElement>("[data-row-card]");
    if (!card || !list.current) return;
    const touch = event.pointerType !== "mouse";
    drag.current = { gesture: beginItineraryDrag(event.pointerId, event.clientX, event.clientY, event.timeStamp, touch), index, target: index, card, handle: event.currentTarget, scrollStart: list.current.scrollTop, frameAt: 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (!touch) { activate(); return; }
    card.dataset.pending = "true";
    hold.current = setTimeout(() => {
      const current = drag.current;
      if (!current) return;
      current.gesture = activateItineraryDrag(current.gesture, current.gesture.startedAt + ITINERARY_HOLD_MS);
      activate();
    }, ITINERARY_HOLD_MS);
  }
  function pointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || current.gesture.pointerId !== event.pointerId) return;
    if (!canChange) { stopDrag(); return; }
    const previousY = current.gesture.y;
    current.gesture = moveItineraryDrag(current.gesture, event.clientX, event.clientY);
    if (current.gesture.phase === "cancelled") {
      if (hold.current) clearTimeout(hold.current);
      delete current.card.dataset.pending;
      if (list.current) list.current.scrollTop -= event.clientY - previousY;
      return;
    }
    if (current.gesture.phase === "dragging") updateVisual();
  }
  function pointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || current.gesture.pointerId !== event.pointerId) return;
    current.gesture = moveItineraryDrag(current.gesture, event.clientX, event.clientY);
    if (current.gesture.phase === "dragging") updateVisual();
    const move = current.gesture.phase === "dragging" && current.index !== current.target && canChange;
    const from = current.index, to = current.target;
    stopDrag();
    if (move && apply({ type: "move", index: from, toIndex: to })) setAnnouncement(`已移动「${items[from].name}」，新的顺序留在本地副本。`);
  }
  function openEdit(index: number) {
    if (!canChange || drag.current) return;
    setRemoving(null);
    setEditing(editItem(items[index], index, items[index].date ?? initial.dates[0]));
    setPendingHour(false); setPendingMinute(false); setError("");
  }
  function updateEdit(patch: Partial<Editing>) { setEditing((current) => current ? { ...current, ...patch } : current); setError(""); }
  function confirmEdit() {
    if (!editing || !canChange || pendingHour || pendingMinute || removing !== null) return;
    if (editing.hour === null || editing.minute === null) { setError("请选择有效的小时和分钟。"); return; }
    const time = `${String(editing.hour).padStart(2, "0")}:${String(editing.minute).padStart(2, "0")}`;
    const original = items[editing.index];
    if (original.date === editing.date && original.time === time && original.name === editing.name.trim() && original.detail === editing.detail.trim() && original.fixed === editing.fixed) { setEditing(null); setError(""); return; }
    if (apply({ type: "edit", index: editing.index, date: editing.date, time, name: editing.name, detail: editing.detail, fixed: editing.fixed })) {
      setSelectedDate(editing.date); setEditing(null); setAnnouncement("活动修改已留在副本，保存行程后更新账户。");
    }
  }
  async function save() {
    if (disabled || stale || !operations.length || initial.error || drag.current || removing !== null) return;
    setSaving(true); setError("");
    try { await onSave(operations); onClose(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "保存失败，修改仍保留。请稍后重试。"); }
    finally { setSaving(false); }
  }
  function requestClose() {
    if (disabled) return;
    if (operations.length || editing) setLeaveOpen(true); else onClose();
  }
  async function saveAndLeave() {
    if (disabled || stale || initial.error || pendingHour || pendingMinute) return;
    let pending = operations;
    if (editing) {
      if (editing.hour === null || editing.minute === null) { setError("请选择有效的小时和分钟。"); setLeaveOpen(false); return; }
      const operation: ItineraryOperation = { type: "edit", index: editing.index, date: editing.date,
        time: `${String(editing.hour).padStart(2, "0")}:${String(editing.minute).padStart(2, "0")}`,
        name: editing.name, detail: editing.detail, fixed: editing.fixed };
      try { applyItineraryOperations(items, [operation], journey.draft.trip ?? {}); }
      catch (caught) { setError(caught instanceof Error ? caught.message : "修改无效，请继续编辑。"); setLeaveOpen(false); return; }
      pending = [...operations, operation];
    }
    if (!pending.length) { onClose(); return; }
    setSaving(true); setError("");
    try { await onSave(pending); onClose(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "保存失败，修改仍保留。"); setLeaveOpen(false); }
    finally { setSaving(false); }
  }
  function selectDate(date: string) {
    if (disabled || drag.current) return;
    setSelectedDate(date); list.current?.scrollTo({ top: 0 });
    datesRef.current?.querySelector<HTMLButtonElement>(`[data-date="${date}"]`)?.scrollIntoView({ block: "nearest", inline: "center", behavior: "auto" });
  }
  const footer = editing ? <div className={styles.actions}><button type="button" className={styles.secondary} disabled={disabled} onClick={() => { setEditing(null); setError(""); }}>取消这项编辑</button><button type="button" className={styles.primary} disabled={!canChange || pendingHour || pendingMinute} onClick={confirmEdit}>{pendingHour || pendingMinute ? "正在选择时间…" : "确认这项修改"}</button></div> : <div className={styles.actions}><button type="button" className={styles.secondary} disabled={disabled} onClick={requestClose}>取消</button><button type="button" className={styles.primary} disabled={disabled || stale || !operations.length || Boolean(initial.error) || Boolean(dragPreview)} onClick={() => void save()}>{saving ? "正在保存…" : "保存行程"}</button></div>;

  return <Modal hideCloseButton={!editing || leaveOpen} title={editing ? "修改活动" : "调整已生成行程"} onClose={requestClose} busy={disabled} footer={leaveOpen ? <div className={styles.actions}><button className={styles.primary} disabled={disabled || stale || pendingHour || pendingMinute} onClick={() => void saveAndLeave()}>保存并离开</button><button className={styles.secondary} disabled={disabled} onClick={() => setLeaveOpen(false)}>继续编辑</button><button className={styles.secondary} disabled={disabled} onClick={onClose}>放弃修改</button></div> : footer}>
    <div className={styles.editor}>
      {leaveOpen ? <p role="status" className={styles.note}>修改尚未保存，请选择如何离开。</p> : null}
      <p className={styles.note}>{editing ? "先修改这项活动，再保存整份行程。时间均为目的地当地时间。" : "长按把手后拖动同日灵活活动；固定预约不动，灵活活动沿用原有时间档位。"}</p>
      {stale ? <p className={styles.error} role="alert">行程已在其他操作中更新。请取消后重新打开；当前副本仍保留。</p> : null}
      {operations.length >= MAX_ITINERARY_OPERATIONS ? <p className={styles.note}>本次调整较多，请先保存后继续。</p> : null}
      {editing ? <div className={styles.form}>
        <div className={styles.fieldHead}><strong>活动日期</strong><span>{labelDate(editing.date)}</span></div>
        <div className={styles.dateStrip} role="group" aria-label="活动日期">{initial.dates.map((date) => <button type="button" key={date} className={`${styles.dateChip} ${editing.date === date ? styles.selectedDate : ""}`} aria-pressed={editing.date === date} disabled={disabled} onClick={() => updateEdit({ date })}><strong>{labelDate(date)}</strong><small>{weekday(date)}</small></button>)}</div>
        <div className={styles.fieldHead}><strong>时间</strong><span>小时与分钟均可单独选择</span></div>
        <div className={styles.timeRow}><TimeWheel label="时" value={editing.hour} max={23} onChange={(hour) => updateEdit({ hour })} disabled={disabled} onPendingChange={setPendingHour} /><span aria-hidden="true">:</span><TimeWheel label="分" value={editing.minute} max={59} onChange={(minute) => updateEdit({ minute })} disabled={disabled} onPendingChange={setPendingMinute} /></div>
        <label className={styles.field} htmlFor={`${id}-name`}><span>活动名称</span><input id={`${id}-name`} value={editing.name} maxLength={120} disabled={disabled} onChange={(event) => updateEdit({ name: event.target.value })} /></label>
        <label className={styles.field} htmlFor={`${id}-detail`}><span>活动说明与地点</span><textarea id={`${id}-detail`} rows={4} value={editing.detail} maxLength={1500} disabled={disabled} onChange={(event) => updateEdit({ detail: event.target.value })} /></label>
        <div className={styles.segment} role="group" aria-label="活动时间是否固定">{[true, false].map((fixed) => <button type="button" key={String(fixed)} aria-pressed={editing.fixed === fixed} disabled={disabled} className={editing.fixed === fixed ? styles.selectedFlag : ""} onClick={() => updateEdit({ fixed })}><Icon name={fixed ? "lock" : "leaf"} size={16} />{fixed ? "固定时间" : "灵活安排"}</button>)}</div>
        <p className={styles.note}>{editing.fixed ? "固定活动不能拖动。日期或时间只会在你明确修改并确认后改变。" : "灵活活动可以在同日时间档位之间排序。"}</p>
        <button type="button" className={styles.removeButton} disabled={!canChange} onClick={() => setRemoving(editing.index)}>从行程移除这项活动</button>
      </div> : <>
        <div className={styles.listHeading}><strong>{selectedDate ? `${labelDate(selectedDate)}的安排` : "暂无可编辑安排"}</strong><span>{rows.length} 项 · {operations.length ? "有未保存修改" : "尚未修改"}</span></div>
        {operations.length ? <button type="button" className={styles.undoButton} disabled={disabled || stale || Boolean(dragPreview)} onClick={undo}>↶ 撤销上一步</button> : null}
        <div className={styles.dateStrip} role="tablist" aria-label="行程日期" ref={datesRef} onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
          const at = initial.dates.indexOf(selectedDate);
          const next = event.key === "Home" ? 0 : event.key === "End" ? initial.dates.length - 1 : Math.max(0, Math.min(initial.dates.length - 1, at + (event.key === "ArrowRight" ? 1 : -1)));
          const date = initial.dates[next]; if (!date) return;
          event.preventDefault(); selectDate(date); datesRef.current?.querySelector<HTMLButtonElement>(`[data-date="${date}"]`)?.focus({ preventScroll: true });
        }}>{initial.dates.map((date) => <button type="button" role="tab" key={date} data-date={date} aria-selected={selectedDate === date} aria-controls={`${id}-list`} tabIndex={selectedDate === date ? 0 : -1} disabled={disabled || Boolean(dragPreview)} className={`${styles.dateChip} ${selectedDate === date ? styles.selectedDate : ""}`} onClick={() => selectDate(date)}><strong>{labelDate(date)}</strong><small>{weekday(date)}</small></button>)}</div>
        <ul className={styles.list} ref={list} id={`${id}-list`} aria-label={selectedDate ? `${labelDate(selectedDate)}的活动` : "行程活动"}>
          {rows.map(({ item, index }) => {
            const at = flexible.findIndex((row) => row.index === index);
            return <li key={item.id ?? index} data-itinerary-index={index} data-flexible={!item.fixed} className={`${styles.row} ${dragPreview?.target === index && dragPreview.index !== index ? styles.dropTarget : ""}`}>
              <div className={styles.rowCard} data-row-card>
                <button type="button" className={styles.itemEdit} disabled={!canChange || Boolean(dragPreview)} aria-label={`修改活动：${item.name}`} onClick={() => openEdit(index)}><span className={styles.itemTime}>{item.time}</span><span className={styles.itemCopy}><strong>{item.name}</strong><small>{item.detail}</small><span className={item.fixed ? styles.fixedBadge : styles.flexBadge}><Icon name={item.fixed ? "lock" : "leaf"} size={12} />{item.fixed ? "固定时间" : "灵活安排"}</span></span><Icon name="edit" size={15} /></button>
                <button type="button" className={styles.dragHandle} aria-label={item.fixed ? `${item.name}为固定活动，不能拖动` : `长按拖动活动：${item.name}`} title={item.fixed ? "固定活动请明确编辑时间" : "长按约半秒后拖动"} disabled={!canChange || item.fixed || flexible.length < 2} onPointerDown={(event) => pointerDown(event, index)} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={stopDrag} onLostPointerCapture={() => { if (drag.current) stopDrag(); }}>
                  {item.fixed ? <Icon name="lock" size={17} /> : <span aria-hidden="true">⠿</span>}
                </button>
                {!item.fixed ? <div className={styles.moveActions}><span>也可点选调整顺序</span><button type="button" aria-label={`上移活动：${item.name}`} disabled={!canChange || at <= 0 || Boolean(dragPreview)} onClick={() => nudge(index, -1)}>↑ 上移</button><button type="button" aria-label={`下移活动：${item.name}`} disabled={!canChange || at >= flexible.length - 1 || Boolean(dragPreview)} onClick={() => nudge(index, 1)}>↓ 下移</button></div> : null}
              </div>
              {dragPreview?.target === index && dragPreview.index !== index ? <span className={styles.targetLabel}>移到 {item.time} 的灵活时间档位</span> : null}
            </li>;
          })}
        </ul>
        <p className={styles.note}>修改只留在本地副本。点击“保存行程”后才会更新账户，取消不会写回。</p>
      </>}
      {removing !== null && items[removing] ? <div className={styles.removeConfirm} role="alert">
        <strong>移除「{items[removing].name}」？</strong>
        <p>{items[removing].fixed ? "这是固定预约。移除后，下次规划将不再保留它；供应商的订单与预约需要你另行处理。" : "只从这份行程中移除，保存前可以撤销。每天至少保留一项安排。"}</p>
        <div className={styles.actions}><button type="button" className={styles.secondary} disabled={disabled} onClick={() => setRemoving(null)}>保留活动</button><button type="button" className={styles.removeButton} disabled={!canChange} onClick={remove}>确认移除</button></div>
      </div> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <span className={styles.srOnly} role="status" aria-live="polite">{announcement}</span>
    </div>
  </Modal>;
}
