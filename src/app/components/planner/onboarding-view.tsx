"use client";
import { StepTransition } from "../ui/motion-provider";
import { useEffect, useRef, useState } from "react";
import { HABITS, PACES, onboardingNotes, type OnboardingAnswers } from "@/lib/onboarding-options";
import { Icon } from "../zen-ui";
import css from "./replan-wizard.module.css";
import ui from "./onboarding.module.css";
const TITLES=["旅途中，你喜欢哪种节奏？","怎样旅行，会让你更舒服？","还有什么，想让我提前知道？","这几件事，我会记住。"];
export function OnboardingView({onDone}:{onDone:()=>Promise<void>}) {
 const [step,setStep]=useState(0),[answers,setAnswers]=useState<OnboardingAnswers>({pace:"",habits:[],homeCity:"",food:""}),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const heading = useRef<HTMLHeadingElement>(null);
 useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [step]);
 const notes=onboardingNotes(answers);
 async function finish(skip=false) { if(busy)return;setBusy(true);setError("");try{const r=await fetch("/api/onboarding",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(skip?{skip:true}:{...answers,confirm:true})});if(!r.ok){const v=await r.json() as {error?:string};throw new Error(v.error||"暂时没能保存，请重试。");}await onDone();}catch(e){setError(e instanceof Error?e.message:"暂时没能保存。");}finally{setBusy(false);} }
 function go(next:number){setStep(next);window.scrollTo({top:0,behavior:"smooth"});}
 return <main className={ui.page}><header><strong>BioTrip</strong><button disabled={busy} onClick={()=>void finish(true)}>先跳过</button></header><div className={`${css.root} ${ui.flow}`}><div className={css.progress}><span>认识你 · {step+1} / 4</span><div>{TITLES.map((_,i)=><i key={i} data-active={i<=step}/>)}</div></div><StepTransition step={step} className={ui.stage}><span className={css.kicker}>让旅行，越来越适合你</span><h1 ref={heading} tabIndex={-1}>{TITLES[step]}</h1><p>{step===3?"下次直接带入，随时可以在记忆里修改或删除。":"点选就好，不确定的可以跳过。"}</p>
 {step===0&&<div className={ui.paces}>{PACES.map(p=><button key={p.value} disabled={busy} aria-pressed={answers.pace===p.value} onClick={()=>setAnswers({...answers,pace:p.value})}><svg viewBox="0 0 240 50" aria-hidden="true"><path d="M12 25H228" stroke="#d8e0cf" strokeWidth="3" strokeDasharray="3 6"/>{Array.from({length:p.count},(_,i)=><g key={i}><circle cx={25+i*(190/Math.max(1,p.count-1))} cy="25" r="12" fill={answers.pace===p.value?"#527850":"#a8b79a"}/><circle cx={25+i*(190/Math.max(1,p.count-1))} cy="25" r="4" fill="#fffefa"/></g>)}</svg><span><strong>{p.label}</strong><small>{p.count===2?"活动少一点，留白多一点":p.count===3?"有探索，也有歇脚的时间":"愿意多走走，看看更多地方"}</small></span></button>)}</div>}
 {step===1&&<div className={ui.habits}>{HABITS.map((h,i)=><button key={h.value} disabled={busy} aria-pressed={answers.habits.includes(h.value)} onClick={()=>setAnswers({...answers,habits:answers.habits.includes(h.value)?answers.habits.filter(v=>v!==h.value):[...answers.habits,h.value]})}><span className={ui.symbol} aria-hidden="true"><Icon name={(["cup","sun","leaf","walk"] as const)[i]}/></span><strong>{h.label}</strong><span className={ui.check} aria-hidden="true">{answers.habits.includes(h.value)?"✓":"＋"}</span></button>)}</div>}
 {step===2&&<div className={ui.inputs}><label><Icon name="pin"/><span>通常从哪里出发？<input aria-label="常用出发城市" value={answers.homeCity} disabled={busy} maxLength={100} onChange={e=>setAnswers({...answers,homeCity:e.target.value})} placeholder="例如：上海（选填）"/></span></label><label><Icon name="leaf"/><span>饮食喜好或忌口<textarea aria-label="饮食喜好或忌口" value={answers.food} disabled={busy} maxLength={500} onChange={e=>setAnswers({...answers,food:e.target.value})} placeholder="例如：清淡、不吃海鲜（选填）" rows={2}/></span></label></div>}
 {step===3&&<div className={ui.review}>{notes.length?notes.map(n=><div key={n.category+n.value}><Icon name="check" size={18}/><span>{n.note}</span></div>):<p>暂时不保存偏好，旅行中也可以慢慢告诉我。</p>}</div>}
 {error&&<p role="alert">{error}</p>}</StepTransition><footer className={css.footer}>{step>0&&<button disabled={busy} onClick={()=>go(step-1)}>上一步</button>}<button className={css.primary} disabled={busy} onClick={()=>step<3?go(step+1):void finish()}>{busy?"保存中…":step===3?(notes.length?"记住这些，开始旅行":"开始旅行"):"下一步"}<Icon name="arrow" size={18}/></button></footer></div></main>;
}
