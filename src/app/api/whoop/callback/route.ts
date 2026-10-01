import { NextResponse } from "next/server";
import {
  clearOAuthState,
  getWhoopOAuthConfig,
  getWhoopProfile,
  saveWhoopProfileMeta,
  verifyOAuthState,
  whoopAppConfigured,
  WHOOP_SCOPES,
  writeWhoopTokens,
} from "@/lib/whoop";
import { getCurrentAccount } from "@/lib/auth";

export const runtime = "nodejs";

function returnToApp(request: Request, outcome: string, providerError?: string) {
  const destination = new URL("/", request.url);
  destination.searchParams.set("whoop", outcome);
  if (providerError) destination.searchParams.set("whoop_error", providerError);
  return NextResponse.redirect(destination);
}

function safeProviderError(value: string | null) {
  if (!value) return "unknown_error";
  const normalized = value.toLowerCase();
  return /^[a-z0-9_]{1,40}$/.test(normalized) ? normalized : "unknown_error";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const account = await getCurrentAccount().catch(() => null);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (!account) {
    await clearOAuthState();
    return NextResponse.redirect(new URL("/login?next=%2F", request.url));
  }

  if (error) {
    await clearOAuthState();
    const providerError = safeProviderError(error);
    return returnToApp(
      request,
      providerError === "access_denied" ? "denied" : "failed",
      providerError,
    );
  }
  if (!whoopAppConfigured() || !state || !code || !(await verifyOAuthState(state, account.id))) {
    await clearOAuthState();
    return returnToApp(request, "failed");
  }

  try {
    const config = getWhoopOAuthConfig();
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      scope: WHOOP_SCOPES.join(" "),
    });
    const response = await fetch("https://api.prod.whoop.com/oauth/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
    });
    if (!response.ok) {
      await clearOAuthState();
      return returnToApp(request, "failed");
    }

    const data = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };
    if (!data.access_token || !data.refresh_token) {
      await clearOAuthState();
      return returnToApp(request, "failed");
    }

    await writeWhoopTokens(account.id, {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
      scope: data.scope ?? WHOOP_SCOPES.join(" "),
    });
    // Store the WHOOP display name now so the app can name the linked member
    // later without a second round trip. The name is never sent to an agent.
    await getWhoopProfile(account.id)
      .then((profile) => saveWhoopProfileMeta(account.id, profile))
      .catch(() => undefined);
    await clearOAuthState();
    return returnToApp(request, "connected");
  } catch {
    await clearOAuthState();
    return returnToApp(request, "failed");
  }
}
