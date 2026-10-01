import { timingSafeEqual } from "node:crypto";
import { bailianBaseUrl, bailianRequest, deleteBailianSession, getBailianConfig } from "@/lib/bailian";
import { consumeAgentResponse, AgentStreamError } from "@/lib/bailian-output";
import { createToolEvidence } from "@/lib/bailian-evidence";
import { planEventStream } from "@/lib/plan-response";
import { forwardFlyaiSearch } from "@/lib/flyai";

function authorized(request: Request) {
  const expected = process.env.BIOTRIP_DIAGNOSTIC_TOKEN;
  const actual = request.headers.get("Authorization")?.replace(/^Bearer /, "") ?? "";
  return Boolean(expected && actual.length === expected.length && timingSafeEqual(Buffer.from(actual), Buffer.from(expected)));
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return new Response(null, { status: 404 });
  }
  const config = getBailianConfig();
  if (!config) return Response.json({ configured: false });
  const response = await bailianRequest(config, "/agents?limit=10");
  const value = await response.json() as Record<string, unknown>;
  const result = {
    configured: true,
    workspace: config.workspaceId,
    region: config.region,
    status: response.status,
    requestId: response.headers.get("x-request-id") ?? value.request_id,
    code: value.code,
    message: typeof value.message === "string" ? value.message.replaceAll(config.apiKey, "[redacted]").slice(0, 1000) : undefined,
    agents: Array.isArray(value.data) ? value.data.map((agent: Record<string, unknown>) => ({ id: agent.id, name: agent.name, model: agent.model })) : undefined,
  };
  // A fixed, tiny model request distinguishes model access from Managed Agent resource access.
  if (response.status === 403) {
    const modelResponse = await fetch(`${bailianBaseUrl(config).replace(/\/api\/v1\/agentstudio$/, "")}/compatible-mode/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "qwen3.8-flash", messages: [{ role: "user", content: "Reply only OK." }], max_tokens: 8, enable_thinking: false }),
      signal: AbortSignal.timeout(30_000),
    });
    const modelValue = await modelResponse.json() as Record<string, unknown>;
    const modelError = typeof modelValue.error === "object" && modelValue.error ? modelValue.error as Record<string, unknown> : {};
    return Response.json({ ...result, modelCheck: { status: modelResponse.status, requestId: modelResponse.headers.get("x-request-id") ?? modelValue.request_id, code: modelError.code, message: typeof modelError.message === "string" ? modelError.message.replaceAll(config.apiKey, "[redacted]").slice(0, 1000) : undefined, answered: Array.isArray(modelValue.choices) && modelValue.choices.length > 0 } }, { headers: { "Cache-Control": "no-store, private" } });
  }
  return Response.json(result, { headers: { "Cache-Control": "no-store, private" } });
}

// Temporary fixed diagnostics: no arbitrary URLs, prompts, code, or credentials.
export async function POST(request: Request) {
  if (!authorized(request)) return new Response(null, { status: 404 });
  const config = getBailianConfig();
  if (!config) return Response.json({ configured: false });
  const input: unknown = await request.json().catch(() => null);
  const action = input && typeof input === "object" && "action" in input ? input.action : null;
  if (action === "upstream") {
    const key = process.env.FLYAI_API_KEY;
    const signingSecret = process.env.FLYAI_SIGN_SECRET;
    if (!key || !signingSecret) return Response.json({ error: "MISSING_CONFIG" });
    try {
      const response = await forwardFlyaiSearch(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "fliggy_fast_search", arguments: { query: "杭州西湖景点门票" } } }), request, key, signingSecret);
      return Response.json({ action, status: response.status });
    } catch (error) {
      return Response.json({ action, error: error instanceof Error ? error.name : "Unknown", message: error instanceof Error ? error.message.replaceAll(key, "[redacted]").replaceAll(signingSecret, "[redacted]").slice(0, 240) : null });
    }
  }
  if (action === "bridge") {
    const listed = await bailianRequest(config, `/vaults/${config.flyaiVaultId}/credentials`);
    const list = await listed.json() as { data?: Array<{ id: string; auth: Record<string, unknown>; display_name?: string; metadata?: unknown }> };
    const credential = list.data?.find((item) => item.auth.secret_name === "FLYAI_API_KEY");
    if (!listed.ok || !credential) return Response.json({ action, status: listed.status, error: "CREDENTIAL_NOT_FOUND" }, { status: 502 });
    const response = await bailianRequest(config, `/vaults/${config.flyaiVaultId}/credentials/${credential.id}`, { method: "POST", body: JSON.stringify({ display_name: credential.display_name, auth: { ...credential.auth, networking: { allowed_hosts: ["flyai.open.fliggy.com", "biotrip.ccwu.cc"] }, injection_location: { header: true } }, metadata: credential.metadata }) });
    return Response.json({ action, status: response.status, credentialId: credential.id });
  }
  if (action === "tune") {
    const agents = [
      { id: config.insightAgentId, maxTokens: 512 },
      { id: config.localInfoAgentId, maxTokens: 4096 },
      { id: config.agentId, maxTokens: 8192 },
    ];
    const updated = [];
    for (const agent of agents) {
      if (!agent.id) continue;
      const response = await bailianRequest(config, `/agents/${agent.id}`);
      if (!response.ok) return Response.json({ action, status: response.status }, { status: 502 });
      const value = await response.json() as Record<string, unknown>;
      if (!value.model || typeof value.model !== "object" || !value.version) return Response.json({ action, error: "INVALID_AGENT_CONFIG" }, { status: 502 });
      // Agent updates are full replacements, so preserve all documented fields.
      const body: Record<string, unknown> = {};
      for (const key of ["version", "name", "description", "system", "tools", "mcp_servers", "skills", "multiagent", "metadata"]) {
        if (key in value) body[key] = value[key];
      }
      body.model = { ...value.model, enable_thinking: false, max_tokens: agent.maxTokens };
      if (agent.id === config.localInfoAgentId && typeof value.system === "string") {
        body.system = `${value.system}\n\nBioTrip 运行约束：只查询用户本轮要求的当地服务。合并查询，最多四次 web_search；已经获取结果后不再补充搜索其它类别。最多六条结果，来源 URL 从本轮工具结果原样复制。完成后立即返回用户要求的 JSON，不继续探索。`;
      }
      if (agent.id === config.agentId && typeof value.system === "string") {
        body.system = `${value.system}\n\nBioTrip 当前 FlyAI 连接：每次只读 CLI 搜索必须使用 DEBUG_FLYAI_MCP_URL=https://biotrip.ccwu.cc/api/flyai/mcp 前缀，通过 Worker 验证 Vault 注入的 Authorization 后重签到官方飞猪 API。不要直接调用旧地址。最多四次搜索，不探测环境、凭证、安装或登录。返回最终 JSON。`;
      }
      const saved = await bailianRequest(config, `/agents/${agent.id}`, { method: "POST", body: JSON.stringify(body) });
      const result = await saved.json() as Record<string, unknown>;
      updated.push({ id: agent.id, status: saved.status, version: result.version, model: result.model, systemType: typeof value.system });
      if (!saved.ok) break;
    }
    return Response.json({ action, updated }, { headers: { "Cache-Control": "no-store, private" } });
  }
  if (action !== "probe") return new Response(null, { status: 400 });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  const started = Date.now();
  return planEventStream(async (progress) => {
    let sessionId: string | null = null;
    try {
      progress({ stage: "flyai_inventory" });
      const created = await bailianRequest(config, "/sessions", { method: "POST", signal: controller.signal, body: JSON.stringify({ agent: config.agentId, environment_id: config.environmentId, vault_ids: [config.flyaiVaultId], title: "BioTrip disposable FlyAI diagnostic" }) });
      if (!created.ok) return Response.json({ error: "SESSION_CREATE", status: created.status }, { status: 502 });
      const value = await created.json() as { id: string };
      sessionId = value.id;
      const stream = await bailianRequest(config, `/sessions/${sessionId}/events/stream`, { signal: controller.signal, headers: { Accept: "text/event-stream" } });
      const submitted = await bailianRequest(config, `/sessions/${sessionId}/events`, { method: "POST", signal: controller.signal, body: JSON.stringify({ input: [{ role: "user", type: "message", content: [{ type: "text", text: '这是只读诊断。官方 flyai 已预装，不要 help、env、安装或配置。只执行一次 bash: DEBUG_FLYAI_MCP_URL=https://biotrip.ccwu.cc/api/flyai/mcp flyai keyword-search --query "杭州西湖景点门票"。不要显示任何凭证。若失败不要重试。最终只返回 JSON：{"completed":true}。' }] }] }) });
      if (!submitted.ok) return Response.json({ error: "EVENT_SUBMIT", status: submitted.status }, { status: 502 });
      const evidence = createToolEvidence("flyai_inventory");
      await consumeAgentResponse(stream, controller, (event) => {
        console.info("[BioTrip fixed probe]", { sessionId, elapsedMs: Date.now() - started, ...event });
      }, evidence);
      const result = evidence.result();
      return Response.json({ action, seconds: Math.round((Date.now() - started) / 1000), ...result });
    } catch (error) {
      return Response.json({ action, seconds: Math.round((Date.now() - started) / 1000), error: error instanceof AgentStreamError ? error.code : controller.signal.aborted ? "TIMEOUT" : "PROBE_ERROR" }, { status: 502 });
    } finally {
      clearTimeout(timer);
      controller.abort();
      if (sessionId) await deleteBailianSession(config, sessionId);
    }
  }, () => controller.abort(), request.signal);
}
