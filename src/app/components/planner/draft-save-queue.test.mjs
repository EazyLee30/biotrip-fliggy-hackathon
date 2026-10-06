import test from "node:test";
import assert from "node:assert/strict";
import { createDraftSaveQueue } from "./draft-save-queue.ts";

const snapshot = (destination = "杭州") => ({ title: `${destination}之旅`, draft: { trip: { destinationCity: destination } } });
const record = (value = snapshot(), version = 1) => ({ id: "draft-1", status: "draft", version, ...value, plan: null, planCurrent: false });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

test("queued saves use the preceding saved version and deduplicate the current content", async () => {
  const state = { alive: true, session: 0, journey: null }, calls = [];
  const queue = createDraftSaveQueue({
    context: () => state,
    persist: async (target, value) => { calls.push(target?.version ?? null); return record(value, (target?.version ?? 0) + 1); },
    onSaved: (saved) => { state.journey = saved; },
  });
  const results = await Promise.all([queue.save(snapshot()), queue.save(snapshot("苏州")), queue.save(snapshot("苏州"))]);
  assert.deepEqual(calls, [null, 1]); assert.equal(results[2].version, 2);
});

test("reverting to an older saved draft writes again after the current record changes", async () => {
  const state = { alive: true, session: 0, journey: null }; let calls = 0;
  const queue = createDraftSaveQueue({ context: () => state,
    persist: async (target, value) => { calls++; return record(value, (target?.version ?? 0) + 1); },
    onSaved: (saved) => { state.journey = saved; },
  });
  await queue.save(snapshot());
  state.journey = record(snapshot("苏州"), 2);
  await queue.save(snapshot());
  assert.equal(calls, 2); assert.equal(state.journey.version, 3);
  assert.equal(state.journey.draft.trip.destinationCity, "杭州");
});

test("a queued save from the previous selection never writes to the new journey", async () => {
  const state = { alive: true, session: 0, journey: record() };
  const queue = createDraftSaveQueue({ context: () => state,
    persist: async () => assert.fail("Old queued draft must not be written"),
    onSaved: () => assert.fail("Old queued draft must not switch selection"),
  });
  const pending = queue.save(snapshot("苏州")); state.session++; state.journey = { ...record(), id: "draft-2" };
  assert.equal(await pending, null);
});

test("an in-flight old save is delivered to the list without selecting it", async () => {
  const state = { alive: true, session: 0, journey: record() }, response = deferred(), started = deferred(), delivered = [];
  const queue = createDraftSaveQueue({ context: () => state,
    persist: async (target) => { assert.equal(target.id, "draft-1"); started.resolve(); return response.promise; },
    onSaved: (saved, selected) => { delivered.push({ id: saved.id, selected }); },
  });
  const saving = queue.save(snapshot("苏州")); await started.promise;
  state.session++; state.journey = { ...record(), id: "draft-2" }; response.resolve(record(snapshot("苏州"), 2));
  assert.equal(await saving, null); assert.deepEqual(delivered, [{ id: "draft-1", selected: false }]);
  assert.equal(state.journey.id, "draft-2");
});

test("an unmounted account receives no late state update", async () => {
  const state = { alive: true, session: 0, journey: record() }, response = deferred(), started = deferred();
  const queue = createDraftSaveQueue({ context: () => state,
    persist: async () => { started.resolve(); return response.promise; },
    onSaved: () => assert.fail("Unmounted state must not be updated"),
  });
  const saving = queue.save(snapshot("苏州")); await started.promise;
  state.alive = false; response.resolve(record(snapshot("苏州"), 2)); assert.equal(await saving, null);
});

test("a background selection change also prevents an old response from selecting its journey", async () => {
  const state = { alive: true, session: 0, journey: record() }, response = deferred(), started = deferred();
  let selected = null;
  const queue = createDraftSaveQueue({ context: () => state,
    persist: async () => { started.resolve(); return response.promise; },
    onSaved: (_, current) => { selected = current; },
  });
  const saving = queue.save(snapshot("苏州")); await started.promise;
  state.journey = { ...record(), id: "recovered-task-journey" };
  response.resolve(record(snapshot("苏州"), 2));
  assert.equal(await saving, null); assert.equal(selected, false);
});

test("a failed save rejects its caller but does not poison a later explicit retry", async () => {
  const state = { alive: true, session: 0, journey: record() }; let calls = 0;
  const queue = createDraftSaveQueue({ context: () => state,
    persist: async (target, value) => { if (++calls === 1) throw new Error("conflict"); return record(value, target.version + 1); },
    onSaved: (saved) => { state.journey = saved; },
  });
  await assert.rejects(queue.save(snapshot("苏州")), /conflict/);
  assert.equal(state.journey.version, 1);
  assert.equal((await queue.save(snapshot("苏州"))).version, 2);
});

test("current formal plans and completed journeys cannot be overwritten by draft saves", async () => {
  for (const protectedJourney of [{ ...record(), plan: {}, planCurrent: true, status: "planned" }, { ...record(), status: "active" }, { ...record(), status: "completed" }]) {
    const queue = createDraftSaveQueue({ context: () => ({ alive: true, session: 0, journey: protectedJourney }),
      persist: async () => assert.fail("Protected journey must not be written"), onSaved: () => assert.fail("Protected journey must not be changed"),
    });
    assert.equal(await queue.save(snapshot("苏州")), protectedJourney);
  }
});
