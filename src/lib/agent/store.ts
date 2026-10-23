import { getDatabase } from "@/lib/database";
import { getJourney, JourneyError } from "@/lib/journeys";
import type { AgentMessage, Conversation, ActionCard } from "./types";
export async function listConversations(
  accountId: string,
): Promise<Conversation[]> {
  const rows = await getDatabase()
    .prepare(
      "SELECT id,journey_id,title,updated_at FROM agent_conversations WHERE account_id=? ORDER BY updated_at DESC,rowid DESC LIMIT 50",
    )
    .bind(accountId)
    .all<{
      id: string;
      journey_id: string | null;
      title: string;
      updated_at: number;
    }>();
  return rows.results.map((r) => ({
    id: r.id,
    journeyId: r.journey_id,
    title: r.title,
    updatedAt: new Date(r.updated_at * 1000).toISOString(),
  }));
}
export async function createConversation(
  accountId: string,
  journeyId: string | null,
) {
  if (journeyId) await getJourney(accountId, journeyId);
  const id = crypto.randomUUID();
  await getDatabase()
    .prepare(
      "INSERT INTO agent_conversations(id,account_id,journey_id) VALUES(?,?,?)",
    )
    .bind(id, accountId, journeyId)
    .run();
  return id;
}
export async function getConversation(accountId: string, id: string) {
  const row = await getDatabase()
    .prepare("SELECT * FROM agent_conversations WHERE id=? AND account_id=?")
    .bind(id, accountId)
    .first<{
      id: string;
      journey_id: string | null;
      busy_request: string | null;
      busy_at: number | null;
    }>();
  if (!row) throw new JourneyError(404, "CHAT_NOT_FOUND", "这段对话不存在。");
  if (
    row.busy_request &&
    row.busy_at &&
    row.busy_at < Math.floor(Date.now() / 1000) - 300
  ) {
    await getDatabase().batch([
      getDatabase()
        .prepare(
          "INSERT OR IGNORE INTO agent_messages(id,conversation_id,account_id,role,content,payload_json) SELECT ?,?,?,'assistant',?,? WHERE EXISTS(SELECT 1 FROM agent_messages WHERE id=? AND conversation_id=? AND account_id=?)",
        )
        .bind(
          `reply_${row.busy_request}`,
          id,
          accountId,
          "上次回复中断，原行程保留。可以重新发送要求。",
          JSON.stringify({ error: "回复中断" }),
          row.busy_request,
          id,
          accountId,
        ),
      getDatabase()
        .prepare(
          "UPDATE agent_conversations SET busy_request=NULL,busy_at=NULL WHERE id=? AND account_id=? AND busy_request=? AND busy_at<unixepoch()-300",
        )
        .bind(id, accountId, row.busy_request),
    ]);
    row.busy_request = null;
    row.busy_at = null;
  }
  return row;
}
export async function listMessages(
  accountId: string,
  id: string,
): Promise<AgentMessage[]> {
  await getConversation(accountId, id);
  const rows = await getDatabase()
    .prepare(
      "SELECT * FROM (SELECT rowid AS position,* FROM agent_messages WHERE conversation_id=? AND account_id=? ORDER BY rowid DESC LIMIT 100) ORDER BY position",
    )
    .bind(id, accountId)
    .all<{
      id: string;
      role: "user" | "assistant";
      content: string;
      payload_json: string | null;
      created_at: number;
    }>();
  const actions = await getDatabase()
    .prepare(
      "SELECT id,state,result_json FROM agent_actions WHERE conversation_id=? AND account_id=?",
    )
    .bind(id, accountId)
    .all<{
      id: string;
      state: ActionCard["state"];
      result_json: string | null;
    }>();
  return rows.results.map((r) => {
    const payload = r.payload_json ? JSON.parse(r.payload_json) : {};
    if (payload.card) {
      const a = actions.results.find((a) => a.id === payload.card.id);
      if (a) {
        payload.card.state = a.state;
        if (a.result_json) payload.card.result = JSON.parse(a.result_json);
      }
    }
    return {
      id: r.id,
      role: r.role,
      content: r.content,
      createdAt: new Date(r.created_at * 1000).toISOString(),
      ...payload,
    };
  });
}
export async function deleteConversation(accountId: string, id: string) {
  await getConversation(accountId, id);
  const removed = await getDatabase()
    .prepare(
      "DELETE FROM agent_conversations WHERE id=? AND account_id=? AND busy_request IS NULL RETURNING id",
    )
    .bind(id, accountId)
    .first();
  if (!removed)
    throw new JourneyError(
      409,
      "CHAT_IN_PROGRESS",
      "对话正在回复，请完成后再删除。",
    );
}
