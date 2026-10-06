"use client";
import { useState } from "react";
import type { Journey } from "@/lib/journey-types";
import type { PlanningJob } from "@/lib/planning/jobs";
import type { JourneyVersion } from "@/lib/journey-versions";
import { compareItineraries } from "@/lib/itinerary-diff";
import { Modal, Badge } from "../zen-ui";
import styles from "../zen-dashboard.module.css";
export function PlanReviewDialog({current,candidate,versions,busy,error,onDecision,onRestore,onClose}:{
 current:Journey;candidate?:PlanningJob;versions?:JourneyVersion[];busy:boolean;error:string;
 onDecision?:(action:'apply'|'discard')=>Promise<void>;onRestore?:(version:number)=>Promise<void>;onClose:()=>void;
}) {
 const [selected,setSelected]=useState<number|null>(null);
 const snapshot=versions?.find(item=>item.version===selected);
 const next=candidate?.candidate ?? snapshot?.plan;
 const before=current.plan?.plan.itinerary ?? [],after=next?.plan.itinerary ?? [];
 const {removed,added,changed,retained:unchanged}=compareItineraries(before,after);
 const fixed=after.filter(item=>item.fixed);
 const conflict=Boolean(candidate && current.version!==candidate.baseVersion);
 return <Modal title={candidate ? "确认新的行程安排" : "行程版本历史"} onClose={onClose} busy={busy} footer={next ? <div className={styles.stack}>
  {candidate ? <><button className={styles.primaryButton} disabled={busy || conflict} onClick={()=>void onDecision?.('apply')}>采用新方案</button><button className={styles.secondaryButton} disabled={busy} onClick={()=>void onDecision?.('discard')}>保留当前安排，放弃新方案</button></> : <button className={styles.primaryButton} disabled={busy || current.status==='completed'} onClick={()=>selected!==null && void onRestore?.(selected)}>确认恢复这个版本</button>}
 </div> : undefined}>
  <div className={styles.stack}>
   {versions ? <><p className={styles.note}>保留最近 30 次安排变更。恢复会产生一个新版本，不会调用模型或修改供应商订单。</p>{versions.map(v=><button key={v.version} className={selected===v.version?styles.primaryButton:styles.secondaryButton} disabled={busy} onClick={()=>setSelected(v.version)}><span>版本 {v.version} · {new Date(v.createdAt).toLocaleString('zh-CN')}<br/>{v.plan.plan.headline}</span></button>)}{!versions.length?<p>还没有可恢复的历史安排。</p>:null}</> : <p className={styles.note}>当前安排会继续保留，确认采用后才替换。请核对日期、地点和固定预约。</p>}
   {conflict?<p role="alert" className={styles.error}>当前行程已被修改，这份候选方案不能覆盖它。请保留当前安排，再重新调整。</p>:null}
   {next ? <><h3>{next.plan.headline}</h3><p>{next.plan.summary}</p><div className={styles.filterRow}><Badge tone="green">保留 {unchanged.length} 项</Badge><Badge tone="mint">新增 {added.length} 项</Badge><Badge tone="muted">移出 {removed.length} 项</Badge><Badge tone="muted">调整 {changed.length} 项</Badge></div>
    <details><summary>查看移出的安排与内容变化</summary>{removed.map((item,i)=><p key={`r${i}`}>{item.date} {item.time} · {item.name} · 移出</p>)}{changed.map(({before:old,after:item},i)=><p key={item.id ?? `c${i}`}>{old.date} {old.time} · {old.name} → {item.date} {item.time} · {item.name}<br/>{item.detail}{old.fixed!==item.fixed ? ` · 改为${item.fixed?"固定":"灵活"}安排` : ""}</p>)}</details>
    <div className={styles.inset}><div><strong>候选方案中的固定安排 · {fixed.length} 项</strong>{fixed.map((item,i)=><p key={item.id ?? i}>{item.date} {item.time} · {item.name}</p>)}<small>恢复旧版本时，近期新增的预约可能不在旧安排中，请逐项核对。</small></div></div>
    <details open><summary>查看完整安排 · {after.length} 项</summary>{after.map((item,i)=><div key={item.id ?? i} className={styles.summaryRow}><span>{item.date}<br/>{item.time}</span><div><strong>{item.name}{item.fixed?' · 固定':''}</strong><p>{item.detail}</p></div></div>)}</details></>:null}
   {error?<p role="alert" className={styles.error}>{error}</p>:null}
  </div>
 </Modal>;
}
