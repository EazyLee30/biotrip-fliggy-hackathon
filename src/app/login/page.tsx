"use client";

import { Suspense, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Icon from "@/app/components/account-icon";
import "../account.css";

type LoginMode = "password" | "code" | "register" | "reset";

function LoginForm() {
  const params = useSearchParams();
  const rawNext = params.get("next") ?? "/";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") && !/[\\\u0000-\u001f\u007f]/.test(rawNext) ? rawNext : "/";
  const [mode, setMode] = useState<LoginMode>(() => params.get("mode") === "reset" ? "reset" : params.get("mode") === "register" ? "register" : "password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [verifiedAccount, setVerifiedAccount] = useState(false);
  const setup = mode === "register" || mode === "reset";

  useEffect(() => {
    if (!retryAt) return;
    const update = () => setRemaining(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [retryAt]);

  useEffect(() => {
    let active = true;
    void fetch("/api/auth/me", { cache: "no-store" })
      .then((response) => response.json() as Promise<{ signedIn?: boolean; account?: { email: string; has_password?: boolean } }>)
      .then((payload) => {
        if (!active || !payload.signedIn) return;
        if (!payload.account?.has_password && mode !== "reset") {
          setVerifiedAccount(true); setEmail(payload.account?.email || ""); setMode("register");
        } else if (mode === "password" || mode === "code") window.location.replace(next);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [next, mode]);

  function changeMode(value: LoginMode) {
    setMode(value); setSent(false); setCode(""); setPassword(""); setConfirmation("");
    setError(""); setMessage(""); setShowPassword(false);
  }

  async function requestCode() {
    if (setup && (password.length < 12 || password.length > 128 || !password.trim())) {
      setError("密码请使用 12–128 个字符，可以包含空格。"); return;
    }
    if (setup && password !== confirmation) { setError("两次输入的密码不一致。"); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/auth/request-code", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, purpose: setup ? "password" : "login" }),
      });
      const payload = await response.json() as { error?: string; retryAfter?: number };
      if (payload.retryAfter) setRetryAt(Date.now() + payload.retryAfter * 1000);
      if (!response.ok) throw new Error(payload.error || "暂时无法发送验证码。");
      setSent(true); setMessage(`验证码已发送到 ${email}，10 分钟内有效。`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "暂时无法发送验证码。"); }
    finally { setBusy(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode !== "password" && !sent && !verifiedAccount) { await requestCode(); return; }
    if (setup && password !== confirmation) { setError("两次输入的密码不一致。"); return; }
    setBusy(true); setError("");
    try {
      const endpoint = mode === "password" ? "/api/auth/password/login" : setup ? "/api/auth/password" : "/api/auth/verify-code";
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: mode !== "code" ? password : undefined, code: mode !== "password" && !verifiedAccount ? code : undefined, next }),
      });
      const payload = await response.json() as { error?: string; next?: string };
      if (!response.ok) throw new Error(payload.error || "登录没有完成。");
      setPassword(""); setConfirmation("");
      window.location.assign(payload.next || "/");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "登录没有完成。"); }
    finally { setBusy(false); }
  }

  return <main className="account-page bio-account">
    <Link className="account-brand" href="/">BioTrip <span>让旅途照顾好你</span></Link>
    <section className="account-card">
      <div className="section-kicker">你的旅途，你的节奏</div><div className="account-emblem"><Icon name="leaf" size={24} /></div>
      <h1>{mode === "reset" ? <>找回密码，<br /><em>继续你的旅程。</em></> : mode === "register" ? <>第一次相遇，<br /><em>记得你的偏好。</em></> : <>欢迎回来，<br /><em>继续你的旅程。</em></>}</h1>
      <p>{mode === "reset" ? "验证邮箱后设置新密码，我们会让其他设备重新登录。" : mode === "register" ? verifiedAccount ? "邮箱已经验证。现在设置登录密码，下次直接用邮箱和密码登录。" : "首次验证邮箱并设置密码，之后直接用邮箱和密码登录。已有账号也可以在这里设置密码，档案会保留。" : "用邮箱和密码登录，旅程偏好与记忆会保存在个人档案中。"}</p>
      {!setup && <div className="account-tabs" aria-label="登录方式">
        <button type="button" aria-pressed={mode === "password"} disabled={busy} onClick={() => changeMode("password")}>密码登录</button>
        <button type="button" aria-pressed={mode === "code"} disabled={busy} onClick={() => changeMode("code")}>验证码登录</button>
      </div>}
      <form onSubmit={(event) => void submit(event)}>
        <label className="account-field"><span>邮箱地址</span><input type="email" autoComplete="username" inputMode="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" readOnly={sent || verifiedAccount} disabled={busy} /></label>
        {mode !== "code" && <label className="account-field"><span>{setup ? "设置密码" : "密码"}</span><div className="account-password-input"><input type={showPassword ? "text" : "password"} autoComplete={setup ? "new-password" : "current-password"} required minLength={setup ? 12 : 1} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={setup ? "至少 12 个字符" : "输入你的密码"} disabled={busy} /><button type="button" aria-label={showPassword ? "隐藏密码" : "显示密码"} aria-pressed={showPassword} onClick={() => setShowPassword((value) => !value)}>{showPassword ? "隐藏" : "显示"}</button></div>{setup && <small>12–128 个字符，可以使用一句容易记住的话。</small>}</label>}
        {setup && <label className="account-field"><span>确认密码</span><input type={showPassword ? "text" : "password"} autoComplete="new-password" required minLength={12} maxLength={128} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="再输入一次密码" disabled={busy} /></label>}
        {sent && <label className="account-field"><span>邮箱验证码</span><input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="6 位数字" disabled={busy} autoFocus /></label>}
        {message && <p className="account-message" role="status">{message}</p>}
        {error && <p className="account-error" role="alert">{error}</p>}
        <button className="account-submit" type="submit" disabled={busy}>{busy ? "请稍候…" : mode === "password" ? "登录并继续 →" : verifiedAccount ? "设置密码并继续 →" : !sent ? "发送验证邮件 →" : setup ? "保存密码并继续 →" : "验证并继续 →"}</button>
      </form>
      {sent && <div className="account-secondary-actions"><button type="button" disabled={busy || remaining > 0} onClick={() => void requestCode()}>{remaining > 0 ? `${remaining} 秒后可重发` : "重新发送验证码"}</button><button type="button" disabled={busy} onClick={() => { setSent(false); setCode(""); setMessage(""); setError(""); }}>更换邮箱</button></div>}
      {!verifiedAccount && <div className="account-secondary-actions">{setup ? <button type="button" disabled={busy} onClick={() => changeMode("password")}>返回密码登录</button> : <><button type="button" disabled={busy} onClick={() => changeMode("register")}>注册 / 首次设置密码</button><button type="button" disabled={busy} onClick={() => changeMode("reset")}>忘记密码</button></>}</div>}
      <div className="account-privacy">继续即表示你同意数据仅按隐私说明处理。<Link href="/privacy">查看隐私说明</Link></div>
    </section><footer className="account-footer">BioTrip · 让旅途照顾好今天的你</footer>
  </main>;
}

export default function LoginPage() {
  return <Suspense fallback={<main className="account-page bio-account"><div className="account-loading">正在打开 BioTrip…</div></main>}><LoginForm /></Suspense>;
}
