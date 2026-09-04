import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { EBAY_SCOPES, EBAY_OAUTH_STATE_COOKIE, generateOAuthState } from "@/lib/ebay-oauth";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  // Middleware already requires a session for this route, but this is the
  // route that kicks off a flow ending in a live credential being displayed,
  // so it checks for itself too.
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;

  const state = generateOAuthState();
  const cookieStore = await cookies();
  cookieStore.set(EBAY_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600, // 10 minutes — plenty for the eBay consent redirect round trip
    path: "/",
  });

  const params = new URLSearchParams({
    client_id: process.env.EBAY_CLIENT_ID!,
    redirect_uri: process.env.EBAY_RUNAME!,
    response_type: "code",
    scope: EBAY_SCOPES,
    state,
  });
  return NextResponse.redirect(`https://auth.ebay.com/oauth2/authorize?${params}`);
}
