import assert from "node:assert/strict";
import { test } from "node:test";
import { loadModule } from "../../../lib/test-support/module-loader.mjs";

const parser = loadModule("lib/planner-input.ts");
const { savePendingReservations, readPendingReservations, clearPendingReservations } = loadModule("app/components/planner/pending-reservations.ts", { "@/lib/planner-input": parser });
const context = { journeyId: "aaaa1111-1111-4111-8111-111111111111", version: 3, baseItineraryText: "13:00 original meetup" };
const other = { ...context, journeyId: "bbbb2222-2222-4222-8222-222222222222" };
const changed = "2026-10-03 13:07 | 参加活动（地点：用户地点） | 固定";

function memoryStorage() {
  const values = new Map();
  return { values, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
}
function replaceStored(storage, value) {
  const key = [...storage.values.keys()][0];
  assert.ok(key);
  storage.values.set(key, typeof value === "string" ? value : JSON.stringify(value));
}

test("temporary changes store only appointment text and its exact journey version/base", () => {
  const storage = memoryStorage();
  assert.equal(savePendingReservations(context, changed, storage), true);
  assert.equal(readPendingReservations(context, storage), changed);
  assert.deepEqual(JSON.parse([...storage.values.values()][0]), { version: 3, baseItineraryText: context.baseItineraryText, value: changed });
  assert.match([...storage.values.keys()][0], new RegExp(`${context.journeyId}$`));
});

test("a removed entire appointment list restores as an empty string, distinct from missing cache", () => {
  const storage = memoryStorage();
  assert.equal(readPendingReservations(context, storage), null);
  assert.equal(savePendingReservations(context, "", storage), true);
  assert.equal(readPendingReservations(context, storage), "");
});

test("independent journey UUIDs never share changes and clearing one keeps the other", () => {
  const storage = memoryStorage();
  savePendingReservations(context, changed, storage);
  savePendingReservations(other, "15:00 another journey", storage);
  assert.equal(readPendingReservations(context, storage), changed);
  assert.equal(readPendingReservations(other, storage), "15:00 another journey");
  assert.equal(clearPendingReservations(context.journeyId, storage), true);
  assert.equal(readPendingReservations(context, storage), null);
  assert.equal(readPendingReservations(other, storage), "15:00 another journey");
});

test("new journey versions and changed raw base text invalidate and remove stale adjustments", () => {
  for (const current of [{ ...context, version: 4 }, { ...context, baseItineraryText: "13:00 | original meetup | 固定" }]) {
    const storage = memoryStorage();
    savePendingReservations(context, changed, storage);
    assert.equal(readPendingReservations(current, storage), null);
    assert.equal(storage.values.size, 0);
  }
});

test("malformed and malicious JSON is discarded without returning any unvalidated text", () => {
  const payload = { version: 3, baseItineraryText: context.baseItineraryText, value: changed };
  for (const malicious of ["not json", "null", "[]", "\"raw string\"", { ...payload, value: {} }, { ...payload, version: "3" }, { ...payload, health: { private: "not accepted" } }, { value: changed }, { ...payload, value: "24:00 invalid" }, "x".repeat(80_001)]) {
    const storage = memoryStorage();
    savePendingReservations(context, changed, storage);
    replaceStored(storage, malicious);
    assert.equal(readPendingReservations(context, storage), null);
    assert.equal(storage.values.size, 0);
  }
});

test("oversized and over-thirty-row content is rejected while an existing valid cache stays intact", () => {
  const storage = memoryStorage();
  savePendingReservations(context, changed, storage);
  for (const invalid of ["x".repeat(6001), Array.from({ length: 31 }, () => "13:00 meetup").join("\n"), "13:60 invalid", "13:00 | | 固定"]) {
    assert.equal(savePendingReservations(context, invalid, storage), false);
    assert.equal(readPendingReservations(context, storage), changed);
  }
  const thirty = Array.from({ length: 30 }, (_, i) => `13:00 meetup${i}`).join("\n");
  assert.equal(savePendingReservations(context, thirty, storage), true);
  assert.equal(readPendingReservations(context, storage), thirty);
});

test("invalid UUIDs, unsafe versions and malformed base text never write storage", () => {
  const storage = memoryStorage();
  for (const invalid of [{ ...context, journeyId: "../another-key" }, { ...context, version: 0 }, { ...context, version: 1.5 }, { ...context, version: Number.MAX_SAFE_INTEGER + 1 }, { ...context, baseItineraryText: "invalid" }]) {
    assert.equal(savePendingReservations(invalid, changed, storage), false);
    assert.equal(readPendingReservations(invalid, storage), null);
  }
  assert.equal(clearPendingReservations("not-a-uuid", storage), false);
  assert.equal(storage.values.size, 0);
});

test("session storage access, get, set and remove errors never throw or block the app", () => {
  const failure = () => { throw new Error("blocked storage"); };
  const storage = { getItem: failure, setItem: failure, removeItem: failure };
  assert.equal(savePendingReservations(context, changed, storage), false);
  assert.equal(readPendingReservations(context, storage), null);
  assert.equal(clearPendingReservations(context.journeyId, storage), false);
  assert.equal(savePendingReservations(context, changed, null), false);
  assert.equal(readPendingReservations(context, null), null);
  assert.equal(clearPendingReservations(context.journeyId, null), false);
  const inaccessible = loadModule("app/components/planner/pending-reservations.ts", { "@/lib/planner-input": parser }, { window: { get sessionStorage() { return failure(); } } });
  assert.equal(inaccessible.savePendingReservations(context, changed), false);
  assert.equal(inaccessible.readPendingReservations(context), null);
  assert.equal(inaccessible.clearPendingReservations(context.journeyId), false);
  assert.equal(readPendingReservations(context), null); // Server-side rendering has no window.
});

test("a valid browser session store is used lazily and uppercase UUIDs resolve to the same journey", () => {
  const storage = memoryStorage();
  const browser = loadModule("app/components/planner/pending-reservations.ts", { "@/lib/planner-input": parser }, { window: { sessionStorage: storage } });
  assert.equal(browser.savePendingReservations({ ...context, journeyId: context.journeyId.toUpperCase() }, changed), true);
  assert.equal(browser.readPendingReservations(context), changed);
  assert.equal(browser.clearPendingReservations(context.journeyId), true);
  assert.equal(storage.values.size, 0);
});
