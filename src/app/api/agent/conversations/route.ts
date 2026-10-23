import { createConversation, listConversations } from "@/lib/agent/store";
import {
  journeyAccount,
  journeyFailure,
  journeyResponse,
  readJourneyJson,
} from "@/lib/journey-http";
import { JourneyError } from "@/lib/journeys";
export async function GET(request: Request) {
  try {
    const a = await journeyAccount(request);
    return journeyResponse({ conversations: await listConversations(a.id) });
  } catch (e) {
    return journeyFailure(e);
  }
}
export async function POST(request: Request) {
  try {
    const a = await journeyAccount(request, true);
    const v = (await readJourneyJson(request)) as { journeyId?: unknown };
    if (v?.journeyId != null && typeof v.journeyId !== "string")
      throw new JourneyError(400, "INVALID_CHAT", "旅程无效。");
    return journeyResponse(
      {
        id: await createConversation(
          a.id,
          (v.journeyId as string | null) ?? null,
        ),
      },
      201,
    );
  } catch (e) {
    return journeyFailure(e);
  }
}
