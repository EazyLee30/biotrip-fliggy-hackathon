import { listBodyCheckIns, recordBodyCheckIn } from "@/lib/body-journey";
import { journeyAccount, journeyFailure, journeyResponse, readJourneyJson } from "@/lib/journey-http";
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,context:Context){try{const account=await journeyAccount(request),{id}=await context.params;return journeyResponse(await listBodyCheckIns(account.id,id));}catch(e){return journeyFailure(e);}}
export async function POST(request:Request,context:Context){try{const account=await journeyAccount(request,true),{id}=await context.params;return journeyResponse(await recordBodyCheckIn(account.id,id,await readJourneyJson(request,2000),request.headers.get("Idempotency-Key")),201);}catch(e){return journeyFailure(e);}}
