"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Journey } from "@/lib/journey-types";
/** One versioned snapshot shared by manual editing, advisor jobs and chat. */
export function useJourneyState(onSelected: (id: string | null) => void) {
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const latestJourneyRef = useRef<Journey | null>(null);
  const draftSessionRef = useRef(0);
  const journey = journeys.find((entry) => entry.id === selectedId) ?? null;
  const replaceJourney = useCallback(
    (value: Journey) => {
      if (
        latestJourneyRef.current?.id === value.id &&
        latestJourneyRef.current.version > value.version
      )
        return;
      latestJourneyRef.current = value;
      setJourneys((current) => [
        value,
        ...current.filter((entry) => entry.id !== value.id),
      ]);
      setSelectedId(value.id);
      onSelected(value.id);
    },
    [onSelected],
  );
  useEffect(() => {
    latestJourneyRef.current = journey;
  }, [journey]);
  return {
    journeys,
    setJourneys,
    selectedId,
    setSelectedId,
    latestJourneyRef,
    draftSessionRef,
    journey,
    replaceJourney,
  };
}
