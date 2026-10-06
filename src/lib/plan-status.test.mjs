import assert from "node:assert/strict";
import { test } from "node:test";
import { loadModule } from "./test-support/module-loader.mjs";
const status = (mode, availability, signedIn = true) => loadModule("app/api/plan/status/route.ts", {
  "next/server": { NextResponse: Response },
  "@/lib/auth": { getCurrentAccount: async () => signedIn ? { id: "qa" } : null },
  "@/lib/planning/providers": { planningTransportAvailability: () => ({ mode, ...availability }) },
}, { process: { env: { FLYAI_API_KEY: "test-only", FLYAI_SIGN_SECRET: "test-only" } } });
test("readiness follows pinned transport and does not require degradable health", async () => {
  for (const [mode, availability, ready] of [
    ["managed", { managedAgent: false, modelApi: true }, false],
    ["model", { managedAgent: true, modelApi: false }, false],
    ["managed", { managedAgent: true, modelApi: false, insightAgent: false }, true],
    ["auto", { managedAgent: false, modelApi: true }, true],
    ["invalid", { managedAgent: true, modelApi: true }, false],
  ]) assert.deepEqual(await (await status(mode, availability).GET()).json(), { ready });
});
test("anonymous readiness checks remain protected", async () => {
  assert.equal((await status("auto", { managedAgent: true }, false).GET()).status, 401);
});
