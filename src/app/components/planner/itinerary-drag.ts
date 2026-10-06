export type ItineraryDrag = {
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  startedAt: number;
  phase: "pending" | "dragging" | "cancelled";
};

export const ITINERARY_HOLD_MS = 300;
const SLOP = 8;

export function beginItineraryDrag(pointerId: number, x: number, y: number, at: number, touch: boolean): ItineraryDrag {
  return { pointerId, startX: x, startY: y, x, y, startedAt: at, phase: touch ? "pending" : "dragging" };
}

export function moveItineraryDrag(state: ItineraryDrag, x: number, y: number): ItineraryDrag {
  const cancelled = state.phase === "pending" && Math.hypot(x - state.startX, y - state.startY) > SLOP;
  return { ...state, x, y, phase: cancelled ? "cancelled" : state.phase };
}

export function activateItineraryDrag(state: ItineraryDrag, at: number): ItineraryDrag {
  return state.phase === "pending" && at - state.startedAt >= ITINERARY_HOLD_MS ? { ...state, phase: "dragging" } : state;
}

/** Centers belong only to eligible same-day flexible activities. */
export function itineraryDropTarget(y: number, centers: readonly { index: number; center: number }[]): number {
  let closest = -1, distance = Infinity;
  for (const item of centers) {
    const next = Math.abs(item.center - y);
    if (next < distance) { closest = item.index; distance = next; }
  }
  return closest;
}

/** Pixels per millisecond; the caller applies this inside requestAnimationFrame. */
export function itineraryEdgeVelocity(y: number, top: number, bottom: number): number {
  if (bottom <= top) return 0;
  const edge = Math.min(48, (bottom - top) / 2);
  if (y < top + edge) return -0.5 * Math.min(1, (top + edge - y) / edge);
  if (y > bottom - edge) return 0.5 * Math.min(1, (y - bottom + edge) / edge);
  return 0;
}
