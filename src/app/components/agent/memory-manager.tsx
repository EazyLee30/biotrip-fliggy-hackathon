"use client";
import { useEffect, useState } from "react";
import type { MemoryInput, MemoryItem } from "@/lib/agent/memory-types";
import type { Journey } from "@/lib/journey-types";
import { ToggleSwitch } from "../toggle-switch";
import css from "./agent.module.css";
const EMPTY: MemoryInput = {
  note: "",
  scope: "global",
  category: "preference",
  enabled: true,
  expiresOn: null,
  journeyId: null,
};
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: "no-store", ...options });
  const value = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(value.error || "记忆暂时无法保存。");
  return value;
}
export function MemoryManager({
  journeys,
  onChanged,
}: {
  journeys: Journey[];
  onChanged: () => void;
}) {
  const [items, setItems] = useState<MemoryItem[]>([]),
    [auto, setAuto] = useState(true),
    [useMemory, setUseMemory] = useState(true),
    [useWhoop, setUseWhoop] = useState(true),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [edit, setEdit] = useState<MemoryItem | null>(null),
    [draft, setDraft] = useState<MemoryInput>(EMPTY),
    [editor, setEditor] = useState(false),
    [filter, setFilter] = useState("all");
  useEffect(() => {
    const abort = new AbortController();
    let revision = 0;
    const load = async () => {
      const current = ++revision;
      try {
        const value = await request<{ memories: MemoryItem[]; autoMemory: boolean; useMemory: boolean; useWhoop: boolean }>("/api/memory", { signal: abort.signal });
        if (abort.signal.aborted || current !== revision) return;
        setItems(value.memories); setAuto(value.autoMemory); setUseMemory(value.useMemory); setUseWhoop(value.useWhoop); setLoaded(true); setError("");
      } catch (e) { if (!abort.signal.aborted && current === revision) setError(e instanceof Error ? e.message : "记忆读取失败。"); }
    };
    void load();
    const changed = () => { void load(); };
    window.addEventListener("biotrip:memory-changed", changed);
    return () => { abort.abort(); window.removeEventListener("biotrip:memory-changed", changed); };
  }, []);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败。");
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    const v = await request<{ memories: MemoryItem[]; autoMemory: boolean; useMemory: boolean; useWhoop: boolean }>("/api/memory");
    setItems(v.memories); setAuto(v.autoMemory); setUseMemory(v.useMemory); setUseWhoop(v.useWhoop); setLoaded(true);
  }
  function start(item?: MemoryItem) {
    setEdit(item ?? null);
    setDraft(item ? { ...item } : { ...EMPTY });
    setEditor(true);
  }
  return (
    <section className={css.memory} aria-label="我的记忆">
      <div className={css.memoryIntro}>
        <span className={css.eyebrow}>MY MEMORY</span>
        <h3>{editor ? edit ? "编辑记忆" : "添加记忆" : "你的旅行记忆"}</h3>
        <p>对话与「我的」共用这份记忆，在任一入口修改都会同步。</p>
      </div>
      {!editor ? <>
      <label className={css.switchRow}>
        <span><strong>使用已保存的记忆</strong><small>助手对话与规划参考你的有效偏好</small></span>
        <ToggleSwitch label="使用已保存的记忆" checked={useMemory} disabled={busy || !loaded} onChange={value => {
          const previous = useMemory; setUseMemory(value);
          void run(async () => { try { await request("/api/agent/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ useMemory: value, useWhoop }) }); } catch (e) { setUseMemory(previous); throw e; } });
        }} />
      </label>
      <label className={css.switchRow}>
        <span>
          <strong>从对话中自动记忆</strong>
          <small>明确偏好自动保存，可随时修改或忘记</small>
        </span>
        <ToggleSwitch
          label="从对话中自动记忆"
          checked={auto}
          disabled={busy || !loaded}
          onChange={(value) => {
            const previous = auto;
            setAuto(value);
            void run(async () => {
              try {
                await request("/api/memory/settings", {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ autoMemory: value }),
                });
              } catch (error) {
                setAuto(previous);
                throw error;
              }
            });
          }}
        />
      </label>
      <div className={css.toolbar}>
        <button type="button" onClick={() => start()} disabled={busy}>
          ＋ 添加记忆
        </button>
        <select
          aria-label="筛选记忆范围"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">全部记忆</option>
          <option value="global">长期偏好</option>
          <option value="journey">本次旅程</option>
          <option value="day">当天状态</option>
        </select>
      </div>
      </> : null}
      {error && (
        <p role="alert" className={css.error}>
          {error}
          <button type="button" onClick={() => void run(refresh)}>
            重试读取
          </button>
        </p>
      )}
      {!loaded && !error && <p>正在读取记忆…</p>}
      {editor && (
        <div className={css.memoryEditor}>
          <label>
            记住什么
            <textarea
              aria-label="记忆内容"
              maxLength={5000}
              value={draft.note}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            />
          </label>
          <label>
            适用范围
            <select
              value={draft.scope}
              onChange={(e) => {
                const scope = e.target.value as MemoryInput["scope"];
                setDraft({
                  ...draft,
                  scope,
                  journeyId:
                    scope === "global" ? null : (journeys[0]?.id ?? null),
                  expiresOn:
                    scope === "global"
                      ? null
                      : scope === "day"
                        ? new Intl.DateTimeFormat("en-CA", {
                            timeZone:
                              journeys[0]?.draft.trip?.destinationTimezone ||
                              "Asia/Shanghai",
                          }).format(new Date())
                        : (journeys[0]?.draft.trip?.returnDate ?? null),
                });
              }}
            >
              <option value="global">长期偏好</option>
              <option value="journey">本次旅程</option>
              <option value="day">当天状态</option>
            </select>
          </label>
          {draft.scope !== "global" && (
            <label>
              指定旅程
              <select
                value={draft.journeyId ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, journeyId: e.target.value })
                }
              >
                <option value="">选择旅程</option>
                {journeys.map((j) => (
                  <option value={j.id} key={j.id}>
                    {j.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            有效期（可选）
            <input
              aria-label="记忆有效期"
              type="date"
              value={draft.expiresOn ?? ""}
              onChange={(e) =>
                setDraft({ ...draft, expiresOn: e.target.value || null })
              }
            />
          </label>
          <label className={css.switchRow}><span>启用这条记忆</span><ToggleSwitch label="启用这条记忆" checked={draft.enabled !== false} disabled={busy} onChange={enabled => setDraft({ ...draft, enabled })} /></label>
          <div className={css.toolbar}>
            <button
              type="button"
              disabled={busy || !draft.note.trim()}
              onClick={() =>
                void run(async () => {
                  await request(
                    edit ? `/api/memory/${edit.id}` : "/api/memory",
                    {
                      method: edit ? "PATCH" : "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        ...draft,
                        ...(edit ? { version: edit.version } : {}),
                      }),
                    },
                  );
                  await refresh();
                  setEditor(false);
                })
              }
            >
              保存记忆
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setEditor(false)}
            >
              返回记忆列表
            </button>
            {edit ? <button type="button" disabled={busy} onClick={() => void run(async () => { await request("/api/memory", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: edit.id }) }); await refresh(); setEditor(false); })}>忘记这条记忆</button> : null}
          </div>
        </div>
      )}
      {!editor ? <div className={css.memoryList}>
        {items
          .filter((m) => filter === "all" || m.scope === filter)
          .map((m) => (
            <article key={m.id} className={css.memoryCard}>
              <button
                type="button"
                className={css.memoryNote}
                onClick={() => start(m)}
                disabled={busy}
              >
                <strong>{m.note}</strong>
                <span>{m.enabled ? "›" : "已停用 ›"}</span>
              </button>
              <small>
                {m.scope === "global"
                  ? "长期偏好"
                  : m.scope === "day"
                    ? "当天状态"
                    : "本次旅程"}{" "}
                ·{" "}
                {(
                  {
                    manual: "手动添加",
                    chat: "来自对话",
                    choice: "来自选择",
                    feedback: "来自反馈",
                    profile: "来自档案",
                  } as Record<string, string>
                )[m.source] ?? m.source}
                {m.journeyId
                  ? ` · ${journeys.find((j) => j.id === m.journeyId)?.title ?? "指定旅程"}`
                  : ""}
              </small>
              <small>
                {m.expiresOn
                  ? `有效至 ${m.expiresOn}`
                  : `更新于 ${m.updatedAt.slice(0, 10)}`}
              </small>

            </article>
          ))}
      </div> : null}
      {!editor && loaded && !items.filter(m => filter === "all" || m.scope === filter).length && (
        <p>{items.length ? "这个范围还没有记忆，试试其他筛选。" : "还没有记忆。可以手动添加，也可以在对话中告诉我你的习惯。"}</p>
      )}
    </section>
  );
}
