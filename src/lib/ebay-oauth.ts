import https from "node:https";
import crypto from "node:crypto";
import { getEbayContext } from "./ebay-request-context";

export const EBAY_OAUTH_STATE_COOKIE = "ebay_oauth_state";

export function generateOAuthState(): string {
  return crypto.randomBytes(24).toString("hex");
}

// sell.account.readonly was added in Phase 2 (per-user eBay connections) so
// /api/ebay/policies can read each seller's own Business Policies. Anyone
// who connected before this scope was added needs to reconnect once to
// pick it up — expected, since Phase 2 already requires everyone to
// reconnect (the old shared connection isn't migrated automatically).
export const EBAY_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.inventory.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
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
//
// Phase 2: this used to be one module-level slot shared by every request
// (fine when there was only one shared eBay connection) — now keyed by
// userId so two different users' requests landing on the same warm
// serverless instance can never see each other's cached access token. The
// refresh token itself comes from the current request's eBay context
// (set up by requireEbayConnection() + ebayContext.run() in each route),
// not a shared env var.
const tokenCacheByUser = new Map<string, { token: string; expires: number }>();

export async function getAccessToken(): Promise<string> {
  const ctx = getEbayContext();

  const cached = tokenCacheByUser.get(ctx.userId);
  if (cached && cached.expires > Date.now() + 60_000) {
    return cached.token;
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: ctx.refreshToken,
    scope: EBAY_SCOPES,
  }).toString();

  const raw = await httpsPost("/identity/v1/oauth2/token", body, {
    Authorization: `Basic ${credentials()}`,
  });
  const data = JSON.parse(raw) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!data.access_token) throw new Error(data.error_description ?? "Token refresh failed");

  const ttlMs = (data.expires_in ?? 7200) * 1000;
  tokenCacheByUser.set(ctx.userId, { token: data.access_token, expires: Date.now() + ttlMs });
  return data.access_token;
}

// Call after any request that gets a 401 with a valid-looking cached token,
// so the very next call is forced to refresh instead of retrying with the
// same (apparently revoked/expired) token. Only clears the CURRENT user's
// cache entry — must be called from inside the same ebayContext.run() the
// failing request ran in.
export function invalidateAccessTokenCache() {
  tokenCacheByUser.delete(getEbayContext().userId);
}
