import assert from "node:assert/strict";
import { test } from "node:test";
import { loadModule } from "./test-support/module-loader.mjs";
import { planEventStream } from "./plan-response.ts";
import * as protection from "./adjust/protection.ts";
import * as adjustmentRequest from "./adjust/request.ts";

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
function fixture(targetError, beforePipelineReturn = () => {}, stream = false, useMemory = true) {
  const memoryFixture = planningMemoryFixture(useMemory);
  const calls = { pipeline: 0, reserve: 0, get memories() { return memoryFixture.calls.reads; }, release: 0, save: 0, context: null };
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
    "@/lib/planning/service": memoryFixture.service,
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
  assert.equal(calls.memories, 0);
});

test("opting out of memory removes both submitted and stored notes from generation", async () => {
  const { POST, calls } = fixture();
  const response = await POST(request({ includeMemory: false }));
  assert.equal(response.status, 200);
  assert.equal(calls.context.input.profileMemoryNotes, "");
  assert.equal(calls.context.memory.applied, false);
  assert.equal(calls.memories, 0);
  assert.equal(calls.release, 1);
});

test("confirmed memory uses canonical enabled records and records their provenance", async () => {
  const { POST, calls } = fixture();
  assert.equal((await POST(request({ includeMemory: true }))).status, 200);
  assert.equal(calls.context.input.profileMemoryNotes, "有效的旅行偏好");
  assert.equal(calls.context.memory.source, "learned");
});

test("the legacy planning route respects global memory opt-out despite a stale client opt-in", async () => {
  const { POST, calls } = fixture(null, () => {}, false, false);
  assert.equal((await POST(request({ includeMemory: true }))).status, 200);
  assert.equal(calls.context.input.profileMemoryNotes, "");
  assert.equal(calls.context.memory.applied, false);
  assert.equal(calls.memories, 0);
});

test("the legacy planning route stops before provider work when memory permission cannot be checked", async () => {
  const { POST, calls } = fixture(null, () => {}, false, new Error("Settings unavailable"));
  assert.equal((await POST(request({ includeMemory: true }))).status, 503);
  assert.equal(calls.memories, 0);
  assert.equal(calls.pipeline, 0);
  assert.equal(calls.reserve, 0);
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
  assert.equal(calls.memories, 0);
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

function planningMemoryFixture(useMemory, target = null) {
  const calls = { settings: 0, reads: 0 };
  const memory = loadModule("lib/agent/memory.ts", {
    "@/lib/database": { getDatabase: () => { throw new Error("Unexpected database access"); } },
    "@/lib/journeys": { JourneyError },
    "@/lib/planner-input": dates,
  });
  const itineraryEdit=loadModule("lib/itinerary-edit.ts",{"./planner-input":dates,"./adjust/protection":protection});
  const pendingReservations=loadModule("lib/planning/reservations.ts",{"@/lib/trip-timing":timing,"@/lib/journeys":{JourneyError},"@/lib/itinerary-edit":itineraryEdit,"@/lib/planner-input":dates,"../adjust/protection":protection,"../adjust/request":adjustmentRequest});
  const service = loadModule("lib/planning/service.ts", {"./reservations":pendingReservations,"@/lib/body-journey":{listAdjustmentRecords:async()=>[]},
    "@/lib/planner-input": dates,
    "@/lib/trip-timing": timing,
    "@/lib/journeys": { JourneyError, checkJourneyForGeneration:async()=>target },
    "../adjust/request": {},
    "./visuals": {},
    "@/lib/agent/memory": {
      applicableMemories: memory.applicableMemories,
      memorySettings: async (accountId) => {
        assert.equal(accountId, "test-account"); calls.settings++;
        if (useMemory instanceof Error) throw useMemory;
        return { useMemory };
      },
      listMemoryItems: async (accountId) => {
        assert.equal(accountId, "test-account"); calls.reads++;
        return [
          { note: "有效的旅行偏好", enabled: true, scope: "global" },
          { note: "已停用的偏好", enabled: false, scope: "global" },
          { note: "另一段旅程的记忆", enabled: true, scope: "journey", journeyId: "other-journey" },
        ];
      },
    },
  });
  return { service, calls };
}

test("planning service enforces account memory opt-out even when the request opts in", async () => {
  const { service, calls } = planningMemoryFixture(false);
  const prepared = await service.preparePlanning("test-account", { ...requestBody, includeMemory: true });
  assert.equal(prepared.input.profileMemoryNotes, "");
  assert.equal(prepared.memory.applied, false);
  assert.equal(prepared.memory.source, "none");
  assert.equal(calls.settings, 1);
  assert.equal(calls.reads, 0);
});

test("planning service requires both account and request permission before reading memory", async () => {
  const { service, calls } = planningMemoryFixture(true);
  const skipped = await service.memoryUsage("test-account", requestBody, false);
  assert.equal(skipped.input.profileMemoryNotes, "");
  assert.equal(calls.settings, 0);
  assert.equal(calls.reads, 0);
  const applied = await service.preparePlanning("test-account", { ...requestBody, includeMemory: true });
  assert.equal(applied.input.profileMemoryNotes, "有效的旅行偏好");
  assert.equal(applied.memory.applied, true);
  assert.equal(applied.memory.noteCount, 1);
  assert.equal(calls.reads, 1);
});

test("planning service never reads memories when account permission cannot be checked", async () => {
  const { service, calls } = planningMemoryFixture(new Error("Settings unavailable"));
  await assert.rejects(service.preparePlanning("test-account", { ...requestBody, includeMemory: true }), /Settings unavailable/);
  assert.equal(calls.reads, 0);
});

function reservationTarget() {
  return {id:"existing-journey",version:7,status:"planned",draft:requestBody,plan:{plan:{itinerary:[
    {id:"existing_booking",date:"2026-10-03",time:"16:00",name:"茶室预约",detail:"三小时",fixed:true,durationMin:180},
    {id:"existing_flexible",date:"2026-10-04",time:"12:00",name:"公园",detail:"",fixed:false,durationMin:60},
    {id:"second_booking",date:"2026-10-04",time:"18:00",name:"晚餐",detail:"",fixed:true,durationMin:60},
  ]}}};
}
test("replanning takes fixed reservation metadata from actual itinerary and treats card changes as a shadow",async()=>{
  const target=reservationTarget(),before=JSON.stringify(target),{service}=planningMemoryFixture(false,target);
  const value={...requestBody,journeyId:target.id,expectedVersion:7,reservationEdits:[{activityId:"existing_booking",date:"2026-10-04",time:"12:00",fixed:true}],trip:{...requestBody.trip,itineraryText:"2026-10-03 16:00 | 茶室预约 | 固定\n2026-10-04 20:00 | 新预约 | 固定"}};
  const prepared=await service.preparePlanning("test-account",value);
  assert.equal(JSON.stringify(target),before);
  assert.equal(prepared.fixedItems.length,3);
  const booking=prepared.fixedItems.find(i=>i.name==="茶室预约");
  assert.equal(booking.id,"existing_booking");assert.equal(booking.durationMin,180);assert.equal(booking.date,"2026-10-04");assert.equal(booking.time,"12:00");
  assert.equal(prepared.fixedItems.some(i=>i.name==="公园"),false);
  assert.equal(prepared.input.trip.itineraryText,"2026-10-04 12:00 | 茶室预约 | 固定\n2026-10-04 20:00 | 新预约 | 固定");
});
test("malformed authorization, unknown activities and overlapping fixed reservations stop before memory or provider work",async()=>{
  const target=reservationTarget(),{service,calls}=planningMemoryFixture(true,target);
  for(const reservationEdits of [
    [{activityId:"existing_booking",date:"2026-10-04",time:"12:00",fixed:true,durationMin:5}],
    [{activityId:"unknown_booking",date:"2026-10-04",time:"12:00",fixed:true}],
    [{activityId:"existing_booking",date:"2026-10-04",time:"17:00",fixed:true}],
    [{activityId:"existing_booking",date:"2026-10-04",time:"12:00",fixed:true},{activityId:"existing_booking",date:"2026-10-04",time:"13:00",fixed:true}],
    [{activityId:"existing_booking",date:"2026-10-05",time:"12:00",fixed:true}],
  ]) await assert.rejects(service.preparePlanning("test-account",{...requestBody,journeyId:target.id,expectedVersion:7,reservationEdits}));
  assert.equal(calls.settings,0);assert.equal(calls.reads,0);
});
for(const state of ["in_progress","completed","skipped"])test(`a ${state} reservation cannot be changed through replanning cards`,async()=>{
  const target=reservationTarget();target.plan.plan.itinerary[0].progress={state,updatedAt:"2026-10-03T09:00:00Z"};
  const {service,calls}=planningMemoryFixture(true,target);
  await assert.rejects(service.preparePlanning("test-account",{...requestBody,journeyId:target.id,expectedVersion:7,reservationEdits:[{activityId:"existing_booking",date:"2026-10-04",time:"12:00",fixed:false}]}),{code:"ACTIVITY_PROTECTED"});
  assert.equal(calls.settings,0);
});
test("legacy direct-save planning cannot apply pending reservation edits without the approval flow",async()=>{
  const {POST,calls}=fixture();
  const response=await POST(request({reservationEdits:[{activityId:"existing_booking",date:"2026-10-04",time:"12:00",fixed:true}]}));
  assert.equal(response.status,409);assert.equal((await response.json()).code,"PLANNING_JOB_REQUIRED");assert.equal(calls.pipeline,0);assert.equal(calls.save,0);assert.equal(calls.reserve,0);
});
test("undated legacy reservations use the original arrival date including a date-line crossing",async()=>{
  const target=reservationTarget();target.plan.plan.itinerary=[{...target.plan.plan.itinerary[0],date:undefined}];
  const trip={...requestBody.trip,departureTimezone:"America/Los_Angeles",destinationTimezone:"Pacific/Kiritimati",returnDate:"2026-10-05",itineraryText:"2026-10-04 16:00 | 茶室预约 | 固定"};
  target.draft={...requestBody,trip};
  const {service}=planningMemoryFixture(false,target),before=JSON.stringify(target);
  const prepared=await service.preparePlanning("test-account",{...requestBody,trip,journeyId:target.id,expectedVersion:7,reservationEdits:[]});
  assert.equal(prepared.fixedItems.length,1);assert.equal(prepared.fixedItems[0].date,"2026-10-04");assert.equal(prepared.fixedItems[0].durationMin,180);
  assert.equal(JSON.stringify(target),before);
});
test("changing new trip dates never silently moves an undated completed reservation from its original day",async()=>{
  const target=reservationTarget();target.plan.plan.itinerary=[{...target.plan.plan.itinerary[0],date:undefined,progress:{state:"completed",updatedAt:"2026-10-03T12:00:00Z"}}];
  const {service}=planningMemoryFixture(false,target);
  const raw={...requestBody,journeyId:target.id,expectedVersion:7,reservationEdits:[],trip:{...requestBody.trip,departureDate:"2026-10-04",returnDate:"2026-10-05",itineraryText:"2026-10-04 16:00 | 茶室预约 | 固定"}};
  await assert.rejects(service.preparePlanning("test-account",raw),{code:"INVALID_SCHEDULE"});
  await assert.rejects(service.preparePlanning("test-account",{...raw,reservationEdits:[{activityId:"existing_booking",date:"2026-10-04",time:"16:00",fixed:true}]}),{code:"ACTIVITY_PROTECTED"});
  target.planCurrent=false;
  await assert.rejects(service.preparePlanning("test-account",raw),{code:"RESERVATION_DATE_UNKNOWN"});
});
