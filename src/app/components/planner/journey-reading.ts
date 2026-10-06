import type { ItineraryItem } from "@/lib/itinerary-edit";

export function destinationDate(now: number, timezone: string) {
  try { return new Intl.DateTimeFormat("sv-SE", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now)); }
  catch { return null; }
}

/** A scheduled start is not evidence that an activity has ended. */
export function upcomingActivity(items: readonly ItineraryItem[], now: number, timezone: string) {
  if (!destinationDate(now, timezone)) return null;
  const parts = new Intl.DateTimeFormat("sv-SE", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(now));
  const value = (name: string) => parts.find(part => part.type === name)?.value ?? "";
  const date = `${value("year")}-${value("month")}-${value("day")}`;
  const time = `${value("hour")}:${value("minute")}`;
  return items.filter(item => item.date === date && /^\d{2}:\d{2}$/.test(item.time) && item.time >= time).sort((a,b) => a.time.localeCompare(b.time))[0] ?? null;
}
