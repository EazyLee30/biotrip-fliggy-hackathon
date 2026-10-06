import { journeyAccount, journeyResponse, journeyFailure, readJourneyJson } from "@/lib/journey-http";
import { listJourneyVersions, restoreJourneyVersion } from "@/lib/journey-versions";
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,context:Context) {
 try {const account=await journeyAccount(request);const {id}=await context.params;return journeyResponse({versions:await listJourneyVersions(account.id,id)});}catch(error){return journeyFailure(error);}
}
export async function POST(request:Request,context:Context) {
 try {const account=await journeyAccount(request,true);const {id}=await context.params;const raw=await readJourneyJson(request) as {version?:unknown;restoreVersion?:unknown};
 return journeyResponse({journey:await restoreJourneyVersion(account.id,id,raw?.version,raw?.restoreVersion)});}catch(error){return journeyFailure(error);}
}
