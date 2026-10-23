import { getDatabase } from "@/lib/database";
import { getJourney, JourneyError } from "@/lib/journeys";
import { isCalendarDate } from "@/lib/planner-input";
import type { MemoryInput, MemoryItem, MemoryScope } from "./memory-types";
type Row = {
  id: string;
  note: string;
  category: string;
  scope: MemoryScope;
  journey_id: string | null;
  expires_on: string | null;
  enabled: number;
  source: string;
  source_id: string | null;
  version: number;
  created_at: number;
  updated_at: number;
};
const fail = (message: string): never => {
  throw new JourneyError(400, "INVALID_MEMORY", message);
};
export function validateMemory(raw: unknown): MemoryInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return fail("记忆内容无效。");
  const v = raw as Record<string, unknown>;
  if (
    typeof v.note !== "string" ||
    !v.note.trim() ||
    v.note.length > 5000 ||
    /[\u0000-\u0008\u000e-\u001f]/.test(v.note)
  )
    return fail("记忆请填写 1–5000 个字符。");
  if (!["global", "journey", "day"].includes(String(v.scope)))
    return fail("请选择记忆的适用范围。");
  if (
    v.category !== undefined &&
    (typeof v.category !== "string" || v.category.length > 40)
  )
    return fail("记忆分类无效。");
  if (v.enabled !== undefined && typeof v.enabled !== "boolean")
    return fail("记忆状态无效。");
  if (
    v.journeyId != null &&
    (typeof v.journeyId !== "string" || v.journeyId.length > 100)
  )
    return fail("旅程无效。");
  if (v.scope !== "global" && !v.journeyId)
    return fail("请为临时记忆选择旅程。");
  if (v.expiresOn != null && !isCalendarDate(v.expiresOn))
    return fail("有效期无效。");
  if (v.scope === "day" && !v.expiresOn) return fail("当天状态需要有效期。");
  return {
    note: v.note.trim(),
    category: typeof v.category === "string" ? v.category : "preference",
    scope: v.scope as MemoryScope,
    journeyId: v.scope === "global" ? null : (v.journeyId as string),
    expiresOn: (v.expiresOn as string | null) ?? null,
    enabled: v.enabled !== false,
  };
}
function item(r: Row): MemoryItem {
  return {
    id: r.id,
    note: r.note,
    category: r.category,
    scope: r.scope,
    journeyId: r.journey_id,
    expiresOn: r.expires_on,
    enabled: !!r.enabled,
    source: r.source,
    sourceId: r.source_id,
    version: r.version,
    createdAt: new Date(r.created_at * 1000).toISOString(),
    updatedAt: new Date(r.updated_at * 1000).toISOString(),
  };
}
export async function listMemoryItems(accountId: string) {
  const db = getDatabase();
  await db.batch([
    db
      .prepare(
        "INSERT OR IGNORE INTO memory_items(id,account_id,note,source,source_id,dedupe_key) SELECT 'feedback_'||id,account_id,note,'feedback',id,'feedback:'||id FROM journey_memories WHERE account_id=?",
      )
      .bind(accountId),
    db
      .prepare(
        "INSERT OR IGNORE INTO memory_items(id,account_id,note,category,source,source_id,dedupe_key) SELECT 'learned_'||id,account_id,label,kind,'choice',id,'choice:'||kind||':'||value FROM learned_preferences WHERE account_id=? AND hits>=2 AND kind NOT IN ('schedule','destination')",
      )
      .bind(accountId),
  ]);
  const rows = await db
    .prepare(
      "SELECT * FROM memory_items WHERE account_id=? AND deleted=0 ORDER BY updated_at DESC,id LIMIT 300",
    )
    .bind(accountId)
    .all<Row>();
  return rows.results.map(item);
}
export function applicableMemories(
  items: MemoryItem[],
  journeyId: string | null,
  date: string,
) {
  return items.filter(
    (m) =>
      m.enabled &&
      (!m.expiresOn || m.expiresOn >= date) &&
      (m.scope === "global" || m.journeyId === journeyId),
  );
}
export async function memorySettings(accountId: string) {
  const row = await getDatabase()
    .prepare(
      "SELECT auto_memory,use_memory,use_whoop FROM agent_settings WHERE account_id=?",
    )
    .bind(accountId)
    .first<{ auto_memory: number; use_memory: number; use_whoop: number }>();
  return {
    autoMemory: row?.auto_memory !== 0,
    useMemory: row?.use_memory !== 0,
    useWhoop: row?.use_whoop !== 0,
  };
}
export async function setMemorySettings(
  accountId: string,
  autoMemory: boolean,
) {
  await getDatabase()
    .prepare(
      "INSERT INTO agent_settings(account_id,auto_memory) VALUES(?,?) ON CONFLICT(account_id) DO UPDATE SET auto_memory=excluded.auto_memory",
    )
    .bind(accountId, autoMemory ? 1 : 0)
    .run();
  return { autoMemory };
}
export async function saveMemory(
  accountId: string,
  raw: unknown,
  options: {
    id?: string;
    version?: number;
    source?: string;
    sourceId?: string;
    key?: string;
  } = {},
) {
  const v = validateMemory(raw);
  if (v.journeyId) await getJourney(accountId, v.journeyId);
  const db = getDatabase();
  if (options.id) {
    if (!Number.isInteger(options.version)) return fail("请重新加载这条记忆。");
    const changed = await db
      .prepare(
        "UPDATE memory_items SET note=?,category=?,scope=?,journey_id=?,expires_on=?,enabled=?,version=version+1,updated_at=unixepoch() WHERE id=? AND account_id=? AND version=? AND deleted=0 RETURNING id",
      )
      .bind(
        v.note,
        v.category,
        v.scope,
        v.journeyId ?? null,
        v.expiresOn ?? null,
        v.enabled ? 1 : 0,
        options.id,
        accountId,
        options.version!,
      )
      .first();
    if (!changed)
      throw new JourneyError(
        409,
        "MEMORY_CHANGED",
        "记忆已变化，请刷新后重试。",
      );
    return options.id;
  }
  const id = crypto.randomUUID();
  // Dedupe keys are stable. An automatic extraction must not resurrect deleted,
  // disabled or manually corrected content from a previous message.
  const inserted = await db
    .prepare(
      "INSERT INTO memory_items(id,account_id,note,category,scope,journey_id,expires_on,enabled,source,source_id,dedupe_key) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(account_id,dedupe_key) DO NOTHING RETURNING id",
    )
    .bind(
      id,
      accountId,
      v.note,
      v.category,
      v.scope,
      v.journeyId ?? null,
      v.expiresOn ?? null,
      v.enabled ? 1 : 0,
      options.source ?? "manual",
      options.sourceId ?? null,
      options.key ?? id,
    )
    .first<{ id: string }>();
  return inserted?.id ?? null;
}
export async function deleteMemory(accountId: string, id: string) {
  const changed = await getDatabase()
    .prepare(
      "UPDATE memory_items SET deleted=1,enabled=0,version=version+1,updated_at=unixepoch() WHERE id=? AND account_id=? AND deleted=0 RETURNING id",
    )
    .bind(id, accountId)
    .first();
  if (!changed)
    throw new JourneyError(404, "MEMORY_NOT_FOUND", "这条记忆不存在。");
}

/** Save a newly extracted fact and its undo receipt in the same transaction. */
export async function rememberFromChat(
  accountId: string,
  raw: unknown,
  sourceId: string,
  key: string,
  previous?: MemoryItem,
) {
  const v = validateMemory(raw);
  if (v.journeyId) await getJourney(accountId, v.journeyId);
  const db = getDatabase(),
    id = previous?.id ?? crypto.randomUUID(),
    undoId = crypto.randomUUID();
  const write = previous
    ? db
        .prepare(
          "UPDATE memory_items SET note=?,category=?,scope=?,journey_id=?,expires_on=?,enabled=1,version=version+1,updated_at=unixepoch() WHERE id=? AND account_id=? AND version=? AND deleted=0",
        )
        .bind(
          v.note,
          v.category,
          v.scope,
          v.journeyId ?? null,
          v.expiresOn ?? null,
          id,
          accountId,
          previous.version,
        )
    : db
        .prepare(
          "INSERT INTO memory_items(id,account_id,note,category,scope,journey_id,expires_on,source,source_id,dedupe_key) VALUES(?,?,?,?,?,?,?,'chat',?,?) ON CONFLICT(account_id,dedupe_key) DO NOTHING",
        )
        .bind(
          id,
          accountId,
          v.note,
          v.category,
          v.scope,
          v.journeyId ?? null,
          v.expiresOn ?? null,
          sourceId,
          key,
        );
  const results = await db.batch([
    write,
    db
      .prepare(
        "INSERT INTO memory_changes(id,account_id,memory_id,source_id,previous_json,applied_version) SELECT ?,?,?,?,?,? WHERE changes()=1",
      )
      .bind(
        undoId,
        accountId,
        id,
        sourceId,
        previous ? JSON.stringify(previous) : null,
        (previous?.version ?? 0) + 1,
      ),
  ]);
  if (results[0].meta.changes !== 1) return null;
  return { id, undoId };
}
export async function undoMemory(accountId: string, undoId: string) {
  const db = getDatabase();
  const change = await db
    .prepare(
      "SELECT * FROM memory_changes WHERE id=? AND account_id=? AND used=0",
    )
    .bind(undoId, accountId)
    .first<{
      memory_id: string;
      previous_json: string | null;
      applied_version: number;
    }>();
  if (!change)
    throw new JourneyError(
      409,
      "MEMORY_UNDO_UNAVAILABLE",
      "这条记忆已撤销或不属于当前账户。",
    );
  const previous = change.previous_json
    ? (JSON.parse(change.previous_json) as MemoryItem)
    : null;
  const update = previous
    ? db
        .prepare(
          "UPDATE memory_items SET note=?,category=?,scope=?,journey_id=?,expires_on=?,enabled=?,version=version+1,updated_at=unixepoch() WHERE id=? AND account_id=? AND version=? AND deleted=0",
        )
        .bind(
          previous.note,
          previous.category,
          previous.scope,
          previous.journeyId,
          previous.expiresOn,
          previous.enabled ? 1 : 0,
          change.memory_id,
          accountId,
          change.applied_version,
        )
    : db
        .prepare(
          "UPDATE memory_items SET deleted=1,enabled=0,version=version+1,updated_at=unixepoch() WHERE id=? AND account_id=? AND version=? AND deleted=0",
        )
        .bind(change.memory_id, accountId, change.applied_version);
  const results = await db.batch([
    update,
    db
      .prepare(
        "UPDATE memory_changes SET used=1 WHERE id=? AND account_id=? AND changes()=1",
      )
      .bind(undoId, accountId),
  ]);
  if (results[0].meta.changes !== 1)
    throw new JourneyError(
      409,
      "MEMORY_CHANGED",
      "这条记忆后来已被修改，请在记忆页查看最新内容。",
    );
}

export async function saveAgentSettings(
  accountId: string,
  settings: { useMemory: boolean; useWhoop: boolean },
) {
  await getDatabase()
    .prepare(
      "INSERT INTO agent_settings(account_id,use_memory,use_whoop) VALUES(?,?,?) ON CONFLICT(account_id) DO UPDATE SET use_memory=excluded.use_memory,use_whoop=excluded.use_whoop",
    )
    .bind(accountId, settings.useMemory ? 1 : 0, settings.useWhoop ? 1 : 0)
    .run();
  return memorySettings(accountId);
}
