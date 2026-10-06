import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { encryptTokens, OAUTH_STATE_COOKIE, type WhoopTokens, writeWhoopTokens as storeTokens, clearWhoopTokens as removeTokens } from "./whoop-core";
export * from "./whoop-core";
const TOKEN_COOKIE_TTL_SECONDS = 60 * 60 * 24 * 30;
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
 * D1 is the only source of truth across devices. Cookie
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

export async function writeWhoopTokens(accountId: string, tokens: WhoopTokens) {
  await storeTokens(accountId, tokens); await writeTokenCookie(accountId, tokens);
}
export async function clearWhoopTokens(accountId: string) {
  await removeTokens(accountId); await writeTokenCookie(accountId, null);
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
