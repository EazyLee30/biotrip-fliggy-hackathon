"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Journey } from "@/lib/journey-types";
import type {
  ActionResult,
  AgentMessage,
  Conversation,
} from "@/lib/agent/types";
import { Icon } from "../zen-ui";
import { Dialog } from "@base-ui/react/dialog";
import { Menu } from "@base-ui/react/menu";
import { ArrowLeft, ArrowUp, MoreHorizontal, Square, SquarePen, ChevronDown, BookOpen, History, SlidersHorizontal } from "lucide-react";
import { AssistantBlocks } from "./assistant-blocks";
import { AssistantMessage } from "./assistant-message";
import { AgentSettings } from "./agent-settings";
import { MemoryManager } from "./memory-manager";
import { proactiveSuggestion } from "@/lib/agent/proactive";
import { AgentJobPanel } from "./job-panel";
import css from "./agent.module.css";
type Request = <T>(url: string, options?: RequestInit) => Promise<T>;
export function AgentDock({
  journeys,
  journeyId,
  request,
  onSaved,
  beforeAction,
  onMemoryChanged,
  disabled,
  openSignal = 0,
  hideLauncher = false,
  openRequest,
  onOpenMemory,
  onBodyChanged,
  onCollectionsChanged,
}: {
  journeys: Journey[];
  journeyId: string | null;
  request: Request;
  onSaved: (journey: Journey) => void;
  beforeAction: () => Promise<unknown>;
  onMemoryChanged: () => void;
  disabled?: boolean;
  openSignal?: number;
  hideLauncher?: boolean;
  openRequest?: { id: number; prompt?: string };
  onOpenMemory?: () => void;
  onBodyChanged?: () => void;
  onCollectionsChanged?: () => void;
}) {
  const [open, setOpen] = useState(false),
    [section, setSection] = useState<
      "chat" | "memory" | "history" | "settings" | "journeys"
    >("chat"),
    [target, setTarget] = useState<string | null>(journeyId),
    [conversation, setConversation] = useState<string | null>(null),
    [conversations, setConversations] = useState<Conversation[]>([]),
    [messages, setMessages] = useState<AgentMessage[]>([]),
    [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [stream, setStream] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [status, setStatus] = useState("正在理解你的安排…"),
    [canCancel, setCanCancel] = useState(false);
  const alive = useRef(true),
    sending = useRef(false),
    creatingConversation = useRef(false),
    log = useRef<HTMLDivElement>(null),
    signalSeen = useRef(openSignal),
    selectedHistory = useRef<string | null>(null),
    scrollToEnd = useRef(true),
    sendAbort = useRef<AbortController | null>(null),
    requestSeen = useRef(0),
    pageRef = useRef<HTMLDivElement>(null);
  const [dismissedSuggestion, setDismissedSuggestion] = useState("");
  const suggestion = proactiveSuggestion(
    journeys.find((j) => j.id === journeyId) ?? null,
  );
  const current = journeys.find((j) => j.id === target);
  const onSavedRef = useRef(onSaved);
  useEffect(() => {
    onSavedRef.current = onSaved;
  }, [onSaved]);
  const receiveJourney = useCallback((j: Journey) => onSavedRef.current(j), []);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const launch = useCallback(() => {
    if (sending.current || creatingConversation.current) { setOpen(true); setSection("chat"); return; }
    scrollToEnd.current = true;
    setTarget(journeyId);
    setOpen(true);
    setSection("chat");
    setError("");
    setLoading(true);
  }, [journeyId]);
  useEffect(() => {
    if (openRequest && openRequest.id !== requestSeen.current) {
      requestSeen.current = openRequest.id;
      queueMicrotask(() => { launch(); if (openRequest.prompt) setText(openRequest.prompt); });
    }
  }, [openRequest, launch]);
  useEffect(() => {
    if (!open || !window.visualViewport) return;
    const viewport = window.visualViewport;
    const resize = () => { pageRef.current?.style.setProperty("--assistant-width", `${window.innerWidth}px`); pageRef.current?.style.setProperty("--assistant-height", `${viewport.height}px`); pageRef.current?.style.setProperty("--assistant-top", `${viewport.offsetTop}px`); };
    resize(); viewport.addEventListener("resize", resize); viewport.addEventListener("scroll", resize);
    return () => { viewport.removeEventListener("resize", resize); viewport.removeEventListener("scroll", resize); };
  }, [open]);
  useEffect(() => {
    if (openSignal !== signalSeen.current) {
      signalSeen.current = openSignal;
      queueMicrotask(launch);
    }
  }, [openSignal, launch]);
  useEffect(() => {
    if (!open || sending.current || creatingConversation.current) return;
    const abort = new AbortController();
    void request<{ conversations: Conversation[] }>(
      "/api/agent/conversations",
      { signal: abort.signal },
    )
      .then(async (v) => {
        if (abort.signal.aborted) return;
        setConversations(v.conversations);
        const match =
          v.conversations.find(
            (c) => c.id === selectedHistory.current && c.journeyId === target,
          ) ?? v.conversations.find((c) => c.journeyId === target);
        if (match) {
          const loaded = await request<{ messages: AgentMessage[] }>(
            `/api/agent/conversations/${match.id}`,
            { signal: abort.signal },
          );
          if (abort.signal.aborted) return;
          setConversation(match.id);
          setMessages(loaded.messages);
        } else {
          setConversation(null);
          setMessages([]);
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [open, target, request]);
  useEffect(() => {
    const node = log.current;
    if (
      node &&
      (scrollToEnd.current ||
        node.scrollHeight - node.scrollTop - node.clientHeight < 250)
    ) {
      node.scrollTop = node.scrollHeight;
      scrollToEnd.current = false;
    }
  }, [messages, stream, section]);
  async function loadConversation(c: Conversation) {
    if (sending.current || creatingConversation.current || loading) return;
    selectedHistory.current = c.id;
    scrollToEnd.current = true;
    setError("");
    setLoading(true);
    try {
      const v = await request<{ messages: AgentMessage[] }>(
        `/api/agent/conversations/${c.id}`,
      );
      setTarget(c.journeyId);
      setConversation(c.id);
      setMessages(v.messages);
      setSection("chat");
    } catch (e) {
      setError(e instanceof Error ? e.message : "读取失败");
    } finally {
      setLoading(false);
    }
  }
  async function newConversation() {
    if (sending.current || creatingConversation.current || loading) return;
    creatingConversation.current = true;
    setLoading(true);
    setError("");
    setSection("chat");
    try {
      const { id } = await request<{ id: string }>("/api/agent/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ journeyId: target }),
      });
      if (!alive.current) return;
      selectedHistory.current = id;
      scrollToEnd.current = true;
      setConversation(id);
      setConversations((old) => [
        { id, journeyId: target, title: "新的对话", updatedAt: new Date().toISOString() },
        ...old,
      ]);
      setMessages([]);
      setText("");
      setStream("");
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : "新建会话失败，请重试。");
    } finally {
      creatingConversation.current = false;
      if (alive.current) setLoading(false);
    }
  }
  async function send(answer?: string) {
    const input = answer ?? text;
    if (!input.trim() || sending.current || creatingConversation.current || loading) return;
    sending.current = true;
    scrollToEnd.current = true;
    setBusy(true);
    setError("");
    setStream("");
    setStatus("正在理解你的安排…");
    const controller = new AbortController();
    sendAbort.current = controller;
    setCanCancel(true);
    const content = input.trim(),
      id = crypto.randomUUID();
    setText("");
    let chatId = conversation;
    try {
      if (!chatId) {
        chatId = (
          await request<{ id: string }>("/api/agent/conversations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ journeyId: target }),
          })
        ).id;
        setConversation(chatId);
        selectedHistory.current = chatId;
      }
      setMessages((old) => [
        ...old,
        { id, role: "user", content, createdAt: new Date().toISOString() },
      ]);
      const response = await fetch("/api/agent/messages", {
        signal: controller.signal,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: chatId,
          messageId: id,
          text: content,
        }),
      });
      if (!response.ok || !response.body) {
        const v = (await response.json()) as { error?: string };
        throw new Error(v.error || "对话暂时不可用");
      }
      const reader = response.body.getReader(),
        decoder = new TextDecoder();
      let buffer = "";
      let completed = false;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";
          for (const block of events) {
            const name = /^event: (.+)$/m.exec(block)?.[1],
              data = /^data: (.+)$/m.exec(block)?.[1];
            if (!data) continue;
            const v = JSON.parse(data);
            if (name === "text" && alive.current) setStream(v.text);
            if (name === "status" && alive.current) { setStatus(v.message); setStream(""); }
            if (name === "error") throw new Error(v.error);
            if (name === "done") {
              completed = true;
              if (alive.current) {
                setMessages((old) => [...old, v.message]);
                setStream("");
                onMemoryChanged();
              }
            }
          }
        }
        if (!completed)
          throw new Error("连接已中断，可以重新打开对话恢复已保存的回复。");
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    } catch (e) {
      if (alive.current) {
        setStream("");
        setError(controller.signal.aborted ? "已停止回复。重新打开可恢复已保存的内容。" : e instanceof Error ? e.message : "发送失败。");
      }
    } finally {
      sendAbort.current = null;
      setCanCancel(false);
      sending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function decide(message: AgentMessage, decision: "apply" | "discard") {
    if (!message.card || sending.current || creatingConversation.current || loading) return;
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      if (decision === "apply") await beforeAction();
      const result = await request<ActionResult>(
        `/api/agent/actions/${message.card.id}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision }),
        },
      );
      setMessages((old) =>
        old.map((m) =>
          m.id === message.id
            ? {
                ...m,
                card: {
                  ...m.card!,
                  state:
                    decision === "apply"
                      ? (result.state ?? "applied")
                      : "discarded",
                  result,
                },
              }
            : m,
        ),
      );
      if (result.journey) {
        receiveJourney(result.journey);
        if (message.card.action.type === "create") setTarget(result.journey.id);
      }
      if (result.forgotten) onMemoryChanged();
      if (result.bodyChanged) onBodyChanged?.();
      if (result.collectionsChanged) onCollectionsChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败。");
      if (conversation)
        try {
          const saved = await request<{ messages: AgentMessage[] }>(
            `/api/agent/conversations/${conversation}`,
          );
          setMessages(saved.messages);
        } catch {
          /* The saved action can still be recovered on reopen. */
        }
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      {!hideLauncher && <button
        type="button"
        className={css.launcher}
        aria-label="打开 BioTrip 对话助手"
        disabled={disabled}
        onClick={launch}
      >
        <Icon name="chat" size={21} />
        <span>聊聊旅程</span>
      </button>}
      {!hideLauncher && !open && suggestion && dismissedSuggestion !== suggestion.key && (
        <aside className={css.proactive}>
          <small>{suggestion.basis}</small>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              launch();
              setText(suggestion.prompt);
              setDismissedSuggestion(suggestion.key);
            }}
          >
            {suggestion.text} ↗
          </button>
          <button
            type="button"
            aria-label="收起今天的建议"
            onClick={() => setDismissedSuggestion(suggestion.key)}
          >
            ×
          </button>
        </aside>
      )}
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Popup ref={pageRef} className={css.page} initialFocus={pageRef}>
          <header className={css.pageHeader}>
            <button type="button" className={css.headerIcon} aria-label={section === "chat" ? "返回旅程" : "返回对话"} onClick={() => section === "chat" ? setOpen(false) : setSection("chat")}><ArrowLeft size={22} /></button>
            <div className={css.headerTitle}><small>{section === "chat" ? "BIOTRIP · 旅程助手" : "BIOTRIP"}</small><Dialog.Title>{section === "chat" ? current?.title || "一起安排下一程" : { journeys: "选择旅程", settings: "助手设置", memory: "旅行记忆", history: "对话历史" }[section]}</Dialog.Title></div>
            <button type="button" className={css.newConversation} aria-label="新建会话" title="新建会话" disabled={busy || loading} onClick={() => void newConversation()}><SquarePen size={18} /><span>新对话</span></button>
            <Menu.Root><Menu.Trigger className={css.headerIcon} aria-label="更多对话选项"><MoreHorizontal size={24} /></Menu.Trigger><Menu.Portal><Menu.Positioner sideOffset={8} align="end" className={css.menuPositioner}><Menu.Popup className={css.moreMenu}>
              <Menu.Item onClick={() => void newConversation()} disabled={busy || loading}><SquarePen size={18} />新建会话</Menu.Item>
              <Menu.Item onClick={() => setSection("journeys")} disabled={busy || loading}><ChevronDown size={18} />切换旅程</Menu.Item>
              <Menu.Item onClick={() => { if (onOpenMemory) { setOpen(false); onOpenMemory(); } else setSection("memory"); }}><BookOpen size={18} />旅行记忆</Menu.Item>
              <Menu.Item onClick={() => { setSection("history"); void request<{ conversations: Conversation[] }>("/api/agent/conversations").then(v => setConversations(v.conversations)).catch(e => setError(e.message)); }} disabled={busy || loading}><History size={18} />对话历史</Menu.Item>
              <Menu.Item onClick={() => setSection("settings")}><SlidersHorizontal size={18} />助手设置</Menu.Item>
            </Menu.Popup></Menu.Positioner></Menu.Portal></Menu.Root>
          </header>
          <div className={css.pageContent}>
          {section === "journeys" ? <div className={css.history}>
            <p className={css.settingsNote}>选择后，对话中的修改只针对这段旅程。</p>
            {[{ id: "", title: "规划一段新旅程", detail: "从目的地和日期开始" }, ...journeys.map(j => ({ id:j.id, title:j.title, detail:j.draft.trip?.departureDate || "日期待定" }))].map(item => <button type="button" className={css.journeyOption} key={item.id} aria-pressed={(target ?? "") === item.id} disabled={busy || loading} onClick={() => {
              if ((target ?? "") !== item.id) { selectedHistory.current = null; setConversation(null); setMessages([]); setText(""); setLoading(true); setTarget(item.id || null); }
              setSection("chat");
            }}><span><strong>{item.title}</strong><small>{item.detail}</small></span><span aria-hidden="true">{(target ?? "") === item.id ? "✓" : "›"}</span></button>)}
          </div> : section === "settings" ? (
            <div className={css.scroller}>
              <AgentSettings onOpenMemory={() => { if (onOpenMemory) { setOpen(false); onOpenMemory(); } else setSection("memory"); }} />
            </div>
          ) : section === "memory" ? (
            <div className={css.scroller}>
              <MemoryManager journeys={journeys} onChanged={onMemoryChanged} />
            </div>
          ) : section === "history" ? (
            <div className={css.history}>
              <button
                type="button"
                disabled={busy || loading}
                onClick={() => void newConversation()}
              >
                ＋ 新建会话
              </button>
              {conversations.map((c) => (
                <div className={css.toolbar} key={c.id}>
                  <button
                    type="button"
                    disabled={busy || loading}
                    onClick={() => void loadConversation(c)}
                  >
                    {c.title} · {c.updatedAt.slice(0, 10)}
                  </button>
                  <button
                    type="button"
                    aria-label={`删除对话 ${c.title}`}
                    disabled={busy || loading}
                    onClick={async () => {
                      try {
                        await request(`/api/agent/conversations/${c.id}`, {
                          method: "DELETE",
                        });
                        setConversations((old) =>
                          old.filter((x) => x.id !== c.id),
                        );
                        if (conversation === c.id) {
                          setConversation(null);
                          setMessages([]);
                        }
                      } catch (e) {
                        setError(e instanceof Error ? e.message : "删除失败");
                      }
                    }}
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className={css.chat}>
              <div
                ref={log}
                className={css.messages}
                role="log"
                aria-label="旅行对话"
                aria-live="polite"
              >
                {!messages.length && !loading && (
                  <div className={css.welcome}>
                    <span className={css.eyebrow}>YOUR TRAVEL COMPANION</span>
                    <h3>
                      旅程随你，
                      <br />
                      随时聊聊。
                    </h3>
                    <p>
                      {current
                        ? "想换一种节奏，或调整某一天的安排？"
                        : "告诉我想去哪里，我们一起安排。"}
                      <br />
                      每一项计划变更都会先给你预览。
                    </p>
                    <div className={css.suggestions}>
                      {(current
                        ? [
                            "把第二天下午安排轻松一点",
                            "保留预约，其他活动往后推半小时",
                            "以后尽量不要安排早起",
                          ]
                        : ["下周末去杭州两天，轻松一点", "我一般不吃辣，请记住"]
                      ).map((s) => (
                        <button
                          type="button"
                          key={s}
                          onClick={() => setText(s)}
                        >
                          {s} ↗
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {loading && <p role="status">正在准备对话…</p>}
                {messages.map((m) => (
                  <article
                    key={m.id}
                    className={`${css.message} ${m.role === "user" ? css.user : ""}`}
                  >
                    {m.role === "assistant" && (
                      <span className={css.assistantLabel}>旅行助手</span>
                    )}
                    {m.role === "assistant" ? <AssistantMessage content={m.content} /> : <p>{m.content}</p>}
                    {m.blocks?.length ? <AssistantBlocks blocks={m.blocks} messageId={m.id} journey={current} disabled={busy || loading} onAnswer={answer => void send(answer)} request={request} onCollectionsChanged={onCollectionsChanged} /> : null}
                    {m.card &&
                      !(
                        m.card.action.type === "forget" &&
                        m.card.state === "applied"
                      ) && (
                        <div className={css.card}>
                          <h4>{m.card.title}</h4>
                          <p>{m.card.summary}</p>
                          {m.card.preview && (
                            <ul>
                              {m.card.preview.map((p, i) => (
                                <li key={i}>
                                  <span>{p.before}</span>
                                  {p.after}
                                </li>
                              ))}
                            </ul>
                          )}
                          {(m.card.action.type === "create" ||
                            m.card.action.type === "plan") && (
                            <p>
                              {m.card.action.draft.trip?.originCity} →{" "}
                              {m.card.action.draft.trip?.destinationCity}
                              <br />
                              {m.card.action.draft.trip?.departureDate} —{" "}
                              {m.card.action.draft.trip?.returnDate}
                            </p>
                          )}
                          {m.card.state === "proposed" &&
                          m.card.requiresApproval !== false &&
                          !["consult", "forget"].includes(
                            m.card.action.type,
                          ) ? (
                            <>
                              <p>
                                {"version" in m.card.action && m.card.action.version !== current?.version ? "行程已更新，这份建议已失效，请重新生成。" : m.card.action.type === "collection" ? "确认后保存到这段旅程。" : (m.card.action.type === "checkin" || m.card.action.type === "feedback") ? "这次感受只用于当下安排。" : "确认后更新行程，也可以保留原安排。"}
                              </p>
                              <div className={css.toolbar}>
                                <button
                                  type="button"
                                  className={css.primary}
                                  disabled={busy || loading || ("version" in m.card.action && m.card.action.version !== current?.version)}
                                  onClick={() => void decide(m, "apply")}
                                >
                                  {m.card.action.type === "consult"
                                    ? "允许获取建议"
                                    : m.card.action.type === "create"
                                      ? "确认创建旅程"
                                      : m.card.action.type === "plan"
                                        ? "生成待确认方案"
                                        : m.card.action.type === "forget"
                                          ? "允许忘记"
                                          : (m.card.action.type === "checkin" || m.card.action.type === "feedback") ? "确认今天的感受" : m.card.action.type === "collection" ? "确认保存" : "确认修改"}
                                </button>
                                <button
                                  type="button"
                                  disabled={busy || loading}
                                  onClick={() => void decide(m, "discard")}
                                >
                                  {m.card.action.type === "collection" || (m.card.action.type === "checkin" || m.card.action.type === "feedback") ? "暂不保存" : "保留原安排"}
                                </button>
                              </div>
                            </>
                          ) : (
                            <small>
                              {
                                (
                                  {
                                    applied:
                                      m.card.requiresApproval === false
                                        ? m.card.action.type === "forget"
                                          ? "已忘记"
                                          : "已开始准备建议"
                                        : "已应用",
                                    proposed: "这次处理尚未完成，请重新发送。",
                                    discarded: "已保留原安排或被后续方案替代",
                                    applying: "操作已提交，正在确认",
                                    failed: "未应用，请重新生成",
                                  } as Record<string, string>
                                )[m.card.state]
                              }
                            </small>
                          )}
                          {m.card.result?.notice && (
                            <p role="status">{m.card.result.notice}</p>
                          )}
                          {m.card.result?.jobId && (
                            <AgentJobPanel
                              id={m.card.result.jobId}
                              request={request}
                              onSaved={receiveJourney}
                            />
                          )}
                        </div>
                      )}
                    {m.memories?.map((memory) => (
                      <div className={css.remembered} key={memory.id}>
                        <span>已记住：{memory.note}</span>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={async () => {
                            try {
                              await request(
                                memory.undoId
                                  ? "/api/memory/undo"
                                  : "/api/memory",
                                {
                                  method: memory.undoId ? "POST" : "DELETE",
                                  headers: {
                                    "Content-Type": "application/json",
                                  },
                                  body: JSON.stringify({ id: memory.id }),
                                },
                              );
                              setMessages((old) =>
                                old.map((x) => ({
                                  ...x,
                                  memories: x.memories?.filter(
                                    (v) => v.id !== memory.id,
                                  ),
                                })),
                              );
                              onMemoryChanged();
                            } catch (e) {
                              setError(
                                e instanceof Error ? e.message : "撤销失败",
                              );
                            }
                          }}
                        >
                          撤销记忆
                        </button>
                      </div>
                    ))}
                  </article>
                ))}
                {busy && (
                  <article className={css.message}>
                    <span className={css.assistantLabel}>旅行助手</span>
                    <AssistantMessage content={stream || status} />
                    {!stream && <span className={css.thinkingDots} aria-hidden="true"><i /><i /><i /></span>}
                  </article>
                )}
              </div>
              {error && (
                <p className={css.error} role="alert">
                  {error}
                </p>
              )}
              <div className={css.composer}>
                <textarea
                  aria-label="对话内容"
                  placeholder="说说你想怎样安排…"
                  maxLength={4000}
                  rows={2}
                  value={text}
                  disabled={busy}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                />
                {busy ? <button type="button" className={css.sendButton} aria-label="停止回复" onClick={() => sendAbort.current?.abort()} disabled={!canCancel}><Square size={18} /></button> : <button type="button" className={css.sendButton} aria-label="发送消息" disabled={loading || !text.trim()} onClick={() => void send()}><ArrowUp size={22} /></button>}
              </div>
            </div>
          )}
          </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
