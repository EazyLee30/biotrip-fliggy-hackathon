import {
  listMemoryItems,
  memorySettings,
  saveMemory,
  deleteMemory,
} from "@/lib/agent/memory";
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
    return journeyResponse({
      memories: await listMemoryItems(a.id),
      ...(await memorySettings(a.id)),
    });
  } catch (e) {
    return journeyFailure(e);
  }
}
export async function POST(request: Request) {
  try {
    const a = await journeyAccount(request, true);
    const id = await saveMemory(a.id, await readJourneyJson(request));
    return journeyResponse({ id, memories: await listMemoryItems(a.id) }, 201);
  } catch (e) {
    return journeyFailure(e);
  }
}
export async function DELETE(request: Request) {
  try {
    const a = await journeyAccount(request, true);
    const v = (await readJourneyJson(request)) as { id?: unknown };
    if (typeof v?.id !== "string")
      throw new JourneyError(400, "INVALID_MEMORY", "记忆无效。");
    await deleteMemory(a.id, v.id);
    return journeyResponse({ forgotten: true });
  } catch (e) {
    return journeyFailure(e);
  }
}
