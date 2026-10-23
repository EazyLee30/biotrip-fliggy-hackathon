import { undoMemory } from "@/lib/agent/memory";
import { JourneyError } from "@/lib/journeys";
import {
  journeyAccount,
  journeyFailure,
  journeyResponse,
  readJourneyJson,
} from "@/lib/journey-http";
export async function POST(request: Request) {
  try {
    const a = await journeyAccount(request, true);
    const v = (await readJourneyJson(request)) as { undoId?: unknown };
    if (typeof v?.undoId !== "string")
      throw new JourneyError(400, "INVALID_MEMORY", "撤销记录无效。");
    await undoMemory(a.id, v.undoId);
    return journeyResponse({ undone: true });
  } catch (e) {
    return journeyFailure(e);
  }
}
