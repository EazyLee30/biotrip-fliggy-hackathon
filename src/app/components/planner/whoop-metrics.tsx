"use client";

import type { CSSProperties } from "react";
import { whoopMetricLabel, whoopStatusLabel, type WhoopDisplay, type WhoopSummary } from "@/lib/whoop-display";
import css from "./whoop-metrics.module.css";

type Metric = "strain" | "recovery" | "sleep" | "steps";
export function MetricRing({ progress, value, unit, label }: { progress: number | null; value: string; unit: string; label: string }) {
  return <div className={css.gauge} role="img" aria-label={`${label}：${value} ${unit}`}><svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="49" className={css.track} /><circle cx="60" cy="60" r="49" className={css.arc} pathLength="100" strokeDasharray={`${Math.max(0, Math.min(100, progress ?? 0))} 100`} /></svg><div className={css.reading}><strong>{value}</strong><small>{unit}</small></div></div>;
}
export function WhoopMetrics({ display, onSelect }: { display: WhoopDisplay; selfAssessment?: boolean; onSelect?: (metric: Metric) => void }) {
  if (!display.connected) return null;
  const data = display.summary;
  const metrics: Array<{ id: Metric; key: keyof WhoopSummary; label: string; value: number | null | undefined; unit: string; progress: number | null; color: string; digits?: number }> = [
    { id: "strain", key: "cycleStrain", label: "运动负荷", value: data?.cycleStrain, unit: "/ 21", progress: data?.cycleStrain == null ? null : data.cycleStrain / 21 * 100, color: "#4384b0", digits: 1 },
    { id: "recovery", key: "recoveryScore", label: "恢复指数", value: data?.recoveryScore, unit: "%", progress: data?.recoveryScore ?? null, color: "#62885d" },
    { id: "sleep", key: "sleepMinutes", label: "睡眠", value: data?.sleepMinutes == null ? null : data.sleepMinutes / 60, unit: "小时", progress: data?.sleepPerformance ?? null, color: "#8a77b1", digits: 1 },
    { id: "steps", key: "cycleSteps", label: "步数", value: data?.cycleSteps, unit: "步", progress: null, color: "#b58a50" },
  ];
  return <section className={css.root} aria-label="WHOOP 身体记录">
    <div className={css.heading}><h2>身体仪表盘</h2><span>WHOOP · {whoopStatusLabel(display.status)}</span></div>
    <div className={css.grid}>{metrics.map(metric => {
      const value = metric.value == null ? "—" : metric.value.toLocaleString("zh-CN", { maximumFractionDigits: metric.digits ?? 0 });
      const content = <><span className={css.label}>{metric.label}{onSelect ? <span aria-hidden="true">↗</span> : null}</span>{metric.id === "steps" ? <div className={css.steps}><svg viewBox="0 0 64 64" aria-hidden="true"><ellipse cx="22" cy="23" rx="8" ry="15" transform="rotate(-20 22 23)"/><ellipse cx="44" cy="36" rx="8" ry="15" transform="rotate(20 44 36)"/><circle cx="28" cy="44" r="6"/><circle cx="37" cy="56" r="5"/></svg><strong>{value}</strong><small>步</small></div> : <MetricRing progress={metric.progress} value={value} unit={metric.unit} label={metric.label} />}<small>{metric.id === "sleep" && data?.sleepPerformance != null ? `睡眠表现 ${Math.round(data.sleepPerformance)}% · ` : ""}{whoopMetricLabel(display, metric.value, metric.key)}</small></>;
      const style = { "--metric-color": metric.color } as CSSProperties;
      return onSelect ? <button type="button" key={metric.id} style={style} className={css.metric} onClick={() => onSelect(metric.id)}>{content}</button> : <div key={metric.id} style={style} className={css.metric}>{content}</div>;
    })}</div>
    <details className={css.note}><summary>数据说明{display.retained ? " · 含上次读数" : ""}</summary><p>负荷 0–21，恢复 0–100%。睡眠圆环表示睡眠表现；步数不设虚构目标。运动负荷不等同于主观疲劳。</p>{display.retrievedAt && Number.isFinite(Date.parse(display.retrievedAt)) ? <p>同步于 {new Date(display.retrievedAt).toLocaleString("zh-CN")}</p> : null}</details>
  </section>;
}
