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
//
// sell.finances, added Sept 9, 2026 -- lets /api/ebay/sales pull real,
// eBay-reported selling fees (src/lib/ebay-finances.ts) instead of relying
// solely on the estimate in ebay-fees.ts. Scope URI verified against eBay's
// own published OAuth scope list and OpenAPI spec for the Finances API
// before adding it here -- an unrecognized scope string would break the
// whole "Connect eBay" consent screen, not just this one feature, so this
// wasn't guessed. Same "reconnect required to pick up a new scope" story as
// sell.account.readonly above; until a seller reconnects, calls needing
// this scope get a 403 that's handled as "not available yet," not an error
// (see fetchRealFeesForRange).
// The original permissions every existing connection granted. Token
// refresh asks ONLY for what the seller actually granted: eBay refuses a
// refresh that asks for more, which would break every eBay call.
export const EBAY_BASE_SCOPE_LIST = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.inventory.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.finances",
] as const;
export const EBAY_SCOPES = EBAY_BASE_SCOPE_LIST.join(" ");

// Phase 1 (Nov 26, 2026): optional extra permissions, asked for only when
// the seller taps "Reconnect eBay to unlock" (/api/ebay/connect?scopes=extended).
// sell.marketing -> markdown sales + promoted listings; sell.analytics.readonly
// -> views/impressions; sell.fulfillment -> orders/tracking. All three are in
// eBay's standard production scope list for every app keyset.
export const EBAY_EXTRA_SCOPES = {
  marketing: "https://api.ebay.com/oauth/api_scope/sell.marketing",
  analytics: "https://api.ebay.com/oauth/api_scope/sell.analytics.readonly",
  fulfillment: "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
} as const;
export const EBAY_EXTENDED_SCOPE_LIST = [...EBAY_BASE_SCOPE_LIST, ...Object.values(EBAY_EXTRA_SCOPES)];
export const EBAY_EXTENDED_SCOPES = EBAY_EXTENDED_SCOPE_LIST.join(" ");
export const EBAY_OAUTH_SCOPES_COOKIE = "ebay_oauth_scopes";

const KNOWN_SCOPES = new Set<string>(EBAY_EXTENDED_SCOPE_LIST);

/**
 * Scopes to ask for on refresh: what the seller granted (stored in
 * ebay_connections.granted_scopes, migration 044), limited to scopes we
 * know, and always including the base set. null/unknown -> base set.
 */
export function scopesForRefresh(granted: string | null | undefined): string {
  if (!granted) return EBAY_SCOPES;
  const list = granted.split(/\s+/).filter((x) => KNOWN_SCOPES.has(x));
  if (!EBAY_BASE_SCOPE_LIST.every((b) => list.includes(b))) return EBAY_SCOPES;
  return EBAY_EXTENDED_SCOPE_LIST.filter((x) => list.includes(x)).join(" ");
}

/** Has the seller granted this permission? (null granted = base set only) */
export function hasScope(granted: string | null | undefined, scope: string): boolean {
  return scopesForRefresh(granted).split(" ").includes(scope);
}

/** Extra permissions the seller hasn't granted yet. */
export function missingExtraScopes(granted: string | null | undefined): Array<keyof typeof EBAY_EXTRA_SCOPES> {
  return (Object.keys(EBAY_EXTRA_SCOPES) as Array<keyof typeof EBAY_EXTRA_SCOPES>).filter((k) => !hasScope(granted, EBAY_EXTRA_SCOPES[k]));
}

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

// The SKU-cleanup loop in list/route.ts and delist/route.ts now fires its
// per-SKU deletes with Promise.all instead of one at a time (see those
// files), so several getAccessToken() calls for the same user can now land
// on a cold cache at the same instant — without this, each one would fire
// its own redundant refresh POST to eBay ("thundering herd"). Not a
// correctness bug (eBay refresh tokens are reusable), just wasted requests
// and slightly higher throttling risk. Dedupe by keeping the in-flight
// refresh promise keyed by userId so concurrent callers share one refresh.
const inFlightRefresh = new Map<string, Promise<string>>();

export async function getAccessToken(): Promise<string> {
  const ctx = getEbayContext();

  const cached = tokenCacheByUser.get(ctx.userId);
  if (cached && cached.expires > Date.now() + 60_000) {
    return cached.token;
  }

  const existing = inFlightRefresh.get(ctx.userId);
  if (existing) return existing;

  const refreshPromise = (async () => {
    try {
      const refresh = async (scope: string) => {
        const body = new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: ctx.refreshToken,
          scope,
        }).toString();
        const raw = await httpsPost("/identity/v1/oauth2/token", body, {
          Authorization: `Basic ${credentials()}`,
        });
        return JSON.parse(raw) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
      };
      const wanted = scopesForRefresh(ctx.grantedScopes);
      let data = await refresh(wanted);
      // Safety net: if the extra permissions are ever refused, fall back to
      // the original set so the connection keeps working.
      if (!data.access_token && wanted !== EBAY_SCOPES) data = await refresh(EBAY_SCOPES);
      if (!data.access_token) throw new Error(data.error_description ?? "Token refresh failed");

      const ttlMs = (data.expires_in ?? 7200) * 1000;
      tokenCacheByUser.set(ctx.userId, { token: data.access_token, expires: Date.now() + ttlMs });
      return data.access_token;
    } finally {
      inFlightRefresh.delete(ctx.userId);
    }
  })();

  inFlightRefresh.set(ctx.userId, refreshPromise);
  return refreshPromise;
}

// Call after any request that gets a 401 with a valid-looking cached token,
// so the very next call is forced to refresh instead of retrying with the
// same (apparently revoked/expired) token. Only clears the CURRENT user's
// cache entry — must be called from inside the same ebayContext.run() the
// failing request ran in.
export function invalidateAccessTokenCache() {
  tokenCacheByUser.delete(getEbayContext().userId);
}
