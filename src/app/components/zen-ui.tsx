"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import Image from "next/image";
import styles from "./zen-dashboard.module.css";

export type IconName = "sun" | "moon" | "leaf" | "compass" | "person" | "tune" | "pin" | "arrow" | "back" | "close" | "check" | "lock" | "clock" | "heart" | "pulse" | "walk" | "train" | "cup" | "wind" | "calendar" | "sync" | "shield" | "plus" | "food" | "bed" | "forest" | "pause" | "play" | "share" | "trash" | "edit";
const paths: Record<IconName, ReactNode> = {
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>,
  moon: <path d="M20.8 13.3A9 9 0 0 1 10.7 3.2 9 9 0 1 0 20.8 13.3Z" />,
  leaf: <><path d="M12 21C5 20 2 15 3 9c5 0 8 3 9 6 1-3 4-6 9-6 1 6-2 11-9 12Z" /><path d="M12 21V9c-3-2-3-5 0-7 3 2 3 5 0 7" /></>,
  compass: <><circle cx="12" cy="12" r="9" /><path d="m16 8-2.5 5.5L8 16l2.5-5.5L16 8Z" /></>,
  person: <><circle cx="12" cy="7" r="3" /><path d="M5 21v-3c0-4 14-4 14 0v3H5Z" /></>,
  tune: <><path d="M3 6h18M3 12h18M3 18h18M8 3v6m8 0v6m-8 0v6" /></>,
  pin: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2" /></>,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />, back: <path d="M20 12H4m6-6-6 6 6 6" />, close: <path d="m6 6 12 12M18 6 6 18" />,
  check: <path d="m5 12 4 4L19 6" />, lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 5v2" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 6v6l4 3" /></>,
  heart: <path d="m12 21-8-8C-2 7 7 0 12 7c5-7 14 0 8 6l-8 8Z" />,
  pulse: <path d="M2 12h5l3-8 4 16 3-8h5" />,
  walk: <><circle cx="13" cy="3" r="1.7" /><path d="m9 20 3-7m0 0-1-6 5 3 3 1M5 12l5-5m2 6 5 7" /></>,
  train: <><rect x="5" y="2" width="14" height="17" rx="4" /><path d="M5 10h14m-7-7v7M8 15h.01M16 15h.01M8 19l-2 3m10-3 2 3" /></>,
  cup: <><path d="M4 6h13v8a6.5 6.5 0 0 1-13 0V6Zm13 1h2a3 3 0 0 1 0 6h-2M2 22h17" /></>,
  wind: <path d="M3 8h12a3 3 0 1 0-3-3M2 12h17a3 3 0 1 1-3 3M3 16h6a3 3 0 1 1-3 3" />,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 2v6m10-6v6M3 11h18m-14 4h2m3 0h2m3 0h2" /></>,
  sync: <><path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5" /></>,
  shield: <><path d="m12 2 8 3v6c0 5-8 11-8 11S4 16 4 11V5l8-3Z" /><path d="m8 11 3 3 5-6" /></>,
  plus: <path d="M12 4v16M4 12h16" />, food: <><path d="M4 2v7h6V2M7 2v20M18 2c-4 4-4 10 0 10h2V2h-2Zm0 10v10" /></>,
  bed: <><path d="M3 4v17m18-9v9M3 17h18M4 8h5v5H4V8Zm5 5V7h8a4 4 0 0 1 4 4v6" /></>,
  forest: <><path d="m7 2-5 8h3l-4 7h12l-4-7h3L7 2Zm0 15v5m10-20-4 7h3l-3 6h9l-4-6h3l-4-7Zm0 13v7" /></>,
  pause: <><path d="M7 4h3v16H7V4Zm7 0h3v16h-3V4Z" /></>, play: <path d="m7 3 14 9-14 9V3Z" />,
  share: <><circle cx="18" cy="4" r="3" /><circle cx="5" cy="12" r="3" /><circle cx="18" cy="20" r="3" /><path d="m8 10 7-4m-7 8 7 4" /></>,
  trash: <><path d="M3 6h18M8 6V3h8v3M5 6l1 15h12l1-15M10 10v7m4-7v7" /></>,
  edit: <><path d="m4 16 12-12 4 4L8 20H4v-4Zm9-9 4 4" /></>,
};
export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
export function Badge({ children, tone = "green" }: { children: ReactNode; tone?: "green" | "mint" | "muted" | "rose" }) {
  return <span className={`${styles.badge} ${styles[tone]}`}>{children}</span>;
}
export function Gauge({ value, label = "恢复" }: { value: number | null | undefined; label?: string }) {
  const score = typeof value === "number" && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null;
  return <div className={styles.gauge} aria-label={score === null ? `${label}暂无数据` : `${label}${score}%`}><svg viewBox="0 0 72 72"><circle cx="36" cy="36" r="30" fill="none" stroke="#e1e8fd" strokeWidth="5" /><circle cx="36" cy="36" r="30" fill="none" stroke="#006948" strokeWidth="5" strokeLinecap="round" strokeDasharray="188.5" strokeDashoffset={188.5 * (1 - (score ?? 0) / 100)} /></svg><div><strong>{score === null ? "—" : Math.round(score)}{score === null ? null : <small>%</small>}</strong><span>{label}</span></div></div>;
}
export function Ambience({ image = "forest", title, label }: { image?: "forest" | "retreat" | "tea" | "sleep"; title?: string; label?: string }) {
  return <div className={styles.ambience}><Image src={`/zen/${image}.jpg`} alt="静谧庭院的旅行氛围图" fill sizes="(max-width: 600px) 100vw, 600px" /><div>{label ? <span>{label}</span> : null}{title ? <strong>{title}</strong> : null}</div></div>;
}
export function Modal({ title, children, onClose, busy = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
      if (event.key !== "Tab") return;
      const nodes = ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]');
      if (!nodes?.length) { event.preventDefault(); return; }
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", listener);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener("keydown", listener); previous?.focus(); };
  }, [busy, onClose]);
  return <div className={styles.modalBackdrop} onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}><div className={styles.modal} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}><div className={styles.sectionHead}><h2>{title}</h2><button className={styles.iconButton} aria-label="关闭" disabled={busy} onClick={onClose}><Icon name="close" /></button></div>{children}</div></div>;
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
    <section className={styles.card}><div className={styles.sectionHead}><h3>感官辅助</h3><small>按你的喜好</small></div><div className={styles.twoColumns}><button className={`${styles.option} ${sound ? styles.selected : ""}`} aria-pressed={sound} onClick={() => void toggleSound()}><Icon name="wind" /><strong>轻柔背景音</strong><small>{sound ? "已开启 · 点击关闭" : "点击开启"}</small></button><button className={`${styles.option} ${haptic ? styles.selected : ""}`} aria-pressed={haptic} onClick={() => setHaptic(!haptic)}><Icon name="pulse" /><strong>节奏触感</strong><small>{haptic ? "已开启 · 支持振动的设备生效" : "每轮开始时轻轻振动"}</small></button></div></section>
    {!complete ? <button className={styles.secondaryButton} onClick={() => setRunning(!running)}><Icon name={running ? "pause" : "play"} />{running ? "暂停练习" : "继续练习"}</button> : null}
    <button className={styles.primaryButton} onClick={() => onComplete(complete)}><Icon name="check" />{complete ? "完成并返回今日行程" : "结束并返回今日行程"}</button>
  </div>;
}
