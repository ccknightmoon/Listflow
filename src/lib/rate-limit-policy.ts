// Rate-limit policy (pure; used by src/proxy.ts, unit tested).
//
// OFF unless BOTH are true:
//   1. RATE_LIMIT_ENABLED=1
//   2. Upstash Redis is configured (UPSTASH_REDIS_REST_URL + _TOKEN, or the
//      KV_REST_API_URL + KV_REST_API_TOKEN names Vercel's Upstash integration adds)
// So connecting Upstash for something else never switches it on by surprise,
// and RATE_LIMIT_ENABLED=0 (or removing it) is an instant off switch.
//
// Limits are per IP per minute and deliberately generous: they stop scripts,
// not a seller working fast (a 100-photo batch, the sync agent, several tabs).
// Anything that fails while checking (Upstash down / slow) lets the request
// through -- rate limiting must never lock Sel out.

export type RateTier = "skip" | "auth" | "ai" | "bulk" | "general";

export const DEFAULT_LIMITS: Record<Exclude<RateTier, "skip">, number> = {
  auth: 30, // login-lockout checks (pre-sign-in)
  ai: 120, // paid OpenAI / eBay-fan-out calls, one per item
  bulk: 300, // listing, drafts, batches, jobs, sync
  general: 600, // everything else under /api
};

// Never limited: not user-driven, verified another way, or would break the app.
const SKIP_PREFIXES = [
  "/api/ebay/callback", // eBay OAuth redirect
  "/api/ebay/account-deletion", // eBay-signed notifications
  "/api/photos/", // image proxy: a grid loads dozens at once
  "/api/cron/", // CRON_SECRET
  "/api/jobs/worker", // server-to-server queue worker
  "/api/billing/webhook", // Stripe-signed
];

const AUTH_PREFIXES = ["/api/auth/lockout"];

const AI_PREFIXES = [
  "/api/analyze-item",
  "/api/group-photos",
  "/api/detect-item-dividers",
  "/api/ai/suggest-specifics",
  "/api/pricing/suggest",
  "/api/pricing/comps",
];

const BULK_PREFIXES = [
  "/api/analyze-batch",
  "/api/batch-jobs",
  "/api/jobs",
  "/api/drafts",
  "/api/ebay/list",
  "/api/ebay/sync",
  "/api/ebay/update-price",
  "/api/ebay/relist",
  "/api/ebay/delist",
  "/api/ebay/specifics-refill",
];

export function rateTier(pathname: string): RateTier {
  if (!pathname.startsWith("/api/") && pathname !== "/api") return "skip";
  if (SKIP_PREFIXES.some((p) => pathname.startsWith(p))) return "skip";
  if (AUTH_PREFIXES.some((p) => pathname.startsWith(p))) return "auth";
  if (AI_PREFIXES.some((p) => pathname.startsWith(p))) return "ai";
  if (BULK_PREFIXES.some((p) => pathname.startsWith(p))) return "bulk";
  return "general";
}

export interface RateLimitConfig {
  enabled: boolean;
  url: string | null;
  token: string | null;
  limits: Record<Exclude<RateTier, "skip">, number>;
}

function num(v: string | undefined, fallback: number, min: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= min ? Math.trunc(n) : fallback;
}

export function rateLimitConfig(env: Record<string, string | undefined> = process.env): RateLimitConfig {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL || null;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN || null;
  return {
    enabled: env.RATE_LIMIT_ENABLED === "1" && !!url && !!token,
    url,
    token,
    // Optional overrides; can't be set below a floor that would hurt normal use.
    limits: {
      auth: num(env.RATE_LIMIT_AUTH_PER_MIN, DEFAULT_LIMITS.auth, 10),
      ai: num(env.RATE_LIMIT_AI_PER_MIN, DEFAULT_LIMITS.ai, 60),
      bulk: num(env.RATE_LIMIT_BULK_PER_MIN, DEFAULT_LIMITS.bulk, 120),
      general: num(env.RATE_LIMIT_GENERAL_PER_MIN, DEFAULT_LIMITS.general, 240),
    },
  };
}

export function clientIp(headers: { get(name: string): string | null }): string {
  return headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() || headers.get("x-real-ip") || "127.0.0.1";
}

/** Runs a limiter check but never blocks on errors or a slow Redis (fail open). */
export async function allowRequest(check: () => Promise<{ success: boolean }>, timeoutMs = 800): Promise<boolean> {
  try {
    const r = await Promise.race([
      check(),
      new Promise<{ success: boolean }>((resolve) => setTimeout(() => resolve({ success: true }), timeoutMs)),
    ]);
    return r.success !== false;
  } catch {
    return true;
  }
}
