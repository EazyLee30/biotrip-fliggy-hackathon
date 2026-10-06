import assert from "node:assert/strict";
import test from "node:test";
import { beginSheetDrag, closestIndexAt, moveSheetDrag, shouldDismissSheet } from "./sheet-gesture.ts";

test("starting or holding the handle never dismisses the sheet", () => {
  const initial = beginSheetDrag(7, 40, 60, 100);
  assert.equal(initial.pointerId, 7);
  assert.equal(initial.offset, 0);
  assert.equal(initial.velocity, 0);
  assert.equal(shouldDismissSheet(initial, 400), false);
  const held = moveSheetDrag(initial, 40, 60, 3_000);
  assert.equal(shouldDismissSheet(held, 400), false);
});

test("a slow pull dismisses only after crossing the height-adjusted distance", () => {
  for (const [height, threshold] of [[200, 64], [400, 80], [600, 120], [1_000, 120]]) {
    const initial = beginSheetDrag(1, 30, 100, 0);
    const below = moveSheetDrag(initial, 30, 100 + threshold - 1, 1_000);
    const atThreshold = moveSheetDrag(initial, 30, 100 + threshold, 1_000);
    assert.equal(shouldDismissSheet(below, height), false, `below threshold for ${height}px sheet`);
    assert.equal(shouldDismissSheet(atThreshold, height), true, `at threshold for ${height}px sheet`);
  }
});

test("a short downward flick survives an immediate stationary release", () => {
  const initial = beginSheetDrag(1, 0, 0, 0);
  const moved = moveSheetDrag(initial, 0, 26, 40);
  const released = moveSheetDrag(moved, 0, 26, 48);
  assert.equal(shouldDismissSheet(moved, 600), true);
  assert.equal(shouldDismissSheet(released, 600), true);
});

test("flicks require enough downward displacement and velocity", () => {
  const initial = beginSheetDrag(1, 0, 0, 0);
  assert.equal(shouldDismissSheet(moveSheetDrag(initial, 0, 23, 10), 600), false);
  assert.equal(shouldDismissSheet(moveSheetDrag(initial, 0, 25, 40), 600), false);
  assert.equal(shouldDismissSheet(moveSheetDrag(initial, 0, 30, 500), 600), false);
});

test("a quick flick after a long hold uses recent movement speed", () => {
  let drag = beginSheetDrag(1, 0, 0, 0);
  drag = moveSheetDrag(drag, 0, 4, 2_000);
  drag = moveSheetDrag(drag, 0, 32, 2_016);
  assert.equal(shouldDismissSheet(drag, 600), true);
});

test("holding still after a flick expires its dismissal velocity", () => {
  let drag = moveSheetDrag(beginSheetDrag(1, 0, 0, 0), 0, 32, 20);
  drag = moveSheetDrag(drag, 0, 32, 40);
  drag = moveSheetDrag(drag, 0, 32, 75);
  drag = moveSheetDrag(drag, 0, 32, 120);
  assert.equal(drag.offset, 32);
  assert.equal(drag.velocity, 0);
  assert.equal(shouldDismissSheet(drag, 600), false);
});

test("sideways intent cancels the entire gesture even if it later moves down", () => {
  let drag = moveSheetDrag(beginSheetDrag(1, 0, 0, 0), 40, 10, 20);
  assert.equal(drag.horizontal, true);
  assert.equal(drag.offset, 0);
  drag = moveSheetDrag(drag, 40, 140, 60);
  assert.equal(drag.offset, 0);
  assert.equal(shouldDismissSheet(drag, 400), false);
});

test("small sideways drift still permits a downward pull", () => {
  const drag = moveSheetDrag(beginSheetDrag(1, 0, 0, 0), 8, 90, 450);
  assert.equal(drag.horizontal, false);
  assert.equal(shouldDismissSheet(drag, 400), true);
});

test("upward movement never shifts the sheet above its resting position", () => {
  const drag = moveSheetDrag(beginSheetDrag(1, 0, 100, 0), 0, 20, 20);
  assert.equal(drag.offset, 0);
  assert.equal(drag.velocity, 0);
  assert.equal(shouldDismissSheet(drag, 400), false);
});

test("retracing a downward pull cancels distance and flick dismissal", () => {
  let drag = moveSheetDrag(beginSheetDrag(1, 0, 0, 0), 0, 140, 700);
  assert.equal(shouldDismissSheet(drag, 400), true);
  drag = moveSheetDrag(drag, 0, 20, 800);
  assert.equal(shouldDismissSheet(drag, 400), false);
  drag = moveSheetDrag(drag, 0, -20, 820);
  assert.equal(drag.offset, 0);
  assert.equal(shouldDismissSheet(drag, 400), false);
});

test("moves produce a new state without changing the original drag", () => {
  const initial = beginSheetDrag(2, 10, 20, 30);
  const moved = moveSheetDrag(initial, 10, 50, 70);
  assert.notEqual(moved, initial);
  assert.equal(initial.offset, 0);
  assert.equal(initial.previousY, 20);
  assert.equal(moved.offset, 30);
});

test("index dragging follows button centers both down and up", () => {
  const centers = [25, 70, 125, 220];
  assert.deepEqual([25, 70, 125, 220].map((y) => closestIndexAt(y, centers)), [0, 1, 2, 3]);
  assert.deepEqual([220, 125, 70, 25].map((y) => closestIndexAt(y, centers)), [3, 2, 1, 0]);
});

test("index dragging selects the nearest button across gaps", () => {
  const centers = [10, 55, 130];
  assert.equal(closestIndexAt(35, centers), 1);
  assert.equal(closestIndexAt(80, centers), 1);
  assert.equal(closestIndexAt(100, centers), 2);
  assert.equal(closestIndexAt(32.5, centers), 0);
});

test("index dragging clamps out-of-bounds positions and supports an empty index", () => {
  assert.equal(closestIndexAt(-500, [20, 80, 145, 230]), 0);
  assert.equal(closestIndexAt(1_000, [20, 80, 145, 230]), 3);
  assert.equal(closestIndexAt(50, []), -1);
  assert.equal(closestIndexAt(-500, [20]), 0);
  assert.equal(closestIndexAt(1_000, [20]), 0);
});

test("index dragging uses actual unequal center spacing", () => {
  const centers = [10, 40, 200, 215];
  assert.equal(closestIndexAt(110, centers), 1);
  assert.equal(closestIndexAt(130, centers), 2);
  assert.equal(closestIndexAt(208, centers), 3);
});
