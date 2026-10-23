import { createHash, randomUUID } from "node:crypto";
import { getDatabase } from "@/lib/database";
import { withActivityIds, identifyGeneratedActivities, getJourney, checkJourneyForGeneration, protectJourneyActivities, JourneyError, requireJourneyId, requireVersion } from "@/lib/journeys";
import { backlogInsertStatements } from "@/lib/journey-collections";
import { getBailianConfig, deleteBailianSession } from "@/lib/bailian";
import { applyAdjustments } from "../adjust/apply";
import { adjustmentScope, destinationClock } from "../adjust/request";
import type { AdjustmentCandidate } from "./adjust-pipeline";
import { reservePlanning } from "./rate-limit";
import type { AdjustmentRecord, JourneyGeneratedPlan } from "@/lib/journey-types";
import { reservationBaseline, identifyReservationCandidate, protectReservationCandidate } from "./reservations";

export type JobState = "queued" | "running" | "awaiting_approval" | "completed" | "failed" | "indeterminate" | "cancel_requested" | "cancelled";
export type PlanningTiming = { submittedAt: string; firstRecommendationsMs?: number; composedMs?: number; resultReadyMs?: number; precision: "second" };
export type PlanningJob = { mode?: "plan" | "adjust"; adjustment?: AdjustmentCandidate | null; timing?: PlanningTiming; id:string; journeyId:string; baseVersion:number; state:JobState; createdAt:string; updatedAt:string; candidate:JourneyGeneratedPlan|null; error:string|null; code:string|null };
export type JobRow = { mode: "plan" | "adjust"; id:string;account_id:string;journey_id:string;base_version:number;request_hash:string;request_json:string;state:JobState;candidate_json:string|null;error_code:string|null;error_message:string|null;lease_token:number;created_at:number;updated_at:number;expires_at:number };
export const ACTIVE_JOB_STATES = new Set<JobState>(["queued","running","cancel_requested"]);
const hash=(text:string)=>createHash("sha256").update(text).digest("hex");
const publicJob=(r:JobRow):PlanningJob=>({mode:r.mode ?? "plan",adjustment:r.mode === "adjust" && r.candidate_json ? JSON.parse(r.candidate_json) : null,id:r.id,journeyId:r.journey_id,baseVersion:r.base_version,state:r.state,createdAt:new Date(r.created_at*1000).toISOString(),updatedAt:new Date(r.updated_at*1000).toISOString(),candidate:r.mode !== "adjust" && r.candidate_json ? withActivityIds(JSON.parse(r.candidate_json),r.journey_id):null,error:r.error_message,code:r.error_code});
export async function jobRow(accountId:string,id:string) {
 requireJourneyId(id);
 const row=await getDatabase().prepare("SELECT * FROM planning_jobs WHERE id=? AND account_id=?").bind(id,accountId).first<JobRow>();
 if(!row) throw new JourneyError(404,"JOB_NOT_FOUND","这次规划任务不存在。");
 return row;
}
export async function getPlanningJob(accountId:string,id:string,cursor=0) {
 const row=await jobRow(accountId,id);
 const events=await getDatabase().prepare("SELECT seq,kind,payload_json FROM planning_job_events WHERE job_id=? AND seq>? ORDER BY seq LIMIT 100").bind(id,cursor).all<{seq:number;kind:string;payload_json:string}>();
 const marks = await getDatabase().prepare(`SELECT
   MIN(CASE WHEN kind='recommendations' AND json_array_length(payload_json,'$.items')>0 THEN created_at END) AS first_recommendation,
   MIN(CASE WHEN kind='progress' AND json_extract(payload_json,'$.stage')='compose_plan' AND json_extract(payload_json,'$.status')='ok' THEN created_at END) AS composed,
   MIN(CASE WHEN kind='progress' AND json_extract(payload_json,'$.stage')='complete' AND json_extract(payload_json,'$.status')='ok' THEN created_at END) AS ready
   FROM planning_job_events WHERE job_id=?`).bind(id).first<{first_recommendation:number|null;composed:number|null;ready:number|null}>();
 const elapsed = (stamp:number) => Math.max(0,(stamp-row.created_at)*1000);
 const timing:PlanningTiming = {submittedAt:new Date(row.created_at*1000).toISOString(),precision:"second",
   ...(marks?.first_recommendation != null ? {firstRecommendationsMs:elapsed(marks.first_recommendation)} : {}),
   ...(marks?.composed != null ? {composedMs:elapsed(marks.composed)} : {}),
   ...(marks?.ready != null ? {resultReadyMs:elapsed(marks.ready)} : {})};
 return {job:{...publicJob(row),timing},events:events.results.map(e=>({seq:e.seq,kind:e.kind,payload:JSON.parse(e.payload_json)}))};
}
export async function listPlanningJobs(accountId:string) {
 const rows=await getDatabase().prepare("SELECT * FROM planning_jobs WHERE account_id=? AND expires_at>unixepoch() ORDER BY created_at DESC LIMIT 20").bind(accountId).all<JobRow>();
 return rows.results.map(publicJob);
}
/** A retry after a lost HTTP response returns the same task, without billing again. */
export async function createPlanningJob(accountId:string,key:unknown,raw:Record<string,unknown>) {
 if(typeof key!=="string" || !/^[0-9a-f-]{36}$/i.test(key)) throw new JourneyError(400,"INVALID_IDEMPOTENCY_KEY","任务标识无效。");
 const encoded=JSON.stringify(raw),digest=hash(encoded);
 const prior=await getDatabase().prepare("SELECT * FROM planning_jobs WHERE account_id=? AND idempotency_key=?").bind(accountId,key).first<JobRow>();
 if(prior){ if(prior.request_hash!==digest) throw new JourneyError(409,"IDEMPOTENCY_CONFLICT","这次提交的资料已变化，请重新提交。"); return {job:publicJob(prior),created:false}; }
 const target=await checkJourneyForGeneration(accountId,raw.journeyId,raw.expectedVersion);
 if(!target) throw new JourneyError(400,"JOURNEY_REQUIRED","请先保存旅程草稿。");
 const active=await getDatabase().prepare("SELECT id FROM planning_jobs WHERE account_id=? AND state IN ('queued','running','cancel_requested','awaiting_approval')").bind(accountId).first();
 if(active) throw new JourneyError(409,"PLANNING_IN_PROGRESS","上一份规划仍在后台生成，请先查看它的进度。");
 const lease=await reservePlanning(accountId,1800);
 const id=randomUUID();
 try {
  await getDatabase().prepare("INSERT INTO planning_jobs(id,account_id,journey_id,base_version,idempotency_key,request_hash,request_json,lease_token,mode) VALUES(?,?,?,?,?,?,?,?,?)")
   .bind(id,accountId,target.id,target.version,key,digest,encoded,lease.token,raw.mode === "adjust" ? "adjust" : "plan").run();
 } catch(error) { await lease.release(); const raced=await getDatabase().prepare("SELECT * FROM planning_jobs WHERE account_id=? AND idempotency_key=?").bind(accountId,key).first<JobRow>(); if(raced && raced.request_hash===digest) return {job:publicJob(raced),created:false}; throw error; }
 return {job:publicJob(await jobRow(accountId,id)),created:true};
}
export async function releaseJob(row:JobRow) {
 await getDatabase().prepare("DELETE FROM auth_rate_limits WHERE limit_key=? AND hit_count=?").bind(hash(`plan:active:${row.account_id}`),row.lease_token).run();
}
export async function jobEvent(id:string,kind:"progress"|"recommendations",payload:unknown) {
 // Callers pass only the existing public progress/recommendation contract.
 const json=JSON.stringify(payload);
 if(json.length>30000) return;
 await getDatabase().prepare("INSERT INTO planning_job_events(job_id,kind,payload_json) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM planning_jobs WHERE id=? AND state='running')").bind(id,kind,json,id).run();
}
export async function failJob(row:JobRow,code:string,message:string,state:JobState="failed") {
 await getDatabase().prepare("UPDATE planning_jobs SET state=?,error_code=?,error_message=?,request_json='{}',updated_at=unixepoch() WHERE id=? AND state IN ('queued','running')").bind(state,code.slice(0,64),message,row.id).run();
 await releaseJob(row);
}
/** Only verified server output enters this function. A replan never replaces the live plan. */
export async function finishJob(row:JobRow,generated:JourneyGeneratedPlan,draft:unknown) {
 if(generated.source!=="live" || !generated.plan.itinerary.length || JSON.stringify(generated).length>64000) throw new JourneyError(502,"INVALID_GENERATED_PLAN","生成的行程不完整。");
 const current=await getJourney(row.account_id,row.journey_id);
 const request=JSON.parse(row.request_json) as {reservationEdits?:unknown};
 const shadow=reservationBaseline(current,request.reservationEdits).shadow;
 const candidate=current.plan ? identifyReservationCandidate(current,shadow,generated) : identifyGeneratedActivities(generated,row.journey_id,current.plan);
 if(current.version===row.base_version) protectReservationCandidate(current,shadow,candidate);
 const plan=JSON.stringify(candidate),encoded=JSON.stringify(draft);
 const pending=JSON.stringify({draft,...(request.reservationEdits !== undefined ? {reservationEdits:request.reservationEdits} : {})});
 if(plan.length>64000) throw new JourneyError(502,"INVALID_GENERATED_PLAN","行程内容过长，无法完整保存。");
 // Keep a candidate even when a concurrent edit makes automatic application unsafe.
 if(current.plan || current.version!==row.base_version || current.status==='completed') {
  await getDatabase().prepare("UPDATE planning_jobs SET state='awaiting_approval',candidate_json=?,request_json=?,updated_at=unixepoch() WHERE id=? AND state='running'")
    .bind(plan,pending,row.id).run();
 } else {
  const db=getDatabase();
  const result=await db.batch([
   db.prepare("UPDATE journeys SET draft_json=?,plan_draft_json=?,plan_json=?,status='planned',version=version+1,updated_at=unixepoch() WHERE id=? AND account_id=? AND version=? AND status<>'completed' AND EXISTS(SELECT 1 FROM planning_jobs WHERE id=? AND state='running') RETURNING version").bind(encoded,encoded,plan,row.journey_id,row.account_id,row.base_version,row.id),
   db.prepare("UPDATE planning_jobs SET state='completed',candidate_json=NULL,request_json='{}',updated_at=unixepoch() WHERE id=? AND state='running' AND changes()=1").bind(row.id),
  ]);
  if(result[0].results.length!==1) {
   await db.prepare("UPDATE planning_jobs SET state='awaiting_approval',candidate_json=?,request_json=?,updated_at=unixepoch() WHERE id=? AND state='running'").bind(plan,pending,row.id).run();
  }
 }
 await getDatabase().prepare(`INSERT INTO planning_job_events(job_id,kind,payload_json)
   SELECT ?,'progress',? WHERE EXISTS(SELECT 1 FROM planning_jobs WHERE id=? AND state IN ('completed','awaiting_approval'))
   AND NOT EXISTS(SELECT 1 FROM planning_job_events WHERE job_id=? AND json_extract(payload_json,'$.stage')='complete')`)
   .bind(row.id,JSON.stringify({stage:"complete",status:"ok",message:"结果已保存，或已准备好等待确认。"}),row.id,row.id).run();
 await releaseJob(row);
}
export async function decidePlanningJob(accountId:string,id:string,action:unknown,version:unknown,accept?:unknown,now=new Date()) {
 const row=await jobRow(accountId,id);
 if(action==='discard') {
  if(row.state!=='awaiting_approval') throw new JourneyError(409,"JOB_NOT_CANDIDATE","当前没有待确认的方案。");
  await getDatabase().prepare("UPDATE planning_jobs SET state='cancelled',candidate_json=NULL,request_json='{}',updated_at=unixepoch() WHERE id=? AND state='awaiting_approval'").bind(id).run();
  return {job:publicJob(await jobRow(accountId,id))};
 }
 if(action!=='apply') throw new JourneyError(400,"INVALID_ACTION","请选择采用或保留原方案。");
 requireVersion(version);
 if(row.state==='completed') return {job:publicJob(row),journey:await getJourney(accountId,row.journey_id)};
 if(row.state!=='awaiting_approval' || !row.candidate_json) throw new JourneyError(409,"JOB_NOT_CANDIDATE","当前没有待确认的方案。");
 const current=await getJourney(accountId,row.journey_id);
 // Reject a changed baseline rather than overwrite edits or reservations the candidate never saw.
 if(current.version!==version || version!==row.base_version || current.status==='completed') throw new JourneyError(409,"JOURNEY_CHANGED","当前行程已变化，这份候选方案无法直接覆盖；请保留原方案并重新调整。");
 let generated = row.candidate_json;
 let adjustmentRecord:AdjustmentRecord|null=null;
 if(row.mode === 'adjust') {
  const candidate = JSON.parse(row.candidate_json) as AdjustmentCandidate;
  const scope = adjustmentScope(current,now);
  // A pre-trip scope is clamped to the future arrival day, so scope equality
  // alone cannot expire yesterday's self-report across local midnight.
  const timezone=current.draft.trip?.destinationTimezone || "Asia/Shanghai";
  const submittedDay=destinationClock(timezone,new Date(row.created_at*1000)).date;
  if(submittedDay!==destinationClock(timezone,now).date) throw new JourneyError(409,"ADJUSTMENT_EXPIRED","这份建议使用了之前一天的感受，请按今天的状态重新获取。");
  if(scope.date !== candidate.scope.date || scope.date > candidate.scope.throughDate) throw new JourneyError(409,"ADJUSTMENT_EXPIRED","这份建议的日期已过去，请重新获取。");
  try {
   const next=applyAdjustments(current.plan!, candidate, accept, current.draft.trip!, scope.fromTime);
   const accepted=candidate.proposals.filter(proposal=>(accept as string[]).includes(proposal.id));
   adjustmentRecord={id:row.id,jobId:row.id,journeyId:current.id,appliedAt:next.bodyAdjustment!.updatedAt,localDate:candidate.scope.date,beforeVersion:version,afterVersion:version+1,fatigueBefore:candidate.fatigueBefore ?? null,changes:accepted.map(({id,title,angle,templates})=>({id,title,angle,templates})),outcome:null};
   next.bodyAdjustment={...next.bodyAdjustment!,id:row.id};
   next.manualAdjustment={...next.manualAdjustment!,id:randomUUID()};
   generated=JSON.stringify(next);
  }
  catch(error) { throw new JourneyError(409,"ADJUSTMENT_INFEASIBLE",error instanceof Error ? error.message : "所选建议无法同时应用。"); }
  if(generated.length > 64000) throw new JourneyError(400,"PLAN_TOO_LARGE","调整后的内容太多，请减少所选建议。");
 }
 const generatedPlan=JSON.parse(generated) as JourneyGeneratedPlan;
 const pending=JSON.parse(row.request_json);
 if(row.mode === 'adjust') protectJourneyActivities(current,generatedPlan);
 else protectReservationCandidate(current,reservationBaseline(current,pending.reservationEdits,undefined,now).shadow,generatedPlan,now);
 const draft=JSON.stringify(pending.draft);
 const db=getDatabase();const statements=[
  db.prepare("UPDATE journeys SET draft_json=?,plan_draft_json=?,plan_json=?,status=CASE WHEN status='active' THEN 'active' ELSE 'planned' END,version=version+1,updated_at=unixepoch() WHERE id=? AND account_id=? AND version=? AND status<>'completed' AND EXISTS(SELECT 1 FROM planning_jobs WHERE id=? AND state='awaiting_approval') RETURNING version").bind(draft,draft,generated,row.journey_id,accountId,version,id),
  db.prepare("UPDATE planning_jobs SET state='completed',candidate_json=NULL,request_json='{}',updated_at=unixepoch() WHERE id=? AND state='awaiting_approval' AND changes()=1").bind(id),
 ];
 if(adjustmentRecord) {
  statements.push(db.prepare("INSERT INTO journey_adjustments(id,account_id,journey_id,job_id,payload_json) SELECT ?,?,?,?,? WHERE changes()=1").bind(adjustmentRecord.id,accountId,current.id,row.id,JSON.stringify(adjustmentRecord)));
 }
 const removed=current.plan!.plan.itinerary.filter(item=>!generatedPlan.plan.itinerary.some(next=>next.id===item.id));
 statements.push(...backlogInsertStatements(accountId,current.id,removed,row.id,version+1,adjustmentRecord?row.id:undefined,adjustmentRecord?generatedPlan.manualAdjustment?.id:undefined,row.id));
 const result=await db.batch(statements);
 if(result[0].results.length!==1) throw new JourneyError(409,"JOURNEY_CHANGED","行程已变化，请刷新后再操作。");
 return {job:publicJob(await jobRow(accountId,id)),journey:await getJourney(accountId,row.journey_id)};
}
export async function cancelPlanningJob(accountId:string,id:string) {
 const row=await jobRow(accountId,id);
 await getDatabase().prepare("UPDATE planning_jobs SET state='cancel_requested',updated_at=unixepoch() WHERE id=? AND state IN ('queued','running')").bind(id).run();
 return row;
}
export async function completeCancellation(row:JobRow) {
 await getDatabase().prepare("UPDATE planning_jobs SET state='cancelled',candidate_json=NULL,request_json='{}',updated_at=unixepoch() WHERE id=? AND state='cancel_requested'").bind(row.id).run();
 await releaseJob(row);
}

export async function cleanupJobSessions(id:string) {
 const config=getBailianConfig(); if(!config)return;
 const rows=await getDatabase().prepare("SELECT session_id FROM planning_job_stages WHERE job_id=? AND session_id IS NOT NULL").bind(id).all<{session_id:string}>();
 await Promise.allSettled(rows.results.map(row=>deleteBailianSession(config,row.session_id)));
}

/** Unlike first-time planning, adjustments always await a per-proposal choice. */
export async function finishAdjustmentJob(row: JobRow, candidate: AdjustmentCandidate, draft: unknown) {
 if(candidate.kind !== "adjustment" || JSON.stringify(candidate).length > 64000) throw new JourneyError(502,"INVALID_ADJUSTMENT","调整建议内容无效。");
 await getDatabase().prepare("UPDATE planning_jobs SET state='awaiting_approval',candidate_json=?,request_json=?,updated_at=unixepoch() WHERE id=? AND state='running' AND mode='adjust'")
  .bind(JSON.stringify(candidate),JSON.stringify({draft}),row.id).run();
 await getDatabase().prepare("INSERT INTO planning_job_events(job_id,kind,payload_json) SELECT ?,'progress',? WHERE EXISTS(SELECT 1 FROM planning_jobs WHERE id=? AND state='awaiting_approval') AND NOT EXISTS(SELECT 1 FROM planning_job_events WHERE job_id=? AND json_extract(payload_json,'$.stage')='complete')")
  .bind(row.id,JSON.stringify({stage:"complete",status:"ok",message:"建议已准备好，逐条选择后才会改变行程。"}),row.id,row.id).run();
 await releaseJob(row);
}
