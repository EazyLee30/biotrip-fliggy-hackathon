import { createHash, randomUUID } from "node:crypto";
import { getDatabase } from "@/lib/database";
import { getJourney, JourneyError } from "@/lib/journeys";
import { getPlanningJob } from "@/lib/planning/jobs";
import { listAdjustmentRecords } from "@/lib/body-journey";
import { validateAdjustmentRequest, adjustmentDraft, AdjustmentRequestError } from "./request";
import { bodyStatus } from "./status";
import { dayLoad } from "./tags";
import { instantProposals } from "./rules";
import { markConflicts } from "./validate";
import { rankProposalsByOutcomes } from "./learning";
import type { AdjustmentCandidate } from "../planning/adjust-pipeline";
/** Entirely deterministic: no provider, inventory, map or WHOOP call is reachable from here. */
export async function createQuickAdjustment(accountId:string,journeyId:string,raw:unknown,key:unknown,now=new Date()) {
  if(typeof key!=="string" || !/^[0-9a-f-]{36}$/i.test(key))throw new JourneyError(400,"INVALID_IDEMPOTENCY_KEY","请重新开始这次调整。");
  const db=getDatabase(),encoded=JSON.stringify(raw),hash=createHash("sha256").update(encoded).digest("hex");
  const previous=await db.prepare("SELECT id,journey_id,request_hash FROM planning_jobs WHERE account_id=? AND idempotency_key=?").bind(accountId,key).first<{id:string;journey_id:string;request_hash:string}>();
  if(previous){if(previous.journey_id!==journeyId || previous.request_hash!==hash)throw new JourneyError(409,"IDEMPOTENCY_CONFLICT","这次提交内容已变化，请重新提交。");return {job:(await getPlanningJob(accountId,previous.id)).job,created:false};}
  const journey=await getJourney(accountId,journeyId);
  let request;
  try { request=validateAdjustmentRequest(raw,journey,now); }
  catch(error) { if(error instanceof AdjustmentRequestError)throw new JourneyError(400,error.code,error.message);throw error; }
  if(request.includeWhoop)throw new JourneyError(400,"QUICK_SELF_REPORT_ONLY","快速调整依据你的自评；参考WHOOP或当地检索时请选择进一步建议。");
  const status=bodyStatus({checkIn:request.checkIn,remaining:dayLoad(journey.plan!.plan.itinerary,request.scope.date)});
  const records=await listAdjustmentRecords(accountId,journeyId);
  const proposals=rankProposalsByOutcomes(markConflicts(instantProposals({itinerary:journey.plan!.plan.itinerary,trip:journey.draft.trip!,scope:request.scope,stance:request.stance,status}),journey.plan!.plan.itinerary,journey.draft.trip!,request.scope),records,request.scope.date);
  const candidate:AdjustmentCandidate={kind:"adjustment",fatigueBefore:request.checkIn.fatigue,checkIn:request.checkIn,scope:request.scope,stance:request.stance,proposals,stages:[],requestedAt:now.toISOString(),strategy:"quick"};
  // A breathing exercise or empty result has no itinerary mutation to approve.
  // Persist the result for retries without occupying the account's planning slot.
  const state=proposals.some(proposal=>proposal.templates.length>0)?"awaiting_approval":"completed";
  const id=randomUUID();
  const result=await db.prepare(`INSERT OR IGNORE INTO planning_jobs(id,account_id,journey_id,base_version,idempotency_key,request_hash,request_json,lease_token,mode,state,candidate_json)
    SELECT ?,?,?,?,?,?,?,0,'adjust',?,? WHERE EXISTS(SELECT 1 FROM journeys WHERE id=? AND account_id=? AND version=? AND status<>'completed')
    AND NOT EXISTS(SELECT 1 FROM planning_jobs WHERE account_id=? AND state IN ('queued','running','cancel_requested','awaiting_approval'))`).bind(id,accountId,journeyId,journey.version,key,hash,JSON.stringify({draft:adjustmentDraft(journey,request)}),state,JSON.stringify(candidate),journeyId,accountId,journey.version,accountId).run();
  if(!result.meta.changes){const raced=await db.prepare("SELECT id,request_hash FROM planning_jobs WHERE account_id=? AND idempotency_key=?").bind(accountId,key).first<{id:string;request_hash:string}>();if(raced?.request_hash===hash)return {job:(await getPlanningJob(accountId,raced.id)).job,created:false};throw new JourneyError(409,"PLANNING_IN_PROGRESS","行程已变化或有待确认建议，请先处理当前建议。");}
  return {job:(await getPlanningJob(accountId,id)).job,created:true};
}
