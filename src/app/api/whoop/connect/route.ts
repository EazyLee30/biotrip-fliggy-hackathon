import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import {
  getWhoopOAuthConfig,
  readWhoopTokens,
  storeOAuthState,
  WHOOP_SCOPES,
  whoopAppConfigured,
} from "@/lib/whoop";
import { getCurrentAccount } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const account = await getCurrentAccount().catch(() => null);
  if (!account) return NextResponse.redirect(new URL("/login?next=%2Fapi%2Fwhoop%2Fconnect", request.url));
  if (!whoopAppConfigured()) {
    return NextResponse.redirect(new URL("/?whoop=failed", request.url));
  }
  // An existing connection is reused as-is. Re-authorising would be an
  // unnecessary interruption for a traveller who already said yes once.
  if (new URL(request.url).searchParams.get("reauthorize") !== "1" && await readWhoopTokens(account.id).catch(() => null)) {
    return NextResponse.redirect(new URL("/?whoop=connected", request.url));
  }

  const config = getWhoopOAuthConfig();
  const state = randomBytes(32).toString("base64url");
  await storeOAuthState(state, account.id);

  const authorizationUrl = new URL("https://api.prod.whoop.com/oauth/oauth2/auth");
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("client_id", config.clientId);
  authorizationUrl.searchParams.set("redirect_uri", config.redirectUri);
  authorizationUrl.searchParams.set("scope", WHOOP_SCOPES.join(" "));
  authorizationUrl.searchParams.set("state", state);
  return NextResponse.redirect(authorizationUrl);
}
