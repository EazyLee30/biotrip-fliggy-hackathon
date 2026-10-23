"use client";
import type * as React from "react";
import type { SetStateAction } from "react";
import type { PlannerInputs } from "./use-planner-inputs";
import type { Journey, JourneyGeneratedPlan } from "@/lib/journey-types";
import type { WhoopDisplay } from "@/lib/whoop-display";
type ItineraryItem = JourneyGeneratedPlan["plan"]["itinerary"][number];
import styles from "../zen-dashboard.module.css";
import { Icon, Badge, Ambience } from "../zen-ui";
import { number, sleepDuration } from "./view-values";
import { whoopMetricLabel } from "@/lib/whoop-display";

type Props = Pick<PlannerInputs, "setBodyFeedback"> & {
  journey: Journey | null;
  plan: JourneyGeneratedPlan | null;
  health: import("@/lib/whoop-display").WhoopSummary | null;
  whoopDisplay: WhoopDisplay;
  renderWhoopStatus: () => React.JSX.Element;
  whoopConnected: boolean;
  busy: boolean;
  healthLoading: boolean;
  syncHealth: (checkConnection?: boolean) => Promise<void>;
  whoopConfigured: boolean;
  setActivity: React.Dispatch<SetStateAction<ItineraryItem | null>>;
  startAdjustment: (light?: boolean) => void;
};
export function SleepView({ journey, plan, health, whoopDisplay, renderWhoopStatus, whoopConnected, busy, healthLoading, syncHealth, whoopConfigured, setActivity, setBodyFeedback, startAdjustment }: Props) { return <div className={styles.stack}><div className={styles.eyebrow}><Icon name="moon" size={16} />睡眠与目的地时区</div><div className={styles.wideGrid}><section className={`${styles.card} ${styles.hero}`}><div className={styles.sectionHead}><span><Icon name="pin" /><strong>{journey?.draft.trip?.destinationCity || "当前旅行节奏"}</strong></span><Badge tone="mint">{plan ? "时区已核对" : "等待旅行信息"}</Badge></div><div className={styles.sleepGauge}><div><strong>{plan ? `${plan.timezone.shiftMinutes > 0 ? "+" : ""}${number(plan.timezone.shiftMinutes / 60, 1)} 小时` : "—"}</strong><small>相对出发地的时区变化</small></div></div><div className={styles.inset}><Icon name="sun" /><p>{plan ? `规划暂按 ${number(plan.timezone.travelHours, 1)} 小时交通缓冲安排，实际时刻以你的交通订单为准。抵达后留意当地光照与自己实际的睡意，按目的地时间逐步安排作息。` : "选择目的地并生成行程后，可查看两地时区变化。"}</p></div><p className={styles.note}>身体适应程度与睡眠窗口尚无测量依据，页面只显示已同步的真实记录。</p></section><section className={styles.card}><div className={styles.sectionHead}><h3>最近睡眠记录</h3><Badge tone="green">WHOOP</Badge></div><div><small className={styles.mutedText}>总睡眠时长</small><h1>{sleepDuration(health?.sleepMinutes)}</h1></div><div className={styles.metrics}><div className={styles.metric}><span><Icon name="moon" size={14} />睡眠表现</span><strong>{number(health?.sleepPerformance)}<small>%</small></strong><small>{whoopMetricLabel(whoopDisplay, health?.sleepPerformance, "sleepPerformance")}</small></div><div className={styles.metric}><span><Icon name="heart" size={14} />静息心率</span><strong>{number(health?.restingHeartRate)}</strong><small>次 / 分 · {whoopMetricLabel(whoopDisplay, health?.restingHeartRate, "restingHeartRate")}</small></div><div className={styles.metric}><span><Icon name="pulse" size={14} />心率变异</span><strong>{number(health?.hrvRmssdMilli, 1)}</strong><small>毫秒 · {whoopMetricLabel(whoopDisplay, health?.hrvRmssdMilli, "hrvRmssdMilli")}</small></div></div>{renderWhoopStatus()}<p className={styles.note}>这些是历史记录，未在旅途中持续测量。</p>{whoopConnected ? <button className={styles.secondaryButton} disabled={busy || healthLoading} onClick={() => void syncHealth()}><Icon name="sync" />同步最新记录</button> : whoopConfigured ? <a className={styles.primaryButton} href="/api/whoop/connect">连接 WHOOP</a> : null}</section></div>{plan ? <section className={styles.card}><div className={styles.sectionHead}><h3>行程里的休息节点</h3><small>来源：当前计划</small></div>{plan.plan.itinerary.filter((item) => /休息|睡|午休|住宿|酒店|放松|茶|咖啡/.test(item.name + item.detail)).slice(0, 5).map((item, index) => <button type="button" className={`${styles.summaryRow} ${styles.detailRowButton}`} key={item.id ?? index} onClick={() => setActivity(item)}><span>{item.time}</span><strong>{item.name}</strong><Icon name="arrow" size={14} /></button>)}<p className={styles.note}>想更早休息，可以通过下方入口调整行程；已确定的预约仍会纳入新规划。</p></section> : null}<Ambience image="sleep" label="夜晚也是旅程的一部分" title="把一天温柔地收好。" />{plan && journey?.status !== "completed" ? <button className={styles.primaryButton} onClick={() => { setBodyFeedback("希望晚上早点回到住宿休息，保留固定预约，减少夜间活动。"); startAdjustment(); }}><Icon name="moon" />调整行程，早点休息</button> : null}</div>; }
