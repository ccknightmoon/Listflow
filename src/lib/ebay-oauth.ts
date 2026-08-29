import https from "node:https";
import crypto from "node:crypto";

export const EBAY_OAUTH_STATE_COOKIE = "ebay_oauth_state";

export function generateOAuthState(): string {
  return crypto.randomBytes(24).toString("hex");
}

export const EBAY_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.inventory.readonly",
].join(" ");

function credentials() {
  return Buffer.from(
    `${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`
  ).toString("base64");
}

function httpsPost(path: string, body: string, extraHeaders: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(body, "utf-8");
    const req = https.request(
      {
        hostname: "api.ebay.com",
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": buf.length,
          ...extraHeaders,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c: Buffer) => { data += c.toString(); });
        res.on("end", () => resolve(data));
      }
    );
    req.on("error", reject);
    req.write(buf);
    req.end();
  });
}

export async function exchangeCodeForTokens(code: string) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: process.env.EBAY_RUNAME!,
  }).toString();

  const raw = await httpsPost("/identity/v1/oauth2/token", body, {
    Authorization: `Basic ${credentials()}`,
  });
  return JSON.parse(raw) as { access_token?: string; refresh_token?: string; error_description?: string };
}

// A single "list on eBay" action can call getAccessToken() 15-20+ times
// (SKU cleanup loop, upsert, offer create/update, publish), and bulk-listing
// multiplies that across every selected draft. Without caching, every one of
// those was a fresh network round-trip to eBay's token endpoint — real
// latency and real throttling risk on exactly the flow that most needs to
// stay fast and reliable. Cache the token for its actual lifetime (minus a
// safety margin), same pattern already used for the Browse API app token in
// pricing/suggest/route.ts.
let userTokenCache: { token: string; expires: number } | null = null;

export async function getAccessToken(): Promise<string> {
  if (userTokenCache && userTokenCache.expires > Date.now() + 60_000) {
    return userTokenCache.token;
  }

  const refreshToken = process.env.EBAY_OAUTH_REFRESH_TOKEN;
  if (!refreshToken) throw new Error("eBay not connected — visit /api/ebay/connect first");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: EBAY_SCOPES,
  }).toString();

  const raw = await httpsPost("/identity/v1/oauth2/token", body, {
    Authorization: `Basic ${credentials()}`,
  });
  const data = JSON.parse(raw) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!data.access_token) throw new Error(data.error_description ?? "Token refresh failed");

  const ttlMs = (data.expires_in ?? 7200) * 1000;
  userTokenCache = { token: data.access_token, expires: Date.now() + ttlMs };
  return data.access_token;
}

// Call after any request that gets a 401 with a valid-looking cached token,
// so the very next call is forced to refresh instead of retrying with the
// same (apparently revoked/expired) token.
export function invalidateAccessTokenCache() {
  userTokenCache = null;
}
