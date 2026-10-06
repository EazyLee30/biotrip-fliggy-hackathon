"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, FormEvent, SetStateAction } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PasswordSecurity from "@/app/components/password-security";
import Icon from "@/app/components/account-icon";
import { LearnedPreferencesBlock } from "@/app/components/planner/blocks/learned-preferences";
import { PlacePickerDialog } from "./planner/place-picker";
import { PhraseInput } from "./planner/quick-inputs";
import { PLACES } from "@/lib/places";
import type { Journey, JourneyMemory } from "@/lib/journey-types";
import type { LearnedPreference, PreferenceDefaults } from "@/lib/preferences";
import { applyWhoopResponse, EMPTY_WHOOP_DISPLAY, readWhoopResponse, whoopReadFailed, whoopStatusLabel, type WhoopDisplay } from "@/lib/whoop-display";
import { Modal } from "./zen-ui";
import { AppDock } from "./planner/app-dock";
import "../account.css";

type Profile = {
  displayName: string; email: string; homeCity: string;
  travelStyle: "flexible" | "structured"; foodPreferences: string;
  sensoryPreferences: string[]; memoryNotes: string;
};
type ShareEntry = { id: string; destination: string; headline: string; expiresAt: number };
const EMPTY: Profile = { displayName: "", email: "", homeCity: "", travelStyle: "flexible", foodPreferences: "", sensoryPreferences: [], memoryNotes: "" };
const SENSORY = ["安静少噪", "自然气息", "柔和光线", "人少宽松", "慢节奏", "少走路"];


export type ProfileViewProps = {
  onNavigate: (next: "today" | "adjust" | "explore" | "create" | "profile", intent?: "open" | "tab") => void;
  whoopDisplay: WhoopDisplay;
  onWhoopDisplayChange: Dispatch<SetStateAction<WhoopDisplay>>;
  onAccountChanged: () => void;
  onRefreshJourneys: () => Promise<void>;
  onSyncWhoop?: () => Promise<void>;
  journeys: Journey[];
  selectedJourneyId?: string | null;
  navigationBusy?: boolean;
  sharesRevision?: number;
};

async function readPayload(response: Response): Promise<Record<string, unknown>> {
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "请求暂时无法完成，请重试。");
  return payload;
}
function stamp(value: string | number, withTime = false) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", ...(withTime ? { timeStyle: "short" as const } : {}) }).format(new Date(typeof value === "number" ? value * 1000 : value));
}

export function ProfileView({ onNavigate, whoopDisplay, onWhoopDisplayChange: setWhoopDisplay, onAccountChanged, onRefreshJourneys, onSyncWhoop, journeys, selectedJourneyId, navigationBusy = false, sharesRevision = 0 }: ProfileViewProps) {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile>(EMPTY);
  const [savedProfile, setSavedProfile] = useState<Profile>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [homePickerOpen, setHomePickerOpen] = useState(false);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [hasPassword, setHasPassword] = useState(false);
  const whoopConnected = whoopDisplay.connected;
  const whoopLoading = ["checking", "syncing"].includes(whoopDisplay.status);
  const whoopError = whoopDisplay.message;
  const [whoopConfigured, setWhoopConfigured] = useState(false);
  const [shares, setShares] = useState<ShareEntry[]>([]);
  const [memories, setMemories] = useState<JourneyMemory[]>([]);
  const [preferences, setPreferences] = useState<LearnedPreference[]>([]);
  const [preferenceDefaults, setPreferenceDefaults] = useState<PreferenceDefaults | null>(null);
  const [whoopMember, setWhoopMember] = useState<{ name: string; connectedAt: string | null }>({ name: "", connectedAt: null });
  const [listErrors, setListErrors] = useState<Record<string, string>>({});
  const [actionBusy, setActionBusy] = useState("");
  const navigationDisabled = navigationBusy || saving || Boolean(actionBusy);
  const actionLock = useRef(false);
  const whoopRequest = useRef<AbortController | null>(null);
  const editor = useRef<HTMLDivElement>(null);
  const [leaveDestination, setLeaveDestination] = useState<{ next: Parameters<ProfileViewProps["onNavigate"]>[0]; intent: "open" | "tab" } | null>(null);
  const dirty = JSON.stringify(profile) !== JSON.stringify(savedProfile);
  const active = journeys.find((journey) => journey.id === selectedJourneyId) ?? journeys.find((journey) => journey.status === "active");
  const syncWhoop = useCallback(async (parentSignal?: AbortSignal) => {
    if (whoopRequest.current) return;
    const controller = new AbortController(); whoopRequest.current = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(25_000), ...(parentSignal ? [parentSignal] : [])]);
    try {
      const response = await fetch("/api/whoop/status", { cache: "no-store", signal });
      if (response.status === 401) { router.replace("/login?next=%2F%23profile"); return; }
      const payload = await readPayload(response);
      if (whoopRequest.current !== controller || parentSignal?.aborted) return;
      const connected = Boolean(payload.connected);
      setWhoopConfigured(Boolean(payload.configured));
      setWhoopMember({ name: typeof payload.memberName === "string" ? payload.memberName : "", connectedAt: typeof payload.connectedAt === "string" ? payload.connectedAt : null });
      if (!connected) { setWhoopDisplay({ ...EMPTY_WHOOP_DISPLAY, status: "not_connected", message: "尚未授权 WHOOP。可以连接设备，也可使用自己的感受规划。" }); return; }
      if (onSyncWhoop) { if (!parentSignal) await onSyncWhoop(); return; }
      setWhoopDisplay((current) => ({ ...current, connected: true, status: "syncing", message: "" }));
      const summaryResponse = await fetch("/api/whoop/summary", { cache: "no-store", signal });
      if (summaryResponse.status === 401) { router.replace("/login?next=%2F%23profile"); return; }
      const data = await readWhoopResponse(summaryResponse);
      if (whoopRequest.current === controller && !parentSignal?.aborted) setWhoopDisplay((current) => applyWhoopResponse(current, data, summaryResponse.ok));
    } catch {
      if (whoopRequest.current === controller && !controller.signal.aborted && !parentSignal?.aborted) setWhoopDisplay((current) => whoopReadFailed(current, signal.aborted ? "WHOOP 本次读取超时，请稍后重试。" : "WHOOP 暂时无法读取，请检查网络后重试。"));
    } finally { if (whoopRequest.current === controller) whoopRequest.current = null; }
  }, [router, setWhoopDisplay, onSyncWhoop]);
  const retryWhoop = useCallback(() => {
    if (whoopRequest.current) return;
    setWhoopDisplay((current) => ({ ...current, status: "syncing", message: "" }));
    void syncWhoop();
  }, [syncWhoop, setWhoopDisplay]);

  useEffect(() => {
    const abort = new AbortController();
    const get = (path: string) => fetch(path, { cache: "no-store", signal: abort.signal });
    void (async () => {
      try {
        const response = await get("/api/profile");
        if (response.status === 401) { router.replace("/login?next=%2F%23profile"); return; }
        const payload = await readPayload(response);
        if (abort.signal.aborted) return;
        const account = payload.account as { email: string; display_name: string; has_password: boolean };
        const value = { ...EMPTY, ...(payload.profile as Partial<Profile> | null), email: account.email, displayName: account.display_name || "" };
        setProfile(value); setSavedProfile(value); setHasPassword(Boolean(account.has_password)); setLoaded(true);
      } catch (caught) {
        if (!abort.signal.aborted) setError(caught instanceof Error ? caught.message : "读取个人档案失败。");
      } finally { if (!abort.signal.aborted) setLoading(false); }
    })();
    void (async () => { await syncWhoop(abort.signal); })();
    for (const [name, path] of [["shares", "/api/share"], ["memories", "/api/memory"], ["preferences", "/api/preferences"]] as const) {
      void get(path).then(readPayload).then((payload) => {
        if (abort.signal.aborted) return;
        if (name === "shares") { if (!Array.isArray(payload.shares)) throw new Error("分享列表返回异常，请重新加载。"); setShares(payload.shares as ShareEntry[]); }
        if (name === "memories") { if (!Array.isArray(payload.memories)) throw new Error("旅行记忆返回异常，请重新加载。"); setMemories(payload.memories as JourneyMemory[]); }
        if (name === "preferences") {
          if (!Array.isArray(payload.preferences)) throw new Error("偏好列表返回异常，请重新加载。");
          setPreferences(payload.preferences as LearnedPreference[]);
          setPreferenceDefaults(payload.defaults as PreferenceDefaults);
        }
      }).catch((caught) => {
        if (!abort.signal.aborted) setListErrors((current) => ({ ...current, [name]: caught instanceof Error ? caught.message : "暂时无法读取。" }));
      });
    }
    return () => { abort.abort(); whoopRequest.current?.abort(); whoopRequest.current = null; };
  }, [reload, syncWhoop, router]);

  useEffect(() => {
    if (!sharesRevision) return;
    const controller = new AbortController();
    void fetch("/api/share", { cache: "no-store", signal: controller.signal }).then(readPayload).then((payload) => {
      if (!controller.signal.aborted) { setShares(payload.shares as ShareEntry[]); setListErrors((current) => ({ ...current, shares: "" })); }
    }).catch((caught) => { if (!controller.signal.aborted) setListErrors((current) => ({ ...current, shares: caught instanceof Error ? caught.message : "暂时无法读取分享。" })); });
    return () => controller.abort();
  }, [sharesRevision]);

  useEffect(() => {
    if (!dirty) return;
    const preventLoss = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [dirty]);

  function refresh() {
    setLoading(true); setWhoopDisplay((current) => ({ ...current, status: "checking", message: "" })); setError(""); setListErrors({}); setReload((value) => value + 1); onAccountChanged();
    void onRefreshJourneys().catch((caught) => setError(caught instanceof Error ? caught.message : "暂时无法刷新旅程。"));
  }
  function navigate(next: Parameters<ProfileViewProps["onNavigate"]>[0], intent: "open" | "tab" = "open") {
    if (navigationDisabled) return;
    if (dirty) setLeaveDestination({ next, intent }); else onNavigate(next, intent);
  }
  function update<K extends keyof Profile>(key: K, value: Profile[K]) { setProfile((current) => ({ ...current, [key]: value })); setToast(""); }
  function toggle(item: string) {
    setProfile((current) => ({ ...current, sensoryPreferences: current.sensoryPreferences.includes(item) ? current.sensoryPreferences.filter((value) => value !== item) : [...current.sensoryPreferences, item] }));
    setToast("");
  }
  async function save(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault(); if (saving) return false;
    setSaving(true); setError(""); setToast("");
    const submitted = { ...profile, sensoryPreferences: [...profile.sensoryPreferences] };
    try {
      await readPayload(await fetch("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(submitted) }));
      setSavedProfile(submitted); setToast("个人档案已保存，下次规划可直接使用这些偏好。"); onAccountChanged(); return true;
    } catch (caught) { setError(caught instanceof Error ? caught.message : "档案暂时无法保存。"); return false; }
    finally { setSaving(false); }
  }
  async function action(name: string, work: () => Promise<void>) {
    if (actionLock.current) return;
    actionLock.current = true; setActionBusy(name); setError(""); setToast("");
    try { await work(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "操作暂时无法完成。"); }
    finally { actionLock.current = false; setActionBusy(""); }
  }
  function signOut() {
    void action("logout", async () => {
      await readPayload(await fetch("/api/auth/logout", { method: "POST" }));
      router.replace("/login"); router.refresh();
    });
  }
  function disconnect() {
    void action("whoop", async () => {
      const payload = await readPayload(await fetch("/api/whoop/disconnect", { method: "POST" }));
      whoopRequest.current?.abort(); whoopRequest.current = null;
      setWhoopDisplay({ ...EMPTY_WHOOP_DISPLAY, status: "not_connected", message: "已断开 WHOOP，本账户不再读取身体记录。" });
      setWhoopMember({ name: "", connectedAt: null });
      setToast(payload.revoked ? "已断开 WHOOP，并撤销授权。所有设备都不再读取你的身体记录。" : "已断开本账户的 WHOOP 连接；如需撤销全部授权，可在 WHOOP 中管理连接。");
      onAccountChanged();
    });
  }
  /** Reuses the shared action lock so a stale row cannot be deleted twice. */
  function forgetPreference(id: string) {
    void action(id, async () => {
      const payload = await readPayload(await fetch("/api/preferences", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }));
      setPreferences(payload.preferences as LearnedPreference[]);
      setPreferenceDefaults(payload.defaults as PreferenceDefaults);
      setToast("已忘记这条偏好，之后不会再自动带入。");
      onAccountChanged();
    });
  }
  function forgetAllPreferences() {
    if (!window.confirm("确定清除全部自动记忆吗？你手动填写的旅程记忆和个人档案不会被删除。")) return;
    void action("preferences-all", async () => {
      const payload = await readPayload(await fetch("/api/preferences", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ all: true }) }));
      setPreferences(payload.preferences as LearnedPreference[]);
      setPreferenceDefaults(payload.defaults as PreferenceDefaults);
      setToast("已清除全部自动记忆。");
      onAccountChanged();
    });
  }
  function forgetMemory(id: string) {
    void action(id, async () => {
      await readPayload(await fetch("/api/memory", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }));
      setMemories((current) => current.filter((item) => item.id !== id)); setToast("这条旅程偏好已忘记。"); onAccountChanged();
    });
  }
  function revokeShare(id: string) {
    void action(id, async () => {
      await readPayload(await fetch(`/api/share/${encodeURIComponent(id)}`, { method: "DELETE" }));
      setShares((current) => current.filter((share) => share.id !== id)); setToast("公开分享链接已撤回。"); onAccountChanged();
    });
  }
  function editProfile() {
    setEditing(true);
    window.setTimeout(() => { editor.current?.scrollIntoView({ behavior: "smooth", block: "center" }); editor.current?.querySelector("input")?.focus({ preventScroll: true }); }, 0);
  }

  const healthStatus = whoopStatusLabel(whoopDisplay.status);
  const name = profile.displayName || profile.email.split("@")[0] || "旅行者";


  return <div className="bio-profile">
    <header className="bio-profile-topbar"><div><span><Icon name="pin" size={16} />{active?.draft.trip?.destinationCity || "你的个人档案"}</span><small>{active ? `${active.status === "active" ? "旅途中" : active.status === "planned" ? "待出发" : active.status === "completed" ? "已完成" : "草稿"} · 我的` : "BioTrip · 我的"}</small></div><div className="bio-profile-top-actions"><span className="bio-status"><i style={{ background: whoopDisplay.status === "synced" ? undefined : whoopDisplay.status === "failed" || whoopDisplay.status === "reauthorization_required" ? "#a63842" : "#75827a" }} /><Icon name="sync" size={14} />{healthStatus}</span><span className="bio-user-mini"><Icon name="user" size={18} /></span></div></header>
    <PlacePickerDialog open={homePickerOpen} citiesOnly title="选择常住城市" current={PLACES.find((entry) => entry.city === profile.homeCity)} suggestions={[profile.homeCity]} onClose={() => setHomePickerOpen(false)} onSelect={(entry) => { update("homeCity", entry.city); setHomePickerOpen(false); }} />
    <main className="bio-profile-main">
      {loading ? <div className="bio-loading" role="status">正在读取你的个人档案…</div> : !loaded ? <section className="bio-card"><h1>暂时无法打开档案</h1><p className="account-error" role="alert">{error}</p><button type="button" className="account-submit" onClick={refresh}>重新加载</button></section> : <>
        <form className="bio-profile-form" onSubmit={(event) => void save(event)}>
          <section className="bio-card bio-identity">
            <div className="bio-identity-row"><div className="bio-avatar">{name.slice(0, 1).toUpperCase()}</div><div className="bio-identity-copy"><h1>{name}<i /></h1><strong>{journeys.filter((journey) => journey.status === "completed").length} 次已完成旅程</strong><p>{profile.homeCity ? `常住城市 · ${profile.homeCity}` : "把旅途交给自己的节奏"}</p></div><button type="button" className="bio-edit" aria-label="编辑个人资料" onClick={editProfile}><Icon name="edit" size={18} /></button></div>
            <div className="bio-ribbons"><span><i />WHOOP · {whoopConnected ? "授权已保存" : whoopDisplay.status === "reauthorization_required" ? "需重新授权" : "未授权"}</span><span><Icon name="compass" size={13} />{profile.travelStyle === "structured" ? "有序安排" : "留白探索"}</span><span><Icon name="shield" size={13} />账户私有档案</span></div>
            {editing && <div className="bio-editor" ref={editor}><label className="account-field"><span>怎么称呼你</span><input maxLength={80} value={profile.displayName} onChange={(event) => update("displayName", event.target.value)} placeholder="你的称呼" /></label><div className="account-field"><span>常住城市</span><div className="bio-city-row"><button type="button" className="bio-city-picker" aria-label="选择常住城市" disabled={saving || navigationBusy} onClick={() => setHomePickerOpen(true)}><Icon name="pin" size={17} /><strong>{profile.homeCity || "点选城市"}</strong><span>选择 ↗</span></button>{profile.homeCity ? <button type="button" className="bio-city-clear" aria-label="清空常住城市" disabled={saving || navigationBusy} onClick={() => update("homeCity", "")}><span aria-hidden="true">×</span></button> : null}</div></div><label className="account-field"><span>登录邮箱</span><input value={profile.email} readOnly type="email" /></label><button type="button" className="bio-text-button" onClick={() => setEditing(false)}>收起资料</button></div>}
          </section>
          <section className="bio-card"><div className="bio-card-heading"><h2>身体记录</h2><span className="bio-status">{healthStatus}</span></div><p className="bio-inline-note">在“节奏”查看读数、同步时间和本次身体感受。</p><button type="button" className="bio-text-button" disabled={navigationDisabled} onClick={() => navigate("adjust")}>查看身体记录与节奏 ↗</button></section>
          {whoopError && <p className="bio-inline-note" role="status">{whoopError}{whoopConnected || whoopDisplay.status === "failed" ? <button type="button" disabled={whoopLoading || Boolean(actionBusy)} onClick={retryWhoop}>{whoopLoading ? "读取中…" : "重试读取"}</button> : whoopConfigured ? <a href="/api/whoop/connect">{whoopDisplay.status === "reauthorization_required" ? "重新授权 WHOOP" : "连接 WHOOP"} ↗</a> : null}</p>}
          <details className="bio-card bio-fold"><summary className="bio-card-heading"><h2><span><Icon name="leaf" size={17} /></span>旅行节奏</h2><small>{dirty ? "有未保存更改" : "你的默认偏好"}</small></summary><div className="bio-pace"><button type="button" aria-pressed={profile.travelStyle === "structured"} onClick={() => update("travelStyle", "structured")}>有序安排</button><button type="button" aria-pressed={profile.travelStyle === "flexible"} onClick={() => update("travelStyle", "flexible")}>留白探索</button><button type="button" disabled={navigationDisabled} onClick={() => navigate("create")}>本次自选 ↗</button></div><div className="bio-pace-description"><Icon name="leaf" size={18} /><p>{profile.travelStyle === "structured" ? "优先保留明确的时间安排和已预约项目，在空闲时段加入休息，让每一步更从容。" : "保留已预约项目，为散步、休息和临时发现留出空间。每次调整都由你确认。"}</p></div><fieldset className="bio-preferences"><legend>环境与感官偏好</legend><div>{SENSORY.map((item) => <button key={item} type="button" aria-pressed={profile.sensoryPreferences.includes(item)} onClick={() => toggle(item)}>{item}</button>)}</div></fieldset><PhraseInput label="饮食偏好或限制" value={profile.foodPreferences} onChange={(next) => update("foodPreferences", next)} phrases={["少辣", "清淡", "素食", "不吃海鲜"]} maxLength={500} rows={2} placeholder="补充口味、忌口或过敏信息" disabled={saving || navigationBusy} /></details>
          <section className="bio-card"><div className="bio-card-heading"><h2><span><Icon name="watch" size={17} /></span>设备与旅行服务</h2><small>{healthStatus}</small></div><div className="bio-service"><span className="bio-service-icon"><Icon name="watch" /></span><div><strong>WHOOP 身体记录</strong><small>{whoopLoading ? "正在读取最近记录" : whoopConnected ? "授权已保存；每次规划单独确认是否使用" : whoopDisplay.status === "reauthorization_required" ? "授权已失效，请重新连接" : "授权后可读取恢复与睡眠记录"}{whoopMember.name ? ` · ${whoopDisplay.status === "reauthorization_required" ? "上次 WHOOP 账户" : "WHOOP 账户"}：${whoopMember.name}` : ""}{whoopMember.connectedAt ? ` · 授权于 ${stamp(whoopMember.connectedAt, true)}` : ""}</small></div>{whoopConnected ? <button className="bio-switch" type="button" role="switch" aria-label="断开 WHOOP" aria-checked="true" disabled={Boolean(actionBusy) || whoopLoading} onClick={disconnect}><span /></button> : whoopConfigured && !whoopLoading ? <a className="bio-switch" href="/api/whoop/connect" role="switch" aria-label="连接 WHOOP" aria-checked="false"><span /></a> : <button className="bio-switch" type="button" role="switch" aria-label={whoopLoading ? "正在读取 WHOOP 连接状态" : "WHOOP 暂时不可连接"} aria-checked="false" disabled><span /></button>}</div><div className="bio-service"><span className="bio-service-icon"><Icon name="plane" /></span><div><strong>飞猪旅行</strong><small>目的地服务与真实商品入口</small></div><button type="button" className="bio-service-link" disabled={navigationDisabled} onClick={() => navigate("explore")}>去探索</button></div></section>

          <details className="bio-card bio-fold"><summary className="bio-card-heading"><h2><span><Icon name="compass" size={17} /></span>旅程记忆</h2><small>仅此账户可见</small></summary><PhraseInput label="想让下次旅途记住什么" value={profile.memoryNotes} onChange={(next) => update("memoryNotes", next)} phrases={["抵达当天留出休息", "避免一早赶行程", "减少长距离步行"]} maxLength={5000} rows={3} placeholder="补充想保留的旅行偏好" disabled={saving || navigationBusy} /><p className="bio-empty">这些文字仅在你确认本次规划授权后使用。</p>{listErrors.memories ? <p className="account-error">{listErrors.memories}</p> : memories.length ? <div className="bio-managed-list">{memories.map((memory) => <div key={memory.id}><p>{memory.note}<small>{stamp(memory.createdAt)}</small></p><button type="button" disabled={Boolean(actionBusy)} onClick={() => forgetMemory(memory.id)}>{actionBusy === memory.id ? "处理中" : "忘记"}</button></div>)}</div> : <p className="bio-empty">旅途中保存的偏好会出现在这里。</p>}</details>
          <LearnedPreferencesBlock preferences={preferences} defaults={preferenceDefaults} busyId={actionBusy} onForget={forgetPreference} onForgetAll={forgetAllPreferences} />
          {error && <p className="account-error bio-feedback" role="alert">{error}</p>}{toast && <p className="account-message bio-feedback" role="status">{toast}</p>}
          <button className="account-submit bio-save" type="submit" disabled={saving || !dirty}><Icon name="sync" size={18} />{saving ? "正在保存档案…" : dirty ? "保存个人档案" : "个人档案已保存"}</button>
        </form>
        <PasswordSecurity email={profile.email} hasPassword={hasPassword} onSaved={() => { setHasPassword(true); onAccountChanged(); }} />
        <details className="bio-card bio-fold"><summary className="bio-card-heading"><h2><span><Icon name="compass" size={17} /></span>公开分享</h2><small>{shares.length} 个有效链接</small></summary><p className="bio-card-note">分享只包含目的地与公开行程。你可以随时撤回链接。</p>{listErrors.shares ? <p className="account-error">{listErrors.shares}</p> : shares.length ? <div className="bio-managed-list">{shares.map((share) => <div key={share.id}><p><a href={`/share/${share.id}`} target="_blank" rel="noreferrer">{share.destination} · {share.headline} ↗</a><small>{stamp(share.expiresAt)}到期</small></p><button type="button" disabled={Boolean(actionBusy)} onClick={() => revokeShare(share.id)}>{actionBusy === share.id ? "处理中" : "撤回"}</button></div>)}</div> : <p className="bio-empty">你还没有公开分享旅程。</p>}</details>
        <button type="button" className="bio-refresh" disabled={whoopLoading || Boolean(actionBusy) || dirty} onClick={refresh}><Icon name="sync" size={18} />{whoopLoading ? "正在同步身体记录…" : dirty ? "保存档案后可同步" : "同步身体记录与旅程"}</button>
        <Link href="/privacy" className="bio-text-button">数据与隐私说明 ↗</Link>
        <button type="button" className="bio-signout" disabled={Boolean(actionBusy)} onClick={signOut}>{actionBusy === "logout" ? "正在退出…" : "退出账户 / 切换账号"}</button>
      </>}
    </main>
    {leaveDestination ? <Modal title="个人档案尚未保存" busy={saving} onClose={() => setLeaveDestination(null)} footer={<div className="bio-leave-actions"><button type="button" className="account-submit" disabled={saving} onClick={async () => { if (await save()) { const target=leaveDestination; setLeaveDestination(null); onNavigate(target.next,target.intent); } }}>{saving ? "保存中…" : "保存并离开"}</button><button type="button" disabled={saving} onClick={() => setLeaveDestination(null)}>继续编辑</button><button type="button" disabled={saving} onClick={() => { setProfile(savedProfile); const target=leaveDestination; setLeaveDestination(null); onNavigate(target.next,target.intent); }}>放弃修改</button></div>}><p>这次修改尚未保存到账户，请选择如何离开。</p>{error ? <p className="account-error" role="alert">{error}</p> : null}</Modal> : null}
    <AppDock view="profile" disabled={navigationDisabled} onNavigate={(next) => navigate(next, "tab")} />
  </div>;
}

export default ProfileView;
