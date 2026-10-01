import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { cookies } from "next/headers";
import { getDatabase } from "@/lib/auth";

const WHOOP_BASE_URL = "https://api.prod.whoop.com";
const AUTH_BASE_URL = `${WHOOP_BASE_URL}/oauth/oauth2`;
const TOKEN_COOKIE_TTL_SECONDS = 60 * 60 * 24 * 30;
export const OAUTH_STATE_COOKIE = "biotrip-whoop-oauth-state";

export const WHOOP_SCOPES = [
  "offline",
  "read:recovery",
  "read:cycles",
  "read:sleep",
  "read:workout",
  "read:profile",
  "read:body_measurement",
] as const;

export type WhoopTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
};

export type WhoopConnectionMeta = {
  connectedAt: string;
  updatedAt: string;
  displayName: string;
  memberEmail: string;
};

type WhoopApiCollection<T> = {
  records?: T[];
  next_token?: string;
};

type ConnectionRow = {
  token_ciphertext: string;
  scope: string;
  access_expires_at: number;
  display_name: string;
  profile_email: string;
  connected_at: number;
  updated_at: number;
};

/**
 * WHOOP stopped accepting the grant. The stored tokens are dropped so the
 * interface can ask for one new authorisation instead of failing forever.
 */
export class WhoopReauthorizationRequiredError extends Error {
  constructor(readonly reason: string) {
    super("WHOOP 授权已失效，请重新连接一次。");
    this.name = "WhoopReauthorizationRequiredError";
  }
}

export function whoopAppConfigured() {
  return Boolean(
    process.env.WHOOP_CLIENT_ID &&
      process.env.WHOOP_CLIENT_SECRET &&
      process.env.WHOOP_REDIRECT_URI &&
      process.env.WHOOP_COOKIE_SECRET,
  );
}

export function getWhoopOAuthConfig() {
  const { WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET, WHOOP_REDIRECT_URI } =
    process.env;
  if (!WHOOP_CLIENT_ID || !WHOOP_CLIENT_SECRET || !WHOOP_REDIRECT_URI) {
    throw new Error("WHOOP OAuth is not configured on the server.");
  }
  return {
    clientId: WHOOP_CLIENT_ID,
    clientSecret: WHOOP_CLIENT_SECRET,
    redirectUri: WHOOP_REDIRECT_URI,
  };
}

function getEncryptionKey() {
  const secret = process.env.WHOOP_COOKIE_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("WHOOP_COOKIE_SECRET must contain at least 32 characters.");
  }
  return createHash("sha256").update(secret, "utf8").digest();
}

function encryptTokens(tokens: WhoopTokens) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const body = Buffer.concat([
    cipher.update(JSON.stringify(tokens), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [iv, tag, body].map((part) => part.toString("base64url")).join(".");
}

function decryptTokens(value: string): WhoopTokens | null {
  try {
    const [ivPart, tagPart, bodyPart] = value.split(".");
    if (!ivPart || !tagPart || !bodyPart) return null;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      getEncryptionKey(),
      Buffer.from(ivPart, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(bodyPart, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    const parsed = JSON.parse(plaintext) as Partial<WhoopTokens>;
    if (
      typeof parsed.accessToken !== "string" ||
      typeof parsed.refreshToken !== "string" ||
      typeof parsed.expiresAt !== "number" ||
      typeof parsed.scope !== "string"
    ) {
      return null;
    }
    return parsed as WhoopTokens;
  } catch {
    return null;
  }
}

function secureCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

function tokenCookieName(accountId: string) {
  const prefix = process.env.NODE_ENV === "production" ? "__Host-biotrip-whoop" : "biotrip-whoop";
  return `${prefix}-${accountId}`;
}

/**
 * The account-scoped cookie only short-circuits the common request. D1 stays the
 * source of truth so one authorisation keeps working across devices; cookie
 * writes are best-effort because cookie mutation is only legal in route handlers.
 */
async function writeTokenCookie(accountId: string, tokens: WhoopTokens | null) {
  try {
    const cookieStore = await cookies();
    cookieStore.set(
      tokenCookieName(accountId),
      tokens ? encryptTokens(tokens) : "",
      secureCookieOptions(tokens ? TOKEN_COOKIE_TTL_SECONDS : 0),
    );
  } catch {
    // Cookie mutation is unavailable in this rendering context; D1 already holds
    // the connection, so the request still succeeds.
  }
}

async function readTokenCookie(accountId: string) {
  try {
    const value = (await cookies()).get(tokenCookieName(accountId))?.value;
    return value ? decryptTokens(value) : null;
  } catch {
    return null;
  }
}

async function readConnectionRow(accountId: string): Promise<ConnectionRow | null> {
  try {
    return await getDatabase().prepare(`SELECT token_ciphertext, scope, access_expires_at,
        display_name, profile_email, connected_at, updated_at FROM whoop_connections WHERE account_id = ?`)
      .bind(accountId).first<ConnectionRow>();
  } catch {
    // The migration is not applied yet. The cookie still carries the grant.
    return null;
  }
}

async function writeConnectionRow(accountId: string, tokens: WhoopTokens) {
  await getDatabase().prepare(`INSERT INTO whoop_connections
      (account_id, token_ciphertext, scope, access_expires_at, connected_at, updated_at)
    VALUES (?, ?, ?, ?, unixepoch(), unixepoch())
    ON CONFLICT(account_id) DO UPDATE SET token_ciphertext = excluded.token_ciphertext,
      scope = excluded.scope, access_expires_at = excluded.access_expires_at, updated_at = unixepoch()`)
    .bind(accountId, encryptTokens(tokens), tokens.scope, tokens.expiresAt).run();
}

/**
 * Resolves the stored grant for an account, upgrading a cookie-only connection
 * into a persistent one the first time it is read.
 */
export async function readWhoopTokens(accountId: string): Promise<WhoopTokens | null> {
  const row = await readConnectionRow(accountId);
  if (row) {
    const tokens = decryptTokens(row.token_ciphertext);
    if (tokens) return tokens;
    // A rotated WHOOP_COOKIE_SECRET makes old ciphertext unreadable. Drop it so
    // the account is asked to authorise once more instead of failing silently.
    await deleteConnectionRow(accountId).catch(() => undefined);
    await writeTokenCookie(accountId, null);
    return null;
  }
  const legacy = await readTokenCookie(accountId);
  if (!legacy) return null;
  await writeConnectionRow(accountId, legacy).catch(() => undefined);
  return legacy;
}

async function deleteConnectionRow(accountId: string) {
  await getDatabase().prepare("DELETE FROM whoop_connections WHERE account_id = ?").bind(accountId).run();
}

/** Stores the grant in D1 and refreshes the short-circuit cookie. */
export async function writeWhoopTokens(accountId: string, tokens: WhoopTokens) {
  await writeConnectionRow(accountId, tokens);
  await writeTokenCookie(accountId, tokens);
}

export async function clearWhoopTokens(accountId: string) {
  await deleteConnectionRow(accountId).catch(() => undefined);
  await writeTokenCookie(accountId, null);
}

export async function getWhoopConnectionMeta(accountId: string): Promise<WhoopConnectionMeta | null> {
  const row = await readConnectionRow(accountId);
  if (!row) return null;
  return {
    connectedAt: new Date(row.connected_at * 1000).toISOString(),
    updatedAt: new Date(row.updated_at * 1000).toISOString(),
    displayName: row.display_name,
    memberEmail: row.profile_email,
  };
}

/** Keeps only the display name and email so the UI can name the linked account. */
export async function saveWhoopProfileMeta(
  accountId: string,
  profile: { firstName: string; lastName: string; email: string },
) {
  const displayName = `${profile.firstName} ${profile.lastName}`.trim().slice(0, 80);
  await getDatabase().prepare(`UPDATE whoop_connections SET display_name = ?, profile_first_name = ?,
      profile_last_name = ?, profile_email = ?, updated_at = unixepoch() WHERE account_id = ?`)
    .bind(displayName, profile.firstName.slice(0, 60), profile.lastName.slice(0, 60),
      profile.email.slice(0, 254), accountId).run();
}

export async function clearOAuthState() {
  const cookieStore = await cookies();
  cookieStore.set(OAUTH_STATE_COOKIE, "", secureCookieOptions(0));
}

export async function verifyOAuthState(receivedState: string, accountId: string) {
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(OAUTH_STATE_COOKIE)?.value;
  if (!expectedState) return false;
  const expected = Buffer.from(`${accountId}:${receivedState}`);
  const received = Buffer.from(expectedState);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export async function storeOAuthState(state: string, accountId: string) {
  const cookieStore = await cookies();
  cookieStore.set(OAUTH_STATE_COOKIE, `${accountId}:${state}`, secureCookieOptions(10 * 60));
}

async function refreshTokens(tokens: WhoopTokens): Promise<WhoopTokens> {
  const config = getWhoopOAuthConfig();
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: "offline",
  });
  const response = await fetch(`${AUTH_BASE_URL}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    // Only a rejected grant clears the connection. A timeout or a 5xx must keep
    // the stored tokens so the next request can retry the refresh.
    const revoked =
      response.status === 401 ||
      (response.status === 400 && /invalid_grant|invalid_client|unauthorized_client/i.test(detail));
    if (revoked) throw new WhoopReauthorizationRequiredError(`token_refresh_${response.status}`);
    throw new Error(`WHOOP token refresh failed (${response.status}).`);
  }
  const data = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!data.access_token || !data.refresh_token) {
    throw new WhoopReauthorizationRequiredError("token_refresh_incomplete");
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    scope: data.scope ?? tokens.scope,
  };
}

/**
 * Returns a usable access token, transparently refreshing and persisting it.
 * Renewed grants keep the WHOOP connection alive without user interaction.
 */
export async function getValidWhoopAccessToken(accountId: string) {
  const tokens = await readWhoopTokens(accountId);
  if (!tokens) return null;
  if (tokens.expiresAt > Date.now() + 60_000) return tokens.accessToken;
  let renewed: WhoopTokens;
  try {
    renewed = await refreshTokens(tokens);
  } catch (error) {
    if (error instanceof WhoopReauthorizationRequiredError) {
      await clearWhoopTokens(accountId);
    }
    throw error;
  }
  await writeWhoopTokens(accountId, renewed);
  return renewed.accessToken;
}

export async function requestWhoop<T>(accountId: string, path: string, params?: URLSearchParams) {
  const accessToken = await getValidWhoopAccessToken(accountId);
  if (!accessToken) throw new Error("WHOOP is not connected.");
  const url = new URL(`${WHOOP_BASE_URL}/developer/v2${path}`);
  params?.forEach((value, key) => url.searchParams.set(key, value));
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (response.status === 401) throw new WhoopReauthorizationRequiredError(`api_${path}`);
  if (!response.ok) throw new Error(`WHOOP API request failed (${response.status}).`);
  return (await response.json()) as T;
}

async function fetchCollection<T>(accountId: string, path: string, start: string, end: string) {
  const records: T[] = [];
  let nextToken: string | undefined;
  do {
    const params = new URLSearchParams({ limit: "25", start, end });
    if (nextToken) params.set("nextToken", nextToken);
    const page = await requestWhoop<WhoopApiCollection<T>>(accountId, path, params);
    records.push(...(page.records ?? []));
    nextToken = page.next_token;
  } while (nextToken && records.length < 100);
  return records;
}

function omitIdentifierFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitIdentifierFields);
  if (!value || typeof value !== "object") return value;
  const omitted = new Set(["id", "user_id", "cycle_id", "sleep_id", "v1_id"]);
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !omitted.has(key))
      .map(([key, child]) => [key, omitIdentifierFields(child)]),
  );
}

export async function getRecentWhoopMetrics(accountId: string) {
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
  const start = startDate.toISOString();
  const end = endDate.toISOString();
  const [cycles, recoveries, sleeps, workouts, bodyMeasurements] = await Promise.all([
    fetchCollection<Record<string, unknown>>(accountId, "/cycle", start, end),
    fetchCollection<Record<string, unknown>>(accountId, "/recovery", start, end),
    fetchCollection<Record<string, unknown>>(accountId, "/activity/sleep", start, end),
    fetchCollection<Record<string, unknown>>(accountId, "/activity/workout", start, end),
    requestWhoop<Record<string, unknown>>(accountId, "/user/measurement/body"),
  ]);

  return {
    window: { start, end },
    cycles: omitIdentifierFields(cycles),
    recoveries: omitIdentifierFields(recoveries),
    sleeps: omitIdentifierFields(sleeps),
    workouts: omitIdentifierFields(workouts),
    body_measurements: omitIdentifierFields(bodyMeasurements),
  };
}

type MetricRecord = Record<string, unknown>;

function latestRecord(records: unknown) {
  return Array.isArray(records)
    ? (records[0] as MetricRecord | undefined)
    : undefined;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nestedRecord(value: unknown, key: string): MetricRecord | undefined {
  if (!value || typeof value !== "object") return undefined;
  const child = (value as MetricRecord)[key];
  return child && typeof child === "object" ? child as MetricRecord : undefined;
}

export async function getRecentWhoopSummary(accountId: string) {
  const snapshot = await getRecentWhoopMetrics(accountId);
  const latestCycle = latestRecord(snapshot.cycles);
  const latestRecovery = latestRecord(snapshot.recoveries);
  const latestSleep = latestRecord(snapshot.sleeps);
  const latestCycleScore = nestedRecord(latestCycle, "score");
  const latestRecoveryScore = nestedRecord(latestRecovery, "score");
  const latestSleepScore = nestedRecord(latestSleep, "score");
  const stageSummary = nestedRecord(latestSleepScore, "stage_summary");

  const sleepMilliseconds = [
    asNumber(stageSummary?.total_light_sleep_time_milli),
    asNumber(stageSummary?.total_slow_wave_sleep_time_milli),
    asNumber(stageSummary?.total_rem_sleep_time_milli),
  ].filter((value): value is number => value !== null).reduce((total, value) => total + value, 0);

  return {
    scoreState: typeof latestRecovery?.score_state === "string" ? latestRecovery.score_state : "MISSING",
    recoveryScore: asNumber(latestRecoveryScore?.recovery_score),
    hrvRmssdMilli: asNumber(latestRecoveryScore?.hrv_rmssd_milli),
    restingHeartRate: asNumber(latestRecoveryScore?.resting_heart_rate),
    sleepMinutes: sleepMilliseconds > 0 ? Math.round(sleepMilliseconds / 60_000) : null,
    sleepPerformance: asNumber(latestSleepScore?.sleep_performance_percentage),
    cycleStrain: asNumber(latestCycleScore?.strain),
    cycleSteps: asNumber(latestCycle?.step_count),
    cycleScoreState: typeof latestCycle?.score_state === "string" ? latestCycle.score_state : "MISSING",
    measuredAt:
      (typeof latestRecovery?.created_at === "string" && latestRecovery.created_at) ||
      (typeof latestSleep?.end === "string" && latestSleep.end) ||
      null,
    workoutsInWindow: Array.isArray(snapshot.workouts) ? snapshot.workouts.length : 0,
  };
}

export async function getWhoopProfile(accountId: string) {
  const profile = await requestWhoop<Record<string, unknown>>(accountId, "/user/profile/basic");
  return {
    firstName: typeof profile.first_name === "string" ? profile.first_name : "",
    lastName: typeof profile.last_name === "string" ? profile.last_name : "",
    email: typeof profile.email === "string" ? profile.email : "",
  };
}
