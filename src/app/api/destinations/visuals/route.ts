import { destinationVisuals, DestinationVisualError } from "@/lib/destination-visuals";
import { FlyaiSearchError } from "@/lib/flyai";
import { journeyAccount, journeyFailure, journeyResponse } from "@/lib/journey-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const account = await journeyAccount(request);
    return journeyResponse(await destinationVisuals(account.id, new URL(request.url).searchParams.get("city"), request.signal));
  } catch (error) {
    if (error instanceof DestinationVisualError || error instanceof FlyaiSearchError || (error instanceof Error && error.message === "FLYAI_POI_SCHEMA_UNSUPPORTED")) {
      return journeyResponse({ code: error instanceof Error ? error.message : "VISUAL_UNAVAILABLE", error: "目的地实景暂未核验，继续使用意境封面。" }, error instanceof DestinationVisualError || error instanceof FlyaiSearchError ? error.status : 502);
    }
    return journeyFailure(error);
  }
}
