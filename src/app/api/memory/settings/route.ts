import { setMemorySettings } from "@/lib/agent/memory";
import {
  journeyAccount,
  journeyFailure,
  journeyResponse,
  readJourneyJson,
} from "@/lib/journey-http";
import { JourneyError } from "@/lib/journeys";
export async function PATCH(request: Request) {
  try {
    const a = await journeyAccount(request, true);
    const v = (await readJourneyJson(request)) as { autoMemory?: unknown };
    if (typeof v?.autoMemory !== "boolean")
      throw new JourneyError(400, "INVALID_MEMORY", "请选择自动记忆开关。");
    return journeyResponse(await setMemorySettings(a.id, v.autoMemory));
  } catch (e) {
    return journeyFailure(e);
  }
}
