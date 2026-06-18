import { NextRequest } from "next/server";
import { exchangeCodeForTokens } from "@/lib/ebay-oauth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    return new Response("Missing code parameter", { status: 400 });
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.refresh_token) {
      return new Response(`eBay error: ${tokens.error_description ?? "No refresh token returned"}`, { status: 400 });
    }

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
      { headers: { "Content-Type": "text/html" } }
    );
  } catch (err) {
    return new Response(`Error: ${(err as Error).message}`, { status: 500 });
  }
}
