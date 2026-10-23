"use client";
import { useState } from "react";
import Image from "next/image";
import { CalendarDays, ExternalLink, MapPin, Plus, Check, ArrowRight } from "lucide-react";
import type { AssistantBlock } from "@/lib/agent/types";
import type { Journey } from "@/lib/journey-types";
import css from "./agent.module.css";

const choiceLabel = (label: string) => label.replace(/\s*[（(](?:Gentle|Balanced|Active)[)）]\s*/gi, "").trim();

type Request = <T>(url: string, options?: RequestInit) => Promise<T>;
export function AssistantBlocks({ blocks, messageId, journey, disabled, onAnswer, request, onCollectionsChanged }: { blocks: AssistantBlock[]; messageId: string; journey?: Journey; disabled: boolean; onAnswer: (answer: string) => void; request: Request; onCollectionsChanged?: () => void }) {
  const [dates, setDates] = useState<Record<string, string>>({}), [saved, setSaved] = useState<string[]>([]), [pending, setPending] = useState<string | null>(null), [error, setError] = useState("");
  async function saveOffer(offerId: string) {
    if (!journey || pending) return;
    setPending(offerId); setError("");
    try { await request(`/api/journeys/${journey.id}/collections`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "save_offer", expectedVersion: journey.version, messageId, offerId }) }); setSaved(old => [...old, offerId]); onCollectionsChanged?.(); }
    catch (error) { setError(error instanceof Error ? error.message : "保存失败，请重试。"); }
    finally { setPending(null); }
  }
  return <div className={css.blocks}>
    {blocks.map((block, index) => <section className={css.richBlock} key={`${block.type}-${index}`}>
      <h4>{block.title}</h4>
      {block.type === "question" && (block.input === "date" ? <div className={css.dateAnswer}><CalendarDays size={20} aria-hidden="true" /><input type="date" aria-label={block.title} min={block.min} value={dates[block.id] ?? ""} disabled={disabled} onChange={event => setDates(old => ({ ...old, [block.id]: event.target.value }))} /><button type="button" disabled={disabled || !dates[block.id]} onClick={() => onAnswer(`${block.title}：${dates[block.id]}`)} aria-label="确认日期"><ArrowRight size={20} /></button></div> : <div className={css.answerOptions}>{block.options?.map(option => <button type="button" key={option.value} disabled={disabled} onClick={() => onAnswer(`${block.title}：${choiceLabel(option.label)}`)}>{choiceLabel(option.label)}<ArrowRight size={16} /></button>)}</div>)}
      {block.type === "offers" && <div className={css.offerGrid}>{block.offers.map(offer => <article className={css.offer} key={offer.id}>
        {offer.imageUrl && <Image src={offer.imageUrl} alt={offer.name} width={560} height={300} unoptimized loading="lazy" className={css.offerPhoto} referrerPolicy="no-referrer" />}
        <div className={css.offerContent}><small>{offer.category}</small><h5>{offer.name}</h5>{offer.price && <strong className={css.offerPrice}>{offer.price}</strong>}
          <dl>{offer.facts.slice(0, 4).map((fact, i) => <div key={i}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>
          <div className={css.offerActions}><a href={offer.url} target="_blank" rel="noopener noreferrer">查看来源<ExternalLink size={14} /></a>{(offer.kind === "poi" || offer.kind === "hotel" || offer.address) && <a href={`https://uri.amap.com/search?keyword=${encodeURIComponent(`${journey?.draft.trip?.destinationCity ?? ""} ${offer.address ?? offer.name}`)}`} target="_blank" rel="noopener noreferrer"><MapPin size={14} />地图</a>}</div>
          {journey && <div className={css.offerActions}><button type="button" disabled={disabled || pending !== null || saved.includes(offer.id)} onClick={() => void saveOffer(offer.id)}>{saved.includes(offer.id) ? <Check size={16} /> : <Plus size={16} />}{saved.includes(offer.id) ? "已存待安排" : "存到待安排"}</button><button type="button" disabled={disabled} onClick={() => onAnswer(`把刚才检索到的“${offer.name}”加入这段旅程，请先核对时间并给我修改预览。`)}>加入行程<ArrowRight size={15} /></button></div>}
          <small className={css.retrieved}>检索于 {new Date(offer.retrievedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small>
        </div>
      </article>)}</div>}
      {block.type === "checklist" && <ul className={css.richChecklist}>{block.items.length ? block.items.map(item => <li key={item.id}><button type="button" disabled={disabled || item.kind !== "checklist"} aria-label={`${item.checked ? "取消完成" : "标记完成"} ${item.title}`} onClick={() => onAnswer(`把清单里的“${item.title}”标记为${item.checked ? "未完成" : "已完成"}。`)}>{item.checked ? <Check size={16} /> : <span />}</button><span>{item.title}<small>{item.kind === "backlog" ? "待安排" : item.detail}</small></span></li>) : <li>还没有项目，可以直接告诉我想准备什么。</li>}</ul>}
      {block.type === "difference" && <ul className={css.richDifference}>{block.changes.map((change, i) => <li key={i}><span>{change.before}</span><ArrowRight size={15} /><strong>{change.after}</strong></li>)}</ul>}
      {block.type === "status" && block.detail && <p>{block.detail}</p>}
    </section>)}
    {error && <p className={css.error} role="alert">{error}</p>}
  </div>;
}
