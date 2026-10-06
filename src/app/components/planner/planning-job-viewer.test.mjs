import test from "node:test";
import assert from "node:assert/strict";
import { watchPlanningJob } from "./planning-job-viewer.ts";

const update = (seq) => ({ job: { id: "saved-job", state: "running" }, events: [{ seq, kind: "progress", payload: {} }] });

test("viewer reconnects to the saved cursor without resetting progress", async () => {
  const cursors = [], delivered = [];
  let reconnects = 0;
  await watchPlanningJob({
    signal: new AbortController().signal, intervalMs: 0,
    read: async (cursor) => {
      cursors.push(cursor);
      if (cursors.length === 2) throw new Error("offline");
      return update(cursors.length === 1 ? 7 : 9);
    },
    onUpdate: async (value) => { delivered.push(value.events[0].seq); return delivered.length === 2; },
    onReconnect: () => reconnects++,
  });
  assert.deepEqual(cursors, [0, 7, 7]);
  assert.deepEqual(delivered, [7, 9]);
  assert.equal(reconnects, 1);
});

test("viewer discards a transport response that arrives after stopping waiting", async () => {
  const controller = new AbortController();
  let release, calls = 0;
  const response = new Promise((resolve) => { release = resolve; });
  const watching = watchPlanningJob({
    signal: controller.signal,
    read: async () => response,
    onUpdate: async () => { calls++; return false; },
    onReconnect: () => assert.fail("Cancellation must not announce reconnect"),
  });
  controller.abort(); release(update(1)); await watching;
  assert.equal(calls, 0);
});

test("stopping during the poll delay prevents another request", async () => {
  const controller = new AbortController(); let reads = 0;
  await watchPlanningJob({
    signal: controller.signal, intervalMs: 60_000,
    read: async () => { reads++; return update(1); },
    onUpdate: async () => { controller.abort(); return false; },
    onReconnect: () => assert.fail("Unexpected reconnect"),
  });
  assert.equal(reads, 1);
});

test("persistent read failures stop after eight attempts and preserve the error", async () => {
  const failure = new Error("network unavailable"); let reads = 0, reconnects = 0;
  await assert.rejects(watchPlanningJob({
    signal: new AbortController().signal, intervalMs: 0,
    read: async () => { reads++; throw failure; },
    onUpdate: async () => assert.fail("No response to deliver"),
    onReconnect: () => reconnects++,
  }), (error) => error === failure);
  assert.equal(reads, 8); assert.equal(reconnects, 7);
});
