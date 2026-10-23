"use client";

import { lazy, Suspense, type ReactNode } from "react";
import { Wind, Watch } from "lucide-react";
import type { WhoopDisplay } from "@/lib/whoop-display";
import { WhoopMetrics } from "./whoop-metrics";
import { FatigueCheckIn } from "./fatigue-check-in";
import type { FeelingPoint } from "./body-history-chart";
import css from "./body-records.module.css";
import body from "./body-experience.module.css";

const BodyHistoryChart = lazy(() => import("./body-history-chart"));
type Props = {
  display: WhoopDisplay;
  status: ReactNode;
  onMetric: (metric: "strain" | "recovery" | "sleep" | "steps") => void;
  onDevices: () => void;
  onBreathing: () => void;
  checkIn?: { fatigue: string; saving: boolean; error: string; onChange: (value: string) => void; points: FeelingPoint[]; journeyName: string };
};

export function BodyRecordsView({ display, status, onMetric, onDevices, onBreathing, checkIn }: Props) {
  return <div className={css.root}>
    <div className={css.intro}><span>留意身体，也听听自己的感受</span><h1>身体记录</h1><p>设备的最近记录与此刻的自评，分别保留。</p></div>
    {display.connected ? <><WhoopMetrics display={display} onSelect={onMetric} />{status}</> : <section className={css.empty}><Watch size={28} /><h2>按自己的感受出发</h2><p>{display.message || "连接 WHOOP 后，可以在这里查看恢复、睡眠与活动记录。"}</p><button type="button" onClick={onDevices}>管理设备与数据 <Watch size={16} /></button></section>}
    {checkIn ? <section><FatigueCheckIn value={checkIn.fatigue} disabled={checkIn.saving} onChange={checkIn.onChange} /><p className={css.caption}>自评记录于「{checkIn.journeyName}」；设备记录不随旅程切换。</p>{checkIn.saving ? <p role="status">正在保存感受…</p> : null}{checkIn.error ? <p role="alert" className={body.error}>{checkIn.error}</p> : null}{checkIn.points.length > 1 ? <details className={body.history}><summary>这段旅程的身体感受</summary><Suspense fallback={<div className={body.chart} />}><BodyHistoryChart points={checkIn.points} /></Suspense></details> : null}</section> : null}
    <button type="button" className={css.link} onClick={onBreathing}><Wind size={19} /><span>做一次舒缓呼吸<small>给自己留 3 分钟</small></span></button>
    {display.connected ? <button type="button" className={css.link} onClick={onDevices}><Watch size={19} /><span>设备与数据<small>连接、授权与同步设置</small></span></button> : null}
  </div>;
}
