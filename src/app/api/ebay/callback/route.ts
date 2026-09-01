import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCodeForTokens, EBAY_OAUTH_STATE_COOKIE } from "@/lib/ebay-oauth";
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
  const cookieStore = cookies();
  const expectedState = cookieStore.get(EBAY_OAUTH_STATE_COOKIE)?.value;
  cookieStore.delete(EBAY_OAUTH_STATE_COOKIE);

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
    const { error: dbError } = await auth.supabase
      .from("ebay_connections")
      .upsert(
        { user_id: auth.user.id, encrypted_refresh_token: encrypted, updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      );

    if (dbError) {
      return NextResponse.redirect(
        new URL(`/settings?ebay=error&message=${encodeURIComponent(dbError.message)}`, req.url)
      );
    }

    return NextResponse.redirect(new URL("/settings?ebay=connected", req.url));
  } catch (err) {
    return NextResponse.redirect(
      new URL(`/settings?ebay=error&message=${encodeURIComponent((err as Error).message)}`, req.url)
    );
  }
}
