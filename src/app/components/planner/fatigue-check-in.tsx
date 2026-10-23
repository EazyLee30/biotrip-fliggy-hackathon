"use client";
import { useId } from "react";
import css from "./body-experience.module.css";
export const FATIGUE_LABELS = ["精力充沛", "有一点累", "想歇一会", "比较疲惫", "很需要休息"];
export function FatigueCheckIn({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const labelId = useId();
  return <section className={css.checkin} aria-label="今天的疲劳自评">
    <div className={css.checkinHeading}><div><span className={css.eyebrow}>听听自己的感受</span><h3 id={labelId}>{value ? FATIGUE_LABELS[Number(value) - 1] : "现在，感觉怎么样？"}</h3></div><span className={css.rating}>{value || "—"}<small>/ 5</small></span></div>
    <div className={css.feelings} role="group" aria-labelledby={labelId}>{FATIGUE_LABELS.map((label, index) => <button type="button" key={label} disabled={disabled} aria-label={`${index + 1} 分，${label}`} aria-pressed={value === String(index + 1)} onClick={() => onChange(String(index + 1))}>
      <svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><circle cx="24" cy="24" r="20"/><path d="M16 19h.1M32 19h.1" strokeWidth="3.5" strokeLinecap="round"/><path d={`M16 ${index < 2 ? 27 : 31} Q24 ${37 - index * 4} 32 ${index < 2 ? 27 : 31}`} strokeLinecap="round"/></svg><span>{index + 1}</span>
    </button>)}</div><div className={css.scaleEnds}><span>精神很好</span><span>想慢下来</span></div>
  </section>;
}
