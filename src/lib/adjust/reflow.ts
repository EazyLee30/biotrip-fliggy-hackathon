import { applyItineraryOperations, ItineraryEditError, type ItineraryItem, type ItineraryOperation } from "../itinerary-edit";
import type { JourneyTripDraft } from "../journey-types";
import { activityTags, clockOf, minutesOf } from "./tags";
import type { AdjustScope, AdjustTemplate } from "./types";

/**
 * Turns adjustment templates into the same operations a manual edit produces.
 *
 * A template says what should change ("add a 40 minute rest after this
 * activity"); this module works out the resulting clock times. Reservations the
 * traveller fixed are pinned: flexible activities move around them, and a
 * template that cannot fit without touching one is infeasible rather than
 * quietly reshaped. Every operation is replayed through
 * `applyItineraryOperations`, so an adjustment can never produce a day a manual
 * edit would have refused.
 */

export class ReflowError extends Error {
  readonly code = "ADJUSTMENT_INFEASIBLE";
  constructor(message: string) { super(message); }
}
function infeasible(message: string): never { throw new ReflowError(message); }

/** Latest minute of day a pushed activity may start. */
const LAST_START = 22 * 60;
const MINIMUM_STOP = 20;

type Working = { items: ItineraryItem[]; operations: ItineraryOperation[]; changed: Set<string> };

function locate(state: Working, id: string): { index: number; item: ItineraryItem } {
  const index = state.items.findIndex((item) => item.id === id);
  if (index < 0) infeasible("这项安排已变化，请重新获取建议。");
  return { index, item: state.items[index] };
}
function emit(state: Working, operation: ItineraryOperation, trip: JourneyTripDraft) {
  try {
    state.items = applyItineraryOperations(state.items, [operation], trip).itinerary;
    state.operations.push(operation);
  } catch (error) {
    if (error instanceof ItineraryEditError) infeasible(error.message);
    throw error;
  }
}
function sameDay(state: Working, date: string) {
  return state.items.filter((item) => item.date === date).sort((a, b) => a.time.localeCompare(b.time));
}
function occupied(item: ItineraryItem, next?: ItineraryItem): number {
  const length = activityTags(item).durationMin;
  return next ? Math.min(length, Math.max(5, minutesOf(next.time) - minutesOf(item.time))) : length;
}
function roundUp(minutes: number) { return Math.ceil(minutes / 5) * 5; }
function assertInScope(item: ItineraryItem, scope: AdjustScope) {
  const date = item.date ?? "";
  if (date < scope.date || date > scope.throughDate || (date === scope.date && item.time < scope.fromTime)) {
    infeasible("已经过去或不在本次调整范围内的安排不会被改动。");
  }
}

/**
 * Makes `[start, start + length)` free on `date` by moving later flexible
 * activities back, latest first so no two ever share a clock time mid-way.
 * Returns the length that actually fits before the next fixed reservation.
 */
function makeRoom(state: Working, date: string, start: number, length: number, trip: JourneyTripDraft, skipId?: string): number {
  const later = sameDay(state, date).filter((item) => item.id !== skipId && minutesOf(item.time) >= start);
  const barrier = later.find((item) => item.fixed);
  let fits = length;
  if (barrier) {
    const gap = minutesOf(barrier.time) - start;
    if (gap < Math.min(MINIMUM_STOP, length)) infeasible("这段时间紧挨着固定预约，放不下这项调整。");
    fits = Math.min(length, gap);
  }
  const moves: Array<{ id: string; time: string }> = [];
  let cursor = start + fits;
  for (let position = 0; position < later.length; position += 1) {
    const item = later[position];
    const begins = minutesOf(item.time);
    if (item.fixed) {
      if (begins < cursor) infeasible("调整后会与固定预约重叠。");
      break;
    }
    if (begins >= cursor) break;
    const target = roundUp(cursor);
    if (target > LAST_START) infeasible("调整后当天安排会排到太晚。");
    moves.push({ id: item.id!, time: clockOf(target) });
    cursor = target + occupied(item, later[position + 1]);
  }
  for (const move of moves.reverse()) {
    const { index } = locate(state, move.id);
    emit(state, { type: "edit", index, activityId: move.id, time: move.time }, trip);
    state.changed.add(move.id);
  }
  return fits;
}

function applyTemplate(state: Working, template: AdjustTemplate, trip: JourneyTripDraft, scope: AdjustScope) {
  if (template.type === "swap_move") {
    const { index, item } = locate(state, template.activityId);
    assertInScope(item, scope);
    emit(state, { type: "edit", index, activityId: item.id, move: {
      mode: template.mode, basis: template.basis,
      ...(template.minutes !== undefined ? { minutes: template.minutes } : {}),
      ...(template.km !== undefined ? { km: template.km } : {}),
      ...(template.costCny !== undefined ? { costCny: template.costCny } : {}),
    } }, trip);
    state.changed.add(item.id!);
    return;
  }
  if (template.type === "add_stop") {
    let start: number;
    if (template.afterActivityId) {
      const { item } = locate(state, template.afterActivityId);
      if (item.date !== template.date) infeasible("新增的停留需要与参照安排在同一天。");
      const day = sameDay(state, template.date);
      start = roundUp(minutesOf(item.time) + occupied(item, day[day.findIndex((row) => row.id === item.id) + 1]));
    } else if (template.time) start = minutesOf(template.time);
    else infeasible("新增的停留缺少时间。");
    if (template.date < scope.date || template.date > scope.throughDate) infeasible("新增的停留不在本次调整范围内。");
    if (template.date === scope.date) start = Math.max(start, roundUp(minutesOf(scope.fromTime)));
    if (start > LAST_START) infeasible("当天已经没有合适的时间。");
    const length = makeRoom(state, template.date, start, template.durationMin, trip);
    const id = crypto.randomUUID();
    emit(state, {
      type: "add", id, date: template.date, time: clockOf(start), name: template.name, detail: template.detail, fixed: false,
      kind: template.kind, effort: template.effort, durationMin: Math.max(5, length),
      ...(template.sourceUrl ? { sourceUrl: template.sourceUrl } : {}),
    }, trip);
    state.changed.add(id);
    return;
  }
  if (template.type === "end_early") {
    const { item } = locate(state, template.afterActivityId);
    assertInScope(item, scope);
    const removable = sameDay(state, item.date ?? "").filter((row) => !row.fixed && row.time > item.time);
    if (!removable.length) infeasible("这之后没有可以放下的灵活安排。");
    for (const row of removable.reverse()) emit(state, { type: "remove", index: locate(state, row.id!).index, activityId: row.id }, trip);
    return;
  }

  const { index, item } = locate(state, template.activityId);
  assertInScope(item, scope);
  if (item.fixed) infeasible("固定预约不会被自动调整。");
  if (template.type === "replace_stop") {
    emit(state, { type: "edit", index, activityId: item.id, name: template.name, detail: template.detail, sourceUrl: template.sourceUrl,
      ...(template.kind ? { kind: template.kind } : {}), ...(template.effort ? { effort: template.effort } : {}) }, trip);
  } else if (template.type === "shorten") {
    if (template.durationMin >= activityTags(item).durationMin) infeasible("缩短后的时长应比原来短。");
    emit(state, { type: "edit", index, activityId: item.id, durationMin: template.durationMin }, trip);
  } else if (template.type === "drop") {
    emit(state, { type: "remove", index, activityId: item.id }, trip);
    return;
  } else if (template.type === "shift") {
    const day = sameDay(state, item.date ?? "");
    const position = day.findIndex((row) => row.id === item.id);
    const target = roundUp(minutesOf(item.time) + template.minutes);
    const previous = day[position - 1];
    if (target > LAST_START || target < 0) infeasible("调整后的时间超出当天范围。");
    if (previous && target < minutesOf(previous.time) + occupied(previous, item)) infeasible("提前后会与上一项安排重叠。");
    if (item.date === scope.date && target < minutesOf(scope.fromTime)) infeasible("不能把安排挪到已经过去的时间。");
    if (template.minutes > 0) makeRoom(state, item.date ?? "", target, occupied(item, day[position + 1]), trip, item.id);
    emit(state, { type: "edit", index: locate(state, item.id!).index, activityId: item.id, time: clockOf(target) }, trip);
  } else if (template.type === "postpone") {
    if (template.date < scope.date || template.date > scope.throughDate || template.date === item.date) infeasible("延后的日期不在本次调整范围内。");
    const length = activityTags(item).durationMin;
    const fits = makeRoom(state, template.date, minutesOf(template.time), length, trip);
    emit(state, { type: "edit", index: locate(state, item.id!).index, activityId: item.id, date: template.date, time: template.time,
      ...(fits < length ? { durationMin: fits } : {}) }, trip);
  }
  state.changed.add(item.id!);
}

export type ReflowResult = { operations: ItineraryOperation[]; itinerary: ItineraryItem[]; changedIds: string[] };

/** Applies templates in order to a copy of the itinerary; throws `ReflowError` when any cannot fit. */
export function reflow(itinerary: readonly ItineraryItem[], templates: readonly AdjustTemplate[], trip: JourneyTripDraft, scope: AdjustScope): ReflowResult {
  if (itinerary.some((item) => !item.id || !item.date)) infeasible("这份行程需要先保存一次，才能使用调整建议。");
  const state: Working = { items: itinerary.map((item) => ({ ...item })), operations: [], changed: new Set() };
  for (const template of templates) applyTemplate(state, template, trip, scope);
  for (const template of templates) {
    if (template.type !== "swap_move" || template.basis !== "amap" || !template.fromActivityId) continue;
    const { item } = locate(state, template.activityId);
    const day = sameDay(state, item.date ?? ""), previous = day[day.findIndex(row => row.id === item.id) - 1];
    if (!previous || previous.id !== template.fromActivityId || (template.fromActivityName && previous.name !== template.fromActivityName)) infeasible("路线起点已变化，请重新获取出行建议。");
  }
  return { operations: state.operations, itinerary: state.items, changedIds: [...state.changed] };
}

/** True when the templates fit the day as it stands. */
export function feasible(itinerary: readonly ItineraryItem[], templates: readonly AdjustTemplate[], trip: JourneyTripDraft, scope: AdjustScope): boolean {
  try { reflow(itinerary, templates, trip, scope); return true; }
  catch (error) { if (error instanceof ReflowError) return false; throw error; }
}
