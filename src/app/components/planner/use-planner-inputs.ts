"use client";
import { useState } from "react";
import type { JourneyDraft } from "@/lib/journey-types";
export type TripForm = Required<NonNullable<JourneyDraft["trip"]>>;
export const EMPTY_TRIP: TripForm = { originCity: "", destinationCity: "", departureDate: "", departureTimezone: "Asia/Shanghai", destinationTimezone: "", returnDate: "", planningStyle: "flexible", paceLevel: "balanced", guardrails: { morningLight: false, protectReservations: true, sensoryBreaks: true }, itineraryText: "", requestedServices: ["hotels", "attractions", "transport", "local_food", "relaxation"], foodPreferences: "" };

/** Shared draft state survives view changes; the dashboard owns persistence and consent gates. */
export function usePlannerInputs() {
  const [form, setForm] = useState<TripForm>(EMPTY_TRIP);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [intention, setIntention] = useState("安静恢复");
  const [fatigue, setFatigue] = useState("");
  const [stress, setStress] = useState("");
  const [bodyFeedback, setBodyFeedback] = useState("");
  const [moodFeedback, setMoodFeedback] = useState("");
  const [ambient, setAmbient] = useState<string[]>([]);
  const [colorTone, setColorTone] = useState("未指定");
  const [profileMemory, setProfileMemory] = useState("");
  const [includeMemory, setIncludeMemory] = useState(true);
  const [includeWhoop, setIncludeWhoop] = useState(true);
  const [consent, setConsent] = useState(false);
  return { form, setForm, scheduleOpen, setScheduleOpen, intention, setIntention, fatigue, setFatigue, stress, setStress, bodyFeedback, setBodyFeedback, moodFeedback, setMoodFeedback, ambient, setAmbient, colorTone, setColorTone, profileMemory, setProfileMemory, includeMemory, setIncludeMemory, includeWhoop, setIncludeWhoop, consent, setConsent };
}

export type PlannerInputs = ReturnType<typeof usePlannerInputs>;
