import { memorySettings, saveAgentSettings } from "@/lib/agent/memory";
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
    return journeyResponse(await memorySettings(a.id));
  } catch (e) {
    return journeyFailure(e);
  }
}
export async function PATCH(request: Request) {
  try {
    const a = await journeyAccount(request, true);
    const v = (await readJourneyJson(request)) as {
      useMemory?: unknown;
      useWhoop?: unknown;
    };
    if (typeof v?.useMemory !== "boolean" || typeof v.useWhoop !== "boolean")
      throw new JourneyError(400, "INVALID_SETTINGS", "请确认助手设置。");
    return journeyResponse(
      await saveAgentSettings(a.id, {
        useMemory: v.useMemory,
        useWhoop: v.useWhoop,
      }),
    );
  } catch (e) {
    return journeyFailure(e);
  }
}
