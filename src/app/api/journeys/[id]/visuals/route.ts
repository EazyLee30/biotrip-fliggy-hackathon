import { supplementJourneyVisuals } from "@/lib/journey-visuals";
import { DestinationVisualError } from "@/lib/destination-visuals";
import { FlyaiSearchError } from "@/lib/flyai";
import { journeyAccount, journeyFailure, journeyResponse, readJourneyJson } from "@/lib/journey-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) {
  try {
    const account = await journeyAccount(request, true);
    const { id } = await context.params;
    return journeyResponse(await supplementJourneyVisuals(account.id, id, await readJourneyJson(request, 1024), request.signal));
  } catch (error) {
    if (error instanceof DestinationVisualError || error instanceof FlyaiSearchError || (error instanceof Error && error.message === "FLYAI_POI_SCHEMA_UNSUPPORTED")) {
      return journeyResponse({ code: error.message, error: "目的地实景暂未核验，请稍后重试。" }, error instanceof DestinationVisualError || error instanceof FlyaiSearchError ? error.status : 502);
    }
    return journeyFailure(error);
  }
}
