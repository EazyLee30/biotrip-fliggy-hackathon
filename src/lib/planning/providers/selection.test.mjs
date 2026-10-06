import assert from "node:assert/strict";
import { test } from "node:test";
import { loadModule } from "../../test-support/module-loader.mjs";

const agent = { agentId: "agent", environmentId: "env", localInfoAgentId: "local", localInfoEnvironmentId: "local-env",
  composeAgentId: "composer", composeEnvironmentId: "compose-env", flyaiVaultId: "vault",
};
function providerModule(mode, config, transport) {
  return loadModule("lib/planning/providers/index.ts", {
    "@/lib/bailian": { getBailianConfig: () => config },
    "./bailian-agent": { createAgentProvider: () => ({ id: "managed_agent" }) },
    "./bailian-model": { getModelTransport: () => transport, createModelProvider: () => ({ id: "model_api" }) },
  }, { process: { env: { BAILIAN_PLANNING_MODE: mode } } });
}
const selection = (mode, config, transport) => providerModule(mode, config, transport).resolvePlanningProvider;
test("automatic selection prefers the configured competition path and allows a configured model fallback", () => {
  assert.equal(selection("auto", agent, {})().id, "managed_agent");
  assert.equal(selection("auto", null, {})().id, "model_api");
});
test("pinned modes never quietly change transport when configuration is missing", () => {
  assert.throws(selection("managed", null, {}), /Managed Agents/);
  assert.throws(selection("model", agent, null), /model API/);
  assert.throws(selection("invalid", agent, {}), /Invalid/);
});

test("managed selection requires the dedicated composer, local search and FlyAI Vault", () => {
  for (const missing of ["composeAgentId", "localInfoAgentId", "localInfoEnvironmentId", "flyaiVaultId", "agentId", "environmentId"]) {
    const incomplete = { ...agent, [missing]: null };
    assert.equal(selection("auto", incomplete, {})().id, "model_api");
    assert.throws(selection("auto", incomplete, null), /No Bailian/);
    assert.throws(selection("managed", incomplete, {}), /Managed Agents/);
    assert.equal(providerModule("auto", incomplete, {}).planningTransportAvailability().managedAgent, false);
  }
  assert.equal(providerModule("managed", agent, {}).planningTransportAvailability().managedAgent, true);
  assert.equal(providerModule("managed", agent, {}).planningTransportAvailability().composeAgent, true);
  // A health interpretation may degrade, and environments may be reused.
  assert.equal(selection("managed", { ...agent, composeEnvironmentId: null }, {})().id, "managed_agent");
});

test("composer configuration resolves only its environment fallback and keeps a dedicated agent ID", () => {
  const env = {
    BAILIAN_API_KEY: "local-fake-credential", BAILIAN_WORKSPACE_ID: "workspace", BAILIAN_AGENT_ID: "travel",
    BAILIAN_ENVIRONMENT_ID: "travel-env", BAILIAN_INSIGHT_ENVIRONMENT_ID: "health-env",
    BAILIAN_COMPOSE_AGENT_ID: "dedicated-compose", BAILIAN_COMPOSE_ENVIRONMENT_ID: "compose-env",
  };
  const configFor = (patch) => loadModule("lib/bailian.ts", {}, { process: { env: { ...env, ...patch } } }).getBailianConfig();
  assert.equal(configFor({}).composeEnvironmentId, "compose-env");
  assert.equal(configFor({ BAILIAN_COMPOSE_ENVIRONMENT_ID: "" }).composeEnvironmentId, "health-env");
  const fallback = configFor({ BAILIAN_COMPOSE_ENVIRONMENT_ID: "", BAILIAN_INSIGHT_ENVIRONMENT_ID: "" });
  assert.equal(fallback.composeEnvironmentId, "travel-env");
  assert.equal(fallback.composeAgentId, "dedicated-compose");
  assert.equal(configFor({ BAILIAN_COMPOSE_AGENT_ID: "" }).composeAgentId, null);
});
