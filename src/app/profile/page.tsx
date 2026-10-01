"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import PasswordSecurity from "@/app/components/password-security";
import Icon from "@/app/components/account-icon";
import { LearnedPreferencesBlock } from "@/app/components/planner/blocks/learned-preferences";
import type { Journey, JourneyMemory } from "@/lib/journey-types";
import type { LearnedPreference, PreferenceDefaults } from "@/lib/preferences";
import "../account.css";

type Profile = {
  displayName: string; email: string; homeCity: string;
  travelStyle: "flexible" | "structured"; foodPreferences: string;
  sensoryPreferences: string[]; memoryNotes: string;
};
type Summary = { recoveryScore: number | null; hrvRmssdMilli: number | null; sleepMinutes: number | null; measuredAt: string | null };
type ShareEntry = { id: string; destination: string; headline: string; expiresAt: number };
const EMPTY: Profile = { displayName: "", email: "", homeCity: "", travelStyle: "flexible", foodPreferences: "", sensoryPreferences: [], memoryNotes: "" };
const SENSORY = ["安静少噪", "自然气息", "柔和光线", "人少宽松", "慢节奏", "少走路"];
const PREFERENCE_GROUPS: Array<{ kind: LearnedPreference["kind"]; title: string }> = [
  { kind: "rhythm", title: "安排方式" },
  { kind: "intention", title: "旅行意图" },
  { kind: "ambience", title: "空间氛围" },
  { kind: "tone", title: "个人色调" },
  { kind: "service", title: "常用服务" },
  { kind: "food", title: "饮食习惯" },
  { kind: "destination", title: "去过的城市" },
  { kind: "schedule", title: "节奏习惯" },
];
const GARDEN = "/design/profile_zen_modern-2.jpg";

async function readPayload(response: Response): Promise<Record<string, unknown>> {
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "请求暂时无法完成，请重试。");
  return payload;
}
function stamp(value: string | number, withTime = false) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", ...(withTime ? { timeStyle: "short" as const } : {}) }).format(new Date(typeof value === "number" ? value * 1000 : value));
}

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile>(EMPTY);
  const [savedProfile, setSavedProfile] = useState<Profile>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [hasPassword, setHasPassword] = useState(false);
  const [whoopConnected, setWhoopConnected] = useState(false);
  const [whoopConfigured, setWhoopConfigured] = useState(false);
  const [whoopLoading, setWhoopLoading] = useState(true);
  const [whoopError, setWhoopError] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [shares, setShares] = useState<ShareEntry[]>([]);
  const [memories, setMemories] = useState<JourneyMemory[]>([]);
  const [preferences, setPreferences] = useState<LearnedPreference[]>([]);
  const [preferenceDefaults, setPreferenceDefaults] = useState<PreferenceDefaults | null>(null);
  const [whoopMember, setWhoopMember] = useState<{ name: string; connectedAt: string | null }>({ name: "", connectedAt: null });
  const [listErrors, setListErrors] = useState<Record<string, string>>({});
  const [actionBusy, setActionBusy] = useState("");
  const actionLock = useRef(false);
  const editor = useRef<HTMLDivElement>(null);
  const dirty = JSON.stringify(profile) !== JSON.stringify(savedProfile);
  const active = journeys.find((journey) => journey.status === "active");

  useEffect(() => {
    const abort = new AbortController();
    const get = (path: string) => fetch(path, { cache: "no-store", signal: abort.signal });
    void (async () => {
      try {
        const response = await get("/api/profile");
        if (response.status === 401) { window.location.replace("/login?next=%2Fprofile"); return; }
        const payload = await readPayload(response);
        if (abort.signal.aborted) return;
        const account = payload.account as { email: string; display_name: string; has_password: boolean };
        const value = { ...EMPTY, ...(payload.profile as Partial<Profile> | null), email: account.email, displayName: account.display_name || "" };
        setProfile(value); setSavedProfile(value); setHasPassword(Boolean(account.has_password)); setLoaded(true);
      } catch (caught) {
        if (!abort.signal.aborted) setError(caught instanceof Error ? caught.message : "读取个人档案失败。");
      } finally { if (!abort.signal.aborted) setLoading(false); }
    })();
    void (async () => {
      try {
        const payload = await readPayload(await get("/api/whoop/status"));
        if (abort.signal.aborted) return;
        const connected = Boolean(payload.connected);
        setWhoopConnected(connected); setWhoopConfigured(Boolean(payload.configured)); setWhoopError("");
        setWhoopMember({ name: typeof payload.memberName === "string" ? payload.memberName : "", connectedAt: typeof payload.connectedAt === "string" ? payload.connectedAt : null });
        if (!connected) { setSummary(null); return; }
        const data = await readPayload(await get("/api/whoop/summary"));
        if (!abort.signal.aborted) setSummary((data.summary as Summary | null) ?? null);
      } catch (caught) {
        if (!abort.signal.aborted) setWhoopError(caught instanceof Error ? caught.message : "身体记录暂时无法同步。");
      } finally { if (!abort.signal.aborted) setWhoopLoading(false); }
    })();
    for (const [name, path] of [["journeys", "/api/journeys"], ["shares", "/api/share"], ["memories", "/api/memory"], ["preferences", "/api/preferences"]] as const) {
      void get(path).then(readPayload).then((payload) => {
        if (abort.signal.aborted) return;
        if (name === "journeys") setJourneys(payload.journeys as Journey[]);
        if (name === "shares") setShares(payload.shares as ShareEntry[]);
        if (name === "memories") setMemories(payload.memories as JourneyMemory[]);
        if (name === "preferences") {
          setPreferences(payload.preferences as LearnedPreference[]);
          setPreferenceDefaults(payload.defaults as PreferenceDefaults);
        }
      }).catch((caught) => {
        if (!abort.signal.aborted) setListErrors((current) => ({ ...current, [name]: caught instanceof Error ? caught.message : "暂时无法读取。" }));
      });
    }
    return () => abort.abort();
  }, [reload]);

  useEffect(() => {
    if (!dirty) return;
    const preventLoss = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [dirty]);

  function refresh() { setLoading(true); setWhoopLoading(true); setError(""); setListErrors({}); setReload((value) => value + 1); }
  function update<K extends keyof Profile>(key: K, value: Profile[K]) { setProfile((current) => ({ ...current, [key]: value })); setToast(""); }
  function toggle(item: string) {
    setProfile((current) => ({ ...current, sensoryPreferences: current.sensoryPreferences.includes(item) ? current.sensoryPreferences.filter((value) => value !== item) : [...current.sensoryPreferences, item] }));
    setToast("");
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (saving) return;
    setSaving(true); setError(""); setToast("");
    const submitted = { ...profile, sensoryPreferences: [...profile.sensoryPreferences] };
    try {
      await readPayload(await fetch("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(submitted) }));
      setSavedProfile(submitted); setToast("个人档案已保存，下次规划可直接使用这些偏好。");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "档案暂时无法保存。"); }
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
      setWhoopConnected(false); setSummary(null); setWhoopError("");
      setWhoopMember({ name: "", connectedAt: null });
      setToast(payload.revoked ? "已断开 WHOOP，并撤销授权。所有设备都不再读取你的身体记录。" : "已断开本账户的 WHOOP 连接；如需撤销全部授权，可在 WHOOP 中管理连接。");
    });
  }
  /** Reuses the shared action lock so a stale row cannot be deleted twice. */
  function forgetPreference(id: string) {
    void action(id, async () => {
      const payload = await readPayload(await fetch("/api/preferences", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }));
      setPreferences(payload.preferences as LearnedPreference[]);
      setPreferenceDefaults(payload.defaults as PreferenceDefaults);
      setToast("已忘记这条偏好，之后不会再自动带入。");
    });
  }
  function forgetAllPreferences() {
    if (!window.confirm("确定清除全部自动记忆吗？你手动填写的旅程记忆和个人档案不会被删除。")) return;
    void action("preferences-all", async () => {
      const payload = await readPayload(await fetch("/api/preferences", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ all: true }) }));
      setPreferences(payload.preferences as LearnedPreference[]);
      setPreferenceDefaults(payload.defaults as PreferenceDefaults);
      setToast("已清除全部自动记忆。");
    });
  }
  function forgetMemory(id: string) {
    void action(id, async () => {
      await readPayload(await fetch("/api/memory", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }));
      setMemories((current) => current.filter((item) => item.id !== id)); setToast("这条旅程偏好已忘记。");
    });
  }
  function revokeShare(id: string) {
    void action(id, async () => {
      await readPayload(await fetch(`/api/share/${encodeURIComponent(id)}`, { method: "DELETE" }));
      setShares((current) => current.filter((share) => share.id !== id)); setToast("公开分享链接已撤回。");
    });
  }
  function editProfile() {
    setEditing(true);
    window.setTimeout(() => { editor.current?.scrollIntoView({ behavior: "smooth", block: "center" }); editor.current?.querySelector("input")?.focus({ preventScroll: true }); }, 0);
  }

  const healthStatus = whoopLoading ? "同步中" : whoopError ? "待重试" : whoopConnected ? "已同步" : "未连接";
  const name = profile.displayName || profile.email.split("@")[0] || "旅行者";
  const metrics = [
    { name: "恢复指数", value: summary?.recoveryScore == null ? "—" : Math.round(summary.recoveryScore), unit: "% · WHOOP", icon: "leaf" as const, progress: summary?.recoveryScore },
    { name: "心率变异性", value: summary?.hrvRmssdMilli == null ? "—" : summary.hrvRmssdMilli.toFixed(1), unit: "毫秒 · HRV", icon: "pulse" as const },
    { name: "最近睡眠", value: summary?.sleepMinutes == null ? "—" : (summary.sleepMinutes / 60).toFixed(1), unit: "小时 · 实际记录", icon: "moon" as const },
  ];

  return <div className="bio-profile">
    <header className="bio-profile-topbar"><div><span><Icon name="pin" size={16} />{active?.draft.trip?.destinationCity || "你的个人档案"}</span><small>{active ? "旅途中 · 我的" : "BioTrip · 我的"}</small></div><div className="bio-profile-top-actions"><span className="bio-status"><i /><Icon name="sync" size={14} />{healthStatus}</span><span className="bio-user-mini"><Icon name="user" size={18} /></span></div></header>
    <main className="bio-profile-main">
      {loading ? <div className="bio-loading" role="status">正在读取你的个人档案…</div> : !loaded ? <section className="bio-card"><h1>暂时无法打开档案</h1><p className="account-error" role="alert">{error}</p><button type="button" className="account-submit" onClick={refresh}>重新加载</button></section> : <>
        <form className="bio-profile-form" onSubmit={(event) => void save(event)}>
          <section className="bio-card bio-identity">
            <div className="bio-identity-row"><div className="bio-avatar">{name.slice(0, 1).toUpperCase()}</div><div className="bio-identity-copy"><h1>{name}<i /></h1><strong>{journeys.filter((journey) => journey.status === "completed").length} 次已完成旅程</strong><p>{profile.homeCity ? `常住城市 · ${profile.homeCity}` : "把旅途交给自己的节奏"}</p></div><button type="button" className="bio-edit" aria-label="编辑个人资料" onClick={editProfile}><Icon name="edit" size={18} /></button></div>
            <div className="bio-ribbons"><span><i />WHOOP · {whoopConnected ? "已连接" : "未连接"}</span><span><Icon name="compass" size={13} />{profile.travelStyle === "structured" ? "有序安排" : "留白探索"}</span><span><Icon name="shield" size={13} />账户私有档案</span></div>
            {editing && <div className="bio-editor" ref={editor}><label className="account-field"><span>怎么称呼你</span><input maxLength={80} value={profile.displayName} onChange={(event) => update("displayName", event.target.value)} placeholder="你的称呼" /></label><label className="account-field"><span>常住城市</span><input maxLength={100} value={profile.homeCity} onChange={(event) => update("homeCity", event.target.value)} placeholder="例如：上海" /></label><label className="account-field"><span>登录邮箱</span><input value={profile.email} readOnly type="email" /></label><button type="button" className="bio-text-button" onClick={() => setEditing(false)}>收起资料</button></div>}
          </section>
          <section className="bio-metrics" aria-label="最近的身体记录">{metrics.map((metric) => <div className="bio-metric" key={metric.name}><div><span>{metric.name}</span><Icon name={metric.icon} size={16} /></div><strong>{metric.value}</strong><small>{whoopLoading ? "正在同步…" : metric.value === "—" ? "暂无记录" : metric.unit}</small><div className="bio-metric-track">{metric.progress != null && <span style={{ width: `${Math.max(0, Math.min(100, metric.progress))}%` }} />}</div></div>)}</section>
          {whoopError && <p className="bio-inline-note" role="status">{whoopError}<button type="button" disabled={dirty} onClick={refresh}>{dirty ? "请先保存档案" : "重试同步"}</button></p>}
          {summary?.measuredAt && <p className="bio-measured">最近记录：{stamp(summary.measuredAt, true)}。身体数据用于参考，不代表未来出行状态。</p>}
          <section className="bio-card"><div className="bio-card-heading"><h2><span><Icon name="leaf" size={17} /></span>旅行节奏</h2><small>{dirty ? "有未保存更改" : "你的默认偏好"}</small></div><div className="bio-pace"><button type="button" aria-pressed={profile.travelStyle === "structured"} onClick={() => update("travelStyle", "structured")}>有序安排</button><button type="button" aria-pressed={profile.travelStyle === "flexible"} onClick={() => update("travelStyle", "flexible")}>留白探索</button><Link href="/?view=create">本次自选 ↗</Link></div><div className="bio-pace-description"><Icon name="leaf" size={18} /><p>{profile.travelStyle === "structured" ? "优先保留明确的时间安排和已预约项目，在空闲时段加入休息，让每一步更从容。" : "保留已预约项目，为散步、休息和临时发现留出空间。每次调整都由你确认。"}</p></div><fieldset className="bio-preferences"><legend>环境与感官偏好</legend><div>{SENSORY.map((item) => <button key={item} type="button" aria-pressed={profile.sensoryPreferences.includes(item)} onClick={() => toggle(item)}>{item}</button>)}</div></fieldset><label className="account-field"><span>饮食偏好或限制</span><input maxLength={500} value={profile.foodPreferences} onChange={(event) => update("foodPreferences", event.target.value)} placeholder="例如：素食、少辣" /></label></section>
          <section className="bio-card"><div className="bio-card-heading"><h2><span><Icon name="watch" size={17} /></span>设备与旅行服务</h2><small>{whoopConnected ? "WHOOP 已连接" : "等待连接"}</small></div><div className="bio-service"><span className="bio-service-icon"><Icon name="watch" /></span><div><strong>WHOOP 身体记录</strong><small>{whoopLoading ? "正在同步最近记录" : whoopConnected ? "规划前单独确认数据授权" : "连接后可读取恢复与睡眠记录"}</small></div>{whoopConnected ? <button className="bio-switch" type="button" role="switch" aria-label="断开 WHOOP" aria-checked="true" disabled={Boolean(actionBusy) || whoopLoading} onClick={disconnect}><span /></button> : whoopConfigured && !whoopLoading ? <a className="bio-switch" href="/api/whoop/connect" role="switch" aria-label="连接 WHOOP" aria-checked="false"><span /></a> : <button className="bio-switch" type="button" role="switch" aria-label={whoopLoading ? "正在读取 WHOOP 连接状态" : "WHOOP 暂时不可连接"} aria-checked="false" disabled><span /></button>}</div><div className="bio-service"><span className="bio-service-icon"><Icon name="plane" /></span><div><strong>飞猪旅行</strong><small>目的地服务与真实商品入口</small></div><Link className="bio-service-link" href="/?view=explore">去探索</Link></div><Link className="bio-garden" href="/?view=explore"><Image src={GARDEN} alt="静谧的庭院与日式建筑" fill sizes="(max-width: 600px) 90vw, 620px" unoptimized /><span><small>留一点空白给旅途</small><strong>寻找让身心放松的地方</strong></span></Link></section>
          <section className="bio-card"><div className="bio-card-heading"><h2><span><Icon name="shield" size={17} /></span>旅途守护</h2><Icon name="shield" size={18} /></div><div className="bio-safeguard"><div><strong>疲劳时温和调整</strong><p>结合最近身体记录和你的感受提出建议，是否采用由你决定。</p></div><Link href="/?view=adjust" aria-label="调整当前行程"><Icon name="sliders" size={20} /></Link></div><div className="bio-safeguard"><div><strong>保留固定预约</strong><p>重新规划时保留已标记的预约时间与项目。</p></div><span className="bio-verified" aria-label="默认启用"><Icon name="check" size={18} /></span></div><div className="bio-safeguard"><div><strong>健康资料按次授权</strong><p>发送给规划服务前会展示本次使用的资料。健康记录不写入公开分享。</p></div><Link href="/privacy" aria-label="查看隐私说明"><Icon name="lock" size={20} /></Link></div></section>
          <section className="bio-card"><div className="bio-card-heading"><h2><span><Icon name="compass" size={17} /></span>旅程记忆</h2><small>仅此账户可见</small></div><label className="account-field"><span>想让下次旅途记住什么</span><textarea maxLength={5000} rows={3} value={profile.memoryNotes} onChange={(event) => update("memoryNotes", event.target.value)} placeholder="例如：抵达当天留出午休，不喜欢一早赶行程…" /><small>这些文字仅在你确认本次规划授权后使用。</small></label>{listErrors.memories ? <p className="account-error">{listErrors.memories}</p> : memories.length ? <div className="bio-managed-list">{memories.map((memory) => <div key={memory.id}><p>{memory.note}<small>{stamp(memory.createdAt)}</small></p><button type="button" disabled={Boolean(actionBusy)} onClick={() => forgetMemory(memory.id)}>{actionBusy === memory.id ? "处理中" : "忘记"}</button></div>)}</div> : <p className="bio-empty">旅途中保存的偏好会出现在这里。</p>}</section>
          <LearnedPreferencesBlock preferences={preferences} defaults={preferenceDefaults} busyId={actionBusy} onForget={forgetPreference} onForgetAll={forgetAllPreferences} />
          {error && <p className="account-error bio-feedback" role="alert">{error}</p>}{toast && <p className="account-message bio-feedback" role="status">{toast}</p>}
          <button className="account-submit bio-save" type="submit" disabled={saving || !dirty}><Icon name="sync" size={18} />{saving ? "正在保存档案…" : dirty ? "保存个人档案" : "个人档案已保存"}</button>
        </form>
        <PasswordSecurity email={profile.email} hasPassword={hasPassword} onSaved={() => setHasPassword(true)} />
        <section className="bio-card"><div className="bio-card-heading"><h2><span><Icon name="compass" size={17} /></span>公开分享</h2><small>{shares.length} 个有效链接</small></div><p className="bio-card-note">分享只包含目的地与公开行程。你可以随时撤回链接。</p>{listErrors.shares ? <p className="account-error">{listErrors.shares}</p> : shares.length ? <div className="bio-managed-list">{shares.map((share) => <div key={share.id}><p><a href={`/share/${share.id}`} target="_blank" rel="noreferrer">{share.destination} · {share.headline} ↗</a><small>{stamp(share.expiresAt)}到期</small></p><button type="button" disabled={Boolean(actionBusy)} onClick={() => revokeShare(share.id)}>{actionBusy === share.id ? "处理中" : "撤回"}</button></div>)}</div> : <p className="bio-empty">你还没有公开分享旅程。</p>}</section>
        {listErrors.journeys && <p className="account-error">{listErrors.journeys}</p>}
        <button type="button" className="bio-refresh" disabled={whoopLoading || Boolean(actionBusy) || dirty} onClick={refresh}><Icon name="sync" size={18} />{whoopLoading ? "正在同步身体记录…" : dirty ? "保存档案后可同步" : "同步身体记录与旅程"}</button>
        <button type="button" className="bio-signout" disabled={Boolean(actionBusy)} onClick={signOut}>{actionBusy === "logout" ? "正在退出…" : "退出账户 / 切换账号"}</button>
      </>}
    </main>
    <nav className="bio-profile-dock" aria-label="主要导航"><Link href="/?view=today"><Icon name="sun" />今日</Link><Link href="/?view=adjust"><Icon name="sliders" />调整</Link><Link href="/?view=explore"><Icon name="compass" />探索</Link><Link href="/profile" aria-current="page"><Icon name="user" />我的</Link></nav>
  </div>;
}
