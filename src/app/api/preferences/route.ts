import {
  clearLearnedPreferences,
  forgetLearnedPreference,
  listLearnedPreferences,
  preferenceDefaults,
} from "@/lib/preferences";
import { journeyAccount, journeyFailure, journeyResponse, readJourneyJson } from "@/lib/journey-http";
import { isRecord, JourneyError } from "@/lib/journeys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const account = await journeyAccount(request);
    const preferences = await listLearnedPreferences(account.id);
    return journeyResponse({ preferences, defaults: preferenceDefaults(preferences) });
  } catch (error) { return journeyFailure(error); }
}

export async function DELETE(request: Request) {
  try {
    const account = await journeyAccount(request, true);
    const value = await readJourneyJson(request, 1_000);
    if (!isRecord(value)) throw new JourneyError(400, "INVALID_PREFERENCE", "记忆记录无效。");
    if (value.all === true) {
      await clearLearnedPreferences(account.id);
      return journeyResponse({ cleared: true, preferences: [], defaults: preferenceDefaults([]) });
    }
    if (typeof value.id !== "string" || value.id.length > 64) {
      throw new JourneyError(400, "INVALID_PREFERENCE", "记忆记录无效。");
    }
    await forgetLearnedPreference(account.id, value.id);
    const preferences = await listLearnedPreferences(account.id);
    return journeyResponse({ forgotten: true, preferences, defaults: preferenceDefaults(preferences) });
  } catch (error) { return journeyFailure(error); }
}
