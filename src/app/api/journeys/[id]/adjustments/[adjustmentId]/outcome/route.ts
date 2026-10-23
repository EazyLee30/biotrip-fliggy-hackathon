import { recordAdjustmentOutcome } from "@/lib/body-journey";
import { journeyAccount, journeyFailure, journeyResponse, readJourneyJson } from "@/lib/journey-http";
export async function POST(request:Request,context:{params:Promise<{id:string;adjustmentId:string}>}){try{const account=await journeyAccount(request,true),{id,adjustmentId}=await context.params;return journeyResponse(await recordAdjustmentOutcome(account.id,id,adjustmentId,await readJourneyJson(request,3000),request.headers.get("Idempotency-Key")),201);}catch(e){return journeyFailure(e);}}
