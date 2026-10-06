import assert from "node:assert/strict";
import { test } from "node:test";
import { loadModule, plain } from "./test-support/module-loader.mjs";

const config = { apiKey: "test-only-secret", workspaceId: "test-workspace", region: "cn-beijing" };

for (const [status, confirmed] of [[200, true], [204, true], [299, true], [404, true], [403, false], [500, false]]) {
  test(`session cleanup only confirms 2xx or already-absent 404: ${status}`, async () => {
    let bodyReads = 0;
    const { deleteBailianSession } = loadModule("lib/bailian.ts", {}, {
      Headers,
      fetch: async (url, options) => {
        assert.equal(url, "https://test-workspace.cn-beijing.maas.aliyuncs.com/api/v1/agentstudio/sessions/sesn_test%2Fencoded");
        assert.equal(options.method, "DELETE");
        assert.ok(options.signal instanceof AbortSignal);
        return {
          status, ok: status >= 200 && status < 300,
          get body() { bodyReads += 1; throw new Error("private-conversation-must-not-be-read"); },
          async json() { bodyReads += 1; throw new Error("private-conversation-must-not-be-read"); },
          async text() { bodyReads += 1; throw new Error("private-conversation-must-not-be-read"); },
        };
      },
    });
    assert.deepEqual(plain(await deleteBailianSession(config, "sesn_test/encoded")), { confirmed, status });
    assert.equal(bodyReads, 0);
  });
}

test("session cleanup reports network failures as unconfirmed without exposing the error", async () => {
  const secretError = "private-provider-error-containing-key-and-dialogue";
  const { deleteBailianSession } = loadModule("lib/bailian.ts", {}, {
    Headers,
    fetch: async () => { throw new Error(secretError); },
    console: { info() { assert.fail("Cleanup helper must not log provider data"); }, error() { assert.fail("Cleanup helper must not log provider data"); } },
  });
  const result = await deleteBailianSession(config, "sesn_test");
  assert.deepEqual(plain(result), { confirmed: false, status: null });
  assert.ok(!JSON.stringify(result).includes(secretError));
  assert.ok(!JSON.stringify(result).includes(config.apiKey));
});
