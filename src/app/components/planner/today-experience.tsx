"use client";
import { useState, type ReactNode } from "react";
import type { ItineraryActivity, Journey } from "@/lib/journey-types";
import { ArrowRight, ArrowUpRight, Check, Coffee, Footprints, Leaf, ListChecks, MapPin, MessageCircle, MoreHorizontal, Play, Sparkles } from "lucide-react";
import { Menu } from "@base-ui/react/menu";
import { JourneyCover } from "./journey-cover";
import { coverForDestination } from "@/lib/visual-assets";
import { FatigueCheckIn, FATIGUE_LABELS } from "./fatigue-check-in";
import { DayLoadChart } from "./day-load-chart";
import css from "./today-experience.module.css";
import body from "./body-experience.module.css";
type Props = {
  journey: Journey | null; accountName: string; items: ItineraryActivity[]; next: ItineraryActivity | null; date:string;
  fatigue:string; saving:boolean; error:string; recordedLabel:string; bodySummary:ReactNode; pendingPlan?:ReactNode; followUp?:ReactNode;
  busy:boolean; onFatigue:(value:string)=>void; onAdjust:()=>void; onCreate:()=>void; onJourney:()=>void; onCollections:()=>void; onSelect:(item:ItineraryActivity)=>void;
  onAsk:()=>void; onSwitch:()=>void; onStart:()=>void; onBody:()=>void; onProgress:(item:ItineraryActivity,state:"in_progress"|"completed"|"skipped")=>void;
};
export function TodayExperience(p:Props) {
  const [editFeeling,setEditFeeling]=useState(false);
  const cover=coverForDestination();
  const plan=p.journey?.plan;
  const active=p.journey?.status === "active";
  const next=p.next || p.items.find(item=>!['completed','skipped'].includes(item.progress?.state ?? "planned"));
  return <div className={css.root}>
    <div className={css.greeting}><span>每一步，都照顾自己的感受</span><button onClick={p.onSwitch} aria-label="切换旅程">我的旅程 <ArrowUpRight size={15}/></button></div>
    <section className={`${css.cover} ${plan ? css.compactCover : ""}`}><JourneyCover images={plan?.visuals?.cover} fallback={cover.src} alt={cover.alt}/><div className={css.coverCopy}><span>{plan ? `${p.journey?.draft.trip?.departureDate || ""} — ${p.journey?.draft.trip?.returnDate || ""}` : "A LITTLE ROOM TO WANDER"}</span><h1>{p.journey?.draft.trip?.destinationCity || "把时间，留给喜欢。"}</h1><p>{plan ? "看风景，也照顾自己。" : `${p.accountName || "旅行者"}，下一站想去哪里？`}</p></div></section>
    {!plan ? <section className={css.empty}><Leaf size={30}/><h2>从一次舒服的出发开始</h2><p>告诉我目的地，习惯与偏好会替你记住。</p><button className={css.primary} onClick={p.onCreate}>开启旅程 <ArrowRight size={18}/></button><button className={css.quiet} onClick={p.onAsk}>也可以直接和助手聊聊 <MessageCircle size={16}/></button></section> : <>
      {next ? <section className={css.next}><div className={css.sectionHeading}><span>{next.progress?.state === "in_progress" ? "正在这里" : "接下来"}</span><span>{next.time}{next.fixed ? " · 已固定" : ""}</span></div><button className={css.nextTitle} onClick={()=>p.onSelect(next)}><h2>{next.name}</h2><ArrowUpRight size={20}/></button><div className={css.nextMeta}><span><MapPin size={14}/>{next.kind === "rest" ? "给身体一点留白" : next.fixed ? "这项安排会为你保留" : "可以跟着感受调整"}</span>{next.move?.minutes ? <span><Footprints size={14}/>{next.move.minutes} 分钟{next.move.mode === "walk" ? "步行" : "交通"}</span> : null}</div>
        {active && next.id && <div className={css.progressActions}><button disabled={p.busy} onClick={()=>p.onProgress(next,next.progress?.state === "in_progress" ? "completed" : "in_progress")}>{next.progress?.state === "in_progress" ? <Check size={16}/> : <Play size={15}/>} {next.progress?.state === "in_progress" ? "已完成" : "开始这站"}</button><Menu.Root><Menu.Trigger className={css.more} aria-label="活动更多操作"><MoreHorizontal size={20}/></Menu.Trigger><Menu.Portal><Menu.Positioner sideOffset={8}><Menu.Popup className={css.menu}><Menu.Item onClick={()=>p.onProgress(next,"completed")}>标记已完成</Menu.Item><Menu.Item onClick={()=>p.onProgress(next,"skipped")}>跳过这站</Menu.Item></Menu.Popup></Menu.Positioner></Menu.Portal></Menu.Root></div>}
      </section> : <section className={css.finished}><Coffee size={24}/><h2>今天的留白，交给你。</h2><p>看看完整旅程，或找一个想去的地方。</p><button className={css.quiet} onClick={p.onJourney}>查看行程 <ArrowRight size={16}/></button></section>}
      <section className={css.feelingSection}>
        {!p.fatigue || editFeeling ? <FatigueCheckIn value={p.fatigue} disabled={p.saving} onChange={value=>{p.onFatigue(value);setEditFeeling(false);}}/> : <button className={css.feelingSummary} onClick={()=>setEditFeeling(true)} aria-label="更新今天的疲劳评分"><span className={css.feelingMark}><Leaf size={22}/></span><span><small>此刻的我 · {p.recordedLabel}</small><strong>{FATIGUE_LABELS[Number(p.fatigue)-1]}</strong></span><span className={css.score}>{p.fatigue}<small>/5</small></span><ArrowUpRight size={16}/></button>}
        {p.saving && <p role="status" className={css.saveStatus}>正在记住这次感受…</p>}{p.error && <p role="alert" className={body.error}>{p.error}</p>}
      </section>
      {p.bodySummary}
      {!p.bodySummary && <button className={css.bodyLink} onClick={p.onBody}>身体记录与呼吸练习 <ArrowUpRight size={15}/></button>}
      {p.journey?.status !== "completed" && <button className={css.adjustAction} disabled={p.busy} onClick={p.onAdjust}><Leaf size={21}/><span>让今天轻松一点<small>少走一点，多留一点休息</small></span><ArrowRight size={20}/></button>}
      {p.journey?.status === "planned" && <button className={css.startJourney} disabled={p.busy} onClick={p.onStart}>已到目的地？开始这段旅程 <ArrowRight size={15}/></button>}
      {p.pendingPlan}
      <section className={css.schedule}><div className={css.sectionHeading}><h2>今天的路线</h2><button onClick={p.onJourney}>完整旅程 <ArrowRight size={15}/></button></div><div className={css.route}>{p.items.slice(0,5).map((item,i)=><button key={item.id || i} onClick={()=>p.onSelect(item)} data-completed={item.progress?.state === "completed"}><time>{item.time}</time><span className={css.routeDot}>{item.progress?.state === "completed" ? <Check size={10}/> : null}</span><span><strong>{item.name}</strong><small>{item.fixed ? "固定安排" : item.kind === "rest" ? "休息时间" : item.move?.minutes ? `约 ${item.move.minutes} 分钟交通` : "灵活安排"}</small></span><ArrowUpRight size={14}/></button>)}</div></section>
      <DayLoadChart items={p.items}/>
      {p.followUp}
      <div className={css.secondaryLinks}><button onClick={p.onCollections}><ListChecks size={20}/><span>待安排与旅行清单</span><ArrowRight size={17}/></button><button onClick={p.onAsk}><MessageCircle size={20}/><span>和旅程助手聊聊</span><ArrowRight size={17}/></button></div>
    </>}
    {!plan && <>{p.bodySummary}{!p.bodySummary && <button className={css.bodyLink} onClick={p.onBody}>身体记录与呼吸练习 <ArrowUpRight size={15}/></button>}</>}
    <div className={css.signature}><Sparkles size={13}/><span>让旅途，越来越适合你。</span></div>
  </div>;
}
