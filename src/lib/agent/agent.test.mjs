import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import * as protection from "../adjust/protection.ts";
import { loadModule, readProjectFile } from "../test-support/module-loader.mjs";
const A = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222";
const draft = {
  intention: "慢慢探索",
  consent: true,
  trip: {
    originCity: "上海",
    destinationCity: "杭州",
    departureDate: "2030-10-20",
    returnDate: "2030-10-20",
    departureTimezone: "Asia/Shanghai",
    destinationTimezone: "Asia/Shanghai",
  },
};
const plan = {
  source: "live",
  retrievedAt: "2026-10-19T00:00:00Z",
  timezone: { shiftMinutes: 0, travelHours: 2 },
  healthContext: { basis: "preferences_only", provisional: true },
  localServices: [],
  plan: {
    headline: "杭州",
    summary: "从容",
    reason: "来源",
    adjustments: [],
    places: [],
    itinerary: [
      {
        date: "2030-10-20",
        time: "10:00",
        name: "博物馆",
        detail: "参观",
        fixed: false,
        durationMin: 60,
      },
      {
        date: "2030-10-20",
        time: "18:00",
        name: "晚餐预约",
        detail: "已订",
        fixed: true,
        durationMin: 60,
      },
    ],
  },
};
function fixture(options = {}) {
  const sqlite = new DatabaseSync(":memory:");
  for (const name of [
    "0001_accounts",
    "0002_password_auth",
    "0003_journeys",
    "0004_whoop_connections",
    "0005_learned_preferences",
    "0006_preference_kinds",
    "0007_planning_jobs",
    "0008_adjustments",
    "0009_agent_memory",
    "0010_memory_undo",
    "0011_agent_defaults",
    "0012_traveler_onboarding",
    "0013_body_journey",
    "0014_journey_collections",
  ])
    sqlite.exec(readProjectFile(`migrations/${name}.sql`));
  for (const id of [A, B])
    sqlite
      .prepare("INSERT INTO accounts(id,email) VALUES(?,?)")
      .run(id, id + "@example.invalid");
  const db = {
    prepare(sql) {
      options.onSql?.(sql);
      const s = sqlite.prepare(sql);
      let args = [];
      return {
        bind(...v) {
          args = v;
          return this;
        },
        async first() {
          return s.get(...args) ?? null;
        },
        async all() {
          return { results: s.all(...args) };
        },
        async run() {
          if (/RETURNING/i.test(sql)) {
            const results = s.all(...args);
            return { results, meta: { changes: results.length } };
          }
          return { meta: { changes: Number(s.run(...args).changes) } };
        },
      };
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const r = [];
        for (const s of statements) r.push(await s.run());
        sqlite.exec("COMMIT");
        return r;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
  };
  const storage = { "@/lib/database": { getDatabase: () => db } };
  const edit = loadModule("lib/itinerary-edit.ts", {
    "./planner-input": loadModule("lib/planner-input.ts"),
    "./adjust/protection": protection,
  });
  const journeys = loadModule("lib/journeys.ts", {
    ...storage,
    "@/lib/itinerary-edit": edit,
    "@/lib/journey-collections": { backlogInsertStatements: (...args) => collections.backlogInsertStatements(...args) },
    "@/lib/preferences": {
      learnFromDraft: async () => {},
      learnFromFeedback: async () => {},
    },
  });
  const versions = loadModule("lib/journey-versions.ts", {
    ...storage,
    "@/lib/journeys": journeys,
  });
  const memory = loadModule("lib/agent/memory.ts", {
    ...storage,
    "@/lib/journeys": journeys,
    "@/lib/planner-input": loadModule("lib/planner-input.ts"),
  });
  const store = loadModule("lib/agent/store.ts", {
    ...storage,
    "@/lib/journeys": journeys,
  });
  const request = loadModule("lib/adjust/request.ts", {
    "../planner-input": loadModule("lib/planner-input.ts"),
    "./types": loadModule("lib/adjust/types.ts"),
  });
  const contract = loadModule("lib/agent/contract.ts", {
    "@/lib/itinerary-edit": edit,
    "@/lib/journeys": journeys,
    "@/lib/places": loadModule("lib/places.ts"),
    "@/lib/adjust/request": request,
    "./memory": memory,
    "./blocks": loadModule("lib/agent/blocks.ts"),
  });
  const collections = loadModule("lib/journey-collections.ts", { ...storage, "@/lib/journeys": journeys });
  const body = loadModule("lib/body-journey.ts", { ...storage, "@/lib/journeys": journeys, "./adjust/request": request, "./adjust/types": loadModule("lib/adjust/types.ts") });
  const agentTools = loadModule("lib/agent/tools.ts", { "@/lib/journeys": journeys, "./memory": memory, "@/lib/body-journey": body, "@/lib/journey-collections": collections, "@/lib/travel-search": { searchTravel: options.searchTravel ?? (async () => ({ offers: [], receipts: [], searchedAt: new Date().toISOString() })) }, "./contract": contract });
  const actions = loadModule("lib/agent/actions.ts", {
    ...storage,
    "@/lib/journeys": journeys,
    "@/lib/journey-versions": versions,
    "./memory": memory,
    "./blocks": loadModule("lib/agent/blocks.ts"),
    "./contract": contract,
    "@/lib/journey-collections": collections,
    "@/lib/body-journey": body,
    "@/lib/planning/service": {
      preparePlanning: async () => {},
      prepareAdjustment: async () => {},
    },
    "@/lib/planning/jobs": {
      createPlanningJob: async () => ({
        job: { id: "job-1", state: "queued" },
      }),
    },
    "@/lib/planning/dispatch": { dispatchPlanningJob: async () => {} },
    "@/lib/adjust/request": request,
    "@/lib/adjust/types": loadModule("lib/adjust/types.ts"),
    "@/lib/planner-input": loadModule("lib/planner-input.ts"),
  });
  async function create() {
    return journeys.saveGeneratedJourney(A, { draft, generated: plan });
  }
  function chatWith(answer) {
    return loadModule("lib/agent/chat.ts", {
      ...storage,
      "@/lib/journeys": journeys,
      "@/lib/journey-versions": versions,
      "./memory": memory,
    "./blocks": loadModule("lib/agent/blocks.ts"),
      "./store": store,
      "./actions": actions,
      "./contract": contract,
    "@/lib/journey-collections": collections,
    "@/lib/body-journey": body,
      "./memory-context": loadModule("lib/agent/memory-context.ts"),
      "./search-policy": loadModule("lib/agent/search-policy.ts"),
      "./model": { askAgent: answer },
      "./tools": agentTools,
      "./tool-loop": loadModule("lib/agent/tool-loop.ts"),
    }).chat;
  }
  return {
    sqlite,
    db,
    journeys,
    versions,
    memory,
    store,
    contract,
    actions,
    create,
    chatWith,
    collections,
    body,
  };
}
test("memory is account-owned, editable, scoped, expiring and cannot be resurrected by extraction", async () => {
  const f = fixture();
  try {
    const j = await f.create();
    const key = "chat:food:spicy";
    const id = await f.memory.saveMemory(
      A,
      { note: "一般不吃辣", scope: "global" },
      { key, source: "chat" },
    );
    assert.equal((await f.memory.listMemoryItems(B)).length, 0);
    await assert.rejects(
      f.memory.saveMemory(B, { note: "x", scope: "journey", journeyId: j.id }),
      (e) => e.code === "JOURNEY_NOT_FOUND",
    );
    const row = (await f.memory.listMemoryItems(A))[0];
    await f.memory.saveMemory(
      A,
      { ...row, note: "可以微辣" },
      { id, version: row.version },
    );
    await assert.rejects(
      f.memory.saveMemory(
        A,
        { ...row, note: "旧值" },
        { id, version: row.version },
      ),
      (e) => e.code === "MEMORY_CHANGED",
    );
    assert.equal(
      await f.memory.saveMemory(
        A,
        { note: "旧聊天不吃辣", scope: "global" },
        { key },
      ),
      null,
    );
    await f.memory.saveMemory(A, {
      note: "这趟带父母",
      scope: "journey",
      journeyId: j.id,
      expiresOn: "2030-10-21",
    });
    await f.memory.saveMemory(A, {
      note: "今天疲劳",
      scope: "day",
      journeyId: j.id,
      expiresOn: "2030-10-20",
    });
    assert.equal(
      f.memory.applicableMemories(
        await f.memory.listMemoryItems(A),
        j.id,
        "2030-10-21",
      ).length,
      2,
    );
    assert.equal(
      f.memory.applicableMemories(
        await f.memory.listMemoryItems(A),
        null,
        "2030-10-21",
      ).length,
      1,
    );
    await f.memory.deleteMemory(A, id);
    assert.equal(
      await f.memory.saveMemory(
        A,
        { note: "不吃辣", scope: "global" },
        { key },
      ),
      null,
    );
    assert.equal((await f.memory.listMemoryItems(A)).length, 2);
  } finally {
    f.sqlite.close();
  }
});
test("new conversations persist separately and the newest empty conversation wins timestamp ties", async () => {
  const f = fixture();
  try {
    const journey = await f.create();
    const previous = await f.store.createConversation(A, journey.id);
    await f.db.prepare("INSERT INTO agent_messages(id,conversation_id,account_id,role,content) VALUES(?,?,?,'user',?)")
      .bind("existing_conversation_message", previous, A, "保留之前的讨论").run();
    const created = await f.store.createConversation(A, journey.id);
    const independent = await f.store.createConversation(A, null);
    await f.store.createConversation(B, null);
    f.sqlite.prepare("UPDATE agent_conversations SET updated_at=100 WHERE account_id=?").run(A);

    const conversations = await f.store.listConversations(A);
    assert.deepEqual(conversations.map(c => c.id), [independent, created, previous]);
    assert.equal(conversations.find(c => c.id === created).journeyId, journey.id);
    assert.equal(conversations[0].journeyId, null);
    assert.deepEqual(await f.store.listMessages(A, created), []);
    assert.equal((await f.store.listMessages(A, previous))[0].content, "保留之前的讨论");
    await assert.rejects(f.store.getConversation(B, created), e => e.code === "CHAT_NOT_FOUND");
  } finally {
    f.sqlite.close();
  }
});
test("conversation ownership and model operations are bound to current journey and stable activity IDs", async () => {
  const f = fixture();
  try {
    const j = await f.create(),
      activity = j.plan.plan.itinerary[0],
      fixed = j.plan.plan.itinerary[1];
    const id = await f.store.createConversation(A, j.id);
    await assert.rejects(
      f.store.listMessages(B, id),
      (e) => e.code === "CHAT_NOT_FOUND",
    );
    const raw = {
      reply: "推迟半小时，保留预约。",
      action: {
        type: "edit",
        journeyId: j.id,
        version: j.version,
        operations: [{ type: "edit", activityId: activity.id, time: "10:30" }],
      },
    };
    const answer = f.contract.validateAnswer(raw, j);
    assert.equal(answer.action.operations[0].index, 0);
    assert.throws(
      () =>
        f.contract.validateAnswer(
          { ...raw, action: { ...raw.action, journeyId: "other" } },
          j,
        ),
      (e) => e.code === "INVALID_AGENT_OUTPUT",
    );
    assert.throws(
      () =>
        f.contract.validateAnswer(
          {
            ...raw,
            action: {
              ...raw.action,
              operations: [{ type: "remove", activityId: fixed.id }],
            },
          },
          j,
        ),
      (e) => e.code === "INVALID_AGENT_OUTPUT",
    );
    assert.throws(
      () =>
        f.contract.validateAnswer(
          {
            ...raw,
            action: {
              ...raw.action,
              operations: [
                { type: "edit", activityId: activity.id, date: "2020-01-01" },
              ],
            },
          },
          j,
        ),
      (e) => e.code === "INVALID_AGENT_OUTPUT",
    );
    const preview = f.contract.actionPreview(answer.action, j);
    assert.match(preview[0].before, /10:00/);
    assert.match(preview[0].after, /10:30/);
  } finally {
    f.sqlite.close();
  }
});
test("chat saves actions and memories once; new proposals supersede old previews; memory opt-out is independent", async () => {
  const f = fixture();
  try {
    const j = await f.create(),
      conv = await f.store.createConversation(A, j.id);
    let calls = 0;
    let allowed = [];
    const chat = f.chatWith(async (input) => {
      calls++;
      allowed = input.memories;
      return {
        reply: "已提出修改，也记住你的口味。",
        action: {
          type: "edit",
          journeyId: j.id,
          version: j.version,
          operations: [
            {
              type: "edit",
              activityId: j.plan.plan.itinerary[0].id,
              time: "10:30",
            },
          ],
        },
        memories: [{ key: "food:spicy", note: "不吃辣", scope: "global" }],
      };
    });
    const raw = {
      conversationId: conv,
      messageId: "message_0001",
      text: "推迟参观半小时。我一般不吃辣。",
      includeMemory: false,
    };
    const first = await chat(A, raw, new AbortController().signal, () => {});
    const again = await chat(A, raw, new AbortController().signal, () => {});
    assert.equal(calls, 1);
    assert.equal(again.id, first.id);
    const unchanged = await f.journeys.getJourney(A, j.id);
    assert.equal(unchanged.version, j.version);
    assert.equal(unchanged.plan.plan.itinerary[0].time, "10:00");
    assert.equal(allowed.length, 0);
    assert.equal((await f.memory.listMemoryItems(A)).length, 1);
    const second = await chat(
      A,
      { ...raw, messageId: "message_0002", text: "还是推迟半小时" },
      new AbortController().signal,
      () => {},
    );
    const messages = await f.store.listMessages(A, conv);
    assert.equal(
      messages.find((m) => m.id === first.id).card.state,
      "discarded",
    );
    assert.equal(second.card.state, "proposed");
    await f.memory.setMemorySettings(A, false);
    await chat(
      A,
      { ...raw, messageId: "message_0003", text: "以后也是如此" },
      new AbortController().signal,
      () => {},
    );
    assert.equal((await f.memory.listMemoryItems(A)).length, 1);
  } finally {
    f.sqlite.close();
  }
});
test("applying an action twice writes once and a manual edit invalidates stale previews", async () => {
  const f = fixture();
  try {
    const j = await f.create(),
      conv = await f.store.createConversation(A, j.id);
    const card = {
      id: "action_0001",
      action: {
        type: "edit",
        journeyId: j.id,
        version: j.version,
        operations: [
          {
            type: "edit",
            index: 0,
            activityId: j.plan.plan.itinerary[0].id,
            time: "10:30",
          },
        ],
      },
    };
    await f.db
      .prepare(
        "INSERT INTO agent_actions(id,conversation_id,account_id,payload_json) VALUES(?,?,?,?)",
      )
      .bind(card.id, conv, A, JSON.stringify(card))
      .run();
    const options = {
      decision: "apply",
      includeMemory: false,
      includeWhoop: false,
    };
    const one = await f.actions.decideAction(A, card.id, options),
      two = await f.actions.decideAction(A, card.id, options);
    assert.equal(one.journey.version, j.version + 1);
    assert.equal(two.journey.version, one.journey.version);
    assert.equal(one.journey.plan.plan.itinerary[1].time, "18:00");
    await f.db
      .prepare(
        "INSERT INTO agent_actions(id,conversation_id,account_id,payload_json) VALUES(?,?,?,?)",
      )
      .bind("action_0002", conv, A, JSON.stringify(card))
      .run();
    await assert.rejects(
      f.actions.decideAction(A, "action_0002", options),
      (e) => e.code === "JOURNEY_CHANGED",
    );
    await assert.rejects(
      f.actions.decideAction(B, card.id, options),
      (e) => e.code === "ACTION_NOT_FOUND",
    );
    const snapshots = await f.versions.listJourneyVersions(A, j.id);
    assert.ok(snapshots.length >= 1);
  } finally {
    f.sqlite.close();
  }
});
test("streamed JSON reply decoding never leaks action fields and tolerates split escape sequences", () => {
  const { partialReply } = loadModule("lib/agent/model.ts", {
    "@/lib/planning/providers/bailian-model": {},
    "@/lib/journeys": {},
  });
  assert.equal(partialReply('{"reply":"你好\\n旅'), "你好\n旅");
  assert.equal(
    partialReply('{"reply":"已准备。","action":{"secret":"x"}}'),
    "已准备。",
  );
  assert.equal(partialReply('{"reply":"你好\\'), "你好");
  assert.equal(partialReply('{"action":{}'), "");
});

test("automatic corrections have a real undo receipt and undo never overwrites a later manual edit", async () => {
  const f = fixture();
  try {
    const first = await f.memory.rememberFromChat(
      A,
      { note: "不吃辣", scope: "global" },
      "message-first",
      "chat:global::food:spicy",
    );
    const original = (await f.memory.listMemoryItems(A))[0];
    const correction = await f.memory.rememberFromChat(
      A,
      { note: "现在可以微辣", scope: "global" },
      "message-correction",
      "chat:global::food:spicy",
      original,
    );
    await assert.rejects(
      f.memory.undoMemory(B, correction.undoId),
      (e) => e.code === "MEMORY_UNDO_UNAVAILABLE",
    );
    await f.memory.undoMemory(A, correction.undoId);
    assert.equal((await f.memory.listMemoryItems(A))[0].note, "不吃辣");
    await assert.rejects(
      f.memory.undoMemory(A, correction.undoId),
      (e) => e.code === "MEMORY_UNDO_UNAVAILABLE",
    );
    const current = (await f.memory.listMemoryItems(A))[0];
    const newer = await f.memory.rememberFromChat(
      A,
      { note: "以后不吃辣", scope: "global" },
      "message-newer",
      "chat:global::food:spicy",
      current,
    );
    const automatic = (await f.memory.listMemoryItems(A))[0];
    await f.memory.saveMemory(
      A,
      { ...automatic, note: "手动修正：少辣" },
      { id: automatic.id, version: automatic.version },
    );
    await assert.rejects(
      f.memory.undoMemory(A, newer.undoId),
      (e) => e.code === "MEMORY_CHANGED",
    );
    assert.equal((await f.memory.listMemoryItems(A))[0].note, "手动修正：少辣");
    assert.ok(first.undoId);
  } finally {
    f.sqlite.close();
  }
});
test("failed chat is recoverable without automatically spending another model call", async () => {
  const f = fixture();
  try {
    const conversationId = await f.store.createConversation(A, null);
    let calls = 0;
    const chat = f.chatWith(async () => {
      calls++;
      throw new Error("UPSTREAM_TIMEOUT");
    });
    const body = {
      conversationId,
      messageId: "failed_message_0001",
      text: "帮我规划旅行",
      includeMemory: false,
    };
    await assert.rejects(chat(A, body, new AbortController().signal, () => {}));
    const recovered = await chat(
      A,
      body,
      new AbortController().signal,
      () => {},
    );
    assert.ok(recovered.error);
    assert.equal(calls, 1);
    await assert.rejects(
      chat(
        A,
        { ...body, text: "不同的消息" },
        new AbortController().signal,
        () => {},
      ),
      (e) => e.code === "CHAT_KEY_REUSED",
    );
    assert.equal(
      (await f.store.getConversation(A, conversationId)).busy_request,
      null,
    );
  } finally {
    f.sqlite.close();
  }
});
test("daily proactive suggestion uses only remaining schedule facts and protects reservations", () => {
  const request = loadModule("lib/adjust/request.ts", {
    "../planner-input": loadModule("lib/planner-input.ts"),
    "./types": loadModule("lib/adjust/types.ts"),
  });
  const { proactiveSuggestion } = loadModule("lib/agent/proactive.ts", {
    "@/lib/adjust/request": request,
  });
  const j = {
    id: "journey",
    status: "active",
    planCurrent: true,
    draft: { trip: { destinationTimezone: "Asia/Shanghai" } },
    plan: {
      plan: {
        itinerary: ["10:00", "12:00", "14:00"].map((time) => ({
          date: "2030-10-20",
          time,
          name: "活动",
          kind: "sight",
        })),
      },
    },
  };
  const suggestion = proactiveSuggestion(j, new Date("2030-10-20T01:00:00Z"));
  assert.match(suggestion.text, /3 项/);
  assert.match(suggestion.prompt, /固定预约/);
  assert.equal(proactiveSuggestion(j, new Date("2030-10-20T07:00:00Z")), null);
  assert.equal(
    proactiveSuggestion(
      { ...j, status: "planned" },
      new Date("2030-10-20T01:00:00Z"),
    ),
    null,
  );
});

test("a complete conversational trip receives neutral defaults and can enter the existing planning pipeline", async () => {
  const f = fixture();
  try {
    const answer = f.contract.validateAnswer(
      {
        reply: "请确认这段新旅程",
        action: {
          type: "create",
          draft: {
            trip: {
              originCity: "上海",
              destinationCity: "杭州",
              departureDate: "2030-10-20",
              returnDate: "2030-10-21",
            },
          },
        },
      },
      null,
    );
    const { validateInput } = loadModule("lib/planner-input.ts");
    assert.ok(validateInput({ ...answer.action.draft, consent: true }));
    assert.equal(answer.action.draft.fatigue, null);
    assert.equal(answer.action.draft.trip.destinationTimezone, "Asia/Shanghai");
  } finally {
    f.sqlite.close();
  }
});

test("stale conversation leases recover persisted history without repeating a model request", async () => {
  const f = fixture();
  try {
    const id = await f.store.createConversation(A, null);
    await f.db
      .prepare(
        "INSERT INTO agent_messages(id,conversation_id,account_id,role,content) VALUES('interrupted_01',?,?,'user','调整安排')",
      )
      .bind(id, A)
      .run();
    await f.db
      .prepare(
        "UPDATE agent_conversations SET busy_request='interrupted_01',busy_at=unixepoch()-301 WHERE id=?",
      )
      .bind(id)
      .run();
    const conversation = await f.store.getConversation(A, id);
    assert.equal(conversation.busy_request, null);
    const messages = await f.store.listMessages(A, id);
    assert.equal(messages.length, 2);
    assert.equal(messages[1].role, "assistant");
    assert.ok(messages[1].error);
  } finally {
    f.sqlite.close();
  }
});
test("memory prompt budget favors scoped facts and stays bounded as memory grows", () => {
  const { boundedMemoryContext } = loadModule("lib/agent/memory-context.ts");
  const items = Array.from({ length: 100 }, (_, i) => ({
    id: String(i),
    note: "记".repeat(1000),
    scope: "global",
    source: "choice",
    updatedAt: "2026-10-19",
  }));
  items.push({
    id: "scoped",
    note: "这次带父母",
    scope: "journey",
    source: "chat",
    updatedAt: "2026-10-19",
  });
  const result = boundedMemoryContext(items);
  assert.equal(result[0].id, "scoped");
  assert.ok(result.length <= 16);
  assert.ok(result.reduce((n, m) => n + m.note.length, 0) <= 5000);
});
test("Bailian streaming uses an edge-compatible redirect policy and reports only changed text chunks", async () => {
  const deltas = ['{"reply":"你好', '，已整理"', ',"action":null', ',"memories":[]}'];
  const body =
    deltas
      .map(
        (content) =>
          "data: " +
          JSON.stringify({
            choices: [{ delta: { content }, finish_reason: null }],
          }) +
          "\n\n",
      )
      .join("") +
    "data: " +
    JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] }) +
    "\n\ndata: [DONE]\n\n";
  let options;
  const texts = [];
  const model = loadModule(
    "lib/agent/model.ts",
    {
      "@/lib/planning/providers/bailian-model": {
        getModelTransport: () => ({
          baseUrl: "https://example.invalid/v1",
          apiKey: "local-test",
          model: "test",
        }),
      },
      "@/lib/journeys": {},
    },
    {
      fetch: async (url, init) => {
        options = init;
        return new Response(body);
      },
    },
  );
  const result = await model.askAgent({
    messages: [{ role: "user", content: "你好" }],
    journey: null,
    memories: [],
    versions: [],
    pending: null,
    autoMemory: false,
    signal: new AbortController().signal,
    onText: (t) => texts.push(t),
  });
  assert.equal(options.redirect, "manual");
  assert.equal(JSON.parse(options.body).store, false);
  assert.equal(result.reply, "你好，已整理");
  assert.equal(texts.at(-1), "你好，已整理");
  assert.equal(texts.length, 2);
});

test("disabling auto memory prevents a new, otherwise valid conversational fact from being saved", async () => {
  const f = fixture();
  try {
    await f.memory.setMemorySettings(A, false);
    const conversationId = await f.store.createConversation(A, null);
    const chat = f.chatWith(async (input) => {
      assert.equal(input.autoMemory, false);
      return {
        reply: "可以在记忆页添加。",
        memories: [
          { key: "schedule:early", note: "不安排早起", scope: "global" },
        ],
      };
    });
    await chat(
      A,
      {
        conversationId,
        messageId: "memory_disabled_01",
        text: "以后不安排早起",
        includeMemory: true,
      },
      new AbortController().signal,
      () => {},
    );
    assert.equal((await f.memory.listMemoryItems(A)).length, 0);
  } finally {
    f.sqlite.close();
  }
});

test("agent settings default on, persist per account and preserve automatic memory independently", async () => {
  const f = fixture();
  try {
    assert.deepEqual(
      { ...(await f.memory.memorySettings(A)) },
      {
        autoMemory: true,
        useMemory: true,
        useWhoop: true,
      },
    );
    await f.memory.setMemorySettings(A, false);
    assert.deepEqual(
      { ...(await f.memory.memorySettings(A)) },
      {
        autoMemory: false,
        useMemory: true,
        useWhoop: true,
      },
    );
    await f.memory.saveAgentSettings(A, { useMemory: false, useWhoop: false });
    assert.deepEqual(
      { ...(await f.memory.memorySettings(A)) },
      {
        autoMemory: false,
        useMemory: false,
        useWhoop: false,
      },
    );
    assert.deepEqual(
      { ...(await f.memory.memorySettings(B)) },
      {
        autoMemory: true,
        useMemory: true,
        useWhoop: true,
      },
    );
    await f.memory.setMemorySettings(A, true);
    assert.deepEqual(
      { ...(await f.memory.memorySettings(A)) },
      {
        autoMemory: true,
        useMemory: false,
        useWhoop: false,
      },
    );
  } finally {
    f.sqlite.close();
  }
});

test("chat reads persistent memory preference when no per-message option is supplied", async () => {
  const f = fixture();
  try {
    await f.memory.saveMemory(A, { note: "一般不吃辣", scope: "global" });
    const conv = await f.store.createConversation(A, null);
    const received = [];
    const chat = f.chatWith(async (input) => {
      received.push(input.memories);
      return { reply: "好的", memories: [] };
    });
    await chat(
      A,
      { conversationId: conv, messageId: "settings_message_1", text: "你好" },
      new AbortController().signal,
      () => {},
    );
    assert.equal(received[0].length, 1);
    await f.memory.saveAgentSettings(A, { useMemory: false, useWhoop: true });
    await chat(
      A,
      { conversationId: conv, messageId: "settings_message_2", text: "再聊聊" },
      new AbortController().signal,
      () => {},
    );
    assert.equal(received[1].length, 0);
  } finally {
    f.sqlite.close();
  }
});

test("denying a chat proposal leaves the itinerary unchanged and prevents later execution", async () => {
  const f = fixture();
  try {
    const j = await f.create();
    const conv = await f.store.createConversation(A, j.id);
    const chat = f.chatWith(async () => ({
      reply: "已安排",
      action: {
        type: "edit",
        journeyId: j.id,
        version: j.version,
        operations: [
          {
            type: "edit",
            activityId: j.plan.plan.itinerary[0].id,
            time: "10:30",
          },
        ],
      },
    }));
    const reply = await chat(
      A,
      {
        conversationId: conv,
        messageId: "deny_action_message",
        text: "推迟参观半小时",
      },
      new AbortController().signal,
      () => {},
    );
    assert.equal(reply.card.state, "proposed");
    assert.equal((await f.journeys.getJourney(A, j.id)).version, j.version);
    await f.actions.decideAction(A, reply.card.id, { decision: "discard" });
    await assert.rejects(
      f.actions.decideAction(A, reply.card.id, { decision: "apply" }),
      (e) => e.code === "ACTION_NOT_AVAILABLE",
    );
    const unchanged = await f.journeys.getJourney(A, j.id);
    assert.equal(unchanged.version, j.version);
    assert.equal(unchanged.plan.plan.itinerary[0].time, "10:00");
    assert.equal(
      (await f.store.listMessages(A, conv)).find((m) => m.id === reply.id).card
        .state,
      "discarded",
    );
  } finally {
    f.sqlite.close();
  }
});

test("only itinerary mutations need approval; memory requests and candidate preparation run directly", async () => {
  const f = fixture();
  try {
    const j = await f.create();
    for (const type of ["edit", "restore", "create"])
      assert.equal(f.contract.requiresItineraryApproval({ type }, true), true);
    for (const type of ["forget", "consult", "plan"])
      assert.equal(f.contract.requiresItineraryApproval({ type }, true), false);
    assert.equal(
      f.contract.requiresItineraryApproval({ type: "plan" }, false),
      true,
    );
    const memoryId = await f.memory.saveMemory(A, {
      note: "一般不吃辣",
      scope: "global",
    });
    const conv = await f.store.createConversation(A, j.id);
    let calls = 0;
    const chat = f.chatWith(async () => {
      calls++;
      return { reply: "请确认", action: { type: "forget", memoryId } };
    });
    const raw = {
      conversationId: conv,
      messageId: "automatic_forget_1",
      text: "忘记我不吃辣这条记忆",
    };
    const result = await chat(A, raw, new AbortController().signal, () => {});
    assert.equal(result.card.requiresApproval, false);
    assert.equal(result.card.state, "applied");
    assert.equal(result.content, "已忘记这条记忆。");
    assert.equal((await f.memory.listMemoryItems(A)).length, 0);
    await chat(A, raw, new AbortController().signal, () => {});
    assert.equal(calls, 1);
    const consult = f.chatWith(async () => ({
      reply: "请允许检索",
      action: {
        type: "consult",
        journeyId: j.id,
        version: j.version,
        instruction: "找些安静的活动",
        tags: [],
      },
    }));
    const advice = await consult(
      A,
      {
        conversationId: conv,
        messageId: "automatic_consult_1",
        text: "找些安静的活动给我参考",
      },
      new AbortController().signal,
      () => {},
    );
    assert.equal(advice.card.requiresApproval, false);
    assert.equal(advice.card.state, "applied");
    assert.equal(advice.card.result.jobId, "job-1");
    assert.equal((await f.journeys.getJourney(A, j.id)).version, j.version);
  } finally {
    f.sqlite.close();
  }
});

test("global memory opt-out cannot be overridden by a chat request or a read_memory tool", async () => {
  let memoryReads = 0;
  const f = fixture({ onSql: sql => { if (/SELECT[^]*FROM memory_items/i.test(sql)) memoryReads++; } });
  try {
    await f.memory.saveMemory(A, { note: "一般不吃辣", scope: "global" });
    await f.memory.saveAgentSettings(A, { useMemory: false, useWhoop: false });
    const conversationId = await f.store.createConversation(A, null);
    memoryReads = 0;
    let rounds = 0;
    const chat = f.chatWith(async input => {
      assert.equal(input.memories.length, 0);
      if (!rounds++) return { reply: "核对偏好", tools: [{ name: "read_memory", arguments: {} }] };
      assert.equal(input.toolResults[0].data.length, 0);
      return { reply: "按这次提供的信息安排。" };
    });
    await chat(A, { conversationId, messageId: "global_memory_off", text: "帮我安排", includeMemory: true }, new AbortController().signal, () => {});
    assert.equal(rounds, 2);
    assert.equal(memoryReads, 0, "global opt-out must prevent the database read itself");
  } finally { f.sqlite.close(); }
});

test("tool loop reuses completed calls and stops after six rounds", async () => {
  const { runAgentToolLoop } = loadModule("lib/agent/tool-loop.ts");
  let asked = 0, executed = 0;
  const result = await runAgentToolLoop({ signal: new AbortController().signal, ask: async () => { asked++; return { reply: "核对", tools: [{ name: "search_travel", arguments: { intents: [{ kind: "poi", city: "杭州" }] } }] }; }, execute: async () => { executed++; return { version: 1 }; } });
  assert.equal(asked, 6);
  assert.equal(executed, 1);
  assert.match(result.reply, /已完成/);
});

test("tool failures preserve earlier results and do not repeat either query", async () => {
  const { runAgentToolLoop } = loadModule("lib/agent/tool-loop.ts");
  let round = 0, executed = 0;
  await runAgentToolLoop({ signal: new AbortController().signal, ask: async results => {
    if (++round < 3) return { reply: "核对", tools: [{ name: "search_travel", arguments: { intents: [{ kind: "poi", city: "杭州" }] } }, { name: "search_travel", arguments: { fail: true } }] };
    assert.equal(results[0].status, "ok"); assert.equal(results[1].status, "error");
    return { reply: "路线未完成，保留已读取的行程。" };
  }, execute: async call => { executed++; if (call.arguments.fail) throw new Error("unavailable"); return { version: 1 }; } });
  assert.equal(executed, 2);
});

test("a journey changed during a model answer is never presented as a valid proposal", async () => {
  const f = fixture();
  try {
    const journey = await f.create(), conversationId = await f.store.createConversation(A, journey.id);
    const chat = f.chatWith(async () => {
      await f.journeys.updateJourneyItinerary(A, journey.id, { version: journey.version, operations: [{ type: "edit", index: 0, time: "11:00" }] });
      return { reply: "现在还是十点。" };
    });
    await assert.rejects(chat(A, { conversationId, messageId: "concurrent_answer", text: "几点出发" }, new AbortController().signal, () => {}), e => e.code === "JOURNEY_CHANGED");
    const messages = await f.store.listMessages(A, conversationId);
    assert.ok(messages.at(-1).error);
    assert.equal(messages.at(-1).card, undefined);
  } finally { f.sqlite.close(); }
});

test("only bounded questions are accepted from model rich blocks; evidence cards require tools", () => {
  const { questionBlocks } = loadModule("lib/agent/blocks.ts");
  const blocks = questionBlocks([{ type: "offers", offers: [{ name: "虚构产品", url: "https://example.invalid" }] }, { type: "question", title: "出发日期", input: "date", min: "2030-10-20" }]);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "question");
  assert.equal(blocks[0].input, "date");
});

test("collection writes are account-owned, version-checked, idempotent and reject unverified links", async () => {
  const f = fixture();
  try {
    const j = await f.create();
    const raw = { operation: "add", expectedVersion: j.version, requestId: "packing_001", kind: "checklist", items: [{ title: "带充电器", sourceUrl: "https://example.invalid/fake" }] };
    await f.collections.mutateJourneyCollection(A, j.id, raw);
    await f.collections.mutateJourneyCollection(A, j.id, raw);
    const items = await f.collections.listJourneyCollections(A, j.id);
    assert.equal(items.length, 1);
    assert.equal(items[0].sourceUrl, undefined);
    await assert.rejects(f.collections.listJourneyCollections(B, j.id), e => e.code === "JOURNEY_NOT_FOUND");
    await assert.rejects(f.collections.mutateJourneyCollection(A, j.id, { ...raw, expectedVersion: j.version - 1 }), e => e.code === "JOURNEY_CHANGED");
    await f.collections.mutateJourneyCollection(A, j.id, { operation: "check", expectedVersion: j.version, id: items[0].id, checked: true });
    assert.equal((await f.collections.listJourneyCollections(A, j.id))[0].checked, true);
  } finally { f.sqlite.close(); }
});

test("body self-assessment action persists only after user confirmation and only once", async () => {
  const f = fixture();
  try {
    const j = await f.create(), conversationId = await f.store.createConversation(A, j.id);
    const chat = f.chatWith(async () => ({ reply: "确认今天的感受", action: { type: "checkin", journeyId: j.id, version: j.version, fatigue: 4, tags: [] } }));
    const message = await chat(A, { conversationId, messageId: "body_assessment_01", text: "今天疲劳四分" }, new AbortController().signal, () => {});
    assert.equal((await f.body.listBodyCheckIns(A, j.id)).current, null);
    await f.actions.decideAction(A, message.card.id, { decision: "apply" });
    await f.actions.decideAction(A, message.card.id, { decision: "apply" });
    const body = await f.body.listBodyCheckIns(A, j.id);
    assert.equal(body.current.fatigue, 4); assert.equal(body.checkIns.length, 1);
  } finally { f.sqlite.close(); }
});

const searchOffer = { id: "offer-museum", name: "杭州博物馆", url: "https://www.fliggy.com/example-museum", kind: "poi", tool: "search_poi", category: "博物馆", retrievedAt: "2030-10-20T00:00:00Z", price: null, facts: [{ label: "位置", value: "杭州" }] };
test("current-turn policy recognizes explicit search and private-context boundaries", () => {
  const policy = loadModule("lib/agent/search-policy.ts");
  const searchPolicyFromText = text => JSON.parse(JSON.stringify(policy.searchPolicyFromText(text)));
  const contextAccessFromText = text => JSON.parse(JSON.stringify(policy.contextAccessFromText(text)));
  assert.deepEqual(searchPolicyFromText("请只做一次飞猪语义搜索，找杭州茶馆。"), { maxQueries: 1, allowedKinds: ["semantic"] });
  assert.deepEqual(searchPolicyFromText("仅调用一次飞猪语义搜索"), { maxQueries: 1, allowedKinds: ["semantic"] });
  assert.deepEqual(searchPolicyFromText("只用语义搜索，找喝茶的地方"), { maxQueries: 4, allowedKinds: ["semantic"] });
  assert.deepEqual(searchPolicyFromText("Only use semantic search. Only one query."), { maxQueries: 1, allowedKinds: ["semantic"] });
  assert.deepEqual(searchPolicyFromText("不要再搜索，解释已有结果"), { maxQueries: 0 });
  assert.deepEqual(searchPolicyFromText("我只去一次，帮我规划杭州"), { maxQueries: 4 });
  assert.deepEqual(contextAccessFromText("不读取身体记录或旅行记忆，请只搜一次"), { memory: false, body: false });
  assert.deepEqual(contextAccessFromText("Don't read body records or memories."), { memory: false, body: false });
  assert.deepEqual(contextAccessFromText("请参考旅行记忆"), { memory: true, body: true });
});

test("one semantic search cannot batch, substitute kinds, retry or bypass limits through consult", async () => {
  const queries = [];
  const detail = "已排除无喝茶证据的酒店与景点，本次没有找到符合条件的茶馆。";
  const f = fixture({ searchTravel: async (_account, intents) => { queries.push(intents); return { offers: [], receipts: [{ state: "empty", detail }], searchedAt: searchOffer.retrievedAt }; } });
  try {
    const j = await f.create(), conversationId = await f.store.createConversation(A, j.id);
    const search = intents => ({ name: "search_travel", arguments: { intents } });
    const chat = f.chatWith(async input => {
      assert.deepEqual(JSON.parse(JSON.stringify(input.searchPolicy)), { maxQueries: 1, allowedKinds: ["semantic"] });
      if (input.round === 0) return { reply: "寻找茶馆", tools: [search([{ kind: "poi", city: "杭州" }])] };
      if (input.round === 1) { assert.equal(input.toolResults.at(-1).data.code, "SEARCH_KIND_RESTRICTED"); return { reply: "核对范围", tools: [search([{ kind: "semantic", query: "杭州茶馆" }, { kind: "semantic", query: "杭州茶室" }])] }; }
      if (input.round === 2) { assert.equal(input.toolResults.at(-1).data.code, "SEARCH_LIMIT"); return { reply: "查找茶馆", tools: [search([{ kind: "semantic", query: "杭州茶馆" }])] }; }
      if (input.round === 3) { assert.equal(input.toolResults.at(-1).data.receipts[0].detail, detail); return { reply: "继续查找", tools: [search([{ kind: "semantic", query: "杭州茶室" }])] }; }
      assert.equal(input.toolResults.at(-1).data.code, "SEARCH_LIMIT");
      return { reply: "再用规划工具查找", action: { type: "consult", journeyId: j.id, version: j.version, instruction: "找茶馆", tags: [] } };
    });
    const result = await chat(A, { conversationId, messageId: "single_semantic_query", text: "请只做一次飞猪语义搜索，找杭州茶馆" }, new AbortController().signal, () => {});
    assert.deepEqual(JSON.parse(JSON.stringify(queries)), [[{ kind: "semantic", query: "杭州茶馆" }]]);
    assert.equal(result.card, undefined);
    assert.equal(result.blocks.some(block => block.type === "offers"), false);
    assert.equal(result.blocks.find(block => block.type === "status").detail, detail);
    assert.equal((await f.store.listMessages(A, conversationId)).at(-1).blocks[0].detail, detail);
  } finally { f.sqlite.close(); }
});

test("explicit private-context opt-out prevents default and tool reads in a bound journey", async () => {
  const reads = [];
  const f = fixture({ onSql: sql => { if (/SELECT[^]*FROM (memory_items|body_checkins|body_check_ins|journey_adjustments|adjustment_outcomes)/i.test(sql)) reads.push(sql); } });
  try {
    const j = await f.create(), conversationId = await f.store.createConversation(A, j.id);
    await f.memory.saveMemory(A, { note: "一般不吃辣", scope: "global" });
    reads.length = 0;
    const chat = f.chatWith(async input => {
      assert.equal(input.memories.length, 0);
      assert.equal(input.bodyContext, null);
      assert.equal(input.autoMemory, false);
      assert.deepEqual(JSON.parse(JSON.stringify(input.contextAccess)), { memory: false, body: false });
      if (input.round === 0) return { reply: "核对范围", tools: [{ name: "read_memory", arguments: {} }, { name: "get_body_context", arguments: {} }] };
      assert.deepEqual(JSON.parse(JSON.stringify(input.toolResults.map(result => result.data))), [[], null]);
      return { reply: "只参考本次需求。", memories: [{ key: "food", note: "一般不吃辣", category: "food", scope: "global" }] };
    });
    await chat(A, { conversationId, messageId: "no_private_context", text: "不读取身体记录或旅行记忆，只参考本次公开需求。", includeMemory: true }, new AbortController().signal, () => {});
    assert.deepEqual(reads, []);
  } finally { f.sqlite.close(); }
});

const publicSearchText = "发布复测：请只做一次语义搜索，查找杭州西湖附近喝茶的地点或产品。只展示本次来源明确提到茶饮服务的结果，没有匹配就说明没有，不再搜索。不创建或修改旅程，不读取身体记录或旅行记忆。";

test("a constrained search cannot finish with an unexecuted success claim or reuse historic offers", async () => {
  for (const corrects of [false, true]) {
    let searches = 0, rounds = 0;
    const f = fixture({ searchTravel: async () => { searches++; return { offers: [], receipts: [{ state: "empty", detail: "本轮没有匹配" }], searchedAt: searchOffer.retrievedAt }; } });
    try {
      const conversationId = await f.store.createConversation(A, null);
      await f.db.prepare("INSERT INTO agent_messages(id,conversation_id,account_id,role,content,payload_json) VALUES(?,?,?,'assistant',?,?)").bind("historic_offer", conversationId, A, "旧检索结果", JSON.stringify({ blocks: [{ type: "offers", title: "上次结果", offers: [searchOffer] }] })).run();
      const chat = f.chatWith(async input => {
        rounds++;
        if (corrects && input.round === 1) return { reply: "现在检索", tools: [{ name: "search_travel", arguments: { intents: [{ kind: "semantic", query: "杭州西湖茶馆" }] } }] };
        return { reply: "已检索杭州西湖附近明确提供茶饮服务的地点。", action: null, tools: [] };
      });
      const result = await chat(A, { conversationId, messageId: `required_real_query_${corrects}`, text: publicSearchText }, new AbortController().signal, () => {});
      assert.equal(searches, corrects ? 1 : 0);
      assert.equal(rounds, corrects ? 3 : 2);
      assert.match(result.content, corrects ? /没有找到匹配结果/ : /本轮未完成检索/);
      assert.doesNotMatch(result.content, /已检索/);
      assert.equal(result.blocks.some(block => block.type === "offers"), false);
      assert.equal(result.card, undefined);
    } finally { f.sqlite.close(); }
  }
});

test("clarification, explicit search prohibition and pure recap do not force a fresh search", async () => {
  const cases = [
    { text: "请只做一次语义搜索", blocks: [{ type: "question", title: "想找哪个城市？", input: "options", options: [{ label: "杭州", value: "杭州" }] }] },
    { text: "不要再搜索，解释上次只做一次语义搜索的结果", blocks: [] },
    { text: "请解释上次只做一次语义搜索的结果", blocks: [] },
  ];
  for (const [index, item] of cases.entries()) {
    let rounds = 0;
    const f = fixture({ searchTravel: async () => { throw new Error("must not search"); } });
    try {
      const conversationId = await f.store.createConversation(A, null);
      const chat = f.chatWith(async () => { rounds++; return { reply: "请参考已有信息。", action: null, blocks: item.blocks }; });
      const result = await chat(A, { conversationId, messageId: `no_forced_search_${index}`, text: item.text }, new AbortController().signal, () => {});
      assert.equal(rounds, 1);
      assert.equal(result.content, "请参考已有信息。");
    } finally { f.sqlite.close(); }
  }
});

test("an initial action-shaped search can be corrected once and execute its first query within the same budget", async () => {
  let searches = 0, rounds = 0;
  const detail = "没有符合茶饮要求的本次结果。";
  const f = fixture({ searchTravel: async () => { searches++; return { offers: [], receipts: [{ state: "empty", detail }], searchedAt: searchOffer.retrievedAt }; } });
  try {
    const conversationId = await f.store.createConversation(A, null);
    const chat = f.chatWith(async input => {
      rounds++;
      assert.equal(input.searchPolicy.maxQueries, 1);
      if (input.round === 0) return { reply: "正在查找", action: { type: "search", query: "杭州西湖茶馆" } };
      assert.equal(input.toolResults[0].name, "validate_answer");
      if (input.round === 1) return { reply: "按范围检索", tools: [{ name: "search_travel", arguments: { intents: [{ kind: "semantic", query: "杭州西湖茶馆" }] } }] };
      return { reply: "这次没有找到匹配结果。", action: null, memories: [{ key: "unasked", note: "爱喝茶", scope: "global" }] };
    });
    const result = await chat(A, { conversationId, messageId: "correct_first_search", text: publicSearchText }, new AbortController().signal, () => {});
    assert.equal(searches, 1); assert.equal(rounds, 3);
    assert.equal(result.card, undefined); assert.equal(result.memories, undefined);
    assert.equal(result.blocks[0].detail, detail);
    assert.equal((await f.store.listMessages(A, conversationId)).at(-1).content, result.content);
  } finally { f.sqlite.close(); }
});

test("invalid final actions preserve only current tool evidence and never repeat searches or execute writes", async () => {
  for (const offers of [[], [searchOffer]]) {
    let searches = 0, rounds = 0;
    const detail = offers.length ? "本次返回的服务内容仍需核实。" : "本次没有找到符合要求的产品。";
    const f = fixture({ searchTravel: async () => { searches++; return { offers, receipts: [{ state: offers.length ? "completed" : "empty", detail }], searchedAt: searchOffer.retrievedAt }; } });
    try {
      const j = await f.create(), conversationId = await f.store.createConversation(A, j.id);
      const chat = f.chatWith(async input => {
        rounds++;
        if (input.round === 0) return { reply: "搜索中", tools: [{ name: "search_travel", arguments: { intents: [{ kind: "semantic", query: "杭州西湖茶馆" }] } }] };
        if (input.round === 1) return { reply: "已删除旅程，已找到所有茶馆", action: { type: "delete_all_journeys" } };
        return { reply: "扩大查询", tools: [{ name: "search_travel", arguments: { intents: [{ kind: "semantic", query: "杭州喝茶" }] } }] };
      });
      const input = { conversationId, messageId: `recover_invalid_action_${offers.length}`, text: publicSearchText };
      const result = await chat(A, input, new AbortController().signal, () => {});
      assert.equal(searches, 1); assert.equal(rounds, 3);
      assert.equal(result.card, undefined); assert.equal(result.memories, undefined);
      assert.doesNotMatch(result.content, /已删除|所有茶馆/);
      assert.match(result.content, offers.length ? /有来源的选择/ : /没有找到匹配结果/);
      assert.equal(result.blocks.find(block => block.type === "status").detail, detail);
      assert.ok(result.blocks.some(block => block.type === "status" && block.title === "额外操作未执行"));
      assert.equal((await f.journeys.getJourney(A, j.id)).version, j.version);
      assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM agent_actions WHERE account_id=?").bind(A).first()).count, 0);
      const replay = await chat(A, input, new AbortController().signal, () => {});
      assert.equal(replay.content, result.content); assert.equal(searches, 1); assert.equal(rounds, 3);
    } finally { f.sqlite.close(); }
  }
});

test("invalid actions without any executed query never claim that a search found no matches", async () => {
  let rounds = 0;
  const f = fixture({ searchTravel: async () => { throw new Error("must not be called"); } });
  try {
    const conversationId = await f.store.createConversation(A, null);
    const chat = f.chatWith(async () => { rounds++; return { reply: "已找到茶馆", action: { type: "unsupported_write" }, blocks: [{ type: "offers", offers: [searchOffer] }] }; });
    const result = await chat(A, { conversationId, messageId: "no_executed_search", text: publicSearchText }, new AbortController().signal, () => {});
    assert.equal(rounds, 2);
    assert.match(result.content, /本轮未完成检索/);
    assert.doesNotMatch(result.content, /已找到|没有找到匹配结果/);
    assert.equal(result.card, undefined);
    assert.equal(result.blocks.some(block => block.type === "offers"), false);
  } finally { f.sqlite.close(); }
});

test("a syntactically valid correction cannot turn empty or absent evidence into a success claim", async () => {
  for (const executeSearch of [false, true]) {
    let searches = 0;
    const f = fixture({ searchTravel: async () => { searches++; return { offers: [], receipts: [{ state: "empty", detail: "没有茶饮产品匹配" }], searchedAt: searchOffer.retrievedAt }; } });
    try {
      const conversationId = await f.store.createConversation(A, null);
      const chat = f.chatWith(async input => {
        if (executeSearch && input.round === 0) return { reply: "检索中", tools: [{ name: "search_travel", arguments: { intents: [{ kind: "semantic", query: "杭州茶馆" }] } }] };
        if (input.round === (executeSearch ? 1 : 0)) return { reply: "正在整理", action: { type: "none" } };
        return { reply: "已找到所有茶馆，并已修改行程", action: null, memories: [] };
      });
      const result = await chat(A, { conversationId, messageId: `valid_false_correction_${executeSearch}`, text: publicSearchText }, new AbortController().signal, () => {});
      assert.equal(searches, executeSearch ? 1 : 0);
      assert.match(result.content, executeSearch ? /没有找到匹配结果/ : /本轮未完成检索/);
      assert.doesNotMatch(result.content, /已找到|已修改/);
    } finally { f.sqlite.close(); }
  }
});

test("a failed search cannot be repeated during correction and final validation never adds a seventh model round", async () => {
  let searches = 0;
  const f = fixture({ searchTravel: async () => { searches++; throw new Error("SEARCH_TIMEOUT"); } });
  try {
    const conversationId = await f.store.createConversation(A, null);
    const chat = f.chatWith(async input => input.round === 1 ? { reply: "已找到", action: { type: "none" } } : { reply: "查询中", tools: [{ name: "search_travel", arguments: { intents: [{ kind: "semantic", query: `杭州茶馆${input.round}` }] } }] });
    const result = await chat(A, { conversationId, messageId: "failed_search_correct", text: publicSearchText }, new AbortController().signal, () => {});
    assert.equal(searches, 1); assert.match(result.content, /未完成检索/);
  } finally { f.sqlite.close(); }
  const { runAgentToolLoop } = loadModule("lib/agent/tool-loop.ts");
  let rounds = 0;
  const result = await runAgentToolLoop({ signal: new AbortController().signal, ask: async () => ++rounds < 6 ? { tools: [{ name: "read_memory", arguments: {} }] } : { reply: "无效", action: { type: "none" } }, execute: async () => [], validateFinal: () => { throw { code: "INVALID_AGENT_OUTPUT" }; }, recoverFinal: () => ({ reply: "安全摘要", action: null }) });
  assert.equal(rounds, 6); assert.equal(result.reply, "安全摘要");
});

test("normal read-only search replies distinguish failed or unknown searches from empty results", async () => {
  for (const state of ["empty", "failed", "unknown", "thrown"]) {
    const f = fixture({ searchTravel: async () => { if (state === "thrown") throw new Error("SEARCH_NETWORK_FAILURE"); return { offers: [], receipts: [{ state }], searchedAt: searchOffer.retrievedAt }; } });
    try {
      const conversationId = await f.store.createConversation(A, null);
      const chat = f.chatWith(async input => input.round === 0
        ? { reply: "检索中", tools: [{ name: "search_travel", arguments: { intents: [{ kind: "semantic", query: "杭州茶馆" }] } }] }
        : { reply: "已搜索成功，未找到茶馆", action: null, blocks: [{ type: "question", title: "希望哪天出发？", input: "date" }] });
      const result = await chat(A, { conversationId, messageId: `honest_search_${state}`, text: publicSearchText }, new AbortController().signal, () => {});
      assert.match(result.content, state === "empty" ? /没有找到匹配结果/ : state === "thrown" ? /未完成检索/ : /检索未完成/);
      assert.doesNotMatch(result.content, /已搜索成功/);
      if (state !== "empty") assert.doesNotMatch(result.content, /没有找到匹配结果/);
      assert.ok(result.blocks.some(block => block.type === "question"));
      assert.equal(result.card, undefined);
    } finally { f.sqlite.close(); }
  }
});

test("multi-round source blocks persist, partial failures remain visible, and saved offers retain verified provenance", async () => {
  let queries = 0;
  const f = fixture({ searchTravel: async () => { queries++; return { offers: [searchOffer], receipts: [{ state: "completed" }, { state: "failed" }], searchedAt: searchOffer.retrievedAt }; } });
  try {
    const j = await f.create(), conversationId = await f.store.createConversation(A, j.id);
    const chat = f.chatWith(async input => input.round === 0 ? { reply: "正在找合适的地方", tools: [{ name: "search_travel", arguments: { intents: [{ kind: "poi", city: "杭州" }] } }] } : { reply: "找到一个可以参考的地点。", blocks: [{ type: "offers", offers: [{ ...searchOffer, name: "编造的酒店" }] }, { type: "question", title: "想安排哪一天？", input: "date" }] });
    const result = await chat(A, { conversationId, messageId: "offers_message_01", text: "找附近博物馆" }, new AbortController().signal, () => {});
    assert.equal(queries, 1);
    assert.equal(result.blocks.find(block => block.type === "offers").offers[0].name, searchOffer.name);
    assert.equal(result.blocks.filter(block => block.type === "offers").length, 1);
    assert.match(result.blocks.find(block => block.type === "status").title, /部分检索/);
    assert.ok((await f.store.listMessages(A, conversationId)).at(-1).blocks.some(block => block.type === "question"));
    await f.collections.mutateJourneyCollection(A, j.id, { operation: "save_offer", messageId: result.id, offerId: searchOffer.id, expectedVersion: j.version });
    const saved = (await f.collections.listJourneyCollections(A, j.id))[0];
    assert.equal(saved.sourceUrl, searchOffer.url);
    assert.equal(saved.retrievedAt, searchOffer.retrievedAt);
    await assert.rejects(f.collections.mutateJourneyCollection(A, j.id, { operation: "save_offer", messageId: "missing", offerId: searchOffer.id, expectedVersion: j.version }), e => e.code === "OFFER_NOT_FOUND");
  } finally { f.sqlite.close(); }
});

test("a failed final reply preserves completed source cards for refresh without repeating paid work", async () => {
  let queries = 0, calls = 0;
  const f = fixture({ searchTravel: async () => { queries++; return { offers: [searchOffer], receipts: [{ state: "completed" }], searchedAt: searchOffer.retrievedAt }; } });
  try {
    const j = await f.create(), conversationId = await f.store.createConversation(A, j.id);
    const chat = f.chatWith(async () => {
      if (++calls === 1) return { reply: "查询中", tools: [{ name: "search_travel", arguments: { intents: [{ kind: "poi", city: "杭州" }] } }] };
      throw new Error("MODEL_TIMEOUT");
    });
    const input = { conversationId, messageId: "partial_sources_01", text: "找一个博物馆" };
    await assert.rejects(chat(A, input, new AbortController().signal, () => {}));
    const recovered = await chat(A, input, new AbortController().signal, () => {});
    assert.ok(recovered.error);
    assert.equal(recovered.blocks.find(block => block.type === "offers").offers[0].url, searchOffer.url);
    assert.equal(queries, 1); assert.equal(calls, 2);
  } finally { f.sqlite.close(); }
});

test("a failed confirmed write is persisted as failed rather than displayed as applied", async () => {
  const f = fixture();
  try {
    const j = await f.create(), conversationId = await f.store.createConversation(A, j.id);
    const chat = f.chatWith(async () => ({ reply: "已标记", action: { type: "collection", journeyId: j.id, version: j.version, operation: "check", id: "nonexistent-checklist-item", checked: true } }));
    const message = await chat(A, { conversationId, messageId: "failed_checklist_1", text: "标记清单项完成" }, new AbortController().signal, () => {});
    await assert.rejects(f.actions.decideAction(A, message.card.id, { decision: "apply" }));
    const persisted = (await f.store.listMessages(A, conversationId)).at(-1);
    assert.equal(persisted.card.state, "failed");
    assert.equal((await f.collections.listJourneyCollections(A, j.id)).length, 0);
  } finally { f.sqlite.close(); }
});

test("chat reads today's actual body context and records feedback against its own adjustment after confirmation", async () => {
  const f = fixture();
  try {
    let j = await f.create();
    await f.db.prepare("UPDATE journeys SET status='active' WHERE id=?").bind(j.id).run();
    j = await f.journeys.getJourney(A, j.id);
    await f.body.recordBodyCheckIn(A, j.id, { fatigue: 4, stress: null, tags: ["legs_tired"], consent: true }, "body_context_check");
    const localDate = (await f.body.listBodyCheckIns(A, j.id)).localDate;
    await f.db.prepare("INSERT INTO journey_adjustments(id,account_id,journey_id,job_id,payload_json) VALUES(?,?,?,?,?)").bind("adjustment_001", A, j.id, "job-adjustment_001", JSON.stringify({ id: "adjustment_001", appliedAt: new Date().toISOString(), localDate, beforeVersion: j.version - 1, afterVersion: j.version, fatigueBefore: 4, changes: [{ id: "rest", title: "加入休息", angle: "recover", templates: ["add_stop"] }] })).run();
    const conversationId = await f.store.createConversation(A, j.id);
    const chat = f.chatWith(async input => {
      assert.equal(input.bodyContext.current.fatigue, 4);
      assert.equal(input.bodyContext.pendingAdjustments[0].id, "adjustment_001");
      return { reply: "记录感受", action: { type: "feedback", journeyId: j.id, version: j.version, adjustmentId: "adjustment_001", feeling: "still_tired", fatigue: 5, stress: null, note: "走路还是累" } };
    });
    const message = await chat(A, { conversationId, messageId: "feedback_in_chat", text: "还是很累，五分" }, new AbortController().signal, () => {});
    assert.equal((await f.body.listAdjustmentRecords(A, j.id))[0].outcome, null);
    const applied = await f.actions.decideAction(A, message.card.id, { decision: "apply" });
    assert.equal(applied.bodyChanged, true);
    const context = await f.body.journeyBodyContext(A, j.id);
    assert.equal(context.current.fatigue, 5);
    assert.equal(context.recentOutcomes[0].feeling, "still_tired");
    assert.equal(context.pendingAdjustments.length, 0);
  } finally { f.sqlite.close(); }
});

test("a verified conversational result can be added only after confirmation and survives reload as a source", async () => {
  const f = fixture({ searchTravel: async () => ({ offers: [searchOffer], receipts: [{ state: "completed" }], searchedAt: searchOffer.retrievedAt }) });
  try {
    const j = await f.create(), conversationId = await f.store.createConversation(A, j.id);
    const chat = f.chatWith(async input => input.round === 0 ? { reply: "核验来源", tools: [{ name: "search_travel", arguments: { intents: [{ kind: "poi", city: "杭州" }] } }] } : { reply: "拟加入这个地点", action: { type: "edit", journeyId: j.id, version: j.version, operations: [{ type: "add", date: "2030-10-20", time: "13:00", name: searchOffer.name, detail: "下午参观", fixed: false, sourceUrl: searchOffer.url, durationMin: 60 }] } });
    const message = await chat(A, { conversationId, messageId: "verified_add_offer", text: "下午一点增加一个博物馆" }, new AbortController().signal, () => {});
    assert.equal((await f.journeys.getJourney(A, j.id)).plan.plan.itinerary.length, 2);
    const result = await f.actions.decideAction(A, message.card.id, { decision: "apply" });
    assert.ok(result.journey.plan.plan.itinerary.some(activity => activity.sourceUrl === searchOffer.url));
    assert.ok(result.journey.plan.plan.places.some(place => place.url === searchOffer.url));
  } finally { f.sqlite.close(); }
});

test("confirmed chat removal is atomically moved into the journey backlog", async () => {
  const f = fixture();
  try {
    const j = await f.create(), conversationId = await f.store.createConversation(A, j.id);
    const activity = j.plan.plan.itinerary[0];
    const chat = f.chatWith(async () => ({ reply: "减少一项安排", action: { type: "edit", journeyId: j.id, version: j.version, operations: [{ type: "remove", activityId: activity.id }] } }));
    const message = await chat(A, { conversationId, messageId: "remove_to_backlog", text: "取消上午博物馆" }, new AbortController().signal, () => {});
    await f.actions.decideAction(A, message.card.id, { decision: "apply" });
    const pending = await f.collections.listJourneyCollections(A, j.id);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].activity.id, activity.id);
    assert.equal((await f.journeys.getJourney(A, j.id)).plan.plan.itinerary.length, 1);
  } finally { f.sqlite.close(); }
});
