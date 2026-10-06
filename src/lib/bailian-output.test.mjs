import assert from "node:assert/strict";
import { test } from "node:test";
import { loadModule, plain } from "./test-support/module-loader.mjs";

const { consumeAgentResponse, parseJsonText, parsePlan, AgentOutputError } = loadModule("lib/bailian-output.ts", {
  "./bailian-evidence": loadModule("lib/bailian-evidence.ts", {
    "./planning/flyai-sources": loadModule("lib/planning/flyai-sources.ts", { "../product-image": loadModule("lib/product-image.ts") }),
  }),
});
const { normalizePlannerError } = loadModule("lib/planning/contract.ts");

const message = (id, text) => ({
  object: "message", id, role: "assistant", type: "message", status: "completed",
  content: [{ type: "text", text }],
});
const status = (sessionStatus, reason) => ({
  object: "message", type: "session_status", status: "completed",
  content: [{ type: "data", data: {
    session_status: sessionStatus,
    ...(reason ? { stop_reason: { type: reason } } : {}),
  } }],
});
const frame = (event) => `event: message\r\ndata: ${JSON.stringify(event)}\r\n\r\n`;
function responseFor(events, { chunkSize = 7, trailingSeparator = true } = {}) {
  let source = `: connected\r\n\r\n${events.map(frame).join("")}`;
  if (!trailingSeparator) source = source.replace(/\r\n\r\n$/, "");
  const bytes = new TextEncoder().encode(source);
  return new Response(new ReadableStream({
    start(controller) {
      for (let position = 0; position < bytes.length; position += chunkSize) {
        controller.enqueue(bytes.slice(position, position + chunkSize));
      }
      controller.close();
    },
  }), { headers: { "Content-Type": "text/event-stream" } });
}
const validPlan = {
  headline: "当天行程",
  summary: "按已确认的安排出发。",
  reason: "活动强度符合所选偏好。",
  adjustments: [],
  itinerary: [{ time: "10:00", name: "已确认活动", detail: "预留交通时间。", fixed: true }],
  places: [{
    name: "真实来源", category: "活动", reason: "按偏好选择", source: "官方来源",
    url: "https://example.com/place",
  }],
};

test("tool preamble and repeated messages do not pollute the final JSON", async () => {
  const preamble = message("msg_preamble", '先查询 {"city":"东京"} 对应的真实来源。');
  const final = message("msg_final", JSON.stringify(validPlan));
  const controller = new AbortController();
  const result = await consumeAgentResponse(responseFor([
    status("idle"), status("running"), preamble,
    { type: "tool_call_output", role: "tool", is_error: false, content: [{ type: "text", text: "工具输出" }] },
    final, final, preamble, status("idle", "end_turn"),
  ]), controller);
  assert.deepEqual(plain(parseJsonText(result)), plain(validPlan));
  assert.equal(controller.signal.aborted, true);
});

test("canonical complete Message is used once when deltas are present", async () => {
  const result = await consumeAgentResponse(responseFor([
    status("running"),
    { type: "event_start", event: { id: "msg_final", type: "message" } },
    { type: "event_delta", event_id: "msg_final", delta: { content: { type: "text", text: '{"summary":' } } },
    message("msg_final", JSON.stringify(validPlan)), status("idle", "end_turn"),
  ]), new AbortController());
  assert.deepEqual(plain(parseJsonText(result)), plain(validPlan));
});

test("UTF-8 chunk boundaries and final frame without separator are handled", async () => {
  const result = await consumeAgentResponse(responseFor([
    message("msg_final", JSON.stringify(validPlan)), status("idle", "end_turn"),
  ], { chunkSize: 1, trailingSeparator: false }), new AbortController());
  assert.deepEqual(plain(parseJsonText(result)), plain(validPlan));
});

test("an idle snapshot without end_turn does not accept an unfinished response", async () => {
  await assert.rejects(consumeAgentResponse(responseFor([
    status("idle"), message("msg_final", JSON.stringify(validPlan)),
  ]), new AbortController()), { code: "INCOMPLETE_AGENT_RESPONSE" });
});

test("final refusal cannot reuse a valid intermediate answer", async () => {
  await assert.rejects(consumeAgentResponse(responseFor([
    message("msg_intermediate", JSON.stringify(validPlan)),
    { id: "msg_final", role: "assistant", type: "message", status: "completed", content: [{ type: "refusal", refusal: "无法回答" }] },
    status("idle", "end_turn"),
  ]), new AbortController()), { code: "INCOMPLETE_AGENT_RESPONSE" });
});

test("requires_action, exhausted retries, termination and provider errors stay failures", async () => {
  for (const [event, code] of [
    [status("idle", "requires_action"), "AGENT_REQUIRES_ACTION"],
    [status("idle", "retries_exhausted"), "AGENT_RETRIES_EXHAUSTED"],
    [status("terminated"), "SESSION_TERMINATED"],
    [{ type: "error", error: { code: "AccessDenied", message: "private provider details" } }, "AccessDenied"],
  ]) {
    await assert.rejects(consumeAgentResponse(responseFor([
      message("msg_final", JSON.stringify(validPlan)), event,
    ]), new AbortController()), { code });
  }
});

test("structured plan with no changes is accepted and fixed entries are preserved", () => {
  const plan = parsePlan(JSON.stringify(validPlan), validPlan.itinerary);
  assert.deepEqual(plain(plan.adjustments), []);
  assert.equal(plan.places[0].url, validPlan.places[0].url);
  assert.equal(plan.itinerary[0].name, validPlan.itinerary[0].name);
});

test("missing or invalid fields and changed fixed entries still fail", () => {
  for (const [patch, code] of [
    [{ adjustments: undefined }, "INVALID_PLAN_ADJUSTMENTS"],
    [{ adjustments: [null] }, "INVALID_PLAN_ADJUSTMENTS"],
    [{ summary: "" }, "INCOMPLETE_TRAVEL_PLAN"],
    [{ reason: " " }, "INCOMPLETE_TRAVEL_PLAN"],
    [{ itinerary: [] }, "INCOMPLETE_TRAVEL_PLAN"],
    [{ itinerary: [{ ...validPlan.itinerary[0], detail: undefined, details: "Incorrect output field" }] }, "INCOMPLETE_TRAVEL_PLAN"],
  ]) {
    assert.throws(() => parsePlan(JSON.stringify({ ...validPlan, ...patch }), []), { code });
  }
  assert.throws(() => parsePlan(JSON.stringify(validPlan), [{ time: "09:00", name: "已确认活动", fixed: true }]), { code: "FIXED_SCHEDULE_NOT_PRESERVED" });
});

test("output failures retain a static identity through pipeline normalisation without leaking response text", () => {
  const privateOutput = "private-model-response-with-health-or-token";
  for (const [run, code] of [
    [() => parseJsonText(`{${privateOutput}`), "INVALID_AGENT_JSON"],
    [() => parseJsonText(JSON.stringify([privateOutput])), "INVALID_AGENT_STRUCTURED_DATA"],
    [() => parsePlan(JSON.stringify({ ...validPlan, adjustments: privateOutput }), []), "INVALID_PLAN_ADJUSTMENTS"],
    [() => parsePlan(JSON.stringify({ ...validPlan, summary: "" }), []), "INCOMPLETE_TRAVEL_PLAN"],
    [() => parsePlan(JSON.stringify(validPlan), [{ time: "09:00", name: privateOutput, fixed: true }]), "FIXED_SCHEDULE_NOT_PRESERVED"],
  ]) {
    let failure;
    try { run(); } catch (error) { failure = error; }
    assert.ok(failure instanceof AgentOutputError);
    assert.equal(failure.code, code);
    assert.equal(failure.message, code);
    assert.ok(!String(failure.stack).includes(privateOutput));
    const normalized = normalizePlannerError("compose_plan", "agent_output", failure);
    assert.equal(normalized.code, code);
    assert.equal(normalized.status, 502);
    assert.equal(normalized.stage, "compose_plan");
    assert.ok(!JSON.stringify(normalized).includes(privateOutput));
  }
});

test("invalid calendar dates have a typed error and valid leap dates preserve dated reservations", () => {
  for (const date of ["2026-99-01", "2026-02-30", "2026-13-01", "2026-00-00", "2026-10-10 trailing-data"]) {
    assert.throws(() => parsePlan(JSON.stringify({ ...validPlan, itinerary: [{ ...validPlan.itinerary[0], date }] }), []), { code: "INVALID_PLAN_DATE" });
  }
  const itinerary = [{ ...validPlan.itinerary[0], date: "2028-02-29" }];
  assert.equal(parsePlan(JSON.stringify({ ...validPlan, itinerary }), itinerary).itinerary[0].date, "2028-02-29");
  for (const patch of [{ date: "2028-03-01" }, { name: "Renamed reservation" }, { time: "11:00" }, { fixed: false }]) {
    assert.throws(() => parsePlan(JSON.stringify({ ...validPlan, itinerary: [{ ...itinerary[0], ...patch }] }), itinerary), { code: "FIXED_SCHEDULE_NOT_PRESERVED" });
  }
});

test("untrusted non-HTTPS sources stay excluded", () => {
  const plan = parsePlan(JSON.stringify({ ...validPlan, places: [
    ...validPlan.places,
    { ...validPlan.places[0], url: "javascript:alert(1)" },
    { ...validPlan.places[0], url: "http://example.com/place" },
  ] }), []);
  assert.equal(plan.places.length, 1);
});

test("only one final object or its JSON fence is parsed", () => {
  assert.deepEqual(plain(parseJsonText(`\u0060\u0060\u0060json\n${JSON.stringify(validPlan)}\n\u0060\u0060\u0060`)), plain(validPlan));
  assert.throws(() => parseJsonText(`${JSON.stringify(validPlan)}${JSON.stringify(validPlan)}`));
  assert.throws(() => parseJsonText(JSON.stringify([validPlan])));
});

test("tool observers expose structural fields without prompt, command or output values", async () => {
  const observed = [];
  const result = await consumeAgentResponse(responseFor([
    { id: "evnt_call", type: "tool_call", role: "assistant", status: "completed", content: [{ type: "data", data: {
      name: "bash", call_id: "call_001", arguments: { command: "private-command-with-key" },
    } }] },
    { id: "evnt_output", type: "tool_call_output", role: "tool", status: "completed", is_error: false, content: [{ type: "data", data: {
      call_id: "call_001", output: JSON.stringify({ stdout: "private-inventory-and-key", stderr: "", exit_code: 0 }),
    } }] },
    message("msg_final", JSON.stringify(validPlan)), status("idle", "end_turn"),
  ]), new AbortController(), (event) => observed.push(event));
  assert.deepEqual(plain(parseJsonText(result)), plain(validPlan));
  assert.equal(observed[0].toolName, "bash");
  assert.equal(observed[0].callId, "call_001");
  assert.equal(observed[0].dataShape.arguments, "object");
  assert.deepEqual(plain(observed[1].outputShape), { stdout: "string", stderr: "string", exit_code: "number" });
  assert.equal(observed[1].isError, false);
  assert.ok(!JSON.stringify(observed).includes("private-"));
  assert.ok(!JSON.stringify(observed).includes(validPlan.summary));
});
