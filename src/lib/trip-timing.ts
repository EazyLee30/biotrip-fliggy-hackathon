import {
  ASSUMED_ARRIVAL_HOUR, ASSUMED_DEPARTURE_HOUR,
  localDateTimeAsInstant, localDateTimeAt, offsetMinutesAt,
  type PlannerInput,
} from "./planner-input";
import type { TripTiming } from "./planning/contract";

function nextDate(date: string) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

/** Clock times are planning buffers, never known flight or reservation times. */
export function resolveTripTiming(input: { trip: Pick<PlannerInput["trip"], "departureDate" | "departureTimezone" | "destinationTimezone" | "returnDate"> }): TripTiming {
  const departureLocal = localDateTimeAt(input.trip.departureDate, ASSUMED_DEPARTURE_HOUR);
  const departureInstant = localDateTimeAsInstant(departureLocal, input.trip.departureTimezone);
  let arrivalDate = input.trip.departureDate;
  let arrivalLocal = localDateTimeAt(arrivalDate, ASSUMED_ARRIVAL_HOUR);
  let arrivalInstant = localDateTimeAsInstant(arrivalLocal, input.trip.destinationTimezone);
  // Crossing the date line can make the same wall-clock date earlier in UTC.
  // Advance the assumed arrival day instead of rejecting a valid route.
  for (let day = 0; arrivalInstant.getTime() < departureInstant.getTime() && day < 2; day += 1) {
    arrivalDate = nextDate(arrivalDate);
    arrivalLocal = localDateTimeAt(arrivalDate, ASSUMED_ARRIVAL_HOUR);
    arrivalInstant = localDateTimeAsInstant(arrivalLocal, input.trip.destinationTimezone);
  }
  const endDate = input.trip.returnDate || arrivalDate;
  if (endDate < arrivalDate) throw new Error(`按所选时区预留的抵达日为 ${arrivalDate}，请将返程日期选在该日或之后。`);
  return {
    departureInstant, arrivalInstant, arrivalDate, endDate, departureLocal, arrivalLocal,
    timezoneShiftMinutes: offsetMinutesAt(arrivalInstant, input.trip.destinationTimezone) - offsetMinutesAt(departureInstant, input.trip.departureTimezone),
    travelHours: Math.round((arrivalInstant.getTime() - departureInstant.getTime()) / 3_600_000 * 10) / 10,
    days: Math.max(1, Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${arrivalDate}T00:00:00Z`)) / 86_400_000) + 1),
  };
}
