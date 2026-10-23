import { listAdjustmentRecords } from "@/lib/body-journey";
import { journeyAccount, journeyFailure, journeyResponse } from "@/lib/journey-http";
export async function GET(request:Request,context:{params:Promise<{id:string}>}){try{const account=await journeyAccount(request),{id}=await context.params;return journeyResponse({adjustments:await listAdjustmentRecords(account.id,id)});}catch(e){return journeyFailure(e);}}
