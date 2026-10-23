import { listMemoryItems, saveMemory } from "@/lib/agent/memory";
import {
  journeyAccount,
  journeyFailure,
  journeyResponse,
  readJourneyJson,
} from "@/lib/journey-http";
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const a = await journeyAccount(request, true);
    const { id } = await context.params;
    const v = (await readJourneyJson(request)) as { version?: number };
    await saveMemory(a.id, v, { id, version: v.version });
    return journeyResponse({ memories: await listMemoryItems(a.id) });
  } catch (e) {
    return journeyFailure(e);
  }
}
