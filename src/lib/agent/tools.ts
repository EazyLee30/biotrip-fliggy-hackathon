import { getJourney, JourneyError } from "@/lib/journeys";
import { journeyBodyContext } from "@/lib/body-journey";
import { listJourneyCollections } from "@/lib/journey-collections";
import { searchTravel } from "@/lib/travel-search";
import { validateAnswer, actionPreview } from "./contract";
import type { AgentToolCall, AssistantBlock } from "./types";
import type { MemoryItem } from "./memory-types";
import { memorySettings } from "./memory";
import type { AgentSearchPolicy } from "./search-policy";

export function createAgentTools(input: { accountId: string; journeyId: string | null; memories: MemoryItem[]; signal: AbortSignal; requestId: string; searchPolicy: AgentSearchPolicy; allowMemory: boolean; allowBody: boolean }) {
  const blocks: AssistantBlock[] = [];
  const verifiedSources = new Set<string>();
  let searchCount = 0;
  const journey = () => input.journeyId ? getJourney(input.accountId, input.journeyId) : Promise.resolve(null);
  const body = () => input.allowBody && input.journeyId ? journeyBodyContext(input.accountId, input.journeyId) : Promise.resolve(null);
  return {
    blocks, verifiedSources, body,
    get hasSearched() { return searchCount > 0; },
    async execute(call: AgentToolCall): Promise<unknown> {
      input.signal.throwIfAborted();
      if (call.name === "read_memory") return input.allowMemory && (await memorySettings(input.accountId)).useMemory ? input.memories : [];
      if (call.name === "get_body_context") return body();
      if (call.name === "search_travel") {
        const intents = Array.isArray(call.arguments.intents) ? call.arguments.intents : [call.arguments.intents];
        if (!intents.length || intents.length + searchCount > input.searchPolicy.maxQueries) throw new JourneyError(400, "SEARCH_LIMIT", `本轮最多执行 ${input.searchPolicy.maxQueries} 项搜索，不能额外检索或自动换工具重试。请使用已有结果，并说明尚未找到的内容。`);
        const allowed = input.searchPolicy.allowedKinds;
        if (allowed?.length && intents.some(intent => !intent || typeof intent !== "object" || !allowed.includes(intent.kind))) throw new JourneyError(400, "SEARCH_KIND_RESTRICTED", `本轮用户仅允许 ${allowed.join(" / ")} 搜索，不能改用其他搜索类型。`);
        searchCount += intents.length;
        const result = await searchTravel(input.accountId, intents, input.signal, `${input.requestId}:${searchCount}`);
        const offers = result.offers.slice(0, 6);
        const failed = result.receipts.filter(receipt => receipt.state === "failed" || receipt.state === "unknown").length;
        const detail = [...new Set(result.receipts.map(receipt => receipt.detail).filter((value): value is string => Boolean(value)))].join(" ").slice(0, 1000);
        if (failed) blocks.push({ type: "status", title: "部分检索暂未完成", detail: detail || `有 ${failed} 项查询尚无可核验结果。${offers.length ? "下方保留已找到的选择。" : "可以稍后重试，或调整搜索条件。"}` });
        else if (!offers.length) blocks.push({ type: "status", title: "这次没有匹配结果", detail: detail || "可以放宽日期、位置或关键词再找一次。" });
        else if (detail) blocks.push({ type: "status", title: "检索说明", detail });
        offers.forEach(offer => verifiedSources.add(offer.url));
        if (offers.length) blocks.push({ type: "offers", title: "为这段旅程找到的选择", offers });
        return { ...result, offers };
      }
      const latest = await journey();
      if (call.name === "get_current_journey") return latest ? { id: latest.id, version: latest.version, status: latest.status, trip: latest.draft.trip, itinerary: latest.plan?.plan.itinerary } : null;
      if (!latest) throw new JourneyError(400, "JOURNEY_REQUIRED", "请先选择一段旅程。");
      if (call.name === "get_collections") {
        const items = await listJourneyCollections(input.accountId, latest.id);
        blocks.push({ type: "checklist", title: items.length > 20 ? "最近的清单与待安排" : "旅行清单与待安排", items: items.slice(0, 20) });
        return { total: items.length, items: items.slice(0, 40).map(item => ({ id: item.id, title: item.title, detail: item.detail.slice(0, 160), kind: item.kind, checked: item.checked })) };
      }
      if (call.name === "propose_adjustment") return { version: latest.version, body: await body(), itinerary: latest.plan?.plan.itinerary, note: "保留固定预约和实际进度，只为用户提出修改；需要新地点先检索。" };
      if (call.name === "check_route") {
        const rows = latest.plan?.plan.itinerary ?? [];
        const index = rows.findIndex(row => row.id === call.arguments.activityId), activity = rows[index];
        if (!activity) throw new JourneyError(400, "ACTIVITY_NOT_FOUND", "无法定位该活动。");
        const previous = index > 0 && rows[index - 1].date === activity.date ? rows[index - 1] : null;
        const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
        const availableMinutes = previous ? minutes(activity.time) - minutes(previous.time) - (previous.durationMin ?? 0) : null;
        const verified = activity.move?.basis === "amap" && typeof activity.move.minutes === "number";
        return { from: previous?.name ?? null, to: activity.name, availableMinutes, verified, travelMinutes: verified ? activity.move!.minutes : null, canReach: verified && availableMinutes !== null ? availableMinutes >= activity.move!.minutes! : null, note: verified ? "来源于已检索的高德路线，不保证实时路况。" : "尚无核验路线，不能声称一定赶得上；可通过consult准备含路线的候选方案。" };
      }
      if (call.name === "validate_itinerary") {
        const answer = validateAnswer({ reply: "核对调整", action: call.arguments.action }, latest, [...verifiedSources]);
        if (!answer.action || answer.action.type !== "edit") throw new JourneyError(400, "INVALID_ACTION", "仅支持核验行程修改。");
        return { valid: true, version: latest.version, changes: actionPreview(answer.action, latest) };
      }
      throw new JourneyError(400, "UNKNOWN_TOOL", "不支持该工具。");
    },
  };
}
