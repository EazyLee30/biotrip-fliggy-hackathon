export type SheetDrag = {
  pointerId: number;
  startX: number;
  startY: number;
  startAt: number;
  previousY: number;
  previousAt: number;
  offset: number;
  velocity: number;
  horizontal: boolean;
};

const HORIZONTAL_SLOP = 16;
const FLICK_RELEASE_WINDOW = 80;

export function beginSheetDrag(pointerId: number, x: number, y: number, at: number): SheetDrag {
  return {
    pointerId,
    startX: x,
    startY: y,
    startAt: at,
    previousY: y,
    previousAt: at,
    offset: 0,
    velocity: 0,
    horizontal: false,
  };
}

/** Coordinates are pointer pixels and timestamps are milliseconds. */
export function moveSheetDrag(state: SheetDrag, x: number, y: number, at: number): SheetDrag {
  const distanceX = Math.abs(x - state.startX);
  const distanceY = y - state.startY;
  const horizontal = state.horizontal || (distanceX >= HORIZONTAL_SLOP && distanceX > Math.abs(distanceY));
  const offset = horizontal ? 0 : Math.max(0, distanceY);
  const elapsed = at - state.previousAt;
  const movement = y - state.previousY;
  const stationary = movement === 0;

  // Retain a flick through an immediate same-position pointerup, but expire it
  // after a pause. Keep its original sample time so repeated stationary events
  // cannot keep an old flick alive indefinitely.
  const retainVelocity = stationary && elapsed >= 0 && elapsed <= FLICK_RELEASE_WINDOW && state.velocity !== 0;
  const velocity = horizontal || offset === 0
    ? 0
    : stationary
      ? retainVelocity ? state.velocity : 0
      : elapsed > 0 ? movement / elapsed : 0;

  return {
    ...state,
    previousY: y,
    previousAt: retainVelocity ? state.previousAt : at,
    offset,
    velocity,
    horizontal,
  };
}

export function shouldDismissSheet(state: SheetDrag, height: number): boolean {
  if (state.horizontal) return false;
  const distanceThreshold = Math.max(64, Math.min(120, height * 0.2));
  return state.offset >= distanceThreshold || (state.offset >= 24 && state.velocity >= 0.65);
}

/** Use measured button centers so drag selection also works across uneven gaps. */
export function closestIndexAt(pointerY: number, centers: readonly number[]): number {
  let closest = -1;
  let closestDistance = Infinity;
  for (let index = 0; index < centers.length; index += 1) {
    const distance = Math.abs(pointerY - centers[index]);
    if (distance < closestDistance) {
      closest = index;
      closestDistance = distance;
    }
  }
  return closest;
}
