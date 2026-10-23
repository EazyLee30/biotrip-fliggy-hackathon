import { createHash } from "node:crypto";
import { getDatabase } from "@/lib/database";
import { getJourney, JourneyError } from "@/lib/journeys";
import { listJourneyVersions } from "@/lib/journey-versions";
import {
  applicableMemories,
  listMemoryItems,
  memorySettings,
  rememberFromChat,
} from "./memory";
import { getConversation, listMessages } from "./store";
import { askAgent } from "./model";
import { memoryAllowed } from "./blocks";
import { createAgentTools } from "./tools";
import { AGENT_TOOLS, runAgentToolLoop } from "./tool-loop";
import { boundedMemoryContext } from "./memory-context";
import { contextAccessFromText, expectsCurrentSearch, searchIsRestricted, searchPolicyFromText } from "./search-policy";
import {
  actionPreview,
  requiresItineraryApproval,
  validateAnswer,
} from "./contract";
import { decideAction } from "./actions";
import type { ActionCard, AgentAnswer, AgentMessage, AssistantBlock } from "./types";

/** Finalization failures retain only server-owned evidence, never model claims or writes. */
function readOnlyToolAnswer(blocks: AssistantBlock[]): AgentAnswer {
  const offerCount = blocks.reduce((total, block) => total + (block.type === "offers" ? block.offers.length : 0), 0);
  const empty = blocks.some(block => block.type === "status" && block.title === "这次没有匹配结果");
  const incomplete = blocks.some(block => block.type === "status" && block.title === "部分检索暂未完成");
  const reply = offerCount
    ? `本轮检索返回了 ${offerCount} 个有来源的选择，见下方卡片。${incomplete ? "部分查询未完成。" : ""}未执行额外操作。`
    : incomplete ? "这次检索未完成，暂时没有可核验的匹配结果。未执行额外操作。"
      : empty ? "这次检索没有找到匹配结果。未执行额外操作。"
        : "本轮未完成检索，也未执行额外操作。请重新发送具体需求后再试。";
  return { reply, action: null, memories: [] };
}
export async function chat(
  accountId: string,
  raw: unknown,
  signal: AbortSignal,
  onText: (text: string) => void,
  onProgress?: (text: string) => void,
): Promise<AgentMessage> {
  const v = raw as {
    conversationId?: unknown;
    messageId?: unknown;
    text?: unknown;
    includeMemory?: unknown;
  };
  if (
    !v ||
    typeof v.conversationId !== "string" ||
    typeof v.messageId !== "string" ||
    !/^[\w-]{8,100}$/.test(v.messageId) ||
    typeof v.text !== "string" ||
    !v.text.trim() ||
    v.text.length > 4000 ||
    (v.includeMemory !== undefined && typeof v.includeMemory !== "boolean")
  )
    throw new JourneyError(400, "INVALID_CHAT", "请填写 1–4000 字的对话。");
  const conversation = await getConversation(accountId, v.conversationId);
  const db = getDatabase(),
    replyId = `reply_${v.messageId}`;
  const existing = await listMessages(accountId, conversation.id);
  const previous = existing.find((m) => m.id === v.messageId);
  if (previous) {
    if (previous.content !== v.text.trim())
      throw new JourneyError(
        409,
        "CHAT_KEY_REUSED",
        "重试内容已变化，请重新发送。",
      );
    const reply = existing.find((m) => m.id === replyId);
    if (reply) return reply;
    if (
      conversation.busy_at &&
      conversation.busy_at < Math.floor(Date.now() / 1000) - 300
    ) {
      const message =
        "上次回复中断，结果未确认。请重新发送，不会自动重复执行。";
      await db.batch([
        db
          .prepare(
            "INSERT OR IGNORE INTO agent_messages(id,conversation_id,account_id,role,content) VALUES(?,?,?,'assistant',?)",
          )
          .bind(replyId, conversation.id, accountId, message),
        db
          .prepare(
            "UPDATE agent_conversations SET busy_request=NULL,busy_at=NULL WHERE id=? AND account_id=? AND busy_request=?",
          )
          .bind(conversation.id, accountId, v.messageId),
      ]);
      return {
        id: replyId,
        role: "assistant",
        content: message,
        createdAt: new Date().toISOString(),
      };
    }
    throw new JourneyError(
      409,
      "CHAT_IN_PROGRESS",
      "这条消息正在回复，请稍后恢复对话。",
    );
  }
  const locked = await db
    .prepare(
      "UPDATE agent_conversations SET busy_request=?,busy_at=unixepoch() WHERE id=? AND account_id=? AND busy_request IS NULL RETURNING id",
    )
    .bind(v.messageId, conversation.id, accountId)
    .first();
  if (!locked)
    throw new JourneyError(
      409,
      "CHAT_IN_PROGRESS",
      "上一条消息仍在回复，请稍候。",
    );
  let recoveredBlocks: AssistantBlock[] = [];
  try {
    const count = await db
      .prepare(
        "INSERT INTO auth_rate_limits(limit_key,hit_count,reset_at) VALUES(?,1,unixepoch()+3600) ON CONFLICT(limit_key) DO UPDATE SET hit_count=CASE WHEN reset_at<=unixepoch() THEN 1 ELSE hit_count+1 END,reset_at=CASE WHEN reset_at<=unixepoch() THEN unixepoch()+3600 ELSE reset_at END RETURNING hit_count",
      )
      .bind(createHash("sha256").update(`chat:hour:${accountId}`).digest("hex"))
      .first<{ hit_count: number }>();
    if (!count || count.hit_count > 60)
      throw new JourneyError(
        429,
        "CHAT_RATE_LIMIT",
        "本小时对话次数已达上限，请稍后再试。",
      );
    await db
      .prepare(
        "INSERT INTO agent_messages(id,conversation_id,account_id,role,content) VALUES(?,?,?,'user',?)",
      )
      .bind(v.messageId, conversation.id, accountId, v.text.trim())
      .run();
    let journey = conversation.journey_id
      ? await getJourney(accountId, conversation.journey_id)
      : null;
    const contextAccess = contextAccessFromText(v.text);
    const settings = await memorySettings(accountId);
    const allowMemory = contextAccess.memory && memoryAllowed(settings.useMemory, v.includeMemory);
    const allowAutoMemory = contextAccess.memory && settings.useMemory && settings.autoMemory;
    const allMemories = allowMemory ? await listMemoryItems(accountId) : [];
    const date = new Intl.DateTimeFormat("en-CA", {
      timeZone: journey?.draft.trip?.destinationTimezone || "Asia/Shanghai",
    }).format(new Date());
    const memories = applicableMemories(allMemories, journey?.id ?? null, date);
    const messages = await listMessages(accountId, conversation.id);
    const snapshots = journey?.plan
      ? await listJourneyVersions(accountId, journey.id)
      : [];
    const versions = snapshots.map((v) => v.version);
    const pending = messages
      .filter((m) => m.card?.state === "proposed")
      .at(-1)?.card;
    const budget = AbortSignal.any([signal, AbortSignal.timeout(240_000)]);
    const searchPolicy = searchPolicyFromText(v.text);
    const needsSearchReceipt = expectsCurrentSearch(v.text, searchPolicy);
    const tools = createAgentTools({ accountId, journeyId: journey?.id ?? null, memories: boundedMemoryContext(memories), signal: budget, requestId: v.messageId, searchPolicy, allowMemory, allowBody: contextAccess.body });
    let finalizationRejected = false;
    recoveredBlocks = tools.blocks;
    const output = await runAgentToolLoop({ signal: budget, execute: tools.execute, progress: onProgress,
      canSearchDuringCorrection: () => !tools.hasSearched,
      recoverFinal: () => { finalizationRejected = true; return readOnlyToolAnswer(tools.blocks); },
      validateFinal: (raw, correcting) => {
        const priorSources = messages.flatMap(message => message.blocks?.flatMap(block => block.type === "offers" ? block.offers.map(offer => offer.url) : []) ?? []);
        const validated = validateAnswer(raw, journey, [...tools.verifiedSources, ...priorSources]);
        const needsClarification = validated.blocks?.some(block => block.type === "question");
        if (needsSearchReceipt && !tools.hasSearched && !needsClarification) throw new JourneyError(502, "INVALID_AGENT_OUTPUT", "本轮尚未执行用户要求的搜索；必须实际调用工具，不能复用历史结果或声称已检索。");
        if (correcting && validated.action) throw new JourneyError(502, "INVALID_AGENT_OUTPUT", "纠正回复不能执行额外操作。");
        return correcting ? { ...readOnlyToolAnswer(tools.blocks), blocks: validated.blocks } : raw;
      }, ask: async (toolResults, round) => {
      // Re-read for every model round. Neither historic chat nor a tool snapshot is authoritative.
      if (journey) journey = await getJourney(accountId, journey.id);
      await db.prepare("UPDATE agent_conversations SET busy_at=unixepoch() WHERE id=? AND account_id=? AND busy_request=?").bind(conversation.id, accountId, v.messageId).run();
      return askAgent({ messages, journey, memories: boundedMemoryContext(memories), versions, pending, autoMemory: allowAutoMemory, signal: budget, onText, bodyContext: await tools.body(), toolResults, toolCatalog: AGENT_TOOLS, searchPolicy, contextAccess: { memory: allowMemory, body: contextAccess.body }, round });
    } });
    if (journey) {
      const latest = await getJourney(accountId, journey.id);
      if (latest.version !== journey.version) throw new JourneyError(409, "JOURNEY_CHANGED", "回复期间行程已变化，请重新发送，助手会基于最新安排核对。");
      journey = latest;
    }
    const verifiedOffers = [...messages.flatMap(message => message.blocks?.flatMap(block => block.type === "offers" ? block.offers : []) ?? []), ...tools.blocks.flatMap(block => block.type === "offers" ? block.offers : [])].slice(-30);
    const priorSources = verifiedOffers.map(offer => offer.url);
    const sources = [...new Set([...tools.verifiedSources, ...priorSources])];
    signal.throwIfAborted();
    const answer = validateAnswer(output, journey, sources);
    // Planning actions use a separate search pipeline and cannot bypass this turn's limits.
    if (searchIsRestricted(searchPolicy) && answer.action && ["consult", "plan", "create"].includes(answer.action.type)) {
      answer.action = null;
      answer.reply = "这一轮已按你的搜索范围处理；没有额外启动规划或其他检索。若要继续生成行程，请再告诉我。";
    }
    const noOffers = !tools.blocks.some(block => block.type === "offers" && block.offers.length);
    if (!answer.action && tools.hasSearched && noOffers) answer.reply = readOnlyToolAnswer(tools.blocks).reply;
    answer.blocks = [...tools.blocks, ...(answer.blocks ?? [])].slice(0, 8);
    if (finalizationRejected) answer.blocks = [...tools.blocks.slice(0, 7), { type: "status", title: "额外操作未执行", detail: "助手返回的操作未通过核验；这里只保留本轮已核验的信息。" }];
    if (answer.action && answer.summary)
      answer.summary = answer.summary
        .replace(/已将/g, "拟将")
        .replace(/已(调整|修改|恢复|创建|删除|取消)/g, "拟$1");
    let card: ActionCard | undefined;
    if (answer.action?.type === "checkin") { answer.title = "记录当前感受"; answer.summary = `疲劳 ${answer.action.fatigue} / 5${answer.action.stress ? ` · 压力 ${answer.action.stress} / 5` : ""}`; }
    if (answer.action?.type === "feedback") { answer.title = "记录调整后的体验"; answer.summary = ({ lighter: "轻松了一些", same: "差不多", still_tired: "还是很累" })[answer.action.feeling] + (answer.action.fatigue ? ` · 疲劳 ${answer.action.fatigue} / 5` : ""); }
    if (answer.action?.type === "collection") { answer.title = answer.action.kind === "backlog" ? "保存到待安排" : "更新旅行清单"; answer.summary = answer.action.operation === "add" ? `保存 ${answer.action.items?.length ?? 0} 个项目` : answer.action.operation === "remove" ? "移除选中的清单项目" : `标记为${answer.action.checked ? "已完成" : "未完成"}`; }
    if (answer.action) {
      if (
        answer.action.type === "forget" &&
        !allMemories.some(
          (m) => m.id === (answer.action as { memoryId: string }).memoryId,
        )
      )
        throw new JourneyError(400, "INVALID_MEMORY", "这条记忆不存在。");
      if (
        answer.action.type === "restore" &&
        !versions.includes(answer.action.restoreVersion)
      )
        throw new JourneyError(400, "INVALID_VERSION", "历史版本不存在。");
      card = {
        id: crypto.randomUUID(),
        title: answer.title || "建议方案",
        summary: answer.summary || "",
        action: answer.action,
        state: "proposed",
        verifiedSources: sources,
        verifiedOffers,
        requiresApproval: requiresItineraryApproval(
          answer.action,
          Boolean(journey?.plan),
        ),
        preview: actionPreview(
          answer.action,
          journey,
          answer.action.type === "restore"
            ? snapshots.find(
                (v) =>
                  v.version ===
                  (answer.action as { restoreVersion: number }).restoreVersion,
              )?.plan
            : undefined,
        ),
      };
    }
    if (card?.action.type === "collection" && card.action.operation === "add") card.preview = card.action.items?.map(item => ({ before: "待添加", after: item.title + (item.detail ? ` · ${item.detail}` : "") }));
    const remembered: Array<{ id: string; undoId: string }> = [];
    if (allowAutoMemory) {
      for (const m of answer.memories ?? []) {
        // Only the current utterance is processed once. Explicit corrections may
        // revise a supplied existing memory; history is never replayed for extraction.
        const old = m.replacesId
          ? allMemories.find((old) => old.id === m.replacesId)
          : null;
        const key = `chat:${m.scope}:${m.journeyId ?? ""}:${m.key}`;
        const receipt = await rememberFromChat(
          accountId,
          m,
          v.messageId,
          key,
          old ?? undefined,
        );
        if (receipt) remembered.push(receipt);
      }
    }
    if (answer.action) {
      const introductions = {
        create: "我整理了一份新旅程草案，确认后将创建并开始规划。",
        edit: "我整理了以下调整，确认后才会修改行程。",
        plan: "这是重新规划的建议，确认后将生成新的候选方案。",
        consult: "正在按你的要求核验建议，原行程保持不变。",
        restore: "已找到对应历史版本，请预览后确认恢复。",
        forget: "正在处理这条记忆。",
        collection: "我整理好了，确认后保存到这段旅程。",
        checkin: "确认这个分数后，今天的安排会参考你的最新感受。",
        feedback: "确认后记录这次调整的体验，下次建议会参考它。",
      };
      answer.reply = introductions[answer.action.type];
    }
    const saved = (remembered.length ? await listMemoryItems(accountId) : [])
      .filter((m) => remembered.some((r) => r.id === m.id))
      .map((m) => ({
        ...m,
        undoId: remembered.find((r) => r.id === m.id)!.undoId,
      }));
    const payload = {
      ...(card ? { card } : {}),
      ...(saved.length ? { memories: saved } : {}),
      ...(answer.blocks?.length ? { blocks: answer.blocks } : {}),
    };
    const statements =
      card && (card.requiresApproval || card.action.type === "plan")
        ? [
            db
              .prepare(
                "UPDATE agent_actions SET state='discarded' WHERE conversation_id=? AND account_id=? AND state='proposed'",
              )
              .bind(conversation.id, accountId),
          ]
        : [];
    if (card)
      statements.push(
        db
          .prepare(
            "INSERT INTO agent_actions(id,conversation_id,account_id,payload_json) VALUES(?,?,?,?)",
          )
          .bind(card.id, conversation.id, accountId, JSON.stringify(card)),
      );
    statements.push(
      db
        .prepare(
          "INSERT INTO agent_messages(id,conversation_id,account_id,role,content,payload_json) VALUES(?,?,?,'assistant',?,?)",
        )
        .bind(
          replyId,
          conversation.id,
          accountId,
          answer.reply,
          JSON.stringify(payload),
        ),
      db
        .prepare(
          "UPDATE agent_conversations SET title=CASE WHEN title='新的对话' THEN ? ELSE title END,updated_at=unixepoch() WHERE id=? AND account_id=?",
        )
        .bind(v.text.trim().slice(0, 40), conversation.id, accountId),
    );
    await db.batch(statements);
    if (card && !card.requiresApproval) {
      try {
        const result = await decideAction(accountId, card.id, {
          decision: "apply",
        });
        card.state = result.state ?? "applied";
        card.result = result;
        answer.reply =
          card.state === "failed"
            ? "这次处理未完成，原行程保留。请稍后重试。"
            : card.action.type === "forget"
              ? "已忘记这条记忆。"
              : "已开始准备建议，原行程保持不变；方案就绪后，只有你允许才会修改安排。";
      } catch (error) {
        card.state = "failed";
        answer.reply =
          error instanceof JourneyError
            ? error.message
            : "暂时未能完成这次请求，原行程保留。请稍后重试。";
      }
      await db
        .prepare(
          "UPDATE agent_messages SET content=?,payload_json=? WHERE id=? AND account_id=?",
        )
        .bind(answer.reply, JSON.stringify(payload), replyId, accountId)
        .run();
    }
    return {
      id: replyId,
      role: "assistant",
      content: answer.reply,
      createdAt: new Date().toISOString(),
      ...payload,
    };
  } catch (error) {
    console.warn("agent_reply_failed", {
      name: error instanceof Error ? error.name : "unknown",
      code: error instanceof JourneyError ? error.code : "internal",
    });
    const message =
      error instanceof JourneyError
        ? error.message
        : "回复暂时中断，请重试；原行程保留。";
    await db
      .prepare(
        "INSERT OR IGNORE INTO agent_messages(id,conversation_id,account_id,role,content,payload_json) VALUES(?,?,?,'assistant',?,?)",
      )
      .bind(
        replyId,
        conversation.id,
        accountId,
        message,
        JSON.stringify({ error: message, ...(recoveredBlocks.length ? { blocks: recoveredBlocks.slice(0, 8) } : {}) }),
      )
      .run();
    throw error;
  } finally {
    await db
      .prepare(
        "UPDATE agent_conversations SET busy_request=NULL,busy_at=NULL WHERE id=? AND account_id=? AND busy_request=?",
      )
      .bind(conversation.id, accountId, v.messageId)
      .run();
  }
}
