import { updateJourneyItinerary } from "@/lib/journeys";
import { journeyAccount, journeyFailure, journeyResponse, readJourneyJson } from "@/lib/journey-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const account = await journeyAccount(request, true);
    const { id } = await context.params;
    return journeyResponse({ journey: await updateJourneyItinerary(account.id, id, await readJourneyJson(request, 64_000)) });
  } catch (error) { return journeyFailure(error); }
}
