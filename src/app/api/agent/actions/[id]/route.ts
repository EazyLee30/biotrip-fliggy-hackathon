import { decideAction } from "@/lib/agent/actions";
import {
  journeyAccount,
  journeyFailure,
  journeyResponse,
  readJourneyJson,
} from "@/lib/journey-http";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const a = await journeyAccount(request, true);
    return journeyResponse(
      await decideAction(
        a.id,
        (await context.params).id,
        await readJourneyJson(request),
      ),
    );
  } catch (e) {
    return journeyFailure(e);
  }
}
