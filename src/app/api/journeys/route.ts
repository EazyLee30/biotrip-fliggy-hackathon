import { createJourney, listJourneys } from "@/lib/journeys";
import { journeyAccount, journeyFailure, journeyResponse, readJourneyJson } from "@/lib/journey-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const account = await journeyAccount(request);
    return journeyResponse({ journeys: await listJourneys(account.id) });
  } catch (error) { return journeyFailure(error); }
}
export async function POST(request: Request) {
  try {
    const account = await journeyAccount(request, true);
    const journey = await createJourney(account.id, await readJourneyJson(request));
    return journeyResponse({ journey }, 201);
  } catch (error) { return journeyFailure(error); }
}
