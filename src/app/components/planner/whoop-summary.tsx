"use client";

import { ArrowUpRight, Activity } from "lucide-react";
import { whoopMetricLabel, whoopStatusLabel, type WhoopDisplay } from "@/lib/whoop-display";
import css from "./body-records.module.css";

export function WhoopSummary({ display, onOpen }: { display: WhoopDisplay; onOpen?: () => void }) {
  if (!display.connected) return null;
  const data = display.summary;
  const stamp = data?.measuredAt;
  const measured = stamp && Number.isFinite(Date.parse(stamp))
    ? new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(stamp))
    : null;
  const content = <>
    <span className={css.summaryHeading}><span><Activity size={16} />WHOOP 最近记录</span>{onOpen ? <span>身体记录 <ArrowUpRight size={15} /></span> : <span>{whoopStatusLabel(display.status)}</span>}</span>
    <span className={css.summaryValues}>
      <span>恢复 <strong>{data?.recoveryScore == null ? "—" : `${Math.round(data.recoveryScore)}%`}</strong><small>{whoopMetricLabel(display, data?.recoveryScore, "recoveryScore")}</small></span>
      <span>睡眠 <strong>{data?.sleepMinutes == null ? "—" : `${(data.sleepMinutes / 60).toFixed(1)} 小时`}</strong><small>{whoopMetricLabel(display, data?.sleepMinutes, "sleepMinutes")}</small></span>
    </span>
    <span className={css.summaryTime}>{display.retained ? "含上次读数，请留意各项数据说明" : measured ? `记录于 ${measured}` : "记录时间待同步"}{onOpen ? ` · ${whoopStatusLabel(display.status)}` : ""}</span>
  </>;
  return onOpen
    ? <button type="button" className={css.summary} onClick={onOpen} aria-label="查看身体记录">{content}</button>
    : <div className={css.summary} aria-label="本次可参考的 WHOOP 记录">{content}</div>;
}
