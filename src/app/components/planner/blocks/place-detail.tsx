"use client";

import { useState } from "react";
import { Icon, Modal } from "../../zen-ui";
import { EditorialImage } from "../editorial-image";
import { TimeWheel } from "../reservation-editor";
import { reservationDates } from "../reservations";
import { travelDateLabel } from "../travel-dates";
import styles from "../../zen-dashboard.module.css";
import intentStyles from "./place-intent.module.css";
import type { JourneyGeneratedPlan } from "@/lib/journey-types";

type Place = JourneyGeneratedPlan["plan"]["places"][number];
export type SlotIntent = { placeName: string; url: string; date: string; time: string } | null;

export function PlaceDetail({ place, whoopConnected, onAddToDay, onClose, busy, tripStart, tripEnd, initialDate }: {
  place: Place;
  whoopConnected: boolean;
  onAddToDay: (slot: SlotIntent) => boolean | Promise<boolean>;
  onClose: () => void;
  busy?: boolean;
  tripStart: string;
  tripEnd: string;
  initialDate?: string;
}) {
  const product = place.source === "飞猪实时搜索";
  const dates = reservationDates(tripStart, tripEnd);
  const [date, setDate] = useState(() => dates.includes(initialDate ?? "") ? initialDate! : dates[0] ?? "");
  const [hour, setHour] = useState<number | null>(null);
  const [minute, setMinute] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [pendingHour, setPendingHour] = useState(false);
  const [pendingMinute, setPendingMinute] = useState(false);
  const valid = dates.includes(date) && hour !== null && minute !== null && !pendingHour && !pendingMinute;
  const time = `${String(hour ?? 0).padStart(2, "0")}:${String(minute ?? 0).padStart(2, "0")}`;
  const [adding, setAdding] = useState(false);
  async function add() {
    if (!valid || busy || adding) return;
    setAdding(true); setError("");
    try {
      if (!await onAddToDay({ placeName: place.name, url: place.url, date, time })) setError("暂时无法加入，请检查已有安排后重试。");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "暂时无法保存活动，请重试。"); }
    finally { setAdding(false); }
  }
  return <Modal title={product ? "飞猪商品详情" : "当地资料详情"} onClose={onClose} busy={busy || adding} footer={<button type="button" className={styles.primaryButton} disabled={busy || adding || !valid} onClick={() => void add()}><Icon name="plus" />{adding ? "正在保存活动…" : valid ? `添加 ${travelDateLabel(date)} ${time} 的活动` : "选好日期与时间后添加"}</button>}><div className={styles.placeDetail}>
    {product ? <EditorialImage imageUrl={place.imageUrl} product subject={place.category + " " + place.name} /> : <p className={styles.note}>这是当地参考资讯，可能是专题或目录，不代表可预订商品。请在原文确认具体地点后再加入安排。</p>}
    <span className={styles.chip}><Icon name="shield" size={12} />有来源的旅行信息</span>
    <h2>{place.name}</h2>
    <p className={styles.placeDetailMeta}>{place.category} · {place.source}</p>
    <p className={styles.placeDetailReason}>{place.reason}</p>
    <div className={styles.sectionHead}><strong><Icon name="calendar" size={15} />想在哪天、几点去？</strong></div>
    <div className={intentStyles.days} role="group" aria-label="活动日期">
      {dates.map((day) => <button key={day} type="button" disabled={busy} aria-pressed={date === day} onClick={() => { setDate(day); setError(""); }}><strong>{travelDateLabel(day)}</strong><small>{day.slice(0, 4)}年</small></button>)}
    </div>
    {!dates.length ? <p role="alert">请先在旅程中选择有效的旅行日期。</p> : <>
      <div className={intentStyles.wheels}>
        <TimeWheel label="活动小时" value={hour} onChange={(next) => { setHour(next); setError(""); }} max={23} initialValue={15} disabled={busy} onPendingChange={setPendingHour} />
        <span aria-hidden="true">:</span>
        <TimeWheel label="活动分钟" value={minute} onChange={(next) => { setMinute(next); setError(""); }} max={59} initialValue={0} disabled={busy} onPendingChange={setPendingMinute} />
      </div>
      <p className={styles.note}>上下滑动或点选时间。已有行程会直接保存活动，无需重新生成。时间冲突时请另选时分。</p>
    </>}
    {error ? <p role="alert" className={intentStyles.error}>{error}</p> : null}
    <a className={styles.secondaryButton} href={place.url} target="_blank" rel="noopener noreferrer">{product ? "打开飞猪商品页 ↗" : "阅读来源原文 ↗"}</a>
    {whoopConnected ? <div className={styles.inset}><Icon name="pulse" size={16} /><p>你已连接 WHOOP。重新规划时会按本次授权使用近期记录。</p></div> : null}
  </div></Modal>;
}
