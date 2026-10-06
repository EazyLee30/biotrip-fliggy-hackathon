import { dispatchPlanningJob } from "@/lib/planning/dispatch";
import { journeyAccount, journeyResponse, journeyFailure, readJourneyJson } from "@/lib/journey-http";
import { createPlanningJob, listPlanningJobs } from "@/lib/planning/jobs";
import { preparePlanning, prepareAdjustment } from "@/lib/planning/service";
import { JourneyError } from "@/lib/journeys";
export async function GET(request:Request) {
 try {const account=await journeyAccount(request);return journeyResponse({jobs:await listPlanningJobs(account.id)});}catch(error){return journeyFailure(error);}
}
export async function POST(request:Request) {
 try {
  const account=await journeyAccount(request,true);const raw=await readJourneyJson(request);
  if ((raw as Record<string,unknown>)?.mode === "adjust") await prepareAdjustment(account.id,raw);
  else await preparePlanning(account.id,raw);
  const result=await createPlanningJob(account.id,request.headers.get('Idempotency-Key'),raw as Record<string,unknown>);
  if(result.job.state==='queued') {
   try {await dispatchPlanningJob(result.job.id);}catch {throw new JourneyError(503,'JOB_DISPATCH_PENDING','后台任务已保存，但暂未确认启动。请稍后恢复这次任务，勿重复新建。');}
  }
  return journeyResponse(result,result.created?202:200);
 } catch(error){return journeyFailure(error);}
}
