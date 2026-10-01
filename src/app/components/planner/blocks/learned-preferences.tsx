import { Icon } from "../../zen-ui";
import type { LearnedPreference, PreferenceKind } from "@/lib/preferences";
import styles from "../../zen-dashboard.module.css";

/**
 * Lets the traveller see, review and delete what BioTrip learned.
 *
 * Nothing is applied silently: rows that reached the repeat threshold are
 * marked, and every one of them can be removed. That is the same data the
 * planner uses to prefill, so this list is the honest control surface for it.
 */

const KIND_LABELS: Record<PreferenceKind, string> = {
  rhythm: "安排方式",
  intention: "旅行意图",
  ambience: "空间氛围",
  tone: "个人色调",
  service: "常用服务",
  food: "饮食习惯",
  destination: "去过的城市",
  schedule: "节奏习惯",
};

const KIND_ORDER: PreferenceKind[] = [
  "rhythm", "intention", "ambience", "tone", "service", "food", "destination", "schedule",
];

const SOURCE_LABELS = { choice: "来自你的选择", feedback: "来自你的反馈", profile: "来自你的档案" } as const;

export function LearnedPreferencesBlock({
  preferences,
  defaults,
  busyId,
  onForget,
  onForgetAll,
}: {
  preferences: LearnedPreference[];
  defaults: { established: boolean } | null;
  busyId: string;
  onForget: (id: string) => void;
  onForgetAll: () => void;
}) {
  const grouped = KIND_ORDER
    .map((kind) => ({ kind, label: KIND_LABELS[kind], rows: preferences.filter((row) => row.kind === kind) }))
    .filter((group) => group.rows.length > 0);

  return (
    <section className={styles.card} aria-label="自动记忆的偏好">
      <div className={styles.sectionHead}>
        <span><Icon name="leaf" /><strong>自动记忆的偏好</strong></span>
        <small>
          {defaults?.established
            ? "重复选择已成为默认，下次自动带入"
            : preferences.length ? "再选择一次即可成为默认" : "暂无记录"}
        </small>
      </div>

      <div className={styles.inset}>
        <Icon name="shield" />
        <p>
          BioTrip 只从你的选择与自评中学习，不使用 WHOOP 数值推断喜好，也不从颜色推断人格。每条都可以单独忘记。
        </p>
      </div>

      {grouped.length === 0 ? (
        <p className={styles.note}>开始创建旅程并做出选择后，这里会显示 BioTrip 记下的偏好。</p>
      ) : (
        <>
          {grouped.map((group) => (
            <div key={group.kind}>
              <div className={styles.sectionHead} style={{ marginTop: 12 }}>
                <strong>{group.label}</strong>
                <small>{SOURCE_LABELS[group.rows[0].source]}</small>
              </div>
              <div className={styles.chipRow}>
                {group.rows.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    className={`${styles.chip} ${row.hits > 1 ? styles.active : ""}`}
                    disabled={Boolean(busyId)}
                    title={`${row.hits} 次 · ${SOURCE_LABELS[row.source]}`}
                    onClick={() => onForget(row.id)}
                  >
                    {busyId === row.id ? "处理中" : row.label}
                    <small>{row.hits}×</small>
                  </button>
                ))}
              </div>
            </div>
          ))}
          <button type="button" className={styles.textButton} onClick={onForgetAll}>
            <Icon name="back" size={16} />清除全部自动记忆（保留你手写的记忆和档案）
          </button>
        </>
      )}
    </section>
  );
}