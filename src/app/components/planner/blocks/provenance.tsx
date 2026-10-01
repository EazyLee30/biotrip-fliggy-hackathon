import type { JourneyProvenance } from "@/lib/journey-types";
import { Icon, type IconName } from "../../zen-ui";
import styles from "../../zen-dashboard.module.css";

/**
 * Renders how a plan was actually produced.
 *
 * Each capability reports whether it verified something or degraded, so the
 * traveller can tell a fully sourced itinerary from one built on a partial
 * lookup without reading prose. Nothing here is decorative: a degraded stage is
 * also written into the plan's adjustments server-side.
 */

const STAGE_ICONS: Record<string, IconName> = {
  health_insight: "pulse",
  local_research: "compass",
  flyai_inventory: "train",
  compose_plan: "leaf",
};

const BASIS_TEXT = {
  whoop_recent: "参考近期身体记录",
  self_report: "仅依据你的主观自评",
  preferences_only: "仅依据旅行偏好，未使用身体数据",
} as const;

export function ProvenanceBlock({
  provenance,
  memoryNotes,
}: {
  provenance?: JourneyProvenance | null;
  memoryNotes?: string[];
}) {
  if (!provenance && !memoryNotes?.length) return null;
  const stages = provenance?.stages ?? [];
  const degraded = stages.filter((stage) => stage.status === "degraded");
  const providerLabel = provenance?.provider === "managed_agent" ? "百炼托管智能体" : "百炼模型接口";
  const flyai = provenance?.flyai;
  const localVerified = provenance?.local.verified;

  return (
    <section className={styles.card} aria-label="资料来源与核验状态">
      <div className={styles.sectionHead}>
        <span><Icon name="shield" /><strong>资料来源与核验</strong></span>
        <small>{providerLabel}</small>
      </div>

      {provenance && (
        <div className={styles.summaryList}>
          {stages.map((stage) => (
            <div className={styles.summaryRow} key={stage.stage}>
              <span><Icon name={STAGE_ICONS[stage.stage] ?? "leaf"} size={14} />{stage.label}</span>
              <strong>
                {stage.status === "ok"
                  ? `已核验 · ${(stage.elapsedMs / 1000).toFixed(1)}s`
                  : stage.status === "skipped" ? "本次未使用" : "本次未核验"}
              </strong>
            </div>
          ))}
          {provenance.health && (
            <div className={styles.summaryRow}>
              <span><Icon name="pulse" size={14} />身体节奏依据</span>
              <strong>{BASIS_TEXT[provenance.health.basis]}</strong>
            </div>
          )}
          {localVerified !== undefined && (
            <div className={styles.summaryRow}>
              <span><Icon name="compass" size={14} />目的地公开资料</span>
              <strong>{localVerified ? "已核验来源链接" : "本次未核验"}</strong>
            </div>
          )}
          {flyai && (
            <div className={styles.summaryRow}>
              <span><Icon name="train" size={14} />飞猪实时商品</span>
              <strong>{flyai.searches > 0 ? `${flyai.searches} 次搜索 · ${flyai.sourceCount} 条来源` : "本次未获取"}</strong>
            </div>
          )}
          {flyai?.executor && (
            <div className={styles.summaryRow}>
              <span><Icon name="shield" size={14} />检索执行者</span>
              <strong>{flyai.executor === "agent_skill" ? "百炼智能体内置 FlyAI Skill" : "BioTrip 服务端只读签名通道"}</strong>
            </div>
          )}
        </div>
      )}

      {degraded.length > 0 && (
        <div className={styles.inset} role="status">
          <Icon name="clock" />
          <div>
            <strong>部分资料本次未核验</strong>
            <p>{degraded.map((stage) => `${stage.label}未核验`).join("、")}。行程已按其余已核验来源编排，相关内容请自行确认。</p>
          </div>
        </div>
      )}

      {provenance?.health.whoopUnavailable && (
        <div className={styles.inset} role="status">
          <Icon name="pulse" />
          <div>
            <strong>WHOOP 授权已失效</strong>
            <p>本次按你的自评规划。可在个人档案重新连接一次，之后将自动保持连接。</p>
          </div>
        </div>
      )}

      {memoryNotes && memoryNotes.length > 0 && (
        <div className={styles.sectionHead} style={{ marginTop: 8 }}>
          <span><Icon name="leaf" /><strong>本次带入的记忆</strong></span>
          <small>{provenance?.memory.source === "learned" ? "来自你的重复选择" : "来自你的档案"}</small>
        </div>
      )}
      {memoryNotes && memoryNotes.length > 0 && (
        <div className={styles.summaryList}>
          {memoryNotes.map((note, index) => (
            <div className={styles.summaryRow} key={`${note}-${index}`}>
              <span><Icon name="check" size={14} />{note}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** Compact one-line trust indicator for headers and cards. */
export function ProvenanceChip({ provenance }: { provenance?: JourneyProvenance | null }) {
  if (!provenance) return null;
  const degraded = provenance.stages.filter((stage) => stage.status === "degraded").length;
  const allVerified = degraded === 0;
  return (
    <small className={styles.note}>
      <Icon name={allVerified ? "check" : "clock"} size={13} />
      {allVerified
        ? `全部资料已核验 · ${provenance.flyai.sourceCount} 条飞猪来源`
        : `${degraded} 项资料本次未核验`}
    </small>
  );
}