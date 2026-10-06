"use client";

import { useId, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { closestIndexAt } from "./sheet-gesture";
import { hasExactPhrase, toggleExactPhrase, uniquePhrases } from "./quick-inputs-values";
import styles from "./quick-inputs.module.css";

const SCORES = [1, 2, 3, 4, 5] as const;

export type QuickRatingProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  lowLabel?: string;
  highLabel?: string;
  disabled?: boolean;
};

/** Empty string stays unanswered; only an explicit interaction selects a score. */
export function QuickRating({ label, value, onChange, lowLabel = "较低", highLabel = "较高", disabled = false }: QuickRatingProps) {
  const labelId = useId(), hintId = useId();
  const row = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ id: number; startX: number; startY: number; active: boolean; vertical: boolean; value: string } | null>(null);
  const suppressClick = useRef(false);
  const selected = /^[1-5]$/.test(value) ? Number(value) : null;

  function pickAt(x: number) {
    const buttons = Array.from(row.current?.querySelectorAll<HTMLButtonElement>("button[data-score]") ?? []);
    const index = closestIndexAt(x, buttons.map((button) => { const bounds = button.getBoundingClientRect(); return bounds.left + bounds.width / 2; }));
    const score = SCORES[index];
    if (score === undefined || disabled) return;
    const next = String(score);
    if (!pointer.current || pointer.current.value !== next) {
      if (pointer.current) pointer.current.value = next;
      onChange(next);
    }
    buttons[index]?.focus({ preventScroll: true });
  }
  function startPointer(event: ReactPointerEvent<HTMLDivElement>) {
    if (disabled || !event.isPrimary || event.button !== 0) return;
    pointer.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY, active: false, vertical: false, value: "" };
    suppressClick.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function movePointer(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = pointer.current;
    if (gesture?.id !== event.pointerId || gesture.vertical) return;
    if (!gesture.active) {
      const x = Math.abs(event.clientX - gesture.startX), y = Math.abs(event.clientY - gesture.startY);
      if (y >= 8 && y > x) { gesture.vertical = true; return; }
      if (x < 8 || x <= y) return;
      gesture.active = true;
    }
    pickAt(event.clientX);
  }
  function endPointer(event: ReactPointerEvent<HTMLDivElement>) {
    if (pointer.current?.id !== event.pointerId) return;
    if (!pointer.current.vertical) {
      const x = Math.abs(event.clientX - pointer.current.startX), y = Math.abs(event.clientY - pointer.current.startY);
      if (pointer.current.active || y < 8 || x > y) pickAt(event.clientX);
    }
    pointer.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function keydown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (disabled || !(event.target instanceof HTMLElement)) return;
    const current = Number(event.target.closest("button[data-score]")?.getAttribute("data-score"));
    if (!SCORES.some((score) => score === current)) return;
    let next: number | undefined;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = current === 5 ? 1 : current + 1;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = current === 1 ? 5 : current - 1;
    else if (event.key === "Home") next = 1;
    else if (event.key === "End") next = 5;
    else if (/^[1-5]$/.test(event.key)) next = Number(event.key);
    if (next === undefined) return;
    event.preventDefault(); onChange(String(next));
    row.current?.querySelector<HTMLButtonElement>(`button[data-score="${next}"]`)?.focus({ preventScroll: true });
  }
  return <div className={styles.rating}>
    <div className={styles.heading}><span id={labelId}>{label}</span><button type="button" className={styles.clear} aria-label={`清空${label}`} disabled={disabled || value === ""} onClick={() => onChange("")}>清空</button></div>
    <div className={styles.ratingRow} role="radiogroup" aria-labelledby={labelId} aria-describedby={hintId} aria-disabled={disabled} ref={row} onKeyDown={keydown} onPointerDown={startPointer} onPointerMove={movePointer} onPointerUp={endPointer} onPointerCancel={() => { pointer.current = null; }} onLostPointerCapture={() => { pointer.current = null; }}>
      {SCORES.map((score) => <button type="button" role="radio" aria-checked={selected === score} aria-label={`${label} ${score} / 5${score === 1 ? `，${lowLabel}` : score === 5 ? `，${highLabel}` : ""}`} data-score={score} key={score} tabIndex={selected === score || (selected === null && score === 1) ? 0 : -1} disabled={disabled} className={`${styles.score} ${selected === score ? styles.selected : ""}`} onClick={(event) => {
        if (event.detail !== 0 && suppressClick.current) { suppressClick.current = false; return; }
        if (!disabled) onChange(String(score));
      }}>{score}</button>)}
    </div>
    <div className={styles.ratingLabels}><span>{lowLabel}</span><span id={hintId} className={styles.answer} aria-live="polite">{selected === null ? "未填写 · 可选" : `${selected} / 5`}</span><span>{highLabel}</span></div>
  </div>;
}

export type PhraseInputProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  phrases: readonly string[];
  placeholder?: string;
  maxLength?: number;
  rows?: number;
  disabled?: boolean;
};

export function PhraseInput({ label, value, onChange, phrases, placeholder, maxLength, rows = 3, disabled = false }: PhraseInputProps) {
  const inputId = useId(), hintId = useId(), countId = useId();
  const limit = maxLength !== undefined && Number.isFinite(maxLength) ? Math.max(0, Math.floor(maxLength)) : undefined;
  return <div className={styles.phraseInput}>
    <div className={styles.heading}><label htmlFor={inputId}>{label}</label><button type="button" className={styles.clear} aria-label={`清空${label}`} disabled={disabled || !value} onClick={() => onChange("")}>清空</button></div>
    <div className={styles.phrases} aria-label={`${label}常用表达`}>
      {uniquePhrases(phrases).map((phrase) => {
        const selected = hasExactPhrase(value, phrase), next = toggleExactPhrase(value, phrase, limit);
        const tooLong = !selected && next === value;
        return <button type="button" key={phrase} className={`${styles.phrase} ${selected ? styles.selectedPhrase : ""}`} aria-pressed={selected} disabled={disabled || tooLong} title={tooLong ? "字数不足，请先精简内容" : undefined} onClick={() => { if (!disabled) onChange(toggleExactPhrase(value, phrase, limit)); }}>{phrase}</button>;
      })}
    </div>
    <textarea id={inputId} className={styles.textarea} value={value} onChange={(event) => onChange(limit === undefined ? event.target.value : event.target.value.slice(0, limit))} placeholder={placeholder} maxLength={limit} rows={Math.max(2, rows)} disabled={disabled} aria-describedby={`${hintId}${limit === undefined ? "" : ` ${countId}`}`} />
    <div className={styles.inputHint}><span id={hintId}>点选常用表达，也可以直接填写。</span>{limit === undefined ? null : <span id={countId}>{value.length} / {limit}</span>}</div>
  </div>;
}
