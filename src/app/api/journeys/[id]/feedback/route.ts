import { listJourneyFeedback, recordJourneyFeedback } from "@/lib/journeys";
import { journeyAccount, journeyFailure, journeyResponse, readJourneyJson } from "@/lib/journey-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const account = await journeyAccount(request);
    const { id } = await context.params;
    return journeyResponse({ feedback: await listJourneyFeedback(account.id, id) });
  } catch (error) { return journeyFailure(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const account = await journeyAccount(request, true);
    const { id } = await context.params;
    return journeyResponse(await recordJourneyFeedback(account.id, id, await readJourneyJson(request, 8_000)), 201);
  } catch (error) { return journeyFailure(error); }
}
