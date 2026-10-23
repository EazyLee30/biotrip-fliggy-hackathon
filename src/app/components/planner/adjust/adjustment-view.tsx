"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowRight, ArrowLeft, ArrowUpRight, Check, Coffee, Leaf, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import type { Journey } from "@/lib/journey-types";
import type { PlanningJob } from "@/lib/planning/jobs";
import { adjustmentScope } from "@/lib/adjust/request";
import { bundle, resolveAccepted, type BundleName } from "@/lib/adjust/validate";
import { CHECK_IN_LABELS, CHECK_IN_TAGS, STANCE_LABELS, STANCES, type CheckInTag, type Proposal, type Stance } from "@/lib/adjust/types";
import { adjustmentDifferences } from "@/lib/adjust/preview";
import { StepTransition } from "../../ui/motion-provider";
import { ToggleSwitch } from "../../toggle-switch";
import { FatigueCheckIn } from "../fatigue-check-in";
import { DayLoadChart } from "../day-load-chart";
import { AdjustmentFollowUp } from "./adjustment-follow-up";
import css from "./adjustment.module.css";

type Request = <T>(url:string,options?:RequestInit)=>Promise<T>;
type Props={whoopSummary?:ReactNode;journey:Journey;request:Request;onSaved:(journey:Journey)=>void;onBreathing:()=>void;onVersions:()=>void;whoopConnected:boolean;memoryAllowed:boolean;initialFatigue?:string;onFatigueChange?:(value:string)=>void;onMemoryChanged?:()=>void};
const NO_PROPOSALS:Proposal[]=[];
const ACTIVE=["queued","running","cancel_requested"];
const TITLES=["先听听身体的感受","选一种，舒服一点的安排","看看今天会怎样变化","新的节奏，已经安排好"];
const LABELS:Record<string,string>={health_insight:"正在结合你的感受",relief_inventory:"正在寻找附近能歇脚的地方",local_research:"正在核对地点资料",mobility:"正在核对到下一站的时间",compose_adjustments:"正在整理适合你的安排"};
function costLabel(proposals:Proposal[]) {
  const ranges=proposals.map(item=>item.effect.costCny).filter((value):value is [number,number]=>Boolean(value));
  if(ranges.length===proposals.length&&ranges.length){const low=ranges.reduce((n,v)=>n+v[0],0),high=ranges.reduce((n,v)=>n+v[1],0);return low===0&&high===0?"预计无新增费用":`费用变化约 ¥${low}–${high}`;}
  return "费用待核验";
}
type Choice={key:string;title:string;subtitle:string;ids:string[];proposals:Proposal[]};

export function AdjustmentView(p:Props) {
  const [fatigue,setFatigue]=useState(p.initialFatigue || ""),[tags,setTags]=useState<CheckInTag[]>([]),[stance,setStance]=useState<Stance>("balanced");
  const [step,setStep]=useState(p.initialFatigue ? 1 : 0),[direction,setDirection]=useState(1),[job,setJob]=useState<PlanningJob|null>(null),[selected,setSelected]=useState<string[]>([]);
  const [pending,setPending]=useState(false),[restored,setRestored]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState(""),[enhanceOpen,setEnhanceOpen]=useState(false),[includeWhoop,setIncludeWhoop]=useState(false),[includeMemory,setIncludeMemory]=useState(true),[stage,setStage]=useState(""),[reconnecting,setReconnecting]=useState(false);
  const [applied,setApplied]=useState<{changes:string[];fatigue:string}|null>(null);
  const lock=useRef(false),alive=useRef(true),cursor=useRef(0),auto=useRef(false),retry=useRef<{kind:string;key:string;body:string}|null>(null);
  const itinerary=p.journey.plan!.plan.itinerary, trip=p.journey.draft.trip!, scope=useMemo(()=>adjustmentScope(p.journey),[p.journey]);
  const request=p.request,journeyId=p.journey.id,jobId=job?.id,jobState=job?.state;
  const running=Boolean(job&&ACTIVE.includes(job.state)), awaiting=job?.state === "awaiting_approval";
  const expired=scope.date>scope.throughDate || p.journey.status === "completed";
  const proposals=job?.adjustment?.proposals ?? NO_PROPOSALS;
  function go(next:number){setDirection(next>step?1:-1);setStep(next);window.scrollTo({top:0,behavior:"smooth"});}

  useEffect(()=>{alive.current=true;const abort=new AbortController();request<{jobs:PlanningJob[]}>("/api/plan/jobs",{signal:abort.signal}).then(async result=>{
    if(!alive.current || abort.signal.aborted)return;
    const saved=result.jobs.find(entry=>entry.mode==="adjust"&&entry.journeyId===journeyId&&(ACTIVE.includes(entry.state)||entry.state==="awaiting_approval"));
    if(saved?.adjustment&&saved.adjustment.scope.date!==scope.date){
      await request(`/api/plan/jobs/${saved.id}`,saved.state==="awaiting_approval"?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"discard",version:p.journey.version})}:{method:"DELETE"});
      if(abort.signal.aborted)return;setNotice("已进入新的一天，请更新此刻的感受。");
    }else if(saved){auto.current=true;setJob(saved);setStep(1);setNotice("已接着上次的调整继续。");}
    setRestored(true);
  }).catch(()=>{if(!abort.signal.aborted){setRestored(true);setNotice("暂时无法读取上次进度，提交时会重新核对。");}});return()=>{alive.current=false;abort.abort();};},[journeyId,request,scope.date,p.journey.version]);
  const autoStart=useEffectEvent(()=>{if(p.initialFatigue&&!fatigue)setFatigue(p.initialFatigue);void submit("quick",p.initialFatigue);});
  useEffect(()=>{if(restored&&p.initialFatigue&&!auto.current&&!expired){auto.current=true;autoStart();}},[restored,p.initialFatigue,expired]);
  useEffect(()=>{
    if(!jobId||!jobState||!ACTIVE.includes(jobState))return;
    const abort=new AbortController();let timer:ReturnType<typeof setTimeout>;
    async function poll(){try{const result=await request<{job:PlanningJob;events:Array<{seq:number;payload:{stage?:string;status?:string}}> }>(`/api/plan/jobs/${jobId}?after=${cursor.current}`,{signal:abort.signal});if(abort.signal.aborted)return;for(const event of result.events){cursor.current=Math.max(cursor.current,event.seq);if(event.payload.stage)setStage(event.payload.stage);}setJob(result.job);setReconnecting(false);if(!ACTIVE.includes(result.job.state)){if(result.job.state!=="awaiting_approval")setNotice(result.job.error||"这次搜索已停止，可以继续使用快速调整。");return;}}catch{if(abort.signal.aborted)return;setReconnecting(true);}timer=setTimeout(()=>void poll(),1800);}
    void poll();return()=>{abort.abort();clearTimeout(timer);};
  },[jobId,jobState,request]);

  async function submit(kind:"quick"|"enhanced",knownFatigue=fatigue){
    if(lock.current||expired||(!knownFatigue&&!tags.length))return;
    lock.current=true;setPending(true);setError("");setNotice("");setApplied(null);setSelected([]);go(1);
    try{
      if(job?.state==="awaiting_approval")await p.request(`/api/plan/jobs/${job.id}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"discard",version:p.journey.version})});
      const body=JSON.stringify({mode:"adjust",journeyId:p.journey.id,expectedVersion:p.journey.version,consent:true,includeWhoop:kind==="enhanced"&&includeWhoop,includeMemory:p.memoryAllowed&&includeMemory,checkIn:{fatigue:knownFatigue?Number(knownFatigue):null,stress:null,tags},stance,scope:adjustmentScope(p.journey)});
      if(!retry.current||retry.current.kind!==kind||retry.current.body!==body)retry.current={kind,key:crypto.randomUUID(),body};
      const result=await p.request<{job:PlanningJob}>(kind==="quick"?`/api/journeys/${p.journey.id}/adjustments/quick`:"/api/plan/jobs",{method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":retry.current.key},body:retry.current.body});
      if(alive.current){setJob(result.job);retry.current=null;cursor.current=0;setEnhanceOpen(false);}
    }catch(e){if(alive.current)setError(e instanceof Error?e.message:"暂时没能准备好方案，请重试。");}
    finally{lock.current=false;if(alive.current)setPending(false);}
  }
  const choices=useMemo(()=>{
    const result:Choice[]=[];const seen=new Set<string>();
    const add=(key:string,title:string,subtitle:string,ids:string[])=>{const signature=[...ids].sort().join("|");if(!ids.length||seen.has(signature))return;try{const preview=resolveAccepted(proposals,ids,itinerary,trip,job?.adjustment?.scope??scope);if(!preview.operations.length)return;}catch{return;}seen.add(signature);result.push({key,title,subtitle,ids,proposals:proposals.filter(item=>ids.includes(item.id))});};
    const presets:Array<[BundleName,string,string]>=[["minimal","少改一点","保留主要安排，腾一点空隙"],["easy","多休息一点","减少负担，让今天更从容"],["treat","换种轻松安排","看看附近适合歇脚的选择"]];
    presets.forEach(([key,title,subtitle])=>add(key,title,subtitle,bundle(proposals,key,stance)));
    proposals.filter(item=>item.templates.length).forEach(item=>{if(result.length<3)add(item.id,item.templates.some(t=>t.type==="end_early")?"早点结束":item.title,item.reason,[item.id]);});
    return result.slice(0,3);
  },[proposals,itinerary,trip,job?.adjustment?.scope,scope,stance]);
  const preview=useMemo(()=>{try{return {itinerary:resolveAccepted(proposals,selected,itinerary,trip,job?.adjustment?.scope??scope).itinerary,error:""};}catch(e){return{itinerary,error:e instanceof Error?e.message:"这组调整已经变化，请重新选择。"};}},[proposals,selected,itinerary,trip,job?.adjustment?.scope,scope]);
  const chosen=proposals.filter(item=>selected.includes(item.id));
  const changes=adjustmentDifferences(itinerary,preview.itinerary);
  async function apply(){if(!job||lock.current||!selected.length)return;lock.current=true;setPending(true);setError("");try{const result=await p.request<{job:PlanningJob;journey?:Journey}>(`/api/plan/jobs/${job.id}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"apply",version:p.journey.version,accept:selected})});if(!alive.current)return;setJob(result.job);if(result.journey){setApplied({changes:chosen.map(v=>v.title),fatigue});p.onSaved(result.journey);go(3);}}catch(e){if(alive.current)setError(e instanceof Error?e.message:"行程尚未更新，请重试。");}finally{lock.current=false;if(alive.current)setPending(false);}}
  async function discard(){if(!job||lock.current)return;lock.current=true;setPending(true);setError("");try{const result=await p.request<{job:PlanningJob}>(`/api/plan/jobs/${job.id}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"discard",version:p.journey.version})});if(alive.current){setJob(result.job);setSelected([]);setNotice("这次建议已放弃，原行程保留。可以重新选择，或返回其他页面。");go(0);}}catch(e){if(alive.current)setError(e instanceof Error?e.message:"暂时无法放弃，请重试。");}finally{lock.current=false;if(alive.current)setPending(false);}}
  async function cancel(){if(!job||lock.current)return;lock.current=true;setPending(true);try{const result=await p.request<{job:PlanningJob}>(`/api/plan/jobs/${job.id}`,{method:"DELETE"});if(alive.current)setJob(result.job);}catch(e){setError(e instanceof Error?e.message:"正在核对停止状态。");}finally{lock.current=false;if(alive.current)setPending(false);}}
  return <div className={css.root}>
    <div className={css.stepper}><span>让今天轻松一点</span><div aria-label={`第${Math.min(step+1,3)}步，共3步`}>{[0,1,2].map(i=><i key={i} data-active={i<=step}/>)}</div></div>
    <StepTransition step={step} direction={direction} className={css.stage}>
      <span className={css.kicker}>{trip.destinationCity} · 跟着身体走</span><h1>{TITLES[step]}</h1>
      {step===0&&<><p className={css.intro}>点选此刻的感受，就能开始。</p><FatigueCheckIn value={fatigue} disabled={pending} onChange={value=>{auto.current=true;setFatigue(value);p.onFatigueChange?.(value);}}/><div className={css.tags}>{CHECK_IN_TAGS.map(tag=><button key={tag} aria-pressed={tags.includes(tag)} onClick={()=>setTags(current=>current.includes(tag)?current.filter(v=>v!==tag):[...current,tag])}>{CHECK_IN_LABELS[tag]}</button>)}</div><button className={css.primary} disabled={pending||expired||(!fatigue&&!tags.length)} onClick={()=>void submit("quick")}>看看怎么安排 <ArrowRight size={18}/></button></>}
      {step===1&&<>
        {pending||!restored?<div className={css.loading} role="status"><div className={css.breathingLeaf}><Leaf size={32}/></div><h2>给今天腾一点空隙</h2><p>正在核对固定安排和可用时间</p></div>:running?<div className={css.loading} role="status"><div className={css.breathingLeaf}><Sparkles size={30}/></div><h2>{LABELS[stage]||"正在寻找更合适的选择"}</h2><p>{reconnecting?"正在恢复进度连接，任务仍在继续。":"找到的结果会接着出现在这里。"}</p><button className={css.textButton} disabled={pending||job?.state==="cancel_requested"} onClick={()=>void cancel()}>{job?.state==="cancel_requested"?"正在确认停止…":"停止搜索"}</button></div>:<>
          <p className={css.intro}>先选一个方向，再看看具体变化。</p>
          {awaiting&&choices.length?<div className={css.choices}>{choices.map((choice,i)=><button key={choice.key} className={css.choice} onClick={()=>{setSelected(choice.ids);go(2);}}><div className={css.choiceHead}><span>{i===0?<Leaf size={22}/>:i===1?<Coffee size={22}/>:<Sparkles size={22}/>}</span>{i===0&&<small>建议先看看</small>}<ArrowRight size={20}/></div><h2>{choice.title}</h2><p>{choice.subtitle}</p><div className={css.effects}><span>{choice.proposals.length} 处调整</span><span>{costLabel(choice.proposals)}</span>{choice.proposals.reduce((n,item)=>n+(item.effect.restMinutes||0),0)>0&&<span>休息 +{choice.proposals.reduce((n,item)=>n+(item.effect.restMinutes||0),0)} 分钟</span>}<span>{itinerary.filter(v=>v.fixed).length} 项固定安排保留</span></div></button>)}</div>:<div className={css.noResults}><Coffee size={28}/><h2>先留在舒服的节奏里</h2><p>{expired?"这段旅程已结束，可以查看历史安排。":"当前时间里没有合适的基础调整，可以换一种感受，或搜索附近的选择。"}</p></div>}
          {!expired&&<><button className={css.enhance} onClick={()=>setEnhanceOpen(v=>!v)}><Sparkles size={18}/><span>也想找附近能休息的地方</span><ArrowUpRight size={16}/></button>{enhanceOpen&&<div className={css.enhanceSettings}><h3>这次想怎样安排？</h3><div className={css.tags}>{STANCES.map(value=><button key={value} aria-pressed={stance===value} onClick={()=>setStance(value)}>{STANCE_LABELS[value]}</button>)}</div>{p.whoopConnected ? p.whoopSummary : null}{p.whoopConnected&&<label><span>参考近期 WHOOP 记录</span><ToggleSwitch label="本次调整使用 WHOOP" checked={includeWhoop} onChange={setIncludeWhoop}/></label>}<label><span>参考旅行记忆</span><ToggleSwitch label="本次调整使用旅行记忆" checked={p.memoryAllowed&&includeMemory} disabled={!p.memoryAllowed} onChange={setIncludeMemory}/></label><p>确认后结合本次感受寻找地点与路线，生成的新方案仍由你决定。</p><button className={css.primary} disabled={!fatigue&&!tags.length} onClick={()=>void submit("enhanced")}>同意并寻找附近选择 <ArrowRight size={17}/></button></div>}</>}
          <div className={css.links}><button onClick={()=>go(0)}>更新此刻感受</button><button onClick={p.onBreathing}>先做一次呼吸练习</button></div>{awaiting&&<button className={css.textButton} disabled={pending} onClick={()=>void discard()}>放弃这次建议</button>}
        </>}
      </>}
      {step===2&&<><p className={css.intro}>只改变选中的部分，重要安排会留下。</p><div className={css.protected}><ShieldCheck size={18}/><span>固定预约与已完成活动受保护</span></div><div className={css.comparison}><DayLoadChart title="调整之前" items={itinerary.filter(item=>item.date===scope.date)}/><DayLoadChart title="调整之后" items={preview.itinerary.filter(item=>item.date===scope.date)}/></div><p className={css.quiet}>{costLabel(chosen)} · 价格与交通时间以实际核验为准</p><div className={css.difference}>{changes.map(change=><article key={change.id}><span className={css.changeDot}/><div><small>{change.kind==="added"?"留出新的时间":change.kind==="removed"?"先收进待安排":"换个更舒服的节奏"}</small>{change.before&&<p className={css.before}>{change.before}</p>}{change.after&&<p>{change.after}</p>}</div></article>)}</div><div className={css.proposalReasons}>{chosen.map(proposal=><details key={proposal.id}><summary>{proposal.title} · 为什么这样安排</summary><p>{proposal.reason}</p>{proposal.source?.price&&<p>来源报价：{proposal.source.price}</p>}{proposal.source&&<a href={proposal.source.url} target="_blank" rel="noreferrer">{proposal.source.name} · 查看来源 ↗</a>}</details>)}</div>{preview.error&&<p role="alert" className={css.error}>{preview.error}</p>}<footer className={css.footer}><button onClick={()=>go(1)} disabled={pending}><ArrowLeft size={17}/> 换个方案</button><button className={css.primary} disabled={pending||!!preview.error||!changes.length} onClick={()=>void apply()}>{pending?"正在更新行程…":"就这样安排"}<Check size={18}/></button></footer></>}
      {step===3&&applied&&<><div className={css.successMark}><Check size={32}/></div><p className={css.intro}>接下来，按舒服的节奏慢慢走。</p><div className={css.savedChanges}>{applied.changes.map(change=><p key={change}><Check size={14}/>{change}</p>)}</div><AdjustmentFollowUp journey={p.journey} beforeFatigue={applied.fatigue} changes={applied.changes} request={p.request} onSaved={p.onSaved} onMemoryChanged={p.onMemoryChanged}/><button className={css.textButton} onClick={p.onVersions}>查看调整前的方案 <ArrowUpRight size={15}/></button></>}
    </StepTransition>
    {notice&&<p className={css.notice} role="status">{notice}</p>}{error&&<div className={css.error} role="alert"><p>{error}</p>{!running&&step!==2&&<button onClick={()=>void submit("quick")} disabled={pending}><RefreshCw size={15}/>重新准备快速方案</button>}</div>}
  </div>;
}
