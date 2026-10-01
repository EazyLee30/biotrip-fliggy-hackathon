import { forgetJourneyMemory, isRecord, listJourneyMemories, onlyKeys } from "@/lib/journeys";
import { journeyAccount, journeyFailure, journeyResponse, readJourneyJson } from "@/lib/journey-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const account = await journeyAccount(request);
    return journeyResponse({ memories: await listJourneyMemories(account.id) });
  } catch (error) { return journeyFailure(error); }
}
export async function DELETE(request: Request) {
  try {
    const account = await journeyAccount(request, true);
    const value = await readJourneyJson(request, 1_000);
    if (!isRecord(value) || typeof value.id !== "string") return journeyResponse({ error: "偏好记录无效。", code: "INVALID_MEMORY" }, 400);
    onlyKeys(value, ["id"]);
    await forgetJourneyMemory(account.id, value.id);
    return journeyResponse({ forgotten: true });
  } catch (error) { return journeyFailure(error); }
}
