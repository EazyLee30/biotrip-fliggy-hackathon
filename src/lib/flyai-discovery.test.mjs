import assert from "node:assert/strict";
import { test } from "node:test";
import { loadModule, plain } from "./test-support/module-loader.mjs";

function fixture(reply, contentType = "application/json") {
  const calls = [], logs = [];
  const api = loadModule("lib/flyai.ts", {
    "./upstream-response": { readBoundedUpstream: async response => response.text() },
    "./planning/flyai-sources": { extractFlyaiSources: data => data.sources ?? [] },
  }, {
    Headers, Response,
    console: { info(...values) { logs.push(values); } },
    process: { env: { FLYAI_API_KEY: "fake-key", FLYAI_SIGN_SECRET: "fake-secret" } },
    fetch: async (url, init) => { const request = JSON.parse(init.body); calls.push({ url, request, headers: init.headers, redirect: init.redirect }); return new Response(reply(request), { headers: { "Content-Type": contentType } }); },
  });
  return { api, calls, logs, signal: new AbortController().signal };
}
test("schema discovery signs tools/list, follows pagination and never calls a paid search", async () => {
  const f = fixture(request => JSON.stringify({ jsonrpc: "2.0", result: request.params?.cursor
    ? { tools: [{ name: "search_poi", inputSchema: { type: "object", properties: { city: { type: "string" } } } }] }
    : { tools: [{ name: "search_hotels" }], nextCursor: "next" } }));
  const tools = await f.api.listFlyaiTools(f.signal);
  assert.equal(tools.length, 2); assert.equal(f.calls.length, 2);
  assert.deepEqual(plain(f.calls[1].request.params), { cursor: "next" });
  for (const call of f.calls) { assert.equal(call.request.method, "tools/list"); assert.equal(call.headers.get("x-flyai-sign-ver"), "7"); assert.ok(call.headers.get("x-flyai-sign")); assert.equal(call.redirect, "manual"); }
});
test("tools/list supports SSE and refuses malformed or provider error envelopes", async () => {
  const f = fixture(() => 'data: {"jsonrpc":"2.0","result":{"tools":[{"name":"search_poi"}]}}\n\n', "text/event-stream");
  assert.equal((await f.api.listFlyaiTools(f.signal))[0].name, "search_poi");
  for (const response of [{ result: { tools: "invented" } }, { error: { code: -1 } }]) {
    const failed = fixture(() => JSON.stringify(response)); await assert.rejects(failed.api.listFlyaiTools(failed.signal));
  }
});
test("search still requires verified status and uses signed tools/call", async () => {
  const f = fixture(() => JSON.stringify({ result: { content: [{ type: "text", text: JSON.stringify({ status: 0, message: "success", data: { sources: [{ name: "西湖" }] } }) }] } }));
  const result = await f.api.searchFlyai("search_poi", { city: "杭州" }, f.signal, "景点");
  assert.equal(result.verified, true); assert.equal(f.calls[0].request.method, "tools/call"); assert.deepEqual(plain(f.calls[0].request.params.arguments), { city: "杭州" });
  await assert.rejects(f.api.searchFlyai("purchase", {}, f.signal, "景点"), error => error.code === "FLYAI_READ_ONLY");
});

test("successful semantic string data reaches the bounded parser without rejecting the API response", async () => {
  const f = fixture(() => JSON.stringify({ result: { content: [{ type: "text", text: JSON.stringify({ status: 0, message: "success", data: JSON.stringify({ itemList: [] }) }) }] } }));
  assert.equal((await f.api.searchFlyai("fliggy_ai_search", { query: "杭州酒店" }, f.signal, "住宿")).verified, true);
});

test("unverified response diagnostics never log provider prose or echoed credentials", async () => {
  const canary = "provider-echoed-private-marker";
  const f = fixture(() => JSON.stringify({ result: { content: [{ type: "text", text: JSON.stringify({ status: 4, message: canary, systemMessage: canary, data: { [canary]: "unknown" } }) }] } }));
  await assert.rejects(f.api.searchFlyai("search_poi", { cityName: "杭州" }, f.signal, "景点"), error => error.code === "FLYAI_OUTPUT_UNVERIFIED");
  assert.equal(f.logs.length, 1);
  assert.doesNotMatch(JSON.stringify(f.logs), new RegExp(canary));
});
