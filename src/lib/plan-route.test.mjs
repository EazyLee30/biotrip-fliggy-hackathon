import assert from "node:assert/strict";
import { test } from "node:test";
import { loadModule } from "./test-support/module-loader.mjs";
import { planEventStream } from "./plan-response.ts";

const dates = loadModule("lib/planner-input.ts");
const reservations = loadModule("app/components/planner/reservations.ts", { "@/lib/planner-input": dates });
const timing = loadModule("lib/trip-timing.ts", { "./planner-input": dates });
class JourneyError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const requestBody = {
  intention: "慢慢探索", colorTone: "松林绿", fatigue: 2, subjectiveStress: 2,
  ambientPreferences: [], profileMemoryNotes: "个人旅行记忆", consent: true,
  trip: {
    originCity: "上海", destinationCity: "杭州", departureDate: "2026-10-03", returnDate: "2026-10-04",
    departureTimezone: "Asia/Shanghai", destinationTimezone: "Asia/Shanghai", planningStyle: "flexible",
    itineraryText: "", requestedServices: ["attractions"], foodPreferences: "",
  },
};
function fixture(targetError, beforePipelineReturn = () => {}, stream = false) {
  const calls = { pipeline: 0, reserve: 0, preferences: 0, release: 0, save: 0, context: null };
  const { POST } = loadModule("app/api/plan/route.ts", {
    "next/server": { NextResponse: Response },
    "@/lib/auth": { getCurrentAccount: async () => ({ id: "test-account" }), isSameOrigin: () => true },
    "@/lib/journeys": {
      JourneyError,
      checkJourneyForGeneration: async () => { if (targetError) throw targetError; return null; },
      saveGeneratedJourney: async (_id, value) => { calls.save += 1; return { id: "test-journey", version: 1, draft: value.draft, plan: value.generated }; },
    },
    "@/lib/journey-http": {
      readJourneyJson: (request) => request.json(),
      journeyFailure: (error) => Response.json({ error: error.message, code: error.code }, { status: error.status ?? 503 }),
    },
    "@/lib/planner-input": dates,
    "@/lib/trip-timing": timing,
    "@/lib/plan-response": { planEventStream: stream ? planEventStream : () => { throw new Error("This test uses JSON responses"); } },
    "@/lib/planning/stages": { PLAN_BUDGET_MS: 180000, STAGE_BY_NAME: {} },
    "@/lib/planning/rate-limit": { reservePlanning: async () => { calls.reserve += 1; return { release: async () => { calls.release += 1; } }; } },
    "@/lib/preferences": {
      listLearnedPreferences: async () => { calls.preferences += 1; return []; },
      preferenceDefaults: () => ({ notes: ["已保存的饮食偏好"] }),
    },
    "@/lib/planning/pipeline": { runPlanning: async (context) => {
      calls.pipeline += 1; calls.context = context;
      if (stream) context.recommendations({
        stage: "flyai_inventory", destination: context.input.trip.destinationCity,
        retrievedAt: "2026-10-03T09:00:00.000Z",
        items: [{ name: "真实工具商品", category: "景点与体验", reason: "公开说明", source: "飞猪实时搜索", url: "https://example.com/item" }],
      });
      beforePipelineReturn();
      return { inventory: { failedCategories: [] }, local: null,
        plan: { adjustments: [], itinerary: [{ time: "15:00", name: "抵达缓冲", detail: "", fixed: false }], places: [] },
        provenance: { requestedAt: new Date().toISOString(), provider: "managed_agent", stages: [],
          health: { basis: "preferences_only", whoopUnavailable: false }, local: { verified: false }, flyai: {}, memory: context.memory },
      };
    } },
  }, { Response, Request, DOMException, console: { info() {}, error() {} } });
  return { POST, calls };
}
function request(overrides = {}, signal) {
  return new Request("https://biotrip.test/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...requestBody, ...overrides }), signal });
}

test("disconnecting before the provider completes releases the lease without saving a plan", async () => {
  const controller = new AbortController();
  const { POST, calls } = fixture(null, () => controller.abort());
  const response = await POST(request({}, controller.signal));
  assert.notEqual(response.status, 200);
  assert.equal(calls.pipeline, 1);
  assert.equal(calls.save, 0);
  assert.equal(calls.release, 1);
});

test("a stale journey fails before acquiring a lease or calling any provider", async () => {
  const { POST, calls } = fixture(new JourneyError(409, "JOURNEY_CHANGED", "请刷新"));
  const response = await POST(request());
  assert.equal(response.status, 409);
  assert.equal(calls.pipeline, 0);
  assert.equal(calls.reserve, 0);
  assert.equal(calls.preferences, 0);
});

test("opting out of memory removes both submitted and stored notes from generation", async () => {
  const { POST, calls } = fixture();
  const response = await POST(request({ includeMemory: false }));
  assert.equal(response.status, 200);
  assert.equal(calls.context.input.profileMemoryNotes, "");
  assert.equal(calls.context.memory.applied, false);
  assert.equal(calls.preferences, 0);
  assert.equal(calls.release, 1);
});

test("confirmed memory is passed into the pipeline and recorded in provenance", async () => {
  const { POST, calls } = fixture();
  assert.equal((await POST(request({ includeMemory: true }))).status, 200);
  assert.match(calls.context.input.profileMemoryNotes, /个人旅行记忆/);
  assert.match(calls.context.input.profileMemoryNotes, /已保存的饮食偏好/);
  assert.equal(calls.context.memory.source, "learned");
});

test("oversized date ranges and malformed consent stop before provider work", async () => {
  const { POST, calls } = fixture();
  assert.equal((await POST(request({ trip: { ...requestBody.trip, returnDate: "2027-10-03" } }))).status, 400);
  assert.equal((await POST(request({ includeMemory: "false" }))).status, 400);
  assert.equal(calls.pipeline, 0);
});

test("a naturally typed reservation enters the pipeline with its exact name and first arrival date", async () => {
  const { POST, calls } = fixture();
  const response = await POST(request({ trip: { ...requestBody.trip, itineraryText: "13:00 omarchy cn meetup" } }));
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.context.fixedItems)), [
    { time: "13:00", name: "omarchy cn meetup", fixed: true, date: "2026-10-03" },
  ]);
});

test("a picked reservation retains its date, arbitrary minute, location and activity in the planning context", async () => {
  const { POST, calls } = fixture();
  const result = reservations.replaceReservation("", null, {
    date: "2026-10-04", time: "13:07", activity: "参加活动", location: "会展中心", fixed: true,
  }, "2026-10-03", "2026-10-04");
  assert.equal(result.error, null);
  const response = await POST(request({ trip: { ...requestBody.trip, itineraryText: result.value } }));
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.context.fixedItems)), [
    { time: "13:07", name: "参加活动（地点：会展中心）", fixed: true, date: "2026-10-04" },
  ]);
});

test("an invalid reservation returns an actionable field error before any provider or quota reservation", async () => {
  const { POST, calls } = fixture();
  const response = await POST(request({ trip: { ...requestBody.trip, itineraryText: "25:00 meetup" } }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /第\s*1\s*行/);
  assert.equal(calls.pipeline, 0);
  assert.equal(calls.reserve, 0);
  assert.equal(calls.preferences, 0);
});

test("a reservation outside the trip is rejected before generation", async () => {
  const { POST, calls } = fixture();
  const response = await POST(request({ trip: { ...requestBody.trip, itineraryText: "2026-10-06 13:00 meetup" } }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /不在本次行程内/);
  assert.equal(calls.pipeline, 0);
  assert.equal(calls.reserve, 0);
});

test("the SSE route forwards public retrieval previews separately and still persists exactly one completed plan", async () => {
  const { POST, calls } = fixture(null, () => {}, true);
  const streaming = request();
  streaming.headers.set("Accept", "text/event-stream");
  const response = await POST(streaming);
  assert.match(response.headers.get("Content-Type"), /text\/event-stream/);
  const text = await response.text();
  assert.ok(text.indexOf("event: recommendations") < text.indexOf("event: result"));
  assert.match(text, /真实工具商品/);
  const preview = text.split("\n\n").find((frame) => frame.startsWith("event: recommendations"));
  const payload = JSON.parse(preview.split("\ndata: ")[1]);
  assert.equal(payload.destination, "杭州");
  assert.deepEqual(Object.keys(payload.items[0]).sort(), ["category", "name", "reason", "source", "url"]);
  assert.equal(calls.pipeline, 1);
  assert.equal(calls.save, 1);
  assert.equal(calls.release, 1);
});
