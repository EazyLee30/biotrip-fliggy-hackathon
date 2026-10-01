"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";

type Props = { email: string; hasPassword: boolean; onSaved: () => void };

export default function PasswordSecurity({ email, hasPassword, onSaved }: Props) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [retryAt, setRetryAt] = useState(0);
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!retryAt) return;
    const update = () => setRemaining(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [retryAt]);

  async function requestCode() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/request-code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, purpose: "password" }) });
      const payload = await response.json() as { error?: string; retryAfter?: number };
      if (payload.retryAfter) setRetryAt(Date.now() + payload.retryAfter * 1000);
      if (!response.ok) throw new Error(payload.error || "发送验证邮件失败。");
      setSent(true); setMessage(`验证码已发送到 ${email}，10 分钟内有效。`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "发送验证邮件失败。"); }
    finally { setBusy(false); }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirmation) { setError("两次输入的密码不一致。"); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, code, password, next: "/profile" }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "保存密码失败。");
      setPassword(""); setConfirmation(""); setCode(""); setSent(false); setOpen(false);
      setMessage("密码已更新，下次可以直接使用邮箱和密码登录。其他设备需重新登录。");
      onSaved();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "保存密码失败。"); }
    finally { setBusy(false); }
  }

  return <section className="profile-section profile-password">
    <div><h2>登录与安全</h2><p>{hasPassword ? "已设置登录密码。" : "首次设置密码后，日常登录无需邮件验证码。"}</p></div>
    <div className="profile-fields">
      {!open ? <button type="button" className="password-settings-trigger" onClick={() => { setOpen(true); setError(""); setMessage(""); }}>{hasPassword ? "修改登录密码" : "设置登录密码"} →</button> : <form className="password-settings-form" onSubmit={(event) => void save(event)}>
        <label className="account-field"><span>验证登录邮箱</span><input value={email} type="email" readOnly autoComplete="username" /></label>
        {hasPassword ? <div className="account-secondary-actions"><button type="button" disabled={busy || remaining > 0} onClick={() => void requestCode()}>{remaining > 0 ? `${remaining} 秒后可重发` : sent ? "重新发送验证码" : "发送验证邮件"}</button></div> : <p className="account-message">当前登录邮箱已验证，首次设置无需再次收取验证码。</p>}
        {hasPassword && sent && <label className="account-field"><span>邮箱验证码</span><input required autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="6 位数字" disabled={busy} /></label>}
        {(sent || !hasPassword) && <>
          <label className="account-field"><span>新密码</span><input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="12–128 个字符" disabled={busy} /><small>可以使用一句容易记住的话。修改后其他设备需重新登录。</small></label>
          <label className="account-field"><span>确认新密码</span><input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={busy} /></label>
          <button type="submit" className="account-submit" disabled={busy}>{busy ? "正在保存…" : "保存登录密码"}</button></>}
        <button type="button" className="account-resend" disabled={busy} onClick={() => { setOpen(false); setPassword(""); setConfirmation(""); setCode(""); setSent(false); setError(""); setMessage(""); }}>收起</button>
      </form>}
      {message && <p className="account-message" role="status">{message}</p>}{error && <p className="account-error" role="alert">{error}</p>}
    </div>
  </section>;
}
