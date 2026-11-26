import { requireEbayConnection } from "@/lib/ebay-connection";
import { ebayContext } from "@/lib/ebay-request-context";
import { fetchEbayIdentity, storeEbayIdentity } from "@/lib/ebay-identity";
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCodeForTokens, EBAY_OAUTH_SCOPES_COOKIE, EBAY_OAUTH_STATE_COOKIE, EBAY_EXTENDED_SCOPES, EBAY_SCOPES } from "@/lib/ebay-oauth";
import { isMissingRelation } from "@/lib/db-errors";
import { encryptToken } from "@/lib/ebay-token-crypto";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  // This route is left reachable without an app session in middleware (eBay's
  // redirect is a cross-site top-level navigation, not in-app), so it does its
  // own auth check here instead of relying on that.
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(EBAY_OAUTH_STATE_COOKIE)?.value;
  cookieStore.delete(EBAY_OAUTH_STATE_COOKIE);
  const scopeSet = cookieStore.get(EBAY_OAUTH_SCOPES_COOKIE)?.value === "extended" ? EBAY_EXTENDED_SCOPES : EBAY_SCOPES;
  cookieStore.delete(EBAY_OAUTH_SCOPES_COOKIE);

  if (!code) {
    return NextResponse.redirect(new URL("/settings?ebay=error&message=Missing+code+parameter", req.url));
  }
  if (!expectedState || !state || state !== expectedState) {
    return NextResponse.redirect(
      new URL("/settings?ebay=error&message=Invalid+or+expired+connection+attempt.+Please+try+again.", req.url)
    );
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.refresh_token) {
      const msg = encodeURIComponent(tokens.error_description ?? "No refresh token returned");
      return NextResponse.redirect(new URL(`/settings?ebay=error&message=${msg}`, req.url));
    }

    // Phase 2: the refresh token is encrypted and stored per-user in
    // ebay_connections (RLS-scoped, same pattern as drafts/app_settings)
    // instead of being displayed for manual copy-paste into a shared env
    // var — see ebay-token-crypto.ts and 004_ebay_per_user_connections.sql.
    const encrypted = encryptToken(tokens.refresh_token);
    // granted_scopes (migration 044) records which permissions this token
    // has, so token refresh never asks for more than was granted. Without
    // the column the token is saved as before (refresh then uses the
    // original permissions, which every token has).
    const baseRow = { user_id: auth.user.id, encrypted_refresh_token: encrypted, updated_at: new Date().toISOString() };
    let { error: dbError } = await auth.supabase
      .from("ebay_connections")
      .upsert({ ...baseRow, granted_scopes: scopeSet }, { onConflict: "user_id" });
    if (dbError && isMissingRelation(dbError, "granted_scopes")) {
      ({ error: dbError } = await auth.supabase.from("ebay_connections").upsert(baseRow, { onConflict: "user_id" }));
    }

    if (dbError) {
      return NextResponse.redirect(
        new URL(`/settings?ebay=error&message=${encodeURIComponent(dbError.message)}`, req.url)
      );
    }

    // Remember which eBay user this is (for eBay's account-deletion
    // notifications). Best-effort: never blocks connecting.
    try {
      const connection = await requireEbayConnection(auth);
      if (connection) {
        const identity = await ebayContext.run(connection, fetchEbayIdentity);
        await storeEbayIdentity(auth.supabase, auth.user.id, identity);
      }
    } catch (err) {
      console.error("eBay identity lookup after connect failed:", (err as Error).message);
    }

    return NextResponse.redirect(new URL("/settings?ebay=connected", req.url));
  } catch (err) {
    return NextResponse.redirect(
      new URL(`/settings?ebay=error&message=${encodeURIComponent((err as Error).message)}`, req.url)
    );
  }
}
