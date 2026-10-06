"use client";

import { useId, useMemo, useRef } from "react";
import type { KeyboardEvent } from "react";
import { mergeRecommendations, type PlanRecommendation } from "@/lib/planning-recommendations";
import { EditorialImage } from "./editorial-image";
import { Icon } from "../zen-ui";
import styles from "./waiting-recommendations.module.css";

export type WaitingRecommendationsProps = {
  complete?: boolean;
  items: readonly PlanRecommendation[];
  destination: string;
  onSelect: (item: PlanRecommendation) => void;
};

/** No timer or auto-scroll: each new batch appends while the traveller keeps their place. */
export function WaitingRecommendations({ items, destination, onSelect, complete = false }: WaitingRecommendationsProps) {
  const verified = useMemo(() => mergeRecommendations([], items), [items]);
  const scroll = useRef<HTMLDivElement>(null);
  const titleId = useId(), hintId = useId();
  function move(direction: -1 | 1) {
    const area = scroll.current;
    if (!area) return;
    area.scrollBy({ left: direction * Math.max(220, area.clientWidth * .85), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
  function keydown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); move(event.key === "ArrowLeft" ? -1 : 1); }
    else if (event.key === "Home" || event.key === "End") {
      event.preventDefault(); scroll.current?.scrollTo({ left: event.key === "Home" ? 0 : scroll.current.scrollWidth, behavior: "auto" });
    }
  }
  return <section className={styles.section} aria-labelledby={titleId}>
    <div className={styles.header}><div><span className={styles.eyebrow}><Icon name="compass" size={14} />{complete ? "继续看看" : "边等边看看"}</span><h3 id={titleId}>{destination ? `${destination}的当地推荐` : "本次检索的当地推荐"}</h3></div><div className={styles.controls}><button type="button" aria-label="向左浏览当地推荐" disabled={verified.length < 2} onClick={() => move(-1)}><Icon name="back" size={18} /></button><button type="button" aria-label="向右浏览当地推荐" disabled={verified.length < 2} onClick={() => move(1)}><Icon name="arrow" size={18} /></button></div></div>
    <p className={styles.hint} id={hintId}>{complete ? "本次检索的推荐已保留，可以继续浏览详情。" : "行程仍在编排。这里会陆续展示本次检索到的真实来源，可先查看详情。"}</p>
    <span className={styles.status} role="status" aria-live="polite">{verified.length ? `本次已返回 ${verified.length} 条公开来源` : complete ? "本次没有可展示的推荐" : "正在等待首批检索结果"}</span>
    {verified.length ? <div className={styles.viewport} ref={scroll} tabIndex={0} role="group" aria-label="横向浏览当地推荐" aria-describedby={hintId} onKeyDown={keydown}>
      <ul className={styles.cards}>{verified.map((item) => <li className={styles.card} key={item.url}>
        <button type="button" className={styles.detail} onClick={() => onSelect(item)} aria-label={`查看${item.name}详情`}><EditorialImage imageUrl={item.imageUrl} product={item.source === "飞猪实时搜索"} subject={item.category + " " + item.name} compact /><div className={styles.copy}><span className={styles.category}>{item.category}</span><h4>{item.name}</h4><p>{item.reason}</p><span className={styles.read}>查看详情 <Icon name="arrow" size={14} /></span></div></button>
        <a className={styles.source} href={item.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"><span>{item.source}</span><span>原始来源 ↗</span></a>
      </li>)}</ul>
    </div> : <div className={styles.empty}><Icon name="clock" size={24} /><div><strong>{complete ? "本次没有可展示的推荐" : `正在查找${destination || "目的地"}的真实资料`}</strong><p>{complete ? "行程结果可以通过上方按钮查看。" : "首批检索结果返回后会显示在这里。你也可以继续等待行程完成。"}</p></div></div>}
    <p className={styles.footnote}>价格、余位、开放时间及预约条件请以原始来源为准。</p>
  </section>;
}
