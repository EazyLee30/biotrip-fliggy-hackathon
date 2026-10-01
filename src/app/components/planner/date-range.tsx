import { useMemo, useState } from "react";
import { Icon } from "../zen-ui";
import styles from "../zen-dashboard.module.css";

/**
 * Date-only trip range selection.
 *
 * Travellers think "I'll be away from the 3rd to the 9th", not "depart 09:00".
 * Two inputs reduce to one gesture: tap the first day, tap the last. A
 * horizontally scrollable strip covers the common near-term case in one swipe,
 * and the calendar covers everything else without a date input.
 */

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

function toKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function fromKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}
function addDays(key: string, delta: number) {
  const date = fromKey(key);
  date.setDate(date.getDate() + delta);
  return toKey(date);
}
function nights(start: string, end: string) {
  return Math.max(1, Math.round((fromKey(end).getTime() - fromKey(start).getTime()) / 86_400_000));
}
function label(key: string) {
  if (!key) return "未选择";
  return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" }).format(fromKey(key));
}

/** Weeks of the given month, Monday-first, padded with nulls. */
function monthGrid(year: number, month: number): Array<number | null> {
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  return [...Array.from({ length: lead }, () => null), ...Array.from({ length: days }, (_, index) => index + 1)];
}

export function DateRangePicker({
  start,
  end,
  today,
  onChange,
}: {
  start: string;
  end: string;
  /** Server-side "today", so the strip cannot disagree with the trip maths. */
  today: string;
  onChange: (next: { start: string; end: string }) => void;
}) {
  const [monthOffset, setMonthOffset] = useState(0);
  const [pending, setPending] = useState<string | null>(null);

  const base = useMemo(() => (today ? fromKey(today) : new Date()), [today]);
  const view = useMemo(() => new Date(base.getFullYear(), base.getMonth() + monthOffset, 1), [base, monthOffset]);
  const strip = useMemo(
    () => (today ? Array.from({ length: 60 }, (_, index) => addDays(today, index)) : []),
    [today],
  );

  /** First tap sets the start; the second completes the range and never inverts. */
  function pick(day: string) {
    if (!pending) { setPending(day); onChange({ start: day, end: "" }); return; }
    if (day < pending) { onChange({ start: day, end: pending }); }
    else { onChange({ start: pending, end: day }); }
    setPending(null);
  }

  const inRange = (day: string) => Boolean(start && end && day >= start && day <= end);
  const isStart = (day: string) => day === start;
  const isEnd = (day: string) => day === end;
  const beforeToday = (day: string) => day < today;

  return (
    <div className={styles.field}>
      <label>旅行日期</label>

      <div className={styles.dateSummary}>
        <div>
          <small>出发</small>
          <strong>{label(start)}</strong>
        </div>
        <Icon name="arrow" size={18} />
        <div>
          <small>返程</small>
          <strong>{end ? label(end) : "未定"}</strong>
        </div>
        {start && <Badge>{end ? `${nights(start, end)} 晚` : "请选择返程"}</Badge>}
      </div>

      <div className={styles.dateStrip} role="group" aria-label="快速选择日期">
        {strip.map((day) => {
          const active = isStart(day) || isEnd(day) || inRange(day);
          return (
            <button
              key={day}
              type="button"
              className={`${styles.dateChip} ${active ? styles.active : ""} ${isStart(day) ? styles.dateStart : ""} ${isEnd(day) ? styles.dateEnd : ""}`}
              aria-pressed={active}
              onClick={() => pick(day)}
            >
              <small>{WEEKDAYS[(fromKey(day).getDay() + 6) % 7]}</small>
              <strong>{fromKey(day).getDate()}</strong>
            </button>
          );
        })}
      </div>

      <div className={styles.calendar}>
        <div className={styles.calendarHead}>
          <button type="button" className={styles.iconButton} aria-label="上个月" onClick={() => setMonthOffset((value) => value - 1)}>
            <Icon name="back" size={16} />
          </button>
          <strong>{view.getFullYear()} 年 {view.getMonth() + 1} 月</strong>
          <button type="button" className={styles.iconButton} aria-label="下个月" onClick={() => setMonthOffset((value) => value + 1)}>
            <Icon name="arrow" size={16} />
          </button>
        </div>
        <div className={styles.calendarWeek}>{WEEKDAYS.map((day) => <span key={day}>{day}</span>)}</div>
        <div className={styles.calendarGrid}>
          {monthGrid(view.getFullYear(), view.getMonth()).map((day, index) => {
            if (day === null) return <span key={`pad-${index}`} />;
            const key = toKey(new Date(view.getFullYear(), view.getMonth(), day));
            const disabled = beforeToday(key);
            return (
              <button
                key={key}
                type="button"
                disabled={disabled}
                aria-pressed={isStart(key) || isEnd(key) || inRange(key)}
                className={`${styles.calendarDay} ${inRange(key) ? styles.active : ""} ${isStart(key) ? styles.dateStart : ""} ${isEnd(key) ? styles.dateEnd : ""} ${key === today ? styles.today : ""}`}
                onClick={() => pick(key)}
              >
                {day}
              </button>
            );
          })}
        </div>
        <p className={styles.note}>先点出发日，再点返程日。日期会按目的地当地时间安排，你不需要填写具体时刻。</p>
      </div>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className={styles.chip}>{children}</span>;
}