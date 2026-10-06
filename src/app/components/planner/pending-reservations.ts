import { parseSchedule, scheduleError } from "@/lib/planner-input";

export type PendingReservationsContext = { journeyId: string; version: number; baseItineraryText: string };
export type PendingReservationsStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREFIX = "biotrip:pending-reservations:";
const MAX_JSON_LENGTH = 80_000;

function storageOrNull(injected?: PendingReservationsStorage | null): PendingReservationsStorage | null {
  if (injected !== undefined) return injected;
  try { return typeof window === "undefined" ? null : window.sessionStorage; } catch { return null; }
}

function storageKey(journeyId: unknown): string | null {
  return typeof journeyId === "string" && UUID.test(journeyId) ? `${PREFIX}${journeyId.toLowerCase()}` : null;
}

function validText(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 6000 || scheduleError(value) !== null) return false;
  const items = parseSchedule(value);
  return items !== null && items.length <= 30;
}

function validContext(context: PendingReservationsContext): boolean {
  return Boolean(context && storageKey(context.journeyId) && Number.isSafeInteger(context.version) && context.version >= 1 && validText(context.baseItineraryText));
}

/** Temporary appointment changes only. The server's saved itinerary remains authoritative. */
export function savePendingReservations(context: PendingReservationsContext, value: string, injected?: PendingReservationsStorage | null): boolean {
  const storage = storageOrNull(injected);
  if (!storage || !validContext(context) || !validText(value)) return false;
  const key = storageKey(context.journeyId)!;
  try {
    // Construct the payload explicitly; never serialize a journey, health data, or credentials.
    storage.setItem(key, JSON.stringify({ version: context.version, baseItineraryText: context.baseItineraryText, value }));
    return true;
  } catch { return false; }
}

/** Restore even an empty value (the user deleted every appointment), provided its exact base still matches. */
export function readPendingReservations(context: PendingReservationsContext, injected?: PendingReservationsStorage | null): string | null {
  const storage = storageOrNull(injected);
  const key = storageKey(context?.journeyId);
  if (!storage || !key) return null;
  function discard(): null {
    try { storage!.removeItem(key!); } catch { /* Storage failures never block the journey. */ }
    return null;
  }
  if (!validContext(context)) return discard();
  try {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    if (raw.length > MAX_JSON_LENGTH) return discard();
    const payload: unknown = JSON.parse(raw);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return discard();
    const value = payload as Record<string, unknown>;
    const keys = Object.keys(value);
    if (keys.length !== 3 || !["version", "baseItineraryText", "value"].every((field) => Object.hasOwn(value, field))) return discard();
    if (value.version !== context.version || value.baseItineraryText !== context.baseItineraryText || !validText(value.value)) return discard();
    return value.value;
  } catch { return discard(); }
}

export function clearPendingReservations(journeyId: string, injected?: PendingReservationsStorage | null): boolean {
  const storage = storageOrNull(injected);
  const key = storageKey(journeyId);
  if (!storage || !key) return false;
  try { storage.removeItem(key); return true; } catch { return false; }
}
