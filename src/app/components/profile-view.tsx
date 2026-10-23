"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, FormEvent, SetStateAction } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PasswordSecurity from "@/app/components/password-security";
import Icon from "@/app/components/account-icon";
import { ToggleSwitch } from "./toggle-switch";
import { AgentSettings } from "./agent/agent-settings";
import { MemoryManager } from "./agent/memory-manager";
import { PlacePickerDialog } from "./planner/place-picker";
import { PhraseInput } from "./planner/quick-inputs";
import { PLACES } from "@/lib/places";
import type { Journey } from "@/lib/journey-types";
import { applyWhoopResponse, EMPTY_WHOOP_DISPLAY, readWhoopResponse, whoopReadFailed, whoopStatusLabel, type WhoopDisplay } from "@/lib/whoop-display";
import { Modal } from "./zen-ui";
import { AppDock } from "./planner/app-dock";
import "../account.css";

type SettingSection = "home" | "profile" | "preferences" | "memory" | "assistant" | "devices" | "security" | "shares";
const SETTING_TITLES: Record<SettingSection, string> = { home: "我的", profile: "个人资料", preferences: "旅行习惯", memory: "旅行记忆", assistant: "助手设置", devices: "设备与数据", security: "账号与隐私", shares: "公开分享" };
function SettingRow({ icon, title, description, onClick }: { icon: Parameters<typeof Icon>[0]["name"]; title: string; description: string; onClick: () => void }) {
  return <button type="button" className="bio-setting-row" onClick={onClick}><span className="bio-setting-icon"><Icon name={icon} size={20} /></span><span className="bio-setting-copy"><strong>{title}</strong><small>{description}</small></span><span className="bio-setting-chevron" aria-hidden="true">›</span></button>;
}

type Profile = {
  displayName: string; email: string; homeCity: string;
  travelStyle: "flexible" | "structured"; foodPreferences: string;
  sensoryPreferences: string[]; memoryNotes: string;
};
type ShareEntry = { id: string; destination: string; headline: string; expiresAt: number };
const EMPTY: Profile = { displayName: "", email: "", homeCity: "", travelStyle: "flexible", foodPreferences: "", sensoryPreferences: [], memoryNotes: "" };
const SENSORY = ["安静少噪", "自然气息", "柔和光线", "人少宽松", "慢节奏", "少走路"];


export type ProfileViewProps = {
  initialSection?: SettingSection;
  sectionRequestKey?: number;
  onNavigate: (next: "today" | "itinerary" | "body" | "explore" | "create" | "profile", intent?: "open" | "tab") => void;
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

export function ProfileView({ onNavigate, whoopDisplay, onWhoopDisplayChange: setWhoopDisplay, onAccountChanged, onRefreshJourneys, onSyncWhoop, journeys, navigationBusy = false, sharesRevision = 0, initialSection = "home", sectionRequestKey = 0 }: ProfileViewProps) {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile>(EMPTY);
  const [savedProfile, setSavedProfile] = useState<Profile>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [section, setSection] = useState<SettingSection>(initialSection);
  const [lastSectionRequest,setLastSectionRequest]=useState(sectionRequestKey);
  if(lastSectionRequest!==sectionRequestKey){setLastSectionRequest(sectionRequestKey);setSection(initialSection);}
  const sectionHeading = useRef<HTMLHeadingElement>(null);
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
  const [whoopMember, setWhoopMember] = useState<{ name: string; connectedAt: string | null }>({ name: "", connectedAt: null });
  const [listErrors, setListErrors] = useState<Record<string, string>>({});
  const [actionBusy, setActionBusy] = useState("");
  const navigationDisabled = navigationBusy || saving || Boolean(actionBusy);
  const actionLock = useRef(false);
  const whoopRequest = useRef<AbortController | null>(null);

  const [leaveDestination, setLeaveDestination] = useState<{ next: Parameters<ProfileViewProps["onNavigate"]>[0]; intent: "open" | "tab" } | null>(null);
  const dirty = JSON.stringify(profile) !== JSON.stringify(savedProfile);

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
      if (onSyncWhoop) { await onSyncWhoop(); return; }
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
    for (const [name, path] of [["shares", "/api/share"]] as const) {
      void get(path).then(readPayload).then((payload) => {
        if (abort.signal.aborted) return;
        if (name === "shares") { if (!Array.isArray(payload.shares)) throw new Error("分享列表返回异常，请重新加载。"); setShares(payload.shares as ShareEntry[]); }
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
  function revokeShare(id: string) {
    void action(id, async () => {
      await readPayload(await fetch(`/api/share/${encodeURIComponent(id)}`, { method: "DELETE" }));
      setShares((current) => current.filter((share) => share.id !== id)); setToast("公开分享链接已撤回。"); onAccountChanged();
    });
  }
  function openSetting(next: SettingSection) {
    if (navigationDisabled) return;
    if (dirty) { setSettingDestination(next); return; }
    setSection(next); setToast(""); setError("");
    window.scrollTo({ top: 0, behavior: "instant" });
    requestAnimationFrame(() => sectionHeading.current?.focus());
  }
  const [settingDestination, setSettingDestination] = useState<SettingSection | null>(null);

  const healthStatus = whoopStatusLabel(whoopDisplay.status);
  const name = profile.displayName || profile.email.split("@")[0] || "旅行者";


  return <div className="bio-profile bio-settings">
    <header className="bio-profile-topbar bio-settings-topbar">
      {section !== "home" ? <button type="button" className="bio-back" aria-label="返回我的设置" disabled={navigationDisabled} onClick={() => openSetting(section === "assistant" ? "memory" : section === "shares" ? "security" : "home")}>‹</button> : null}
      <h1 ref={sectionHeading} tabIndex={-1}>{SETTING_TITLES[section]}</h1>
      {section === "home" ? <span className="bio-settings-brand">BIOTRIP</span> : <span className="bio-settings-brand">我的 / 设置</span>}
    </header>
    <PlacePickerDialog open={homePickerOpen} citiesOnly title="选择常住城市" current={PLACES.find((entry) => entry.city === profile.homeCity)} suggestions={[profile.homeCity]} onClose={() => setHomePickerOpen(false)} onSelect={(entry) => { update("homeCity", entry.city); setHomePickerOpen(false); }} />
    <main className="bio-profile-main">
      {loading ? <div className="bio-loading" role="status">正在读取你的设置…</div> : !loaded ? <section className="bio-card"><h2>暂时无法打开设置</h2><p className="account-error" role="alert">{error}</p><button type="button" className="account-submit" onClick={refresh}>重新加载</button></section> : <>
        {section === "home" ? <>
          <button type="button" className="bio-card bio-identity bio-identity-button" onClick={() => openSetting("profile")}>
            <div className="bio-identity-row"><div className="bio-avatar">{name.slice(0, 1).toUpperCase()}</div><div className="bio-identity-copy"><h2>{name}</h2><p>{profile.homeCity || "设置常住城市"} · 编辑个人资料</p></div><span aria-hidden="true">›</span></div>
          </button>
          <p className="bio-settings-caption">偏好与个性化</p>
          <nav className="bio-settings-list" aria-label="偏好与个性化设置">
            <SettingRow icon="leaf" title="旅行习惯" description={`${profile.travelStyle === "structured" ? "有序安排" : "留白探索"} · 饮食与环境`} onClick={() => openSetting("preferences")} />
            <SettingRow icon="compass" title="旅行记忆" description="对话和旅程共用的记忆" onClick={() => openSetting("memory")} />
          </nav>
          <p className="bio-settings-caption">账户与服务</p>
          <nav className="bio-settings-list" aria-label="账户与服务设置">
            <SettingRow icon="watch" title="设备与数据" description={`WHOOP · ${healthStatus}`} onClick={() => openSetting("devices")} />
            <SettingRow icon="lock" title="账号与隐私" description="登录密码与切换账号" onClick={() => openSetting("security")} />
          </nav>
          <Link href="/privacy" className="bio-settings-privacy">数据与隐私说明 ↗</Link>
        </> : null}
        {section === "profile" || section === "preferences" ? <form className="bio-profile-form" onSubmit={(event) => void save(event)}>
          <p className="bio-settings-description">{section === "profile" ? "完善资料，让每次出发更方便。" : "设为以后规划的默认偏好，每次旅行仍可单独调整。"}</p>
          <section className="bio-card">{section === "profile" ? <div className="bio-editor"><label className="account-field"><span>怎么称呼你</span><input maxLength={80} value={profile.displayName} onChange={(event) => update("displayName", event.target.value)} placeholder="你的称呼" /></label><div className="account-field"><span>常住城市</span><div className="bio-city-row"><button type="button" className="bio-city-picker" aria-label="选择常住城市" disabled={saving || navigationBusy} onClick={() => setHomePickerOpen(true)}><Icon name="pin" size={17} /><strong>{profile.homeCity || "点选城市"}</strong><span>选择 ↗</span></button>{profile.homeCity ? <button type="button" className="bio-city-clear" aria-label="清空常住城市" disabled={saving || navigationBusy} onClick={() => update("homeCity", "")}><span aria-hidden="true">×</span></button> : null}</div></div><label className="account-field"><span>登录邮箱</span><input value={profile.email} readOnly type="email" /></label></div> : <><div className="bio-pace"><button type="button" aria-pressed={profile.travelStyle === "structured"} onClick={() => update("travelStyle", "structured")}>有序安排</button><button type="button" aria-pressed={profile.travelStyle === "flexible"} onClick={() => update("travelStyle", "flexible")}>留白探索</button><button type="button" disabled={navigationDisabled} onClick={() => navigate("create")}>本次自选 ↗</button></div><div className="bio-pace-description"><Icon name="leaf" size={18} /><p>{profile.travelStyle === "structured" ? "优先保留明确的时间安排和已预约项目，在空闲时段加入休息，让每一步更从容。" : "保留已预约项目，为散步、休息和临时发现留出空间。每次调整都由你确认。"}</p></div><fieldset className="bio-preferences"><legend>环境与感官偏好</legend><div>{SENSORY.map((item) => <button key={item} type="button" aria-pressed={profile.sensoryPreferences.includes(item)} onClick={() => toggle(item)}>{item}</button>)}</div></fieldset><PhraseInput label="饮食偏好或限制" value={profile.foodPreferences} onChange={(next) => update("foodPreferences", next)} phrases={["少辣", "清淡", "素食", "不吃海鲜"]} maxLength={500} rows={2} placeholder="补充口味、忌口或过敏信息" disabled={saving || navigationBusy} /></>}</section>
          <button className="account-submit bio-save" type="submit" disabled={saving || !dirty}>{saving ? "正在保存…" : dirty ? "保存修改" : "已保存"}</button>
        </form> : null}
        {section === "memory" ? <><SettingRow icon="sliders" title="记忆与助手设置" description="选择规划时使用哪些信息" onClick={() => openSetting("assistant")}/><MemoryManager journeys={journeys} onChanged={onAccountChanged} /></> : null}
        {section === "assistant" ? <div className="bio-card"><AgentSettings onOpenMemory={() => openSetting("memory")} /></div> : null}
        {section === "devices" ? <>
          <p className="bio-settings-description">管理 WHOOP 的连接与授权，身体指标统一在「身体记录」中查看。</p>
          <SettingRow icon="pulse" title="查看身体记录" description="恢复、睡眠与活动记录" onClick={() => navigate("body")} />
          <section className="bio-card"><div className="bio-service"><span className="bio-service-icon"><Icon name="watch" /></span><div><strong>WHOOP 身体记录</strong><small>{whoopLoading ? "正在读取最近记录" : whoopConnected ? "授权已保存；每次规划单独确认是否使用" : whoopDisplay.status === "reauthorization_required" ? "授权已失效，请重新连接" : "授权后可读取恢复与睡眠记录"}{whoopMember.name ? ` · ${whoopDisplay.status === "reauthorization_required" ? "上次 WHOOP 账户" : "WHOOP 账户"}：${whoopMember.name}` : ""}{whoopMember.connectedAt ? ` · 授权于 ${stamp(whoopMember.connectedAt, true)}` : ""}</small></div><ToggleSwitch label="WHOOP 连接" checked={whoopConnected} disabled={Boolean(actionBusy) || whoopLoading || (!whoopConnected && !whoopConfigured)} onChange={enabled => { if (enabled) window.location.assign(new URL("/api/whoop/connect", window.location.origin)); else void disconnect(); }} /></div><div className="bio-service"><span className="bio-service-icon"><Icon name="plane" /></span><div><strong>飞猪旅行</strong><small>目的地服务与真实商品入口</small></div><button type="button" className="bio-service-link" disabled={navigationDisabled} onClick={() => navigate("explore")}>去探索</button></div></section>
          {whoopError ? <p className="bio-inline-note" role="status">{whoopError}</p> : null}
          <button type="button" className="bio-refresh" disabled={whoopLoading || Boolean(actionBusy)} onClick={retryWhoop}>{whoopLoading ? "正在同步身体记录…" : "同步 WHOOP 身体记录"}</button>
        </> : null}
        {section === "security" ? <><SettingRow icon="plane" title="公开分享" description={shares.length ? `${shares.length} 个有效链接` : "管理分享权限与有效期"} onClick={() => openSetting("shares")}/><Link href="/privacy" className="bio-settings-privacy">数据与隐私说明 ↗</Link><PasswordSecurity email={profile.email} hasPassword={hasPassword} onSaved={() => { setHasPassword(true); onAccountChanged(); }} /><button type="button" className="bio-signout" disabled={Boolean(actionBusy)} onClick={signOut}>{actionBusy === "logout" ? "正在退出…" : "退出账户 / 切换账号"}</button></> : null}
        {section === "shares" ? <section className="bio-card"><p className="bio-card-note">分享只包含目的地与公开行程。你可以随时撤回链接。</p>{listErrors.shares ? <p className="account-error">{listErrors.shares}</p> : shares.length ? <div className="bio-managed-list">{shares.map((share) => <div key={share.id}><p><a href={`/share/${share.id}`} target="_blank" rel="noreferrer">{share.destination} · {share.headline} ↗</a><small>{stamp(share.expiresAt)}到期</small></p><button type="button" disabled={Boolean(actionBusy)} onClick={() => revokeShare(share.id)}>{actionBusy === share.id ? "处理中" : "撤回"}</button></div>)}</div> : <p className="bio-empty">你还没有公开分享旅程。</p>}</section> : null}
        {error && loaded && <p className="account-error bio-feedback" role="alert">{error}</p>}{toast && <p className="account-message bio-feedback" role="status">{toast}</p>}
      </>}
    </main>
    {settingDestination ? <Modal title="修改尚未保存" busy={saving} onClose={() => setSettingDestination(null)} footer={<div className="bio-leave-actions"><button type="button" className="account-submit" disabled={saving} onClick={async () => { if (await save()) { setSection(settingDestination); setSettingDestination(null); window.scrollTo(0, 0); } }}>保存并返回</button><button type="button" disabled={saving} onClick={() => setSettingDestination(null)}>继续编辑</button><button type="button" disabled={saving} onClick={() => { setProfile(savedProfile); setSection(settingDestination); setSettingDestination(null); window.scrollTo(0, 0); }}>放弃修改</button></div>}><p>保存后，新的偏好会用于之后的旅行。</p>{error ? <p role="alert" className="account-error">{error}</p> : null}</Modal> : null}
    {leaveDestination ? <Modal hideCloseButton title="个人档案尚未保存" busy={saving} onClose={() => setLeaveDestination(null)} footer={<div className="bio-leave-actions"><button type="button" className="account-submit" disabled={saving} onClick={async () => { if (await save()) { const target=leaveDestination; setLeaveDestination(null); onNavigate(target.next,target.intent); } }}>{saving ? "保存中…" : "保存并离开"}</button><button type="button" disabled={saving} onClick={() => setLeaveDestination(null)}>继续编辑</button><button type="button" disabled={saving} onClick={() => { setProfile(savedProfile); const target=leaveDestination; setLeaveDestination(null); onNavigate(target.next,target.intent); }}>放弃修改</button></div>}><p>这次修改尚未保存到账户，请选择如何离开。</p>{error ? <p className="account-error" role="alert">{error}</p> : null}</Modal> : null}
    <AppDock view="profile" disabled={navigationDisabled} onNavigate={(next) => { if (next === "profile") openSetting("home"); else navigate(next, "tab"); }} />
  </div>;
}

export default ProfileView;
