import type { Journey } from "@/lib/journey-types";
import { destinationClock } from "@/lib/adjust/request";
export function proactiveSuggestion(
  journey: Journey | null,
  now = new Date(),
): { key: string; text: string; prompt: string; basis: string } | null {
  if (!journey?.plan || !journey.planCurrent || journey.status !== "active")
    return null;
  const clock = destinationClock(
    journey.draft.trip?.destinationTimezone || "Asia/Shanghai",
    now,
  );
  const remaining = journey.plan.plan.itinerary.filter(
    (a) => a.date === clock.date && a.time >= clock.time,
  );
  if (!remaining.length) return null;
  const active = remaining.filter(
    (a) => a.kind !== "rest" && a.kind !== "stay",
  );
  const rests = remaining.filter((a) => a.kind === "rest");
  if (active.length < 3 || rests.length) return null;
  return {
    key: `${journey.id}:${clock.date}`,
    text: `今天还有 ${active.length} 项安排，要留一点休息时间吗？`,
    prompt:
      "保留今天的固定预约，在剩余行程里留出一段休息，并说明会调整哪些活动。",
    basis: "根据今天尚未开始的行程安排",
  };
}
