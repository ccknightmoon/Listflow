import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { exchangeCodeForTokens, EBAY_OAUTH_STATE_COOKIE } from "@/lib/ebay-oauth";
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
    return new Response("Missing code parameter", { status: 400 });
  }
  if (!expectedState || !state || state !== expectedState) {
    return new Response(
      "Invalid or expired OAuth state — please restart the connection from /api/ebay/connect.",
      { status: 400 }
    );
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.refresh_token) {
      return new Response(`eBay error: ${tokens.error_description ?? "No refresh token returned"}`, { status: 400 });
    }

    // This page necessarily displays a live, long-lived credential so you can
    // copy it into Vercel — that's the intended one-time setup flow, not a
    // bug. What IS hardened: only your logged-in session can reach this page
    // (requireUser above), the OAuth `state` param stops a forged callback
    // from completing, and no-store keeps it out of any cache.
    return new Response(
      `<!DOCTYPE html>
<html>
<head><title>eBay Connected</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font-family: -apple-system, sans-serif; padding: 24px; max-width: 540px; margin: 0 auto; }
  h2 { color: #3B6D11; }
  .token { background: #f4f4f4; padding: 12px; border-radius: 8px; word-break: break-all; font-size: 12px; margin: 12px 0; }
  .step { background: #fff8e1; border-left: 3px solid #f59e0b; padding: 12px; margin: 12px 0; border-radius: 4px; }
  a { color: #185FA5; }
</style>
</head>
<body>
  <h2>eBay authorized!</h2>
  <p>One last step - copy the token below and add it to Vercel:</p>
  <div class="step">
    <strong>1.</strong> Copy this refresh token:
    <div class="token">${tokens.refresh_token}</div>
    <strong>2.</strong> Go to <a href="https://vercel.com" target="_blank">vercel.com</a> → listflow → Settings → Environment Variables<br><br>
    <strong>3.</strong> Add: <code>EBAY_OAUTH_REFRESH_TOKEN</code> = (paste token)<br><br>
    <strong>4.</strong> Redeploy from the Vercel dashboard
  </div>
  <a href="/dashboard">← Back to dashboard</a>
</body>
</html>`,
      { headers: { "Content-Type": "text/html", "Cache-Control": "no-store, no-cache, must-revalidate" } }
    );
  } catch (err) {
    return new Response(`Error: ${(err as Error).message}`, { status: 500 });
  }
}
