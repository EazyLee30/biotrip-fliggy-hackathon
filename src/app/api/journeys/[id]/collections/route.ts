import { listJourneyCollections, mutateJourneyCollection } from "@/lib/journey-collections";
import { journeyAccount, journeyFailure, journeyResponse, readJourneyJson } from "@/lib/journey-http";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try { const account = await journeyAccount(request); const { id } = await context.params; return journeyResponse({ items: await listJourneyCollections(account.id, id) }); }
  catch (error) { return journeyFailure(error); }
}
export async function POST(request: Request, context: Context) {
  try { const account = await journeyAccount(request, true); const { id } = await context.params; return journeyResponse(await mutateJourneyCollection(account.id, id, await readJourneyJson(request, 16000))); }
  catch (error) { return journeyFailure(error); }
}
export const PATCH = POST;
