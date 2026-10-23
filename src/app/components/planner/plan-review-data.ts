import type { Journey } from "@/lib/journey-types";
import { isCalendarDate } from "@/lib/planner-input";
import { resolveTripTiming } from "@/lib/trip-timing";

/** Match the server's legacy baseline without guessing from the new candidate. */
export function reviewBaselineItinerary(current: Journey) {
  const before = current.plan?.plan.itinerary ?? [];
  if (!before.some(item => !item.date)) return before;
  const trip = current.draft.trip;
  if (current.planCurrent === false || !isCalendarDate(trip?.departureDate) || !trip.departureTimezone || !trip.destinationTimezone) return before;
  try {
    const { arrivalDate } = resolveTripTiming({ trip: { departureDate: trip.departureDate, departureTimezone: trip.departureTimezone, destinationTimezone: trip.destinationTimezone, returnDate: trip.returnDate ?? "" } });
    return before.map(item => item.date ? item : { ...item, date: arrivalDate });
  } catch { return before; }
}
