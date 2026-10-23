import { onboardingDefaults } from "@/lib/onboarding";
import { listMemoryItems, memorySettings } from "@/lib/agent/memory";
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
    const [memories,settings] = await Promise.all([listMemoryItems(account.id),memorySettings(account.id)]);
    const learned=preferenceDefaults(preferences), initial=onboardingDefaults(memories);
    // First-run choices seed defaults; later, repeated or explicitly updated
    // preferences can replace them without making onboarding permanent.
    const defaults = {
      ...learned,
      paceLevel: learned.paceLevel ?? initial.paceLevel,
      homeCities: learned.homeCities.length ? learned.homeCities : initial.homeCities ?? [],
      foodPreferences: learned.foodPreferences ?? initial.foodPreferences,
      established: learned.established || initial.established,
    };
    return journeyResponse({ preferences, defaults: settings.useMemory ? defaults : preferenceDefaults([]) });
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
