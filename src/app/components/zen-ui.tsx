"use client";

import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import Image from "next/image";
import { Sun, Moon, Leaf, Compass, UserRound, SlidersHorizontal, MapPin, ArrowRight, ArrowLeft, X, Check, LockKeyhole, Clock3, Heart, Activity, Footprints, TrainFront, Coffee, Wind, CalendarDays, RefreshCw, ShieldCheck, Plus, Utensils, BedDouble, Trees, Pause, Play, Share2, Trash2, Pencil, MessageCircle, BookOpen, History } from "lucide-react";
import { beginSheetDrag, moveSheetDrag, shouldDismissSheet, type SheetDrag } from "./planner/sheet-gesture";
import { COURTYARD_ASSET } from "@/lib/visual-assets";
import { ToggleSwitch } from "./toggle-switch";
import styles from "./zen-dashboard.module.css";

export type IconName = "sun" | "moon" | "leaf" | "compass" | "person" | "tune" | "pin" | "arrow" | "back" | "close" | "check" | "lock" | "clock" | "heart" | "pulse" | "walk" | "train" | "cup" | "wind" | "calendar" | "sync" | "shield" | "plus" | "food" | "bed" | "forest" | "pause" | "play" | "share" | "trash" | "edit" | "chat" | "memory" | "history";
const iconComponents = { sun:Sun, moon:Moon, leaf:Leaf, compass:Compass, person:UserRound, tune:SlidersHorizontal, pin:MapPin, arrow:ArrowRight, back:ArrowLeft, close:X, check:Check, lock:LockKeyhole, clock:Clock3, heart:Heart, pulse:Activity, walk:Footprints, train:TrainFront, cup:Coffee, wind:Wind, calendar:CalendarDays, sync:RefreshCw, shield:ShieldCheck, plus:Plus, food:Utensils, bed:BedDouble, forest:Trees, pause:Pause, play:Play, share:Share2, trash:Trash2, edit:Pencil, chat:MessageCircle, memory:BookOpen, history:History };
export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const Component = iconComponents[name];
  return <Component size={size} strokeWidth={1.65} aria-hidden="true" />;
}
export function Badge({ children, tone = "green" }: { children: ReactNode; tone?: "green" | "mint" | "muted" | "rose" }) {
  return <span className={`${styles.badge} ${styles[tone]}`}>{children}</span>;
}
export function Gauge({ value, label = "恢复" }: { value: number | null | undefined; label?: string }) {
  const score = typeof value === "number" && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null;
  return <div className={styles.gauge} aria-label={score === null ? `${label}暂无数据` : `${label}${score}%`}><svg viewBox="0 0 72 72"><circle cx="36" cy="36" r="30" fill="none" stroke="#e1e8fd" strokeWidth="5" /><circle cx="36" cy="36" r="30" fill="none" stroke="#006948" strokeWidth="5" strokeLinecap="round" strokeDasharray="188.5" strokeDashoffset={188.5 * (1 - (score ?? 0) / 100)} /></svg><div><strong>{score === null ? "—" : Math.round(score)}{score === null ? null : <small>%</small>}</strong><span>{label}</span></div></div>;
}
export function Ambience({ image = "forest", title, label }: { image?: "forest" | "retreat" | "tea" | "sleep"; title?: string; label?: string }) {
  const key = image === "retreat" ? "courtyard" : image === "sleep" ? "rest" : image;
  const alt = key === "courtyard" ? COURTYARD_ASSET.alt : key === "forest" ? "晨光下的自然步道，生成的旅行氛围图" : key === "tea" ? "窗边的一杯茶与木桌，生成的旅行氛围图" : "窗边的休息角落，生成的旅行氛围图";
  return <div className={styles.ambience}><Image src={`/ambience/${key}-1280.webp`} alt={alt} fill sizes="(max-width: 600px) 100vw, 600px" /><div>{label ? <span>{label}</span> : null}{title ? <strong>{title}</strong> : null}</div></div>;
}
export type ModalProps = { title: string; children: ReactNode; onClose: () => void; busy?: boolean; footer?: ReactNode; className?: string; bodyClassName?: string; expanded?: boolean; onExpandedChange?: (expanded: boolean) => void; hideCloseButton?: boolean };

const activeSheetHistory = new Set<string>();
let sheetNavigationInProgress = false;
let sheetNavigationPromise: Promise<void> | null = null;
function popSheetHistoryEntry(): Promise<void> {
  if (sheetNavigationPromise) return sheetNavigationPromise;
  sheetNavigationInProgress = true;
  sheetNavigationPromise = new Promise<void>(resolve => {
    window.addEventListener("popstate", () => resolve(), { once: true, capture: true });
    window.history.back();
  }).finally(() => { sheetNavigationInProgress = false; sheetNavigationPromise = null; });
  return sheetNavigationPromise;
}
/** Finish sheet history removal before an async account save can open another page. */
export async function dismissSheetsBeforeNavigation(): Promise<void> {
  if (sheetNavigationPromise) await sheetNavigationPromise;
  while (window.history.state?.biotripSheet) await popSheetHistoryEntry();
}

export function Modal({ title, children, onClose, busy = false, footer, className = "", bodyClassName = "", expanded, onExpandedChange, hideCloseButton = false }: ModalProps) {
  const historyToken = useId();
  const ref = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const drag = useRef<SheetDrag | null>(null);
  const hasFooter = footer !== undefined && footer !== null && footer !== false;
  const closeFromKeyboard = useEffectEvent(() => { if (!busy) onClose(); });
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const currentHistory = window.history.state;
    if (!currentHistory?.biotripSheet && currentHistory?.biotripNavigation) {
      currentHistory.biotripNavigation = { ...currentHistory.biotripNavigation, top: window.scrollY };
      window.history.replaceState(currentHistory, "");
    }
    const historyEntry = { ...currentHistory, biotripSheet: historyToken };
    const previousToken = currentHistory?.biotripSheet as string | undefined;
    const replaceClosedSheet = previousToken && !activeSheetHistory.has(previousToken);
    activeSheetHistory.add(historyToken);
    if (previousToken !== historyToken) window.history[replaceClosedSheet ? "replaceState" : "pushState"](historyEntry, "");
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const body = document.body, root = document.documentElement;
    const scrollX = window.scrollX, scrollY = window.scrollY;
    const previousBody = { overflow: body.style.overflow, position: body.style.position, top: body.style.top, left: body.style.left, width: body.style.width, paddingRight: body.style.paddingRight };
    const previousRootOverflow = root.style.overflow;
    const scrollbar = Math.max(0, window.innerWidth - root.clientWidth);
    body.style.overflow = "hidden"; body.style.position = "fixed";
    body.style.top = `${-scrollY}px`; body.style.left = `${-scrollX}px`; body.style.width = "100%";
    if (scrollbar) body.style.paddingRight = `${(Number.parseFloat(window.getComputedStyle(body).paddingRight) || 0) + scrollbar}px`;
    root.style.overflow = "hidden";
    dialog.focus({ preventScroll: true });
    const nodes = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')).filter((node) => node.getClientRects().length > 0 && !node.closest("[inert]"));
    const isTopDialog = () => Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')).filter((node) => node.getClientRects().length > 0 && !node.closest("[inert]")).at(-1) === dialog;
    const listener = (event: KeyboardEvent) => {
      if (!isTopDialog() || event.defaultPrevented) return;
      if (event.key === "Escape") { event.preventDefault(); closeFromKeyboard(); return; }
      if (event.key !== "Tab") return;
      const list = nodes(), first = list[0], last = list.at(-1);
      if (!first || !last) { event.preventDefault(); dialog.focus(); return; }
      const current = document.activeElement;
      if (event.shiftKey && (current === first || current === dialog || !dialog.contains(current))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (current === last || !dialog.contains(current))) { event.preventDefault(); first.focus(); }
    };
    const popstate = (event: PopStateEvent) => {
      // Returning from a nested sheet leaves this sheet open.
      if (sheetNavigationInProgress || !isTopDialog() || event.state?.biotripSheet === historyToken) return;
      event.stopImmediatePropagation();
      closeFromKeyboard();
      // Unsaved-change or busy guards may keep the sheet mounted.
      window.setTimeout(() => {
        if (dialog.isConnected && activeSheetHistory.has(historyToken)) window.history.pushState(historyEntry, "");
      }, 0);
    };
    window.addEventListener("popstate", popstate, true);
    const focusin = (event: FocusEvent) => {
      if (isTopDialog() && event.target instanceof Node && !dialog.contains(event.target)) (nodes()[0] ?? dialog).focus({ preventScroll: true });
    };
    document.addEventListener("keydown", listener);
    document.addEventListener("focusin", focusin);
    return () => {
      activeSheetHistory.delete(historyToken);
      window.removeEventListener("popstate", popstate, true);
      window.setTimeout(() => {
        if (!sheetNavigationInProgress && !activeSheetHistory.has(historyToken) && window.history.state?.biotripSheet === historyToken) void popSheetHistoryEntry();
      }, 0);
      document.removeEventListener("keydown", listener); document.removeEventListener("focusin", focusin);
      Object.assign(body.style, previousBody); root.style.overflow = previousRootOverflow;
      const oldBehavior = root.style.scrollBehavior; root.style.scrollBehavior = "auto";
      window.scrollTo(scrollX, scrollY); root.style.scrollBehavior = oldBehavior;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [historyToken]);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    let frame = 0;
    const update = () => {
      backdrop.current?.style.setProperty("--modal-viewport-height", `${viewport.height}px`);
      backdrop.current?.style.setProperty("--modal-viewport-top", `${viewport.offsetTop}px`);
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const active = document.activeElement, scroller = bodyRef.current;
        if (!(active instanceof HTMLElement) || !scroller?.contains(active)) return;
        const area = scroller.getBoundingClientRect(), field = active.getBoundingClientRect();
        if (field.bottom > area.bottom - 16) scroller.scrollTop += field.bottom - area.bottom + 16;
        else if (field.top < area.top + 16) scroller.scrollTop += field.top - area.top - 16;
      });
    };
    update(); viewport.addEventListener("resize", update); viewport.addEventListener("scroll", update);
    return () => { viewport.removeEventListener("resize", update); viewport.removeEventListener("scroll", update); window.cancelAnimationFrame(frame); };
  }, []);
  useEffect(() => {
    if (!busy) return;
    drag.current = null;
    ref.current?.style.setProperty("--modal-offset", "0px");
    if (ref.current) delete ref.current.dataset.dragging;
  }, [busy]);
  function resetDrag() {
    drag.current = null;
    ref.current?.style.setProperty("--modal-offset", "0px");
    if (ref.current) delete ref.current.dataset.dragging;
  }
  function startDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (busy || !event.isPrimary || event.button !== 0 || (!onExpandedChange && !window.matchMedia("(max-width: 699px)").matches)) return;
    drag.current = beginSheetDrag(event.pointerId, event.clientX, event.clientY, event.timeStamp);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (ref.current) ref.current.dataset.dragging = "true";
  }
  function moveDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (busy) { resetDrag(); return; }
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = moveSheetDrag(drag.current, event.clientX, event.clientY, event.timeStamp);
    ref.current?.style.setProperty("--modal-offset", `${drag.current.offset}px`);
  }
  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    const delta = event.clientY - drag.current.startY;
    const final = moveSheetDrag(drag.current, event.clientX, event.clientY, event.timeStamp);
    const dismiss = !busy && shouldDismissSheet(final, ref.current?.getBoundingClientRect().height ?? 0);
    resetDrag();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (onExpandedChange && !final.horizontal && delta < -48) onExpandedChange(true);
    else if (onExpandedChange && expanded && dismiss) onExpandedChange(false);
    else if (dismiss) onClose();
  }
  return <div className={styles.modalBackdrop} ref={backdrop} onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className={`${styles.modal} ${hasFooter ? styles.modalWithFooter : ""} ${className}`} role="dialog" aria-modal="true" aria-label={title} aria-busy={busy} tabIndex={-1} ref={ref}>
      <div className={`${styles.modalHandle} ${onExpandedChange ? styles.modalInteractiveHandle : ""}`} aria-hidden={onExpandedChange ? undefined : true} role={onExpandedChange ? "separator" : undefined} tabIndex={onExpandedChange ? 0 : undefined} aria-label={onExpandedChange ? "调整助手面板" : undefined} aria-orientation={onExpandedChange ? "horizontal" : undefined} aria-valuenow={onExpandedChange ? (expanded ? 100 : 64) : undefined} onKeyDown={event => { if (!onExpandedChange || busy) return; if (event.key === "ArrowUp") { event.preventDefault(); onExpandedChange(true); } else if (event.key === "ArrowDown") { event.preventDefault(); if (expanded) onExpandedChange(false); else onClose(); } }} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={resetDrag} onLostPointerCapture={resetDrag}><span /></div>
      <div className={styles.modalHeader}><h2>{title}</h2>{!hideCloseButton && <button type="button" className={styles.iconButton} aria-label="关闭" disabled={busy} onClick={() => { if (!busy) onClose(); }}><Icon name="close" /></button>}</div>
      <div className={`${styles.modalBody} ${bodyClassName}`} ref={bodyRef}>{children}</div>
      {hasFooter ? <div className={styles.modalFooter}>{footer}</div> : null}
    </div>
  </div>;
}
export function BreathingSession({ restingHeartRate, onComplete }: { restingHeartRate: number | null | undefined; onComplete: (completed: boolean) => void }) {
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(true);
  const [sound, setSound] = useState(false);
  const [haptic, setHaptic] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  const oscillator = useRef<OscillatorNode | null>(null);
  const startTime = useRef(0);
  const startingElapsed = useRef(0);
  const inhale = elapsed % 10 < 4;
  const seconds = inhale ? 4 - elapsed % 10 : 10 - elapsed % 10;
  useEffect(() => {
    if (!running || elapsed >= 180) return;
    startTime.current = Date.now(); startingElapsed.current = elapsed;
    const timer = window.setInterval(() => {
      const value = Math.min(180, startingElapsed.current + Math.floor((Date.now() - startTime.current) / 1000));
      setElapsed(value);
      if (value === 180) setRunning(false);
    }, 250);
    return () => window.clearInterval(timer);
    // Resume from the last displayed second; the wall clock prevents background timer drift.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);
  useEffect(() => {
    if (haptic && running && elapsed % 10 === 0 && "vibrate" in navigator) navigator.vibrate(60);
  }, [elapsed, haptic, running]);
  useEffect(() => () => { oscillator.current?.stop(); void audio.current?.close(); }, []);
  async function toggleSound() {
    if (sound) { oscillator.current?.stop(); oscillator.current = null; setSound(false); return; }
    try {
      const context = audio.current ?? new AudioContext(); audio.current = context;
      await context.resume();
      const tone = context.createOscillator(), gain = context.createGain();
      tone.frequency.value = 432; tone.type = "sine"; gain.gain.value = 0.015;
      tone.connect(gain); gain.connect(context.destination); tone.start(); oscillator.current = tone; setSound(true);
    } catch { setSound(false); }
  }
  const complete = elapsed >= 180;
  return <div className={styles.stack}>
    <div className={styles.syncBar}><span><i />{complete ? "练习已完成" : running ? "呼吸练习进行中" : "练习已暂停"}</span><Badge tone="muted"><Icon name="leaf" size={15} />舒缓节奏</Badge></div>
    <section className={`${styles.card} ${styles.breathCard}`}><div className={styles.sectionHead}><span>均匀呼吸</span><span className={styles.greenText}>第 {Math.min(18, Math.floor(elapsed / 10) + 1)} / 18 轮</span></div><div className={`${styles.breathOrbit} ${inhale && running ? styles.inhale : ""}`}><div className={styles.breathCircle}><strong>{complete ? "完成" : !running ? "暂停" : inhale ? "吸气" : "呼气"}</strong><b>{complete ? "✓" : seconds}</b><span>{complete ? "回到自己的节奏" : inhale ? "轻轻吸入" : "缓缓呼出"}</span></div></div><div className={styles.inset}><Icon name="heart" /><div><small>最近静息心率</small><strong>{restingHeartRate ?? "—"} <small>次 / 分</small></strong></div><span className={styles.mutedText}>WHOOP 历史测量<br />本次未测实时心率</span></div></section>
    <section className={styles.card}><div className={styles.sectionHead}><h3>旅途中的 3 分钟</h3><Icon name="wind" /></div><p>找一个舒服的坐姿，跟随圆环轻轻吸气 4 秒、呼气 6 秒。保持自然，不必用力；需要时随时暂停。</p><div className={styles.sectionHead}><small>练习进度</small><strong>{String(Math.floor(elapsed / 60)).padStart(2, "0")}:{String(elapsed % 60).padStart(2, "0")} / 03:00</strong></div><div className={styles.progress}><i style={{ width: `${elapsed / 1.8}%` }} /></div></section>
    <section className={styles.card}><div className={styles.sectionHead}><h3>感官辅助</h3><small>按你的喜好</small></div><div className={styles.twoColumns}><label className={styles.sensorySwitch}><span><strong>轻柔背景音</strong><small>轻柔的持续背景音</small></span><ToggleSwitch label="轻柔背景音" checked={sound} onChange={() => void toggleSound()} /></label><label className={styles.sensorySwitch}><span><strong>节奏触感</strong><small>每轮开始时轻轻振动</small></span><ToggleSwitch label="节奏触感" checked={haptic} onChange={setHaptic} /></label></div></section>
    {!complete ? <button className={styles.secondaryButton} onClick={() => setRunning(!running)}><Icon name={running ? "pause" : "play"} />{running ? "暂停练习" : "继续练习"}</button> : null}
    <button className={styles.primaryButton} onClick={() => onComplete(complete)}><Icon name="check" />{complete ? "完成并返回" : "结束并返回"}</button>
  </div>;
}
