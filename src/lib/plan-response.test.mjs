import assert from "node:assert/strict";
import { test } from "node:test";
import { planEventStream } from "./plan-response.ts";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("long-running generation emits immediate connection, heartbeats, progress and the original result", async () => {
  const request = new AbortController();
  const result = { source: "live", plan: { adjustments: [] } };
  const response = planEventStream(async (progress) => {
    progress({ stage: "local_info", message: "正在检索目的地" });
    await sleep(55);
    progress({ stage: "flyai_planning" });
    return Response.json(result);
  }, () => assert.fail("completed generation must not be cancelled"), request.signal, 10);
  assert.equal(response.headers.get("Content-Type"), "text/event-stream; charset=utf-8");
  assert.match(response.headers.get("Cache-Control"), /no-store/);
  const reader = response.body.getReader();
  const first = await reader.read();
  assert.equal(new TextDecoder().decode(first.value), ": connected\n\n");
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += new TextDecoder().decode(value);
  }
  assert.ok((text.match(/: keepalive/g) ?? []).length >= 2);
  assert.match(text, /event: progress\ndata: {"stage":"local_info","message":"正在检索目的地"}/);
  assert.match(text, /event: result/);
  const last = text.trim().split("\n\n").at(-1);
  assert.deepEqual(JSON.parse(last.split("\ndata: ")[1]), result);
});

test("a generation failure keeps the diagnostic payload in an error event", async () => {
  const failure = { error: "请求失败", diagnostic: { stage: "local_info", code: "AccessDenied", status: 403 } };
  const response = planEventStream(async () => Response.json(failure, { status: 502 }), () => {}, new AbortController().signal);
  const text = await response.text();
  assert.match(text, /event: error/);
  assert.ok(!text.includes("event: result"));
  assert.deepEqual(JSON.parse(text.trim().split("\ndata: ")[1]), failure);
});

test("cancelling the response aborts upstream work and allows its finally cleanup", async () => {
  const request = new AbortController();
  const upstream = new AbortController();
  let cleanedUp = false;
  let settle;
  const cleanup = new Promise((resolve) => { settle = resolve; });
  const response = planEventStream(async () => {
    try {
      await new Promise((_, reject) => upstream.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    } finally {
      cleanedUp = true;
      settle();
    }
    return Response.json({});
  }, () => upstream.abort(), request.signal);
  const reader = response.body.getReader();
  await reader.read();
  await reader.cancel();
  await cleanup;
  assert.equal(upstream.signal.aborted, true);
  assert.equal(cleanedUp, true);
});

test("request disconnection closes the stream and cancels pending generation", async () => {
  const request = new AbortController();
  let aborts = 0;
  let settle;
  const pending = new Promise((resolve) => { settle = resolve; });
  const response = planEventStream(async () => {
    await pending;
    return Response.json({ source: "live" });
  }, () => { aborts += 1; settle(); }, request.signal);
  const reader = response.body.getReader();
  await reader.read();
  request.abort();
  assert.equal((await reader.read()).done, true);
  assert.equal(aborts, 1);
});

test("already disconnected requests never start planning", async () => {
  const request = new AbortController();
  request.abort();
  let calls = 0;
  const response = planEventStream(async () => { calls += 1; return Response.json({}); }, () => {}, request.signal);
  assert.equal(await response.text(), "");
  assert.equal(calls, 0);
});
