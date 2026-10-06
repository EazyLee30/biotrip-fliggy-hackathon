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
  if (!["auto", "managed", "model"].includes(mode)) throw new Error("Invalid Bailian planning mode.");
  const config = getBailianConfig();
  const agentsUsable = Boolean(
    config?.agentId && config?.environmentId &&
    config?.localInfoAgentId && config?.localInfoEnvironmentId &&
    config?.composeAgentId && (config?.composeEnvironmentId || config?.insightEnvironmentId || config?.environmentId) &&
    config?.flyaiVaultId,
  );

  const transport = getModelTransport();
  if (mode === "managed") {
    if (config && agentsUsable) return createAgentProvider(config);
    throw new Error("Managed Agents are not configured.");
  }
  if (mode === "model") {
    if (transport) return createModelProvider(transport);
    throw new Error("Bailian model API is not configured.");
  }
  if (config && agentsUsable) return createAgentProvider(config);
  if (transport) return createModelProvider(transport);
  throw new Error("No Bailian planning transport is configured.");
}

export function planningTransportAvailability() {
  const config = getBailianConfig();
  return {
    managedAgent: Boolean(config?.agentId && config?.environmentId && config?.flyaiVaultId &&
      config?.localInfoAgentId && config?.localInfoEnvironmentId && config?.composeAgentId &&
      (config?.composeEnvironmentId || config?.insightEnvironmentId || config?.environmentId)),
    mobilityAgent: Boolean(config?.mobilityAgentId && config?.mobilityEnvironmentId && config?.mobilityMcpServerId),
    composeAgent: Boolean(config?.composeAgentId && (config?.composeEnvironmentId || config?.insightEnvironmentId || config?.environmentId)),
    localInfoAgent: Boolean(config?.localInfoAgentId && config?.localInfoEnvironmentId),
    insightAgent: Boolean(config?.insightAgentId && config?.insightEnvironmentId),
    modelApi: Boolean(getModelTransport()),
    mode: process.env.BAILIAN_PLANNING_MODE || "auto",
  };
}
