import { createQuickAdjustment } from "@/lib/adjust/quick";
import { journeyAccount, journeyFailure, journeyResponse, readJourneyJson } from "@/lib/journey-http";
export async function POST(request:Request,context:{params:Promise<{id:string}>}) {try{const account=await journeyAccount(request,true),{id}=await context.params;return journeyResponse(await createQuickAdjustment(account.id,id,await readJourneyJson(request,5000),request.headers.get("Idempotency-Key")));}catch(error){return journeyFailure(error);}}
