"use client";
import { useEffect, useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import type { AdjustmentRecord, Journey } from "@/lib/journey-types";
import { AdjustmentFollowUp } from "./adjustment-follow-up";
import css from "./adjustment.module.css";
type Request=<T>(url:string,options?:RequestInit)=>Promise<T>;
export function AdjustmentRecords({journey,request,onSaved,onMemoryChanged,compact=false}:{journey:Journey;request:Request;onSaved:(journey:Journey)=>void;onMemoryChanged?:()=>void;compact?:boolean}) {
  const [records,setRecords]=useState<AdjustmentRecord[]>([]),[revision,setRevision]=useState(0);
  useEffect(()=>{const abort=new AbortController();request<{adjustments:AdjustmentRecord[]}>(`/api/journeys/${journey.id}/adjustments`,{signal:abort.signal}).then(result=>{if(!abort.signal.aborted)setRecords(result.adjustments);}).catch(()=>{});return()=>abort.abort();},[journey.id,journey.version,revision,request]);
  const latest=records.find(record=>record.id===journey.plan?.bodyAdjustment?.id);
  return <>{latest&&!latest.outcome&&<AdjustmentFollowUp key={latest.id} journey={journey} beforeFatigue={latest.fatigueBefore?String(latest.fatigueBefore):""} changes={latest.changes.map(item=>item.title)} request={request} onSaved={value=>{onSaved(value);setRevision(v=>v+1);}} onMemoryChanged={onMemoryChanged}/>}
    {!compact&&records.some(record=>record.outcome)&&<details className={css.proposalReasons}><summary>每一次调整，都在更了解你</summary>{records.filter(record=>record.outcome).slice(0,6).map(record=><article key={record.id} className={css.panel}><small>{record.localDate}</small><p>{record.changes.map(item=>item.title).join(" · ")}</p>{record.fatigueBefore&&record.outcome?.fatigue&&<div className={css.outcomeTrend}><strong>{record.fatigueBefore}<small>调整前</small></strong><ArrowRight size={18}/><strong>{record.outcome.fatigue}<small>调整后</small></strong></div>}<p className={css.quiet}><Check size={13}/> {record.outcome?.feeling==='lighter'?'轻松了一些':record.outcome?.feeling==='same'?'差不多':'还是很累'}</p></article>)}</details>}
  </>;
}
