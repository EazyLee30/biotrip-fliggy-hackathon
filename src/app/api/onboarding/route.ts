import { onboardingStatus, saveOnboarding } from "@/lib/onboarding";
import { journeyAccount, journeyFailure, journeyResponse, readJourneyJson } from "@/lib/journey-http";
export async function GET(request:Request) { try { const account=await journeyAccount(request);return journeyResponse(await onboardingStatus(account.id)); } catch(e){return journeyFailure(e);} }
export async function POST(request:Request) { try { const account=await journeyAccount(request,true);return journeyResponse(await saveOnboarding(account.id,await readJourneyJson(request,4000))); } catch(e){return journeyFailure(e);} }
