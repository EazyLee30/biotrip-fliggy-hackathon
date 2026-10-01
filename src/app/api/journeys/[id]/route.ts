import { deleteJourney, getJourney, requireVersion, updateJourney } from "@/lib/journeys";
import { journeyAccount, journeyFailure, journeyResponse, readJourneyJson } from "@/lib/journey-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const account = await journeyAccount(request);
    const { id } = await context.params;
    return journeyResponse({ journey: await getJourney(account.id, id) });
  } catch (error) { return journeyFailure(error); }
}
export async function PATCH(request: Request, context: Context) {
  try {
    const account = await journeyAccount(request, true);
    const { id } = await context.params;
    return journeyResponse({ journey: await updateJourney(account.id, id, await readJourneyJson(request)) });
  } catch (error) { return journeyFailure(error); }
}
export async function DELETE(request: Request, context: Context) {
  try {
    const account = await journeyAccount(request, true);
    const { id } = await context.params;
    const rawVersion = new URL(request.url).searchParams.get("version");
    const version = requireVersion(rawVersion && /^\d{1,15}$/.test(rawVersion) ? Number(rawVersion) : null);
    await deleteJourney(account.id, id, version);
    return journeyResponse({ deleted: true });
  } catch (error) { return journeyFailure(error); }
}
