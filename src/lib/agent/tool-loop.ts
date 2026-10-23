import type { AgentToolCall, AgentToolResult } from "./types";

export const MAX_AGENT_ROUNDS = 6;
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
export const AGENT_TOOLS = [
  { name: "get_current_journey", description: "读取当前旅程、版本与真实活动进度", arguments: "{}" },
  { name: "read_memory", description: "读取设置允许使用的旅行记忆", arguments: "{}" },
  { name: "get_body_context", description: "读取当前自评与近期调整结果", arguments: "{}" },
  { name: "search_travel", description: "按意图检索真实旅行产品或地点；不传身体、姓名或记忆原文", arguments: "{intents:[{kind:'flight'|'train'|'hotel'|'poi'|'marriott_hotel'|'marriott_package'|'keyword'|'semantic',city?,origin?,destination?,departureDate?,returnDate?,checkInDate?,checkOutDate?,keyword?,query?}]}" },
  { name: "check_route", description: "核对已检索的交通用时及前后活动缓冲；没有路线依据时明确未知", arguments: "{activityId:string}" },
  { name: "validate_itinerary", description: "服务端校验拟修改的完整安排和固定预约；不实际修改", arguments: "{action:{type:'edit',journeyId,version,operations:[...]}}" },
  { name: "propose_adjustment", description: "读取当前身体感受、预约及习惯，准备调整的依据；需要修改时输出action确认卡", arguments: "{}" },
  { name: "get_collections", description: "读取当前旅程待安排和旅行清单", arguments: "{}" },
] as const;

export function toolCalls(raw: unknown): AgentToolCall[] {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { tools?: unknown }).tools)) return [];
  return ((raw as { tools: unknown[] }).tools).slice(0, 2).map(call => {
    if (!call || typeof call !== "object") throw new Error("INVALID_TOOL_CALL");
    const v = call as Record<string, unknown>;
    if (typeof v.name !== "string" || !AGENT_TOOLS.some(tool => tool.name === v.name) || !v.arguments || typeof v.arguments !== "object" || Array.isArray(v.arguments) || JSON.stringify(v.arguments).length > 6000) throw new Error("INVALID_TOOL_CALL");
    return { name: v.name, arguments: v.arguments as Record<string, unknown> };
  });
}

/** Bounded model/tool loop. Tools are read-only; final actions remain separately confirmed. */
export async function runAgentToolLoop(input: {
  signal: AbortSignal;
  ask: (results: AgentToolResult[], round: number) => Promise<unknown>;
  execute: (call: AgentToolCall) => Promise<unknown>;
  progress?: (text: string) => void;
  validateFinal?: (answer: unknown, correcting: boolean) => unknown;
  recoverFinal?: () => unknown;
  canSearchDuringCorrection?: () => boolean;
}): Promise<unknown> {
  const results: AgentToolResult[] = [], cache = new Map<string, AgentToolResult>();
  let correcting = false;
  for (let round = 0; round < MAX_AGENT_ROUNDS; round++) {
    input.signal.throwIfAborted();
    const answer = await input.ask(results, round);
    const calls = toolCalls(answer);
    if (!calls.length) {
      try { return input.validateFinal ? input.validateFinal(answer, correcting) : answer; }
      catch (error) {
        const invalidOutput = error !== null && typeof error === "object" && "code" in error && error.code === "INVALID_AGENT_OUTPUT";
        if (!invalidOutput || !input.recoverFinal) throw error;
        if (correcting || round === MAX_AGENT_ROUNDS - 1) return input.recoverFinal();
        correcting = true;
        results.push({ name: "validate_answer", status: "error", data: { code: "INVALID_AGENT_OUTPUT", message: "最终回复缺少实际执行依据，或格式/操作无效。仅纠正一次：明确要求本轮搜索但尚未调用时，必须用 tools 实际检索，不可复用历史结果；检索不能写到 action。若已有本轮检索回执则复用，不得新增搜索。最终 action=null、memories=[]；无实际检索不能声称已找到。" } });
        input.progress?.("正在整理检索结果…");
        continue;
      }
    }
    if (round === MAX_AGENT_ROUNDS - 1) break;
    for (const call of calls) {
      input.signal.throwIfAborted();
      const fingerprint = JSON.stringify(canonical(call));
      const reusable = call.name === "search_travel";
      if (reusable && cache.has(fingerprint)) { results.push(cache.get(fingerprint)!); continue; }
      if (correcting && reusable && !input.canSearchDuringCorrection?.()) return input.recoverFinal!();
      input.progress?.(call.name === "search_travel" ? "正在寻找适合这段旅程的选择…" : call.name === "check_route" ? "正在核对到下一站的时间…" : "正在核对你的最新安排…");
      let result: AgentToolResult;
      try { result = { name: call.name, status: "ok", data: await input.execute(call) }; }
      catch (error) {
        if (input.signal.aborted) throw error;
        const constrained = error !== null && typeof error === "object" && "message" in error && typeof error.message === "string" && "code" in error && (error.code === "SEARCH_LIMIT" || error.code === "SEARCH_KIND_RESTRICTED");
        result = { name: call.name, status: "error", data: constrained ? { code: error.code, message: error.message } : { message: "这项查询暂未完成，请使用已返回的结果或说明缺失项。" } };
      }
      if (reusable) cache.set(fingerprint, result);
      results.push(result);
    }
  }
  if (correcting && input.recoverFinal) return input.recoverFinal();
  return { reply: "已完成这一轮核对。你可以查看下方已找到的结果，或补充一个更具体的要求继续。", action: null, memories: [] };
}
