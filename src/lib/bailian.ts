export type BailianConfig = {
  apiKey: string;
  workspaceId: string;
  agentId: string;
  environmentId: string;
  insightAgentId: string | null;
  insightEnvironmentId: string | null;
  localInfoAgentId: string | null;
  localInfoEnvironmentId: string | null;
  composeAgentId?: string | null;
  composeEnvironmentId?: string | null;
  flyaiVaultId: string | null;
  mobilityAgentId?: string | null;
  mobilityEnvironmentId?: string | null;
  mobilityMcpServerId?: string | null;
  region: string;
};

export function getBailianConfig(): BailianConfig | null {
  const { BAILIAN_API_KEY, BAILIAN_WORKSPACE_ID, BAILIAN_AGENT_ID, BAILIAN_ENVIRONMENT_ID } = process.env;
  if (!BAILIAN_API_KEY || !BAILIAN_WORKSPACE_ID || !BAILIAN_AGENT_ID || !BAILIAN_ENVIRONMENT_ID) {
    return null;
  }
  return {
    apiKey: BAILIAN_API_KEY,
    workspaceId: BAILIAN_WORKSPACE_ID,
    agentId: BAILIAN_AGENT_ID,
    environmentId: BAILIAN_ENVIRONMENT_ID,
    insightAgentId: process.env.BAILIAN_INSIGHT_AGENT_ID || null,
    insightEnvironmentId: process.env.BAILIAN_INSIGHT_ENVIRONMENT_ID || null,
    localInfoAgentId: process.env.BAILIAN_LOCAL_INFO_AGENT_ID || null,
    localInfoEnvironmentId: process.env.BAILIAN_LOCAL_INFO_ENVIRONMENT_ID || null,
    composeAgentId: process.env.BAILIAN_COMPOSE_AGENT_ID || null,
    composeEnvironmentId: process.env.BAILIAN_COMPOSE_ENVIRONMENT_ID || process.env.BAILIAN_INSIGHT_ENVIRONMENT_ID || BAILIAN_ENVIRONMENT_ID,
    mobilityAgentId: process.env.BAILIAN_MOBILITY_AGENT_ID || null,
    mobilityEnvironmentId: process.env.BAILIAN_MOBILITY_ENVIRONMENT_ID || null,
    mobilityMcpServerId: process.env.BAILIAN_MOBILITY_MCP_SERVER_ID || null,
    flyaiVaultId: process.env.BAILIAN_FLYAI_VAULT_ID || null,
    region: process.env.BAILIAN_REGION || "cn-beijing",
  };
}

export function bailianBaseUrl(config: BailianConfig) {
  return `https://${config.workspaceId}.${config.region}.maas.aliyuncs.com/api/v1/agentstudio`;
}

export async function bailianRequest(config: BailianConfig, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${config.apiKey}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(`${bailianBaseUrl(config)}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(30_000),
  });
  return response;
}

export type BailianSessionCleanup = { confirmed: boolean; status: number | null };

export async function deleteBailianSession(config: BailianConfig, sessionId: string): Promise<BailianSessionCleanup> {
  try {
    const response = await bailianRequest(config, `/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
      signal: AbortSignal.timeout(10_000),
    });
    // Status is sufficient; the response body can contain conversation details.
    return { confirmed: response.ok || response.status === 404, status: response.status };
  } catch {
    // Cleanup cannot replace the planning result, but a network failure is not
    // confirmation that the provider removed the session. Never expose errors.
    return { confirmed: false, status: null };
  }
}
