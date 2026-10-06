import { dispatchPlanningJob } from "@/lib/planning/dispatch";
import { env } from "cloudflare:workers";
import { journeyAccount, journeyResponse, journeyFailure, readJourneyJson } from "@/lib/journey-http";
import { getPlanningJob, decidePlanningJob, cancelPlanningJob, completeCancellation, cleanupJobSessions } from "@/lib/planning/jobs";
import { JourneyError } from "@/lib/journeys";
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,context:Context) {
 try {const account=await journeyAccount(request);const {id}=await context.params;const cursor=Number(new URL(request.url).searchParams.get('after')??0);
  if(!Number.isSafeInteger(cursor)||cursor<0) throw new JourneyError(400,'INVALID_CURSOR','进度标识无效。');
  const result=await getPlanningJob(account.id,id,cursor);
  if(result.job.state==='queued') await dispatchPlanningJob(id).catch(()=>undefined);
  return journeyResponse(result);
 }catch(error){return journeyFailure(error);}
}
export async function POST(request:Request,context:Context) {
 try {const account=await journeyAccount(request,true);const {id}=await context.params;const raw=await readJourneyJson(request) as {action?:unknown;version?:unknown;accept?:unknown};
  return journeyResponse(await decidePlanningJob(account.id,id,raw?.action,raw?.version,raw?.accept));
 }catch(error){return journeyFailure(error);}
}
export async function DELETE(request:Request,context:Context) {
 try {const account=await journeyAccount(request,true);const {id}=await context.params;const row=await cancelPlanningJob(account.id,id);
  if(['queued','running','cancel_requested'].includes(row.state)) {
   try {const instance=await env.BIOTRIP_PLANNING.get(id);await instance.terminate();}
   catch {throw new JourneyError(503,'CANCELLATION_PENDING','已请求停止，正在等待后台确认；原行程会保留。');}
   await cleanupJobSessions(id);
   await completeCancellation(row);
  }
  return journeyResponse(await getPlanningJob(account.id,id));
 }catch(error){return journeyFailure(error);}
}
