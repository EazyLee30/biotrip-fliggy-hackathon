import { getDatabase } from "@/lib/database";
import { withActivityIds, getJourney, protectJourneyActivities, JourneyError, requireVersion } from "@/lib/journeys";
import type { JourneyGeneratedPlan, JourneyDraft } from "@/lib/journey-types";
export type JourneyVersion = {version:number;createdAt:string;draft:JourneyDraft;plan:JourneyGeneratedPlan};
export async function listJourneyVersions(accountId:string,id:string):Promise<JourneyVersion[]> {
 await getJourney(accountId,id);
 const rows=await getDatabase().prepare("SELECT version,created_at,draft_json,plan_json FROM journey_versions WHERE journey_id=? AND account_id=? ORDER BY version DESC LIMIT 30").bind(id,accountId).all<{version:number;created_at:number;draft_json:string;plan_json:string}>();
 return rows.results.map(r=>({version:r.version,createdAt:new Date(r.created_at*1000).toISOString(),draft:JSON.parse(r.draft_json),plan:withActivityIds(JSON.parse(r.plan_json),id)}));
}
export async function restoreJourneyVersion(accountId:string,id:string,version:unknown,target:unknown) {
 requireVersion(version);requireVersion(target);
 const current=await getJourney(accountId,id);
 if(current.status==='completed') throw new JourneyError(409,"JOURNEY_COMPLETED","已完成的旅程不能替换安排。");
 if(current.version!==version) throw new JourneyError(409,"JOURNEY_CHANGED","行程已变化，请刷新后再恢复。");
 const snapshot=await getDatabase().prepare("SELECT draft_json,plan_json,plan_draft_json FROM journey_versions WHERE journey_id=? AND account_id=? AND version=?").bind(id,accountId,target).first<{draft_json:string;plan_json:string;plan_draft_json:string}>();
 if(!snapshot) throw new JourneyError(404,"VERSION_NOT_FOUND","这个历史版本不存在。");
 const restored=withActivityIds(JSON.parse(snapshot.plan_json),id);
 // History restores arrangements; explicit activity progress always belongs to now.
 restored.plan.itinerary=restored.plan.itinerary.map(item=>({...item,progress:current.plan?.plan.itinerary.find(existing=>existing.id===item.id)?.progress}));
 const plan=JSON.stringify(restored);
 if(plan===JSON.stringify(current.plan)) return current;
 protectJourneyActivities(current,JSON.parse(plan));
 const result=await getDatabase().prepare("UPDATE journeys SET draft_json=?,plan_json=?,plan_draft_json=?,status=CASE WHEN status='active' THEN 'active' ELSE 'planned' END,version=version+1,updated_at=unixepoch() WHERE id=? AND account_id=? AND version=? AND status<>'completed' AND NOT EXISTS(SELECT 1 FROM planning_jobs WHERE account_id=? AND state IN ('queued','running','cancel_requested')) RETURNING version")
 .bind(snapshot.draft_json,plan,snapshot.plan_draft_json,id,accountId,version,accountId).first<{version:number}>();
 if(!result) throw new JourneyError(409,"JOURNEY_CHANGED","行程正在生成或已变化，请完成当前操作后重试。");
 return getJourney(accountId,id);
}
