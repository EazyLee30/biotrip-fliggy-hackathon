import { Icon } from "../../zen-ui";
import styles from "../../zen-dashboard.module.css";
import type { PaceLevel } from "@/lib/journey-types";

/**
 * Daily effort, chosen on a scale the traveller recognises rather than a
 * personality label.
 *
 * The numbers are planning *targets*, not measured or predicted physiology: they
 * tell the composer how dense a day may get. Nothing here reads or predicts a
 * recovery score.
 */

export const PACE_LEVELS: ReadonlyArray<{
  value: PaceLevel;
  name: string;
  summary: string;
  /** Steps per day the composer aims for. Advisory, never enforced. */
  stepsPerDay: number;
  dayShape: string;
  hint: string;
}> = [
  {
    value: "gentle",
    name: "轻松为主",
    summary: "少走路，多坐下",
    stepsPerDay: 4000,
    dayShape: "每天 2–3 项，步行集中在短距离",
    hint: "抵达第一天和时差明显的日子尤其适合",
  },
  {
    value: "balanced",
    name: "均衡",
    summary: "有安排，也有留白",
    stepsPerDay: 6500,
    dayShape: "每天 3–5 项，移动与休息交替",
    hint: "多数行程的起点，之后随时可以调整",
  },
  {
    value: "active",
    name: "充分探索",
    summary: "走得多，看得多",
    stepsPerDay: 9000,
    dayShape: "每天 4–6 项，步行距离较长",
    hint: "适合已经适应时差、想多走一点的时候",
  },
];

export function PaceMatrix({
  value,
  onChange,
  disabled,
}: {
  value: PaceLevel;
  onChange: (level: PaceLevel) => void;
  disabled?: boolean;
}) {
  return (
    <section className={styles.card} aria-labelledby="pace-heading">
      <div className={styles.sectionHead}>
        <span><Icon name="tune" /><strong id="pace-heading">每天想走多少</strong></span>
        <Badge>可随时调整</Badge>
      </div>
      <p className={styles.note}>
        这是你给行程的<b>目标密度</b>，不是身体检测结果。BioTrip 不会根据设备数据预测你的体能上限。
      </p>
      <div className={styles.paceGrid} role="radiogroup" aria-label="每日活动密度">
        {PACE_LEVELS.map((level) => {
          const selected = value === level.value;
          return (
            <button
              key={level.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              className={`${styles.paceCard} ${selected ? styles.selected : ""}`}
              onClick={() => onChange(level.value)}
            >
              <div className={styles.paceTop}>
                <strong>{level.name}</strong>
                {selected && <Icon name="check" size={14} />}
              </div>
              <small>{level.summary}</small>
              <span className={styles.paceSteps}>约 {level.stepsPerDay.toLocaleString("zh-CN")} 步 / 天</span>
              <span className={styles.paceShape}>{level.dayShape}</span>
              {selected && <span className={styles.paceHint}><Icon name="leaf" size={12} />{level.hint}</span>}
            </button>
          );
        })}
      </div>
      <p className={styles.note}>选定后每天都会按这个密度编排，你不需要再逐日调整。</p>
    </section>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className={styles.chip}>{children}</span>;
}