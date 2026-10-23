import { updateActivityState } from "@/lib/journeys";
import { journeyAccount, journeyFailure, journeyResponse, readJourneyJson } from "@/lib/journey-http";
export async function PATCH(request:Request,context:{params:Promise<{id:string;activityId:string}>}){try{const account=await journeyAccount(request,true),{id,activityId}=await context.params;return journeyResponse({journey:await updateActivityState(account.id,id,activityId,await readJourneyJson(request,1000))});}catch(e){return journeyFailure(e);}}
