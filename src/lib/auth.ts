import { createHash, createHmac, randomBytes, randomInt, randomUUID } from "node:crypto";
import { env } from "cloudflare:workers";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "__Host-biotrip-session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const CODE_TTL_SECONDS = 10 * 60;
const CODE_RESEND_SECONDS = 60;
const MAX_CODE_ATTEMPTS = 5;
// Workers WebCrypto supports up to 100,000 PBKDF2 iterations. The input is
// additionally peppered with AUTH_SECRET, which is kept outside the database.
const PASSWORD_ITERATIONS = 100_000;
const DUMMY_PASSWORD_SALT = "00000000000000000000000000000000";

type CodePurpose = "login" | "password";
export type Account = { id: string; email: string; display_name: string; has_password: boolean };
type PasswordRecord = { password_hash: string; salt: string; iterations: number };

export class AuthRateLimitError extends Error {
  constructor(public readonly retryAfter: number) {
    super("操作太频繁，请稍后再试。");
  }
}

export function getDatabase() { return env.BIOTRIP_DB; }

function requiredSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("Authentication is not configured.");
  return secret;
}

function codeDigest(email: string, code: string, purpose: CodePurpose) {
  // Keep existing login codes usable through the schema migration.
  const input = purpose === "login" ? `${email}:${code}` : `${purpose}:${email}:${code}`;
  return createHmac("sha256", requiredSecret()).update(input).digest("hex");
}

function sessionDigest(token: string) { return createHash("sha256").update(token).digest("hex"); }

export function normalizeEmail(value: unknown) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function safeAuthNext(value: unknown) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") &&
    !/[\\\u0000-\u001f\u007f]/.test(value) ? value : "/";
}

export function passwordValidationError(value: unknown) {
  if (typeof value !== "string" || value.length < 12 || value.length > 128 || !value.trim()) {
    return "密码请使用 12–128 个字符，可以包含空格。";
  }
  return null;
}

async function consumeLimit(scope: string, subject: string, maximum: number, windowSeconds: number) {
  const database = getDatabase();
  const now = Math.floor(Date.now() / 1000);
  const key = createHmac("sha256", requiredSecret()).update(`${scope}:${subject}`).digest("hex");
  const record = await database.prepare(`INSERT INTO auth_rate_limits (limit_key, hit_count, reset_at)
    VALUES (?, 1, ?)
    ON CONFLICT(limit_key) DO UPDATE SET
      hit_count = CASE WHEN auth_rate_limits.reset_at <= ? THEN 1 ELSE auth_rate_limits.hit_count + 1 END,
      reset_at = CASE WHEN auth_rate_limits.reset_at <= ? THEN excluded.reset_at ELSE auth_rate_limits.reset_at END
    RETURNING hit_count, reset_at`)
    .bind(key, now + windowSeconds, now, now).first<{ hit_count: number; reset_at: number }>();
  if (!record || record.hit_count > maximum) {
    throw new AuthRateLimitError(Math.max(1, (record?.reset_at ?? now + windowSeconds) - now));
  }
}

export async function checkAuthRateLimit(request: Request, email: string, action: "send" | "verify" | "password") {
  const ip = request.headers.get("cf-connecting-ip") || "local";
  const windowSeconds = action === "send" ? 3600 : 900;
  await consumeLimit(`${action}:ip`, ip, action === "send" ? 20 : 50, windowSeconds);
  await consumeLimit(`${action}:email`, email, action === "send" ? 8 : 15, windowSeconds);
  // Delete expired buckets without retaining raw IP addresses or email addresses.
  await getDatabase().prepare("DELETE FROM auth_rate_limits WHERE reset_at < ?")
    .bind(Math.floor(Date.now() / 1000) - 3600).run();
}

async function sendCodeEmail(email: string, code: string, purpose: CodePurpose) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("Resend is not configured.");
  const action = purpose === "password" ? "设置或重置密码" : "登录";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL || "BioTrip <login@notify.biotrip.ccwu.cc>",
      to: [email],
      subject: `BioTrip ${action}验证码`,
      text: `你的 BioTrip ${action}验证码是 ${code}，10 分钟内有效。若这不是你的操作，请忽略此邮件。`,
      html: `<div style="font-family:system-ui,sans-serif;color:#294a3e"><p>你的 BioTrip ${action}验证码</p><p style="font-size:32px;letter-spacing:8px;font-weight:700">${code}</p><p>10 分钟内有效。若这不是你的操作，请忽略此邮件。</p></div>`,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Resend rejected the verification email.");
}

export async function sendLoginCode(email: string, purpose: CodePurpose = "login") {
  const database = getDatabase();
  const now = Math.floor(Date.now() / 1000);
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const digest = codeDigest(email, code, purpose);
  const reserved = await database.prepare(`INSERT INTO login_codes (email, code_hash, attempts, created_at, expires_at, purpose)
    VALUES (?, ?, 0, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, attempts = 0,
      created_at = excluded.created_at, expires_at = excluded.expires_at, purpose = excluded.purpose
    WHERE login_codes.created_at <= ?`)
    .bind(email, digest, now, now + CODE_TTL_SECONDS, purpose, now - CODE_RESEND_SECONDS).run();
  if (reserved.meta.changes !== 1) {
    const previous = await database.prepare("SELECT created_at FROM login_codes WHERE email = ?")
      .bind(email).first<{ created_at: number }>();
    throw new AuthRateLimitError(Math.max(1, CODE_RESEND_SECONDS - (now - (previous?.created_at ?? now))));
  }
  try { await sendCodeEmail(email, code, purpose); }
  catch {
    await database.prepare("DELETE FROM login_codes WHERE email = ? AND code_hash = ?").bind(email, digest).run();
    throw new Error("暂时无法发送验证邮件，请稍后重试。");
  }
  return { retryAfter: CODE_RESEND_SECONDS };
}

async function consumeCode(email: string, code: string, purpose: CodePurpose) {
  const database = getDatabase();
  const now = Math.floor(Date.now() / 1000);
  const record = await database.prepare("SELECT code_hash, attempts, expires_at, purpose FROM login_codes WHERE email = ?")
    .bind(email).first<{ code_hash: string; attempts: number; expires_at: number; purpose: CodePurpose }>();
  if (!record || record.expires_at <= now || record.attempts >= MAX_CODE_ATTEMPTS || record.purpose !== purpose) return false;
  const submittedDigest = codeDigest(email, code, purpose);
  if (!timingSafeHexEqual(submittedDigest, record.code_hash)) {
    await database.prepare("UPDATE login_codes SET attempts = attempts + 1 WHERE email = ? AND code_hash = ?")
      .bind(email, record.code_hash).run();
    return false;
  }
  const consumed = await database.prepare("DELETE FROM login_codes WHERE email = ? AND code_hash = ? AND expires_at > ? AND attempts < ? AND purpose = ?")
    .bind(email, record.code_hash, now, MAX_CODE_ATTEMPTS, purpose).run();
  return consumed.meta.changes === 1;
}

async function accountByEmail(email: string) {
  const record = await getDatabase().prepare(`SELECT a.id, a.email, a.display_name,
    CASE WHEN p.account_id IS NULL THEN 0 ELSE 1 END AS has_password
    FROM accounts a LEFT JOIN account_passwords p ON p.account_id = a.id WHERE a.email = ?`)
    .bind(email).first<Omit<Account, "has_password"> & { has_password: number }>();
  return record ? { ...record, has_password: Boolean(record.has_password) } : null;
}

async function getOrCreateAccount(email: string) {
  const database = getDatabase();
  await database.prepare("INSERT INTO accounts (id, email) VALUES (?, ?) ON CONFLICT(email) DO NOTHING")
    .bind(randomUUID(), email).run();
  const account = await accountByEmail(email);
  if (!account) throw new Error("Could not create the account.");
  await database.prepare("INSERT INTO profiles (account_id) VALUES (?) ON CONFLICT(account_id) DO NOTHING")
    .bind(account.id).run();
  return account;
}

async function createSession(account: Account, passwordGuard?: PasswordRecord) {
  const now = Math.floor(Date.now() / 1000);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = now + SESSION_TTL_SECONDS;
  const statement = passwordGuard
    ? getDatabase().prepare(`INSERT INTO sessions (token_hash, account_id, expires_at)
      SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM account_passwords
      WHERE account_id = ? AND password_hash = ? AND salt = ?)`)
      .bind(sessionDigest(token), account.id, expiresAt, account.id, passwordGuard.password_hash, passwordGuard.salt)
    : getDatabase().prepare("INSERT INTO sessions (token_hash, account_id, expires_at) VALUES (?, ?, ?)")
      .bind(sessionDigest(token), account.id, expiresAt);
  const result = await statement.run();
  if (result.meta.changes !== 1) return null;
  return { account, token, expiresAt };
}

export async function verifyLoginCode(email: string, code: string) {
  if (!await consumeCode(email, code, "login")) return null;
  return createSession(await getOrCreateAccount(email));
}

async function derivePassword(password: string, salt: string, iterations: number) {
  // HMAC is a keyed pre-hash, never persisted; use native WebCrypto for PBKDF2.
  const material = createHmac("sha256", requiredSecret()).update(`biotrip-password-v1:${password}`).digest();
  const key = await crypto.subtle.importKey("raw", new Uint8Array(material), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new Uint8Array(Buffer.from(salt, "hex")), iterations }, key, 256);
  return Buffer.from(bits).toString("hex");
}

export async function signInWithPassword(email: string, password: string) {
  const account = await accountByEmail(email);
  const record = account ? await getDatabase().prepare("SELECT password_hash, salt, iterations FROM account_passwords WHERE account_id = ?")
    .bind(account.id).first<PasswordRecord>() : null;
  // Unknown email and accounts without a password perform the same work and
  // produce the same response as an incorrect password.
  const digest = await derivePassword(password, record?.salt ?? DUMMY_PASSWORD_SALT, record?.iterations ?? PASSWORD_ITERATIONS);
  if (!account || !record || !timingSafeHexEqual(digest, record.password_hash)) return null;
  return createSession(account, record);
}

export async function setPasswordWithCode(email: string, code: string, password: string) {
  if (!await consumeCode(email, code, "password")) return null;
  const account = await getOrCreateAccount(email);
  const salt = randomBytes(16).toString("hex");
  const passwordHash = await derivePassword(password, salt, PASSWORD_ITERATIONS);
  await getDatabase().batch([
    getDatabase().prepare(`INSERT INTO account_passwords (account_id, password_hash, salt, iterations)
      VALUES (?, ?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET password_hash = excluded.password_hash,
      salt = excluded.salt, iterations = excluded.iterations, updated_at = unixepoch()`)
      .bind(account.id, passwordHash, salt, PASSWORD_ITERATIONS),
    getDatabase().prepare("DELETE FROM sessions WHERE account_id = ?").bind(account.id),
  ]);
  // Setting/resetting a password rotates all sessions and signs in this device.
  return createSession({ ...account, has_password: true }, { password_hash: passwordHash, salt, iterations: PASSWORD_ITERATIONS });
}

/** The verified session can set its first password without a second email. */
export async function setInitialPassword(account: Account, password: string) {
  if (account.has_password) return null;
  const salt = randomBytes(16).toString("hex");
  const passwordHash = await derivePassword(password, salt, PASSWORD_ITERATIONS);
  const results = await getDatabase().batch([
    getDatabase().prepare(`INSERT INTO account_passwords (account_id, password_hash, salt, iterations)
      VALUES (?, ?, ?, ?) ON CONFLICT(account_id) DO NOTHING`)
      .bind(account.id, passwordHash, salt, PASSWORD_ITERATIONS),
    getDatabase().prepare("DELETE FROM sessions WHERE account_id = ? AND changes() = 1").bind(account.id),
  ]);
  // A session that has not set a password may never replace an existing one.
  if (results[0].meta.changes !== 1) return null;
  return createSession({ ...account, has_password: true }, { password_hash: passwordHash, salt, iterations: PASSWORD_ITERATIONS });
}

function timingSafeHexEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}

export async function getCurrentAccount(): Promise<Account | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || token.length > 100) return null;
  const now = Math.floor(Date.now() / 1000);
  const record = await getDatabase().prepare(`SELECT a.id, a.email, a.display_name,
      CASE WHEN p.account_id IS NULL THEN 0 ELSE 1 END AS has_password
      FROM sessions s JOIN accounts a ON a.id = s.account_id
      LEFT JOIN account_passwords p ON p.account_id = a.id
      WHERE s.token_hash = ? AND s.expires_at > ? LIMIT 1`)
    .bind(sessionDigest(token), now).first<Omit<Account, "has_password"> & { has_password: number }>();
  if (!record) return null;
  await getDatabase().prepare("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?").bind(now, sessionDigest(token)).run();
  return { ...record, has_password: Boolean(record.has_password) };
}

export async function revokeCurrentSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await getDatabase().prepare("DELETE FROM sessions WHERE token_hash = ?").bind(sessionDigest(token)).run();
}

export function setSessionCookie(response: Response, token: string, expiresAt: number) {
  const maxAge = Math.max(0, expiresAt - Math.floor(Date.now() / 1000));
  response.headers.append("Set-Cookie", `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`);
}

export function clearSessionCookie(response: Response) {
  response.headers.append("Set-Cookie", `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
}

export function isSameOrigin(request: Request) { return request.headers.get("origin") === new URL(request.url).origin; }
