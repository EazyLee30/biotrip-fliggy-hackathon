"use client";
import { useRef, useState } from "react";
import { ArrowRight, Check, Leaf, Minus, Moon } from "lucide-react";
import type { Journey } from "@/lib/journey-types";
import { FatigueCheckIn } from "../fatigue-check-in";
import { PhraseInput } from "../quick-inputs";
import { ToggleSwitch } from "../../toggle-switch";
import css from "./adjustment.module.css";
type Request=<T>(url:string,options?:RequestInit)=>Promise<T>;
const OUTCOMES=[{value:"lighter",label:"轻松了一些",icon:Leaf},{value:"same",label:"差不多",icon:Minus},{value:"still_tired",label:"还是很累",icon:Moon}] as const;
export function AdjustmentFollowUp({journey,beforeFatigue,changes,request,onSaved,onMemoryChanged}:{journey:Journey;beforeFatigue:string;changes:string[];request:Request;onSaved:(journey:Journey)=>void;onMemoryChanged?:()=>void}) {
  const [open,setOpen]=useState(false),[fatigue,setFatigue]=useState(""),[feeling,setFeeling]=useState(""),[remember,setRemember]=useState(false),[memoryNote,setMemoryNote]=useState(""),[busy,setBusy]=useState(false),[saved,setSaved]=useState(false),[error,setError]=useState("");
  const [outcomeRecorded,setOutcomeRecorded]=useState(false);
  const requestId=useRef<string|null>(null),outcomeSaved=useRef(false),savedJourney=useRef<Journey|null>(null);
  async function save(){if(busy||!feeling||(remember&&!memoryNote.trim()))return;setBusy(true);setError("");requestId.current??=crypto.randomUUID();try{
    if(!outcomeSaved.current){
      const adjustment=journey.plan?.bodyAdjustment;
      const result=await request<{journey:Journey}>(adjustment?.id?`/api/journeys/${journey.id}/adjustments/${adjustment.id}/outcome`:`/api/journeys/${journey.id}/feedback`,{method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":requestId.current},body:JSON.stringify(adjustment?.id?{version:journey.version,feeling,fatigue:fatigue?Number(fatigue):null}:{version:journey.version,adjustmentAt:adjustment?.updatedAt,fatigue:fatigue?Number(fatigue):null,note:`调整后的感受：${OUTCOMES.find(item=>item.value===feeling)?.label}。本次调整：${changes.slice(0,3).join("、").slice(0,350)}`})});
      outcomeSaved.current=true;setOutcomeRecorded(true);savedJourney.current=result.journey;window.dispatchEvent(new Event("biotrip:body-changed"));
    }
    if(remember){await request("/api/memory",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({note:memoryNote.trim(),scope:"global",category:"preference"})});onMemoryChanged?.();}
    setSaved(true);if(savedJourney.current)onSaved(savedJourney.current);
  }catch(e){setError(`${outcomeSaved.current?"感受已保存，偏好暂未保存。":""}${e instanceof Error?e.message:"请重试。"}`);}finally{setBusy(false);}}
  return <section className={css.panel} aria-label="调整后的感受"><h2>{saved?"这次感受，已记下。":"新节奏，感觉怎么样？"}</h2><p className={css.quiet}>{saved?"下一次调整，会结合这次的真实感受。":"休息或走完下一段后，回来告诉我。"}</p>
    {saved&&fatigue&&beforeFatigue&&<div className={css.outcomeTrend}><strong>{beforeFatigue}<small>调整之前</small></strong><ArrowRight size={20}/><strong>{fatigue}<small>现在的感受</small></strong></div>}
    {!saved&&(!open?<button className={css.primary} onClick={()=>setOpen(true)}>记录调整后的感受 <ArrowRight size={17}/></button>:<><div className={css.outcomes}>{OUTCOMES.map(({value,label,icon:Icon})=><button key={value} disabled={busy||outcomeRecorded} aria-pressed={feeling===value} onClick={()=>setFeeling(value)}><Icon size={24}/>{label}</button>)}</div><FatigueCheckIn value={fatigue} onChange={setFatigue} disabled={busy||outcomeRecorded}/><label className={css.followupToggle}><ToggleSwitch label="记住一项旅行偏好" checked={remember} disabled={busy} onChange={setRemember}/><span>为下次记住一项偏好</span></label>{remember&&<PhraseInput label="你希望记住什么？" value={memoryNote} onChange={setMemoryNote} phrases={["下午留出坐下休息的时间","减少连续步行","抵达当天少安排活动"]} maxLength={500} rows={2} disabled={busy}/>}<button className={css.primary} disabled={busy||!feeling||(remember&&!memoryNote.trim())} onClick={()=>void save()}>{busy?"正在保存…":"记下这次感受"}<Check size={17}/></button>{error&&<p role="alert" className={css.error}>{error}</p>}</>)}
  </section>;
}
