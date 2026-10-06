import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { getDatabase } from "@/lib/database";
import { runPlanning } from "@/lib/planning/pipeline";
import { runAdjustments } from "@/lib/planning/adjust-pipeline";
import { preparePlanning, prepareAdjustment, generatedPlan } from "@/lib/planning/service";
import { finishAdjustmentJob, finishJob, failJob, jobEvent, completeCancellation, cleanupJobSessions, type JobRow } from "@/lib/planning/jobs";
import { PlannerError, type PlanStage } from "@/lib/planning/contract";
import { STAGE_BY_NAME } from "@/lib/planning/stages";

type Params={jobId:string};
/** Paid stages have zero automatic retries. An interrupted call is never billed a second time. */
export class PlanningWorkflow extends WorkflowEntrypoint<Cloudflare.Env,Params> {
 async run(event:WorkflowEvent<Params>,step:WorkflowStep) {
  const db=getDatabase();
  const row=await step.do('load-task',async()=>{
   const job=await db.prepare("SELECT * FROM planning_jobs WHERE id=?").bind(event.payload.jobId).first<JobRow>();
   if(!job) throw new Error('JOB_NOT_FOUND');
   await db.prepare("UPDATE planning_jobs SET state='running',updated_at=unixepoch() WHERE id=? AND state='queued'").bind(job.id).run();
   return job;
  });
  if(!['queued','running'].includes(row.state)) return {jobId:row.id};
  let pending=Promise.resolve();
  const emit=(kind:'progress'|'recommendations',payload:unknown)=>{pending=pending.then(()=>jobEvent(row.id,kind,payload));};
  const controller=new AbortController();
  let timer:ReturnType<typeof setInterval>|undefined;
  try {
   // WHOOP raw records are fetched only inside the health callback and never checkpointed.
   const prepared=row.mode === 'adjust' ? await prepareAdjustment(row.account_id,JSON.parse(row.request_json)) : await preparePlanning(row.account_id,JSON.parse(row.request_json));
   timer=setInterval(()=>{ void db.prepare("SELECT state FROM planning_jobs WHERE id=?").bind(row.id).first<{state:string}>().then(r=>{if(!r || r.state!=='running') controller.abort();}).catch(()=>controller.abort()); },2000);
   const request={...prepared,accountId:row.account_id,requestId:row.id,signal:controller.signal,
    progress:(e: import('@/lib/plan-response').PlanProgress)=>emit('progress',e),recommendations:(e: import('@/lib/planning-recommendations').PlanRecommendations)=>emit('recommendations',e),
    sessionCreated:async(stage:PlanStage,sessionId:string)=>{await db.prepare("UPDATE planning_job_stages SET session_id=? WHERE job_id=? AND stage=?").bind(sessionId,row.id,stage).run();},
    checkpoint:async <T>(stage:PlanStage,run:()=>Promise<T>):Promise<T>=>{
     const serialized=await step.do(`stage-${stage}`,{retries:{limit:0,delay:'1 second'},timeout:STAGE_BY_NAME[stage].budgetMs+10000},async()=>{
      const state=await db.prepare("SELECT state FROM planning_jobs WHERE id=?").bind(row.id).first<{state:string}>();
      if(state?.state!=='running') return JSON.stringify({ok:false,code:'JOB_CANCELLED',status:409});
      const prior=await db.prepare("SELECT state,result_json FROM planning_job_stages WHERE job_id=? AND stage=?").bind(row.id,stage).first<{state:string;result_json:string|null}>();
      if(prior?.state==='completed' && prior.result_json) return JSON.stringify({ok:true,value:JSON.parse(prior.result_json)});
      if(prior) return JSON.stringify({ok:false,code:'PROVIDER_RESULT_UNKNOWN',status:502});
      await db.prepare("INSERT INTO planning_job_stages(job_id,stage,state) VALUES(?,?,'started')").bind(row.id,stage).run();
      try {
       const value=await run();
       await db.prepare("UPDATE planning_job_stages SET state='completed',result_json=?,updated_at=unixepoch() WHERE job_id=? AND stage=?").bind(JSON.stringify(value),row.id,stage).run();
       await pending;
       return JSON.stringify({ok:true,value});
      } catch(error) {
       await db.prepare("UPDATE planning_job_stages SET state='failed',updated_at=unixepoch() WHERE job_id=? AND stage=?").bind(row.id,stage).run();
       const failure=error as {code?:string;status?:number};
       return JSON.stringify({ok:false,code:failure.code ?? 'PROVIDER_FAILED',status:failure.status ?? 502});
      }
     });
     const saved=JSON.parse(serialized) as {ok:boolean;value:T;code:string;status:number};
     if(!saved.ok) {
      if(saved.code==='PROVIDER_RESULT_UNKNOWN') { controller.abort(); await failJob(row,saved.code,"上游调用结果尚不确定，为避免重复扣费，已停止自动重试。",'indeterminate'); }
      throw new PlannerError(stage,'workflow',saved.status,saved.code);
     }
     return saved.value as T;
    }
   };
   if(row.mode === 'adjust' && 'adjustment' in prepared) {
    const candidate=await runAdjustments({...request,journey:prepared.journey,adjustment:prepared.adjustment});
    await pending;
    await step.do('save-result',async()=>{await finishAdjustmentJob(row,candidate,prepared.draft);return {saved:true};});
   } else {
    const outcome=await runPlanning(request);
    await pending;
    const result=generatedPlan(outcome,prepared.timing);
    await step.do('save-result',async()=>{await finishJob(row,result,prepared.input);return {saved:true};});
   }
   return {jobId:row.id};
  } catch(error) {
   await pending.catch(()=>undefined);
   await step.do('record-failure',async()=>{
    const state=await db.prepare("SELECT state FROM planning_jobs WHERE id=?").bind(row.id).first<{state:string}>();
    if(state?.state==='cancel_requested') await completeCancellation(row);
    else { const code=(error as {code?:string}).code ?? 'PLANNING_FAILED'; await failJob(row,/^[A-Za-z0-9_.:-]{1,64}$/.test(code)?code:'PLANNING_FAILED',"本次规划未完成，原行程与草稿已保留。请稍后重试。"); }
    return {recorded:true};
   });
   return {jobId:row.id,failed:true};
  } finally { if(timer) clearInterval(timer);controller.abort(); }
 }
}
const worker = {
 fetch(){return new Response('Not found',{status:404});},
 async scheduled() {
  const db=getDatabase();
  // Expired private job input and stage data are removed; saved journey versions remain.
  await db.prepare("DELETE FROM planning_jobs WHERE expires_at<unixepoch() AND state NOT IN ('queued','running','cancel_requested')").run();
  const abandoned=await db.prepare("SELECT * FROM planning_jobs WHERE state IN ('queued','running','cancel_requested') AND updated_at<unixepoch()-1800").all<JobRow>();
  for(const row of abandoned.results) {
   try {const instance=await import('cloudflare:workers').then(m=>m.env.BIOTRIP_PLANNING.get(row.id));await instance.terminate();
    await cleanupJobSessions(row.id);
    if(row.state==='cancel_requested') await completeCancellation(row);
    else await failJob(row,'TASK_INTERRUPTED','后台执行已中断，原行程仍保留。为避免重复调用，请核对后重新提交。','indeterminate');
   } catch { /* Keep the active lock until execution is confirmed terminated. */ }
  }
 }
};

export default worker;
