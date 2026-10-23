import * as searchRouting from "../../travel-search-routing.ts";
import * as mobilityModule from "../mobility.ts";
import * as adjustPrompts from "../adjust-prompts.ts";
import * as adjustHealth from "../adjust-health.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadModule, plain } from "../../test-support/module-loader.mjs";

const contract = loadModule("lib/planning/contract.ts");
const prompts = loadModule("lib/planning/prompts.ts", {
  "./schema": loadModule("lib/planning/schema.ts"),
  "@/lib/planner-input": loadModule("lib/planner-input.ts"),
});
const evidence = loadModule("lib/bailian-evidence.ts", {
  "./planning/flyai-sources": loadModule("lib/planning/flyai-sources.ts", { "../product-image": loadModule("lib/product-image.ts") }),
});
const output = loadModule("lib/bailian-output.ts", { "./bailian-evidence": evidence });
const validation = loadModule("lib/planning/validation.ts", { "./contract": contract });
const places = loadModule("lib/places.ts");
const inventory = loadModule("lib/planning/inventory.ts", { "@/lib/places": places, "../travel-search-routing": searchRouting });
const inventoryStream = loadModule("lib/planning/inventory-stream.ts", {
  "@/lib/bailian-evidence": evidence, "@/lib/bailian-output": output,
});
const model = loadModule("lib/planning/providers/bailian-model.ts", {
  "@/lib/places": places,
  "@/lib/upstream-response": {},
  "@/lib/bailian-output": output,
  "@/lib/flyai": { searchFlyai() { throw new Error("No live search in a regression test"); } },
  "../adjust-prompts": adjustPrompts, "../adjust-health": adjustHealth, "../prompts": prompts,
  "../schema": loadModule("lib/planning/schema.ts"),
  "../contract": contract,
  "../validation": validation, "../inventory": inventory,
});

const fixed = { date: "2026-10-10", time: "18:00", name: "返回酒店休息", detail: "用户固定安排", fixed: true };
const ctx = {
  input: { trip: { destinationCity: "杭州", requestedServices: ["attractions"], guardrails: null } },
  signal: new AbortController().signal,
  requestId: "regression-plan",
  progress() {},
  fixedItems: [fixed],
  timing: {
    departureInstant: new Date("2026-10-10T00:00:00Z"),
    arrivalInstant: new Date("2026-10-10T02:00:00Z"),
    arrivalDate: "2026-10-10", endDate: "2026-10-10", days: 1,
    travelHours: 2, timezoneShiftMinutes: 0,
  },
};
const gathered = {
  health: null,
  local: null,
  inventory: {
    sources: [
      { name: "已检索到的西湖商品", category: "景点与体验", url: "https://example.com/retrieved/0", price: null },
      { name: "已检索到的湿地商品", category: "景点与体验", url: "https://example.com/retrieved/1", price: null },
    ],
    searches: 1, failedSearches: 0, failedCategories: [], executor: "worker",
  },
};
const plan = {
  headline: "杭州轻松一日", summary: "按真实检索结果安排行程。", reason: "保留用户固定日程。",
  adjustments: [], itinerary: [fixed], places: [{ source_index: 1, source_name: gathered.inventory.sources[1].name, reason: "符合安静体验偏好" }],
};

function providerReturning(body, { inventoryEvents = [], agentEvents = null, fallback = model.flyaiInventory,
  snapshot = { tools: [], skills: [], mcp_servers: [] }, configPatch = {},
  cleanupResult = { confirmed: true, status: 200 },
} = {}) {
  const requests = [];
  const deleted = [];
  const logs = [];
  let searching = false;
  const frame = (event) => `data: ${JSON.stringify(event)}\n\n`;
  const events = [
    { id: "msg_final", type: "message", role: "assistant", status: "completed", content: [{ type: "text", text: JSON.stringify(body) }] },
    { type: "session_status", status: "completed", content: [{ type: "data", data: { session_status: "idle", stop_reason: { type: "end_turn" } } }] },
  ];
  const { createAgentProvider } = loadModule("lib/planning/providers/bailian-agent.ts", {
    "@/lib/bailian": {
      async bailianRequest(_config, path, options = {}) {
        requests.push({ path, options });
        if (path === "/sessions") {
          searching = Boolean(JSON.parse(options.body).vault_ids?.length);
          return Response.json({ id: "sesn_regression", agent: snapshot });
        }
        if (path.endsWith("/events/stream")) return new Response((searching ? inventoryEvents : agentEvents ?? events).map(frame).join(""), { headers: { "Content-Type": "text/event-stream" } });
        if (path.endsWith("/events")) return Response.json({ accepted: true });
        throw new Error(`Unexpected request: ${path}`);
      },
      async deleteBailianSession(_config, id) { deleted.push(id); return cleanupResult; },
    },
    "@/lib/flyai": { searchFlyai() { throw new Error("No live query in test"); } },
    "@/lib/bailian-session-cleanup": { registerSessionCleanup: async () => {}, queueSessionCleanup: async id => { deleted.push(id); } },
    "@/lib/bailian-output": output,
    "@/lib/bailian-evidence": evidence,
    "../adjust-prompts": adjustPrompts, "../adjust-health": adjustHealth, "../prompts": prompts,
    "./bailian-model": { ...model, flyaiInventory: fallback },
    "../contract": contract,
    "../inventory": inventory,
    "../mobility": mobilityModule,
    "../inventory-stream": inventoryStream,
    "../stages": loadModule("lib/planning/stages.ts"),
    "../validation": validation,
  }, { DOMException, console: { info(label, fields) { logs.push({ label, ...plain(fields) }); } } });
  return {
    provider: createAgentProvider({ agentId: "agent_test", environmentId: "env_test", flyaiVaultId: "vlt_test",
      localInfoAgentId: "agent_local", localInfoEnvironmentId: "env_local",
      composeAgentId: "agent_compose", composeEnvironmentId: "env_compose", ...configPatch,
    }),
    requests, deleted, logs,
  };
}

test("managed composition binds source_index places to the verified inventory", async () => {
  const { provider, requests, deleted } = providerReturning(plan);
  const result = await provider.composePlan(ctx, gathered);
  assert.deepEqual(plain(result.places), [{
    name: gathered.inventory.sources[1].name, category: "景点与体验",
    source: "飞猪实时搜索", url: gathered.inventory.sources[1].url, reason: "符合安静体验偏好",
  }]);
  assert.deepEqual(plain(result.itinerary), [fixed]);
  assert.deepEqual(JSON.parse(requests.find((request) => request.path === "/sessions").options.body), {
    agent: "agent_compose", environment_id: "env_compose", title: "BioTrip 已核验来源行程编排",
  });
  const submitted = requests.find((request) => request.path.endsWith("/events"));
  const prompt = JSON.parse(submitted.options.body).input[0].content[0].text;
  assert.match(prompt, /返回 source_index、source_name 与 reason/);
  assert.match(prompt, /不要再调用 FlyAI CLI/);
  assert.deepEqual(deleted, ["sesn_regression"]);
});

for (const [status, confirmed] of [[200, true], [404, true], [403, false], [null, false]]) {
  test(`managed session queues durable cleanup independently of upstream cleanup status ${status ?? "network failure"}`, async () => {
    const { provider, logs } = providerReturning(plan, {
      cleanupResult: { confirmed, status }, configPatch: { apiKey: "private-cleanup-key-canary" },
    });
    const result = await provider.composePlan(ctx, gathered);
    assert.equal(result.headline, plan.headline, "Cleanup failure must preserve the generated result");
    const cleanup = logs.filter((entry) => entry.state === "cleanup_queued");
    assert.equal(cleanup.length, 1);
    assert.equal(cleanup[0].state, "cleanup_queued");
    assert.equal(cleanup[0].status, undefined, "Do not claim background deletion has already succeeded");
    assert.ok(!JSON.stringify(cleanup).includes("private-cleanup-key-canary"));
    assert.ok(!JSON.stringify(cleanup).includes(plan.summary));
  });
}

test("managed composition ignores invented place fields and keeps retrieved name and URL", async () => {
  const { provider } = providerReturning({ ...plan, places: [{
    source_index: 0, source_name: gathered.inventory.sources[0].name, reason: "取自已验证库存", name: "编造名称", category: "编造类别", url: "https://example.com/invented",
  }] });
  const result = await provider.composePlan(ctx, gathered);
  assert.equal(result.places[0].name, gathered.inventory.sources[0].name);
  assert.equal(result.places[0].url, gathered.inventory.sources[0].url);
});

test("managed composition rejects out-of-range source references and still deletes the session", async () => {
  const { provider, deleted } = providerReturning({ ...plan, places: [{ source_index: 2, source_name: gathered.inventory.sources[0].name, reason: "不存在的来源" }] });
  await assert.rejects(provider.composePlan(ctx, gathered), { code: "UNVERIFIED_SOURCE_URL" });
  assert.deepEqual(deleted, ["sesn_regression"]);
});

test("the composing schema requires the exact source name alongside its inventory index", () => {
  const schema = loadModule("lib/planning/schema.ts").composedPlanSchema(gathered.inventory.sources.length);
  assert.deepEqual(plain(schema.properties.places.items.required), ["source_index", "source_name", "reason"]);
  assert.equal(schema.properties.places.items.properties.source_name.type, "string");
});

test("managed composition omits and discloses mismatched product names without attaching unrelated explanations", async () => {
  for (const sourceName of ["楼外楼", gathered.inventory.sources[0].name, `${gathered.inventory.sources[1].name} `]) {
    const { provider, deleted } = providerReturning({ ...plan, places: [{
      source_index: 1, source_name: sourceName, reason: "楼外楼为杭帮菜餐厅",
    }] });
    const result = await provider.composePlan(ctx, gathered);
    assert.equal(result.places.length, 0);
    assert.ok(result.adjustments.some(note => note.includes("未通过来源核验")));
    assert.deepEqual(deleted, ["sesn_regression"]);
  }
});

test("one invalid optional product cannot discard valid verified recommendations or the itinerary", async () => {
  const { provider } = providerReturning({ ...plan, places: [
    { source_index: 0, source_name: gathered.inventory.sources[0].name, reason: "真实商品" },
    { source_index: 1, source_name: "另一家餐厅", reason: "不能附到商品上的说明" },
  ] });
  const result = await provider.composePlan(ctx, gathered);
  assert.equal(result.places.length, 1);
  assert.equal(result.places[0].url, gathered.inventory.sources[0].url);
  assert.equal(result.places[0].reason, "真实商品");
  assert.ok(result.itinerary.length > 0);
  assert.ok(result.adjustments.some(note => note.includes("已移除 1 条")));
});

test("new raw place references require both fields while normalized saved plans remain readable", () => {
  for (const place of [null, { source_index: 1, reason: "缺失名称" }, { source_index: 1, source_name: 1, reason: "名称类型错误" }]) {
    assert.throws(() => model.bindPlaces(JSON.stringify({ ...plan, places: [place] }), gathered.inventory.sources), { code: "INVALID_PLACE_REFERENCE" });
  }
  const saved = { ...plan, places: [{
    name: gathered.inventory.sources[1].name, category: gathered.inventory.sources[1].category,
    reason: "已保存的推荐", source: "飞猪实时搜索", url: gathered.inventory.sources[1].url,
  }] };
  const restored = output.parsePlan(JSON.stringify(saved), ctx.fixedItems);
  assert.deepEqual(plain(restored.places), saved.places);
});

const call = (command) => ({
  id: "ev_call", type: "tool_call", role: "assistant", status: "completed",
  content: [{ type: "data", data: { name: "bash", call_id: "query_1", arguments: { command } } }],
});
const result = {
  id: "ev_output", type: "tool_call_output", role: "tool", status: "completed", is_error: false,
  content: [{ type: "data", data: { call_id: "query_1", output: JSON.stringify({
    exit_code: 0, interrupted: false, stderr: "", stdout: JSON.stringify({ status: 0, message: "success", data: {
      itemList: [{ info: { title: "工具真实商品名称", jumpUrl: "https://example.com/actual-tool", price: "80" } }],
    } }),
  }) } }],
};

test("Skill inventory reads real tool names and links then composition uses all gathered context", async () => {
  const command = inventory.skillInventoryQueries(ctx).commands[0].command;
  const { provider, requests } = providerReturning(plan, { inventoryEvents: [call(command), result] });
  const actualInventory = await provider.flyaiInventory(ctx);
  assert.equal(actualInventory.executor, "agent_skill");
  assert.deepEqual(plain(actualInventory.sources.map(({ name, url, category, price }) => ({ name, url, category, price }))), [{ name: "工具真实商品名称", url: "https://example.com/actual-tool", category: "景点与体验", price: "¥80" }]);
  assert.equal(actualInventory.sources[0].tool, "search_poi");
  assert.equal(actualInventory.receipts[0].state, "completed");
  const fullCtx = { ...ctx, input: { ...ctx.input, preferences: {
    intention: "安静体验", ambientPreferences: ["自然"], colorTone: "绿色", savedMemory: "喜欢坐着看风景", planningStyle: "flexible",
  }, selfReport: { fatigue: 4, subjectiveStress: 3 } } };
  const health = { basis: "self_report", walkingPace: "reduced", breakFrequency: "frequent", sensoryFilters: ["quiet"] };
  const local = { searches: 1, services: [{ name: "真实当地资料", detail: "已核验", sourceUrl: "https://example.com/local" }] };
  await provider.composePlan(fullCtx, { ...gathered, health, local });
  const promptsSent = requests.filter((request) => request.path.endsWith("/events")).map((request) => JSON.parse(request.options.body).input[0].content[0].text);
  assert.match(promptsSent[0], /本阶段只运行/);
  assert.doesNotMatch(promptsSent[0], /walking_pace|saved_travel_preferences|fatigue_self_report/);
  assert.match(promptsSent[1], /"walking_pace":"reduced"/);
  assert.match(promptsSent[1], /真实当地资料/);
  assert.match(promptsSent[1], /喜欢坐着看风景/);
  assert.match(promptsSent[1], /"fatigue":4/);
  const sessions = requests.filter((request) => request.path === "/sessions").map((request) => JSON.parse(request.options.body));
  assert.equal(sessions[0].agent, "agent_test");
  assert.deepEqual(sessions[0].vault_ids, ["vlt_test"]);
  assert.equal(sessions[1].agent, "agent_compose");
  assert.equal(sessions[1].vault_ids, undefined);
});

test("missing dedicated composer fails before any session and never reuses the travel agent", async () => {
  const { provider, requests } = providerReturning(plan, { configPatch: { composeAgentId: null } });
  assert.throws(() => provider.assertConfigured(), { code: "COMPOSE_AGENT_NOT_CONFIGURED" });
  await assert.rejects(provider.composePlan(ctx, gathered), { code: "COMPOSE_AGENT_NOT_CONFIGURED" });
  assert.equal(requests.length, 0);
  for (const configPatch of [{ flyaiVaultId: null }, { agentId: "" }, { localInfoAgentId: null }, { localInfoEnvironmentId: null }]) {
    assert.throws(() => providerReturning(plan, { configPatch }).provider.assertConfigured(), /Managed Agents/);
  }
});

test("composer session snapshot rejects tools, skills and MCP before submitting any traveller data", async () => {
  for (const snapshot of [
    {}, { tools: [] }, { tools: [], skills: "invalid", mcp_servers: [] },
    { tools: [], skills: [], mcp_servers: null }, { tools: [{ type: "bash" }], skills: [], mcp_servers: [] },
    { tools: [], skills: [{ name: "FlyAI" }], mcp_servers: [] },
    { tools: [], skills: [], mcp_servers: [{ url: "https://example.com/mcp" }] },
  ]) {
    const { provider, requests, deleted } = providerReturning(plan, { snapshot });
    await assert.rejects(provider.composePlan(ctx, gathered), { code: "COMPOSE_AGENT_HAS_TOOLS" });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].path, "/sessions");
    assert.deepEqual(deleted, ["sesn_regression"]);
  }
});

test("composer may reuse an existing environment while keeping its dedicated agent", async () => {
  for (const [configPatch, expectedEnvironment] of [
    [{ composeEnvironmentId: null, insightEnvironmentId: "env_health" }, "env_health"],
    [{ composeEnvironmentId: null, insightEnvironmentId: null }, "env_test"],
  ]) {
    const { provider, requests } = providerReturning(plan, { configPatch });
    provider.assertConfigured();
    await provider.composePlan(ctx, gathered);
    const created = JSON.parse(requests[0].options.body);
    assert.equal(created.agent, "agent_compose");
    assert.equal(created.environment_id, expectedEnvironment);
    assert.equal(created.vault_ids, undefined);
  }
});

test("Skill fallback keeps the original error code and reports Worker execution honestly", async () => {
  const command = inventory.skillInventoryQueries(ctx).commands[0].command;
  const failed = { ...result, content: [{ type: "data", data: { call_id: "query_1", output: JSON.stringify({
    exit_code: 1, stdout: "", stderr: "HTTP 403 AccessDenied", interrupted: false,
  }) } }] };
  const { provider } = providerReturning(plan, { inventoryEvents: [call(command), failed], fallback: async () => gathered.inventory });
  const actualInventory = await provider.flyaiInventory(ctx);
  assert.equal(actualInventory.executor, "worker");
  assert.equal(actualInventory.fallbackReason, "FLYAI_AUTH_ERROR");
});

function outputFor(id, items = []) {
  return {
    id: `output_${id}`, type: "tool_call_output", status: "completed", is_error: false,
    content: [{ type: "data", data: { call_id: id, output: JSON.stringify({
      exit_code: 0, interrupted: false, stderr: "", stdout: JSON.stringify({ status: 0, message: "success", data: { itemList: items } }),
    }) } }],
  };
}
function callFor(id, command) {
  return { ...call(command), id: `call_${id}`, content: [{ type: "data", data: { name: "bash", call_id: id, arguments: { command } } }] };
}
const frames = (events) => new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
const idle = (reason) => ({
  type: "session_status", status: "completed",
  content: [{ type: "data", data: { session_status: "idle", stop_reason: reason ? { type: reason } : {} } }],
});

test("authentic empty Skill inventory completes without repeating searches through the Worker", async () => {
  const command = inventory.skillInventoryQueries(ctx).commands[0].command;
  let fallbackCalls = 0;
  const { provider } = providerReturning(plan, {
    inventoryEvents: [idle(), callFor("empty", command), outputFor("empty")],
    fallback: async () => { fallbackCalls += 1; return gathered.inventory; },
  });
  const actualInventory = await provider.flyaiInventory(ctx);
  assert.equal(actualInventory.executor, "agent_skill");
  assert.equal(actualInventory.searches, 1);
  assert.equal(actualInventory.failedSearches, 0);
  assert.deepEqual(plain(actualInventory.sources), []);
  assert.deepEqual(plain(actualInventory.failedCategories), ["景点与体验"]);
  assert.equal(fallbackCalls, 0);
});

test("mixed inventory retains good sources and marks only the empty category unverified", async () => {
  const multiCtx = { ...ctx, input: { trip: { ...ctx.input.trip, requestedServices: ["hotels", "attractions"] } } };
  const commands = inventory.skillInventoryQueries(multiCtx).commands;
  const { provider } = providerReturning(plan, { inventoryEvents: [
    callFor("hotel", commands[0].command), outputFor("hotel"),
    callFor("attraction", commands[1].command), outputFor("attraction", [{ info: { title: "实际景点商品", jumpUrl: "https://example.com/verified-attraction" } }]),
  ] });
  const actualInventory = await provider.flyaiInventory(multiCtx);
  assert.equal(actualInventory.executor, "agent_skill");
  assert.equal(actualInventory.searches, 2);
  assert.deepEqual(plain(actualInventory.failedCategories), ["住宿"]);
  assert.equal(actualInventory.sources[0].category, "景点与体验");
});

test("a later Skill failure searches only unfinished queries and keeps successful/empty receipts", async () => {
  const multiCtx = { ...ctx, searchIntents: [{ kind: "hotel", city: "杭州" }, { kind: "poi", city: "杭州" }, { kind: "keyword", query: "杭州 茶馆" }] };
  const commands = inventory.skillInventoryQueries(multiCtx).commands;
  let retried = [];
  const failed = { ...outputFor("tea"), content: [{ type: "data", data: { call_id: "tea", output: JSON.stringify({ exit_code: 1, stdout: "", stderr: "timeout", interrupted: false }) } }] };
  const qa = providerReturning(plan, { inventoryEvents: [
    callFor("hotel", commands[0].command), outputFor("hotel", [{ name: "真实酒店", detailUrl: "https://example.com/hotel" }]),
    callFor("poi", commands[1].command), outputFor("poi"), callFor("tea", commands[2].command), failed,
  ], fallback: async (_signal, _trip, _date, _preview, selection) => {
    retried = selection.queries.map(query => query.queryKey);
    return { sources: [{ name: "真实茶馆", url: "https://example.com/tea", category: "旅行商品", price: null }], searches: 1, failedSearches: 0, failedCategories: [], receipts: [] };
  } });
  const value = await qa.provider.flyaiInventory(multiCtx);
  assert.deepEqual(retried, [commands[2].queryKey]);
  assert.deepEqual(plain(value.sources.map(source => source.name)), ["真实酒店", "真实茶馆"]);
  assert.equal(value.searches, 3);
  assert.ok(value.receipts.some(receipt => receipt.state === "empty" && receipt.queryKey === commands[1].queryKey));
});

test("same-category queries each need their own completion receipt", async () => {
  const scoped = { ...ctx, searchIntents: [{ kind: "keyword", query: "杭州 茶馆" }, { kind: "keyword", query: "杭州 接送" }] };
  const commands = inventory.skillInventoryQueries(scoped).commands;
  const value = await inventoryStream.consumeInventoryStream(frames([
    callFor("tea", commands[0].command), outputFor("tea"),
    callFor("ride", commands[1].command), outputFor("ride", [{ title: "真实接送", jumpUrl: "https://example.com/ride" }]),
  ]), new AbortController(), commands, () => {});
  assert.equal(value.queryReceipts.length, 2);
  assert.equal(value.flyaiSources[0].name, "真实接送");
});

test("unknown Skill calls are retained without automatic retry while unstarted queries can finish", async () => {
  const scoped = { ...ctx, searchIntents: [{ kind: "hotel", city: "杭州" }, { kind: "poi", city: "杭州" }, { kind: "keyword", query: "杭州 茶馆" }] };
  const commands = inventory.skillInventoryQueries(scoped).commands;
  let retried = [];
  const qa = providerReturning(plan, { inventoryEvents: [
    callFor("hotel", commands[0].command), outputFor("hotel", [{ name: "真实酒店", detailUrl: "https://example.com/hotel" }]),
    callFor("poi", commands[1].command),
  ], fallback: async (_signal, _trip, _date, _preview, selection) => {
    retried = selection.queries.map(query => query.queryKey);
    return { sources: [], searches: 1, failedSearches: 0, failedCategories: selection.unsearchedCategories, receipts: [] };
  } });
  const result = await qa.provider.flyaiInventory(scoped);
  assert.deepEqual(retried, [commands[2].queryKey]);
  assert.ok(result.receipts.some(receipt => receipt.queryKey === commands[1].queryKey && receipt.state === "unknown"));
  assert.ok(result.failedCategories.includes(commands[1].category));
  assert.equal(result.sources[0].name, "真实酒店");
});

test("four observed Skill calls exhaust the fallback attempt budget", async () => {
  const scoped = { ...ctx, searchIntents: ["杭州 茶馆", "杭州 接送", "杭州 温泉", "杭州 SIM卡"].map(query => ({ kind: "keyword", query })) };
  const commands = inventory.skillInventoryQueries(scoped).commands;
  let calls = 0;
  const failed = { ...outputFor("query-0"), content: [{ type: "data", data: { call_id: "query-0", output: JSON.stringify({ exit_code: 1, stdout: "", stderr: "timeout", interrupted: false }) } }] };
  const qa = providerReturning(plan, { inventoryEvents: [...commands.map((command, i) => callFor(`query-${i}`, command.command)), failed],
    fallback: async () => { calls++; return gathered.inventory; } });
  const result = await qa.provider.flyaiInventory(scoped);
  assert.equal(calls, 0);
  assert.equal(result.receipts.length, 4);
  assert.ok(result.receipts.some(receipt => receipt.state === "failed"));
  assert.ok(result.failedCategories.length > 0);
});

test("inventory preserves requires_action and retries_exhausted stop reasons", async () => {
  const commands = inventory.skillInventoryQueries(ctx).commands;
  for (const [reason, code] of [["requires_action", "AGENT_REQUIRES_ACTION"], ["retries_exhausted", "AGENT_RETRIES_EXHAUSTED"], ["end_turn", "NO_VERIFIED_FLYAI_SEARCH"]]) {
    await assert.rejects(inventoryStream.consumeInventoryStream(frames([idle(reason)]), new AbortController(), commands, () => {}), { code });
  }
});

test("composition rejects built-in, unknown, MCP, function and approval calls at the call phase", async () => {
  for (const event of [
    { type: "tool_call", content: [{ type: "data", data: { name: "read", call_id: "read_1" } }] },
    { type: "tool_call", content: [{ type: "data", data: { name: "unknown_external_tool" } }] },
    { type: "mcp_call" }, { type: "function_call" }, { type: "tool_approval_request" },
  ]) {
    await assert.rejects(output.consumeAgentResponse(frames([{ ...event, status: "completed" }]), new AbortController(), () => {}, evidence.createToolEvidence("compose_plan")), { code: "COMPOSE_TOOL_CALL_FORBIDDEN" });
  }
});

test("inventory cancellation interrupts a pending read and cancels the stream", async () => {
  let cancellations = 0;
  const response = new Response(new ReadableStream({ cancel() { cancellations += 1; } }));
  const controller = new AbortController();
  const promise = inventoryStream.consumeInventoryStream(response, controller, inventory.skillInventoryQueries(ctx).commands, () => {});
  controller.abort(new DOMException("Cancelled", "AbortError"));
  await assert.rejects(promise, { name: "AbortError" });
  assert.equal(cancellations, 1);
});

 test("product images are bound from the matching FlyAI item, ignoring model image fields", () => {
  const imageUrl = "https://img.alicdn.com/product.jpg";
  const sources = [{ name: "真实商品", url: "https://item.fliggy.com/item.htm?id=1", category: "景点与体验", price: null, imageUrl }];
  const places = model.bindPlaces(JSON.stringify({ places: [{ source_index: 0, source_name: "真实商品", reason: "检索商品", imageUrl: "https://evil.example/fake.jpg" }] }), sources);
  assert.equal(places[0].imageUrl, imageUrl);
  assert.equal(places[0].url, sources[0].url);
});

test("Skill publishes only verified tool output before all categories finish", async () => {
  const multi = { ...ctx, input: { trip: { ...ctx.input.trip, requestedServices: ['hotels', 'attractions'] } } };
  const commands = inventory.skillInventoryQueries(multi).commands;
  let stream; const batches = [];
  const response = new Response(new ReadableStream({ start(controller) { stream = controller; } }));
  const send = event => stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
  const running = inventoryStream.consumeInventoryStream(response, new AbortController(), commands, () => {}, sources => batches.push(plain(sources)));
  send(callFor('first', commands[0].command)); await new Promise(setImmediate);
  assert.equal(batches.length, 0, 'a tool call is not a successful result');
  send(outputFor('first', [{ info: { title: '真实酒店', jumpUrl: 'https://example.com/hotel' } }]));
  await new Promise(setImmediate); assert.equal(batches.length, 1); assert.equal(batches[0][0].name, '真实酒店');
  send(callFor('second', commands[1].command)); send(outputFor('second'));
  const final = await running; assert.equal(final.successfulFlyaiSearches, 2); assert.equal(batches.length, 1);
});


const officialMapSnapshot = () => ({
  skills: [], mcp_servers: [{ type: "official", name: "amap-maps" }],
  tools: [
    { type: "builtin_toolkit", default_config: { enabled: false }, configs: [{ name: "bash", enabled: false }] },
    { type: "mcp_toolkit", mcp_server_name: "amap-maps", default_config: { enabled: false, permission_policy: { type: "always_allow" } }, configs: ["maps_text_search", "maps_search_detail", "maps_direction_walking", "maps_direction_driving", "maps_direction_transit_integrated"].map(name => ({ name, enabled: true })) },
  ],
});
test("mobility rejects expanded toolkit permissions before sending any itinerary", async () => {
  const unsafe = [];
  for (const change of [s => { s.tools[1].default_config.enabled = true; }, s => { s.tools[0].configs[0].enabled = true; }, s => { s.tools[1].configs.push({ name: "maps_ip_location", enabled: true }); }, s => { s.mcp_servers[0].type = "customer"; }, s => { s.tools[1].configs[0].permission_policy = { type: "always_ask" }; }]) {
    const snapshot = officialMapSnapshot(); change(snapshot); unsafe.push(snapshot);
  }
  for (const snapshot of unsafe) {
    const qa = providerReturning({}, { snapshot, configPatch: { mobilityAgentId: "agent_map", mobilityEnvironmentId: "env_map", mobilityMcpServerId: "amap-maps" } });
    await assert.rejects(qa.provider.mobility({ ...ctx, input: { trip: { destinationCity: "杭州" }, itinerary: [{ id: "a", date: "2026-10-12", name: "西湖" }, { id: "b", date: "2026-10-12", name: "灵隐寺" }] } }), error => error.code === "MOBILITY_AGENT_MCP_MISMATCH");
    assert.equal(qa.requests.some(request => request.path.endsWith("/events")), false);
  }
});

test("mobility rejects an Agent with unrelated tools or an unverified MCP snapshot before sending itinerary", async () => {
  const configPatch = { mobilityAgentId: "agent_map", mobilityEnvironmentId: "env_map", mobilityMcpServerId: "mcp_amap" };
  for (const snapshot of [{ tools: [{ name: "bash" }], skills: [], mcp_servers: ["mcp_amap"] }, { tools: [], skills: [], mcp_servers: ["other"] }]) {
    const qa = providerReturning({}, { configPatch, snapshot });
    await assert.rejects(qa.provider.mobility({ ...ctx, input: { trip: { destinationCity: "杭州" }, itinerary: [
      { id: "lake", date: "2026-10-12", name: "西湖", fixed: false }, { id: "temple", date: "2026-10-12", name: "灵隐寺", fixed: false },
    ] } }), error => error.code === "MOBILITY_AGENT_MCP_MISMATCH");
    assert.equal(qa.requests.some(request => request.path.endsWith("/events")), false);
    assert.equal(qa.deleted.length, 1);
  }
});
test("mobility uses independent no-Vault session and returns only figures extracted from MCP events", async () => {
  const event = (type, id, data) => ({ id: `${type}:${id}`, type, status: "completed", content: [{ type: "data", data: { call_id: id, ...data } }] });
  const events = [];
  for (const [id, name, location] of [["a", "西湖", "120.1,30.2"], ["b", "灵隐寺", "120.2,30.3"]]) {
    events.push(event("mcp_call", id, { name: "maps_text_search", arguments: { keywords: name, city: "杭州" } }));
    events.push(event("mcp_call_output", id, { output: { content: [{ type: "text", text: JSON.stringify({ pois: [{ name, location }] }) }] } }));
  }
  events.push(event("mcp_call", "route", { name: "maps_direction_driving", arguments: { origin: "120.1,30.2", destination: "120.2,30.3" } }));
  events.push(event("mcp_call_output", "route", { output: { content: [{ type: "text", text: JSON.stringify({ route: { paths: [{ duration: "540", distance: "2100" }] } }) }] } }));
  events.push({ id: "done", type: "message", role: "assistant", status: "completed", content: [{ type: "text", text: "完成" }] });
  events.push({ type: "session_status", status: "completed", content: [{ type: "data", data: { session_status: "idle", stop_reason: { type: "end_turn" } } }] });
  for (const [snapshot, server] of [[{ tools: [], skills: [], mcp_servers: [{ id: "mcp_amap" }] }, "mcp_amap"], [officialMapSnapshot(), "amap-maps"]]) {
  const qa = providerReturning({}, { agentEvents: events, snapshot, configPatch: { mobilityAgentId: "agent_map", mobilityEnvironmentId: "env_map", mobilityMcpServerId: server } });
  const result = await qa.provider.mobility({ ...ctx, input: { trip: { destinationCity: "杭州" }, itinerary: [
    { id: "lake", date: "2026-10-12", name: "西湖", fixed: false }, { id: "temple", date: "2026-10-12", name: "灵隐寺", fixed: false },
  ], selfReport: { private: "private-marker" } } });
  assert.equal(result.routes[0].taxiMinutes, 9); assert.equal(result.routes[0].taxiCostCny, undefined);
  const create = JSON.parse(qa.requests[0].options.body); assert.equal(create.agent, "agent_map"); assert.equal(create.vault_ids, undefined);
  assert.doesNotMatch(qa.requests.find(request => request.path.endsWith("/events")).options.body, /private-marker/);
  assert.equal(qa.deleted.length, 1);
  }
});
