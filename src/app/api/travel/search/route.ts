import { journeyAccount, journeyFailure, journeyResponse, readJourneyJson } from "@/lib/journey-http";
import { searchTravel } from "@/lib/travel-search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const account = await journeyAccount(request, true);
    const body = await readJourneyJson(request, 6000);
    return journeyResponse(await searchTravel(account.id, body, request.signal, request.headers.get("Idempotency-Key") ?? undefined));
  } catch (error) { return journeyFailure(error); }
}
