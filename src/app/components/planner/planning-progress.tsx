"use client";
import type { PlanningJob } from "@/lib/planning/jobs";
import type { PlanRecommendation } from "@/lib/planning-recommendations";
import { WaitingRecommendations } from "./waiting-recommendations";
import styles from "../zen-dashboard.module.css";

type Props = {
  ready?: "saved" | "review" | null; onReady: () => void;
  progressMessage: string; progressStage: string;
  progressStates: Record<string, "running" | "ok" | "skipped" | "degraded">;
  activeJob: PlanningJob | null; waitingItems: PlanRecommendation[]; waitingDestination: string;
  onPause: () => void; onCancel: () => Promise<void>; onSelectPlace: (place: PlanRecommendation) => void;
};
export function PlanningProgress({ready,onReady,progressMessage,progressStage,progressStates,activeJob,waitingItems,waitingDestination,onPause,onCancel,onSelectPlace}: Props) {
  const terminalError = activeJob && ["failed", "indeterminate", "cancelled"].includes(activeJob.state);
  return <section className={`${styles.loading} ${styles.loadingPanel}`}>
    {terminalError ? <span aria-hidden="true">!</span> : ready ? <span aria-hidden="true" style={{ fontSize: 32, color: "var(--green, #286653)" }}>✓</span> : <div className={styles.spinner} />}
    <h2>{terminalError ? activeJob?.state === "cancelled" ? "任务已停止" : "本次生成未完成" : ready ? ready === "saved" ? "行程已生成并保存" : "调整方案已准备好" : "正在整理你的旅程"}</h2>
    <p role="status" aria-live="polite">{terminalError ? activeJob?.error || "原行程仍保留，可以继续浏览已返回的资料。" : progressMessage}</p>
    {ready ? <button className={styles.primaryButton} style={{ maxWidth: 300 }} onClick={onReady}>{ready === "saved" ? "查看行程" : "查看调整方案"}</button> : null}
    <WaitingRecommendations complete={Boolean(ready || terminalError)} items={waitingItems} destination={waitingDestination} onSelect={onSelectPlace} />
    <details className={styles.stack}>
      <summary>查看生成进度</summary>
      {activeJob?.timing ? <div className={styles.summaryList} aria-label="本次任务耗时">{([
        ["firstRecommendationsMs", "首批推荐"], ["composedMs", "编排完成"], ["resultReadyMs", "结果保存或待确认"],
      ] as const).map(([key,label]) => activeJob.timing?.[key] !== undefined ? <div className={styles.summaryRow} key={key}><span>{label}</span><strong>提交后约 {Math.round(activeJob.timing[key]! / 1000)} 秒</strong></div> : null)}<small>来自本次任务记录，精度为秒；各时刻包含队列等待与服务调用。</small></div> : null}
      <div className={styles.loadingSteps}>
        {[["preparing", "准备旅行资料"], ["health_insight", "结合身体感受与偏好"], ["local_research", "检索真实目的地信息"], ["flyai_inventory", "核验飞猪实时商品"], ["poi_catalog", "读取目的地实景"], ["compose_plan", "编排中文行程"], ["complete", "保存到你的旅程"]].map(([stage, label], index) => <div className={!ready && (progressStates[stage] === "running" || progressStage === stage) ? styles.active : ""} key={stage}>
          <span>{progressStates[stage] === "ok" ? "✓" : index + 1}</span>{label}
          <small>{progressStates[stage] === "ok" ? "已完成" : progressStates[stage] === "skipped" ? "已跳过" : progressStates[stage] === "degraded" ? "部分资料不可用" : progressStates[stage] === "running" ? "进行中" : "等待"}</small>
        </div>)}
      </div>
    </details>
    <p className={styles.note}>{ready || terminalError ? "推荐会留在这里，可继续打开详情。页面不会自动跳转。" : "任务在后台执行，关闭页面也会继续。重新打开可恢复进度；调整结果需要你确认。"}</p>
    <button className={styles.secondaryButton} style={{ maxWidth: 300 }} onClick={onPause}>{ready || terminalError ? "继续浏览" : "先去浏览，后台继续"}</button>
    {!ready && !terminalError && activeJob ? <button className={styles.textButton} onClick={() => void onCancel()}>停止后台任务</button> : null}
  </section>;
}
