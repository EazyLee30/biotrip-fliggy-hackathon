import { getBailianConfig } from "@/lib/bailian";
import { createAgentProvider } from "./bailian-agent";
import { createModelProvider, getModelTransport } from "./bailian-model";
import type { PlanningProvider } from "../contract";

/**
 * Transport selection.
 *
 * Managed Agents are the competition-required path and the default whenever they
 * are configured. The plain model API is the cheaper fallback used when agents
 * or the FlyAI Vault are unavailable, so a provider outage degrades latency
 * rather than blocking planning.
 *
 * `BAILIAN_PLANNING_MODE` pins a transport explicitly when the fallback should
 * be disabled; "auto" keeps the preference order below.
 */
export function resolvePlanningProvider(): PlanningProvider {
  const mode = (process.env.BAILIAN_PLANNING_MODE || "auto").trim().toLowerCase();
  const config = getBailianConfig();
  const agentsUsable = Boolean(
    config?.agentId && config?.environmentId &&
    config?.localInfoAgentId && config?.localInfoEnvironmentId &&
    config?.flyaiVaultId,
  );

  if (mode === "managed" || (mode !== "model" && agentsUsable)) {
    if (config && agentsUsable) return createAgentProvider(config);
  }
  const transport = getModelTransport();
  if (transport) return createModelProvider(transport);
  if (config && agentsUsable) return createAgentProvider(config);
  throw new Error("No Bailian planning transport is configured.");
}

export function planningTransportAvailability() {
  const config = getBailianConfig();
  return {
    managedAgent: Boolean(config?.agentId && config?.environmentId && config?.flyaiVaultId),
    localInfoAgent: Boolean(config?.localInfoAgentId && config?.localInfoEnvironmentId),
    insightAgent: Boolean(config?.insightAgentId && config?.insightEnvironmentId),
    modelApi: Boolean(getModelTransport()),
    mode: process.env.BAILIAN_PLANNING_MODE || "auto",
  };
}
