import assert from "node:assert/strict";
import test from "node:test";
import { activateItineraryDrag, beginItineraryDrag, itineraryDropTarget, itineraryEdgeVelocity, moveItineraryDrag } from "./itinerary-drag.ts";

test("touch sorting requires the full hold while desktop handles start immediately", () => {
  const touch = beginItineraryDrag(1, 30, 70, 100, true);
  assert.equal(activateItineraryDrag(touch, 399).phase, "pending");
  assert.equal(activateItineraryDrag(touch, 400).phase, "dragging");
  assert.equal(beginItineraryDrag(2, 30, 70, 100, false).phase, "dragging");
});

test("scrolling before the hold cancels sorting permanently", () => {
  let touch = moveItineraryDrag(beginItineraryDrag(1, 30, 70, 0, true), 32, 85);
  assert.equal(touch.phase, "cancelled");
  touch = activateItineraryDrag(touch, 1_000);
  touch = moveItineraryDrag(touch, 30, 70);
  assert.equal(touch.phase, "cancelled");
});

test("a small hold jitter is tolerated and active dragging can retrace", () => {
  let touch = moveItineraryDrag(beginItineraryDrag(1, 30, 70, 0, true), 34, 75);
  touch = activateItineraryDrag(touch, 300);
  assert.equal(touch.phase, "dragging");
  touch = moveItineraryDrag(touch, 30, 180);
  assert.equal(touch.phase, "dragging");
  touch = moveItineraryDrag(touch, 30, 70);
  assert.equal(touch.y, touch.startY);
  assert.equal(touch.phase, "dragging");
});

test("targets use real uneven row centers and never include fixed positions", () => {
  const centers = [{ index: 0, center: 30 }, { index: 2, center: 150 }, { index: 4, center: 320 }];
  assert.equal(itineraryDropTarget(90, centers), 0);
  assert.equal(itineraryDropTarget(130, centers), 2);
  assert.equal(itineraryDropTarget(300, centers), 4);
  assert.equal(itineraryDropTarget(-100, centers), 0);
  assert.equal(itineraryDropTarget(1_000, centers), 4);
  assert.equal(itineraryDropTarget(20, []), -1);
});

test("auto-scroll runs only near an edge and caps its speed", () => {
  assert.equal(itineraryEdgeVelocity(200, 100, 400), 0);
  assert.ok(itineraryEdgeVelocity(120, 100, 400) < 0);
  assert.ok(itineraryEdgeVelocity(380, 100, 400) > 0);
  assert.equal(itineraryEdgeVelocity(-1_000, 100, 400), -0.5);
  assert.equal(itineraryEdgeVelocity(1_000, 100, 400), 0.5);
  assert.equal(itineraryEdgeVelocity(100, 100, 100), 0);
  assert.equal(itineraryEdgeVelocity(110, 100, 120), 0);
});

test("drag helpers do not mutate earlier pointer state", () => {
  const initial = beginItineraryDrag(1, 0, 0, 0, true);
  const next = moveItineraryDrag(initial, 0, 20);
  assert.equal(initial.y, 0);
  assert.equal(initial.phase, "pending");
  assert.equal(next.phase, "cancelled");
});
