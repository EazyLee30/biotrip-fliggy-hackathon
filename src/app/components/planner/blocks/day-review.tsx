import { Icon } from "../../zen-ui";
import styles from "../../zen-dashboard.module.css";
import type { JourneyGeneratedPlan } from "@/lib/journey-types";

/**
 * The last screen before a trip is saved: what each day holds, and which
 * commitments are locked.
 *
 * It reads as a summary rather than a form — by this point the traveller has
 * already decided everything, so the only action is confirming or going back.
 */

type Item = JourneyGeneratedPlan["plan"]["itinerary"][number];

function dayKey(item: Item, fallback: string) {
  return item.date || fallback;
}

export function DayReview({
  plan,
  startDate,
  destination,
  travelHours,
  onEditPace,
  onLaunch,
  busy,
  daysToShow = 6,
}: {
  plan: JourneyGeneratedPlan;
  startDate: string;
  destination: string;
  travelHours: number;
  onEditPace: () => void;
  onLaunch: () => void;
  busy?: boolean;
  daysToShow?: number;
}) {
  const byDay = new Map<string, Item[]>();
  for (const item of plan.plan.itinerary) {
    const key = dayKey(item, startDate);
    byDay.set(key, [...(byDay.get(key) ?? []), item]);
  }
  const days = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(0, daysToShow);
  const locked = plan.plan.itinerary.filter((item) => item.fixed);
  const nights = Math.max(1, days.length - 1);

  return (
    <div className={styles.stack}>
      <div className={styles.pageIntro}>
        <div className={styles.sectionHead}>
          <span className={styles.eyebrow}>行程已整理好</span>
          <span className={styles.chip}><Icon name="check" size={12} />待你确认</span>
        </div>
        <h1>{plan.plan.headline}</h1>
        <p>{destination ? `为 ${destination} 安排 · ` : ""}共 {days.length} 天 / {nights} 晚，旅程时间约 {travelHours} 小时。</p>
      </div>

      <section className={styles.card}>
        <div className={styles.sectionHead}>
          <strong><Icon name="calendar" size={16} />每天的安排</strong>
          <small>{plan.plan.itinerary.length} 个节点</small>
        </div>
        <div className={styles.dayList}>
          {days.map(([day, items], index) => (
            <article className={styles.dayRow} key={day}>
              <div className={styles.dayMarker}>
                <strong>D{index + 1}</strong>
                <small>{/^\d{4}-/.test(day) ? day.slice(5).replace("-", "/") : ""}</small>
              </div>
              <div className={styles.dayBody}>
                <h3>{items[0]?.name ?? "自由安排"}</h3>
                <p>{items.slice(0, 3).map((item) => `${item.time} ${item.name}`).join(" · ")}</p>
                {items.length > 3 && <small className={styles.mutedText}>另有 {items.length - 3} 项</small>}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.card}>
        <div className={styles.sectionHead}>
          <span><Icon name="lock" size={16} /><strong>已锁定的安排</strong></span>
          <small>{locked.length} 项不会自动挪动</small>
        </div>
        {locked.length ? (
          <div className={styles.summaryList}>
            {locked.map((item, index) => (
              <div className={styles.summaryRow} key={`${item.time}-${index}`}>
                <span><Icon name="check" size={13} />{item.time}</span>
                <strong>{item.name}</strong>
              </div>
            ))}
          </div>
        ) : (
          <p className={styles.note}>你还没有标记固定预约。填入后，重新规划时会原样保留时间与名称。</p>
        )}
        <p className={styles.note}>「已锁定」来自你填写的日程。预订状态以供应商订单为准。</p>
      </section>

      <section className={styles.card}>
        <div className={styles.sectionHead}>
          <span><Icon name="leaf" size={16} /><strong>为什么这样安排</strong></span>
        </div>
        <p>{plan.plan.reason}</p>
        {plan.plan.adjustments.length > 0 && (
          <div className={styles.summaryList}>
            {plan.plan.adjustments.map((note, index) => (
              <div className={styles.summaryRow} key={index}><span><Icon name="clock" size={13} />待确认</span><strong>{note}</strong></div>
            ))}
          </div>
        )}
      </section>

      <button className={styles.primaryButton} disabled={busy} onClick={onLaunch}>
        <Icon name="check" />确认并保存这段旅程
      </button>
      <button className={styles.textButton} onClick={onEditPace}>
        <Icon name="tune" size={16} />调整密度或固定安排
      </button>
    </div>
  );
}