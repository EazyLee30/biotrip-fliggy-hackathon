import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomInt,
} from "node:crypto";
import { getDatabase } from "@/lib/database";
import { readBoundedUpstream } from "./upstream-response";

const WHOOP_BASE_URL = "https://api.prod.whoop.com";
const AUTH_BASE_URL = `${WHOOP_BASE_URL}/oauth/oauth2`;
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
  next_token?: string | null;
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
  readonly code = "WHOOP_REAUTHORIZATION_REQUIRED";
  readonly status = 401;
  constructor(readonly reason: string) {
    super("WHOOP 授权已失效，请重新连接一次。");
    this.name = "WhoopReauthorizationRequiredError";
  }
}

export class WhoopRequestError extends Error {
  constructor(readonly code: string, readonly path: string, readonly status: number | null = null) {
    super(code);
    this.name = "WhoopRequestError";
  }
}

export type WhoopMetric = "cycle" | "recovery" | "sleep" | "workout" | "body_measurements";
export type WhoopMetricFailure = { metric: WhoopMetric; path: string; status: number | null; code: string };

export class WhoopSyncError extends Error {
  readonly code = "WHOOP_SYNC_FAILED";
  readonly status = 502;
  constructor(readonly failures: WhoopMetricFailure[]) {
    super("WHOOP_SYNC_FAILED");
    this.name = "WhoopSyncError";
  }
}

export function whoopFailureDiagnostic(error: unknown) {
  if (error instanceof WhoopRequestError) return { code: error.code, path: error.path, status: error.status };
  if (error instanceof WhoopSyncError) return { code: error.code, path: null, status: error.status };
  if (error instanceof WhoopReauthorizationRequiredError) return { code: error.code, path: "/oauth/oauth2/token", status: error.status };
  const name = typeof error === "object" && error && "name" in error ? error.name : null;
  return { code: name === "TimeoutError" ? "WHOOP_TIMEOUT" : name === "AbortError" ? "WHOOP_CANCELLED" : "WHOOP_READ_FAILED", path: null, status: null };
}

function logWhoopRequest(path: string, status: number | null, code: string | null) {
  // Only fixed endpoint paths and static codes; no account, token or health data.
  console.info("[BioTrip WHOOP request]", { path, status, code });
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

export function encryptTokens(tokens: WhoopTokens) {
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

async function readConnectionRow(accountId: string): Promise<ConnectionRow | null> {
  try {
    return await getDatabase().prepare(`SELECT token_ciphertext, scope, access_expires_at,
        display_name, profile_email, connected_at, updated_at FROM whoop_connections WHERE account_id = ?`)
      .bind(accountId).first<ConnectionRow>();
  } catch {
    throw new WhoopRequestError("WHOOP_STORAGE_UNAVAILABLE", "connection", 503);
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
 * Resolves only the D1 grant. Old cookie-only users must reconnect; a stale
 * browser cookie must never resurrect an account-wide disconnection.
 */
export async function readWhoopTokens(accountId: string): Promise<WhoopTokens | null> {
  const row = await readConnectionRow(accountId);
  if (row) {
    const tokens = decryptTokens(row.token_ciphertext);
    if (tokens) return tokens;
    // A server encryption/configuration failure does not prove revocation.
    throw new WhoopRequestError("WHOOP_TOKEN_UNREADABLE", "connection", 503);
  }
  return null;
}

async function deleteConnectionRow(accountId: string) {
  await getDatabase().prepare("DELETE FROM whoop_connections WHERE account_id = ?").bind(accountId).run();
}

/** Stores the grant in D1 and refreshes the short-circuit cookie. */
export async function writeWhoopTokens(accountId: string, tokens: WhoopTokens) {
  await writeConnectionRow(accountId, tokens);
}

export async function clearWhoopTokens(accountId: string) {
  await deleteConnectionRow(accountId);
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

async function refreshTokens(tokens: WhoopTokens, signal?: AbortSignal): Promise<WhoopTokens> {
  signal?.throwIfAborted();
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
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const detail = await readBoundedUpstream(response, 8192).catch(() => "");
    // Only a rejected grant clears the connection. A timeout or a 5xx must keep
    // the stored tokens so the next request can retry the refresh.
    const revoked = [400, 401].includes(response.status) && /invalid_grant/i.test(detail);
    logWhoopRequest("/oauth/oauth2/token", response.status, revoked ? "WHOOP_REAUTHORIZATION_REQUIRED" : "WHOOP_REFRESH_FAILED");
    if (revoked) throw new WhoopReauthorizationRequiredError(`token_refresh_${response.status}`);
    throw new WhoopRequestError("WHOOP_REFRESH_FAILED", "/oauth/oauth2/token", response.status);
  }
  const data = JSON.parse(await readBoundedUpstream(response, 8192)) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!data.access_token || !data.refresh_token) {
    // Malformed success is not evidence of a revoked grant. Preserve the
    // stored connection until WHOOP explicitly rejects the refresh token.
    throw new WhoopRequestError("WHOOP_REFRESH_INCOMPLETE", "/oauth/oauth2/token", 502);
  }
  logWhoopRequest("/oauth/oauth2/token", response.status, null);
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
export async function getValidWhoopAccessToken(accountId: string, signal?: AbortSignal, rejectedAccessToken?: string) {
  signal?.throwIfAborted();
  const tokens = await readWhoopTokens(accountId);
  signal?.throwIfAborted();
  if (!tokens) return null;
  if (tokens.expiresAt > Date.now() + 60_000 && tokens.accessToken !== rejectedAccessToken) return tokens.accessToken;
  const key = createHash("sha256").update(`whoop:refresh:${accountId}`).digest("hex");
  const owner = randomInt(1, 2147483647);
  const deadline = Date.now() + 12_000;
  // The database lease works across Worker isolates/devices, unlike a module Map.
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    const now = Math.floor(Date.now() / 1000);
    const lock = await getDatabase().prepare(`INSERT INTO auth_rate_limits (limit_key, hit_count, reset_at) VALUES (?, ?, ?)
      ON CONFLICT(limit_key) DO UPDATE SET hit_count = excluded.hit_count, reset_at = excluded.reset_at
      WHERE auth_rate_limits.reset_at <= ? RETURNING hit_count`).bind(key, owner, now + 20, now).first();
    if (!lock) {
      const current = await readWhoopTokens(accountId);
      if (!current) return null;
      if (current.expiresAt > Date.now() + 60_000 && current.accessToken !== rejectedAccessToken) return current.accessToken;
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(signal?.reason); };
        const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, 75);
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
      });
      continue;
    }
    try {
      signal?.throwIfAborted();
      const row = await readConnectionRow(accountId);
      signal?.throwIfAborted();
      if (!row) return null;
      const current = decryptTokens(row.token_ciphertext);
      if (!current) throw new WhoopRequestError("WHOOP_TOKEN_UNREADABLE", "connection", 503);
      if (current.expiresAt > Date.now() + 60_000 && current.accessToken !== rejectedAccessToken) return current.accessToken;
      let renewed: WhoopTokens;
      try { renewed = await refreshTokens(current, signal); }
      catch (error) {
        if (error instanceof WhoopReauthorizationRequiredError) {
          // An old rejected refresh must not delete a newer connection.
          const removed = await getDatabase().prepare("DELETE FROM whoop_connections WHERE account_id = ? AND token_ciphertext = ?")
            .bind(accountId, row.token_ciphertext).run();
          if (removed.meta.changes !== 1) {
            const fresh = await readWhoopTokens(accountId);
            if (fresh) return fresh.accessToken;
          }
        } else {
          const diagnostic = whoopFailureDiagnostic(error);
          logWhoopRequest("/oauth/oauth2/token", diagnostic.status, diagnostic.code);
        }
        throw error;
      }
      // Persist a successful rotation even if the caller has just cancelled,
      // but never recreate a disconnected row or replace a newer OAuth grant.
      const saved = await getDatabase().prepare(`UPDATE whoop_connections SET token_ciphertext = ?, scope = ?,
        access_expires_at = ?, updated_at = unixepoch() WHERE account_id = ? AND token_ciphertext = ?`)
        .bind(encryptTokens(renewed), renewed.scope, renewed.expiresAt, accountId, row.token_ciphertext).run();
      signal?.throwIfAborted();
      if (saved.meta.changes !== 1) return (await readWhoopTokens(accountId))?.accessToken ?? null;
      return renewed.accessToken;
    } finally {
      await getDatabase().prepare("DELETE FROM auth_rate_limits WHERE limit_key = ? AND hit_count = ?")
        .bind(key, owner).run().catch(() => undefined);
    }
  }
  throw new WhoopRequestError("WHOOP_REFRESH_BUSY", "/oauth/oauth2/token", 503);
}

type WhoopRequestOptions = { signal?: AbortSignal; accessToken?: string };

export async function requestWhoop<T>(accountId: string, path: string, params?: URLSearchParams, options: WhoopRequestOptions = {}) {
  options.signal?.throwIfAborted();
  const accessToken = options.accessToken ?? await getValidWhoopAccessToken(accountId, options.signal);
  if (!accessToken) throw new WhoopRequestError("WHOOP_NOT_CONNECTED", path, 409);
  const url = new URL(`${WHOOP_BASE_URL}/developer/v2${path}`);
  params?.forEach((value, key) => url.searchParams.set(key, value));
  const send = (token: string) => fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
  });
  let response: Response;
  try {
    response = await send(accessToken);
    if (response.status === 401) {
      // One controlled refresh handles expired/replaced access; the D1 lease
      // ensures parallel readers cannot rotate the same refresh token twice.
      logWhoopRequest(path, 401, "WHOOP_ACCESS_TOKEN_REJECTED");
      await response.body?.cancel();
      const renewed = await getValidWhoopAccessToken(accountId, options.signal, accessToken);
      if (!renewed) throw new WhoopRequestError("WHOOP_NOT_CONNECTED", path, 409);
      response = await send(renewed);
    }
  } catch (error) {
    const diagnostic = whoopFailureDiagnostic(error);
    logWhoopRequest(path, diagnostic.status, diagnostic.code);
    throw error;
  }
  if (!response.ok) {
    const code = response.status === 403 ? "WHOOP_API_FORBIDDEN" : response.status === 429 ? "WHOOP_RATE_LIMITED" : "WHOOP_API_HTTP_ERROR";
    logWhoopRequest(path, response.status, code);
    await response.body?.cancel();
    throw new WhoopRequestError(code, path, response.status);
  }
  try {
    const value = JSON.parse(await readBoundedUpstream(response, 1_000_000)) as T;
    logWhoopRequest(path, response.status, null);
    return value;
  } catch {
    throw new WhoopRequestError("WHOOP_INVALID_RESPONSE", path, 502);
  }
}

async function fetchCollection<T>(accountId: string, path: string, start: string, end: string, options: WhoopRequestOptions) {
  const records: T[] = [];
  const seenTokens = new Set<string>();
  let nextToken: string | undefined;
  do {
    const params = new URLSearchParams({ limit: "25", start, end });
    if (nextToken) params.set("nextToken", nextToken);
    const page = await requestWhoop<WhoopApiCollection<T>>(accountId, path, params, options);
    // WHOOP ends a collection with next_token: null. That is a successful
    // final page, including when records is empty, rather than bad data.
    if (!page || !Array.isArray(page.records) || (page.next_token != null && typeof page.next_token !== "string")) {
      throw new WhoopRequestError("WHOOP_INVALID_RESPONSE", path, 502);
    }
    records.push(...(page.records ?? []));
    nextToken = page.next_token ?? undefined;
    if (nextToken && seenTokens.has(nextToken)) break;
    if (nextToken) seenTokens.add(nextToken);
  } while (nextToken && records.length < 100 && seenTokens.size < 4);
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

export async function getRecentWhoopMetrics(accountId: string, options: { signal?: AbortSignal; summaryOnly?: boolean } = {}) {
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000), ...(options.signal ? [options.signal] : [])]);
  // Resolve/refresh once before the parallel reads: rotating one refresh token
  // concurrently can invalidate an otherwise healthy WHOOP connection.
  const accessToken = await getValidWhoopAccessToken(accountId, signal);
  if (!accessToken) throw new WhoopRequestError("WHOOP_NOT_CONNECTED", "connection", 409);
  const requestOptions = { signal, accessToken };
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
  const start = startDate.toISOString();
  const end = endDate.toISOString();
  const tasks: Array<{ metric: WhoopMetric; path: string; read: () => Promise<unknown> }> = [
    { metric: "cycle", path: "/cycle", read: () => fetchCollection(accountId, "/cycle", start, end, requestOptions) },
    { metric: "recovery", path: "/recovery", read: () => fetchCollection(accountId, "/recovery", start, end, requestOptions) },
    { metric: "sleep", path: "/activity/sleep", read: () => fetchCollection(accountId, "/activity/sleep", start, end, requestOptions) },
    ...options.summaryOnly ? [] : [
      { metric: "workout" as const, path: "/activity/workout", read: () => fetchCollection(accountId, "/activity/workout", start, end, requestOptions) },
      { metric: "body_measurements" as const, path: "/user/measurement/body", read: () => requestWhoop(accountId, "/user/measurement/body", undefined, requestOptions) },
    ],
  ];
  const results = await Promise.allSettled(tasks.map(({ read }) => read().catch((error) => {
    if (error instanceof WhoopReauthorizationRequiredError) controller.abort(error);
    throw error;
  })));
  options.signal?.throwIfAborted();
  const failures: WhoopMetricFailure[] = [];
  const values: Partial<Record<WhoopMetric, unknown>> = {};
  let authenticationFailure: WhoopReauthorizationRequiredError | undefined;
  results.forEach((result, index) => {
    const { metric, path } = tasks[index];
    if (result.status === "fulfilled") values[metric] = result.value;
    else {
      const diagnostic = whoopFailureDiagnostic(result.reason);
      failures.push({ metric, path, code: diagnostic.code, status: diagnostic.status });
      if (result.reason instanceof WhoopReauthorizationRequiredError) authenticationFailure = result.reason;
    }
  });
  if (authenticationFailure) throw authenticationFailure;
  if (!results.slice(0, 3).some((result) => result.status === "fulfilled")) throw new WhoopSyncError(failures);

  return {
    window: { start, end },
    retrievedAt: new Date().toISOString(),
    syncStatus: failures.length ? "partial" as const : "synced" as const,
    failedMetrics: failures.map(({ metric }) => metric),
    failures,
    cycles: omitIdentifierFields(values.cycle ?? []),
    recoveries: omitIdentifierFields(values.recovery ?? []),
    sleeps: omitIdentifierFields(values.sleep ?? []),
    workouts: omitIdentifierFields(values.workout ?? []),
    body_measurements: omitIdentifierFields(values.body_measurements ?? null),
  };
}

type MetricRecord = Record<string, unknown>;

function latestRecord(records: unknown) {
  if (!Array.isArray(records)) return undefined;
  // A new PENDING record does not erase the latest genuinely scored record.
  return (records.find((item) => item && typeof item === "object" && item.score &&
    typeof item.score === "object" && (!item.score_state || item.score_state === "SCORED")) ?? records[0]) as MetricRecord | undefined;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nestedRecord(value: unknown, key: string): MetricRecord | undefined {
  if (!value || typeof value !== "object") return undefined;
  const child = (value as MetricRecord)[key];
  return child && typeof child === "object" ? child as MetricRecord : undefined;
}

export async function getRecentWhoopSummary(accountId: string, options: { signal?: AbortSignal } = {}) {
  const snapshot = await getRecentWhoopMetrics(accountId, { ...options, summaryOnly: true });
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

  const summary = {
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
  };
  const hasReadings = [summary.recoveryScore, summary.hrvRmssdMilli, summary.restingHeartRate,
    summary.sleepMinutes, summary.sleepPerformance, summary.cycleStrain, summary.cycleSteps].some((value) => value !== null);
  return {
    summary,
    retrievedAt: snapshot.retrievedAt,
    syncStatus: snapshot.failedMetrics.length ? "partial" as const : hasReadings ? "synced" as const : "empty" as const,
    failedMetrics: snapshot.failedMetrics,
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
