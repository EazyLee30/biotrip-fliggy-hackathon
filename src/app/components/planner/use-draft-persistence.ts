"use client";

import { useCallback, useMemo, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { Journey, JourneyDraft } from "@/lib/journey-types";
import type { AppView } from "./app-navigation";
import { createDraftSaveQueue } from "./draft-save-queue";

export function useDraftPersistence({ latestJourney, draftSession, alive, draftFor, destinationCity, originCity, view, replaceJourney, setJourneys, request }: {
  latestJourney: RefObject<Journey | null>;
  draftSession: RefObject<number>;
  alive: RefObject<boolean>;
  draftFor: () => JourneyDraft;
  destinationCity: string;
  originCity: string;
  view: AppView;
  replaceJourney: (value: Journey) => void;
  setJourneys: Dispatch<SetStateAction<Journey[]>>;
  request: <T>(url: string, options?: RequestInit) => Promise<T>;
}) {
  const queue = useMemo(() => createDraftSaveQueue({
    context: () => ({ alive: alive.current, session: draftSession.current, journey: latestJourney.current }),
    persist: async (target, snapshot) => {
      const payload = await request<{ journey: Journey }>(target ? `/api/journeys/${target.id}` : "/api/journeys", {
        method: target ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(target ? { version: target.version } : {}), ...snapshot }),
      });
      return payload.journey;
    },
    onSaved: (saved, selected) => {
      if (selected) replaceJourney(saved);
      else setJourneys((current) => current.some((entry) => entry.id === saved.id && entry.version > saved.version)
        ? current : [saved, ...current.filter((entry) => entry.id !== saved.id)]);
    },
  }), [alive, draftSession, latestJourney, replaceJourney, request, setJourneys]);
  const queueDraftSave = useCallback(() => queue.save({
    title: destinationCity.trim() ? `${destinationCity.trim()}之旅` : "新的旅程",
    draft: draftFor(),
  }), [destinationCity, draftFor, queue]);
  const flushDraft = useCallback(async () => {
    // Merely leaving an empty page must not create a journey.
    if (!latestJourney.current && (view !== "create" || (!originCity.trim() && !destinationCity.trim()))) return null;
    return queueDraftSave();
  }, [latestJourney, view, originCity, destinationCity, queueDraftSave]);
  return { queueDraftSave, flushDraft };
}
