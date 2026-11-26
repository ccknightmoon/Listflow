import { verifiedUser } from "@/lib/verified-user";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { allowRequest, clientIp, rateLimitConfig, rateTier } from "@/lib/rate-limit-policy";

// Routes that must stay reachable without this middleware's own session check:
// - "/", "/login", "/privacy", "/terms" are public entry points.
// - "/api/ebay/callback" is eBay's OAuth redirect target — it does its own
//   auth + CSRF `state` check in-route (see api/ebay/callback/route.ts)
//   rather than relying on this middleware, since it's reached via a
//   cross-site top-level redirect from eBay rather than in-app navigation.
//   "/api/ebay/connect" is NOT here on purpose — starting the OAuth flow
//   requires being logged in, same as everything else.
// - "/api/auth/lockout" is the login-lockout proxy (see
//   src/app/api/auth/lockout/route.ts) — it has to be reachable BEFORE
//   sign-in, since checking/recording a failed login attempt happens while
//   the visitor is still anonymous. It's still subject to the rate-limit
//   block below (that check runs before this public-path bypass, on
//   purpose — see the comment there) and does its own email-shape
//   validation and service-role-scoped RPC calls internally.
// - "/api/cron" (both api/cron/purge-deleted-accounts and
//   api/cron/daily-digest) is added here Sept 9, 2026, fixing a real bug
//   found while building the digest route: Vercel Cron's actual HTTP
//   request carries no Supabase session cookie at all (only
//   `Authorization: Bearer $CRON_SECRET`), so without this carve-out the
//   "!user -> 401 JSON" check further down fired FIRST, on every single
//   cron-triggered request, before either route's own CRON_SECRET check
//   ever ran — meaning the daily account-purge cron has very likely never
//   actually succeeded on its Vercel-triggered schedule since this
//   middleware was rewritten to cover every /api path (confirmed locally:
//   both cron routes returned this middleware's own "Not authenticated"
//   body even with a Bearer token attached, never reaching their own
//   "Not authorized" check). Safe to make public the same way
//   /api/ebay/callback and /api/auth/lockout already are: both cron
//   routes do their own CRON_SECRET check internally and refuse anything
//   else, so an anonymous request here still gets nothing but a 401.
//
// IMPORTANT: /api routes are NEVER made public as a blanket rule here.
// Every /api/* route other than the ones explicitly listed above must
// fall through to the same "!user -> 401 JSON" check further down. A
// version of this file briefly existed (as an unused, never-deployed
// duplicate at the project root) that treated ALL "/api" paths as public
// — that would have made every API route reachable with zero
// authentication, reopening exactly the bypass this middleware was
// rewritten to close. Do not reintroduce a blanket "/api" public rule.
const PUBLIC_PATHS = ["/", "/login", "/privacy", "/terms", "/forgot-password", "/reset-password", "/manifest.webmanifest", "/sw.js"];
// "/api/ebay/account-deletion": eBay's Marketplace Account Deletion
// notifications (signed by eBay, verified in the route itself).
// "/api/billing/webhook": Stripe events (Stripe-Signature verified in the route).
const PUBLIC_PREFIXES = ["/_next", "/favicon", "/api/ebay/callback", "/api/auth/lockout", "/api/cron", "/api/jobs/worker", "/api/ebay/account-deletion", "/api/billing/webhook"];

// Self-service account deletion (src/lib/account-deletion.ts): a signed-in
// user with a pending deletion request is locked to /account/pending-deletion
// and the couple of API routes that page itself calls, until they
// reactivate there or the grace period lapses and the daily purge cron
// (api/cron/purge-deleted-accounts) deletes the account for good.
const PENDING_DELETION_ALLOWED_PATHS = [
  "/account/pending-deletion",
  "/api/account/status",
  "/api/account/reactivate",
];

// Rate limiting: OFF unless RATE_LIMIT_ENABLED=1 AND Upstash Redis env vars
// are set. Four generous per-IP tiers (auth 30, AI 120, bulk/listing 300,
// general 600 per minute); cron, queue worker, eBay/Stripe webhooks and the
// photo proxy are never limited; a Redis error or slow answer lets the
// request through (fail open), so it can't lock the owner out.
// Nov 2026: tiers, limits and the on/off switch live in
// src/lib/rate-limit-policy.ts (RATE_LIMIT_ENABLED=1 + Upstash vars).
const rl = rateLimitConfig();
const redis = rl.enabled ? new Redis({ url: rl.url!, token: rl.token! }) : null;
const limiters = redis
  ? {
      auth: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(rl.limits.auth, "1 m"), analytics: false, prefix: "listflow:rl:auth" }),
      ai: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(rl.limits.ai, "1 m"), analytics: false, prefix: "listflow:rl:ai2" }),
      bulk: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(rl.limits.bulk, "1 m"), analytics: false, prefix: "listflow:rl:bulk" }),
      general: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(rl.limits.general, "1 m"), analytics: false, prefix: "listflow:rl:general2" }),
    }
  : null;

const notPendingUntil = new Map<string, number>();

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Deliberately runs BEFORE the public-path bypass below: "/api/auth/lockout"
  // is both public (reachable pre-sign-in) AND rate-limited, and the eBay
  // callback is the only /api path that should skip this entirely (it's a
  // one-time OAuth redirect, not a route a script would hammer).
  if (limiters) {
    const tier = rateTier(pathname);
    if (tier !== "skip") {
      const limiter = limiters[tier];
      const ok = await allowRequest(() => limiter.limit(`${tier}:${clientIp(request.headers)}`));
      if (!ok) {
        return NextResponse.json(
          { error: "Too many requests. Please wait a minute before trying again.", rateLimited: true },
          { status: 429, headers: { "Retry-After": "60" } }
        );
      }
    }
  }

  if (PUBLIC_PATHS.includes(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    // Still resolve the user below for the "/login while already signed in" redirect;
    // everything else here just passes through.
    if (pathname !== "/login") {
      return NextResponse.next();
    }
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Verified locally from the JWT (see verifiedUser in src/lib/auth.ts):
  // no Supabase Auth round trip per request.
  const user = await verifiedUser(supabase as never);

  if (pathname === "/login") {
    // Already signed in: no reason to see the login page again.
    if (user) return NextResponse.redirect(new URL("/dashboard", request.url));
    // Not signed in: this IS the page an anonymous visitor is supposed to
    // reach. Falling through to the generic "!user" branch below would
    // redirect back to "/login" itself — an infinite redirect loop. This
    // was the actual bug behind "the app won't load": anyone who wasn't
    // already signed in (a new visitor, a cleared cookie, an expired
    // session) hit net::ERR_TOO_MANY_REDIRECTS trying to reach /login at
    // all, with no way in.
    return response;
  }

  if (!user) {
    if (pathname.startsWith("/api")) {
      // API routes get a JSON 401, not an HTML redirect.
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }

  if (!PENDING_DELETION_ALLOWED_PATHS.includes(pathname)) {
    // "Not pending" is remembered for a minute per server instance (one
    // database trip fewer on almost every request). "Pending" is never
    // remembered, so Reactivate takes effect at once; a fresh deletion
    // request can take up to a minute to start redirecting (the purge is
    // 30 days later anyway).
    let pending = false;
    const okUntil = notPendingUntil.get(user.id) ?? 0;
    if (okUntil < Date.now()) {
      const { data: settings } = await supabase
        .from("app_settings")
        .select("deletion_requested_at")
        .eq("user_id", user.id)
        .maybeSingle();
      pending = !!settings?.deletion_requested_at;
      if (!pending) {
        if (notPendingUntil.size > 5000) notPendingUntil.clear();
        notPendingUntil.set(user.id, Date.now() + 60_000);
      }
    }

    if (pending) {
      if (pathname.startsWith("/api")) {
        return NextResponse.json(
          { error: "Account pending deletion", pendingDeletion: true },
          { status: 403 }
        );
      }
      const pendingUrl = request.nextUrl.clone();
      pendingUrl.pathname = "/account/pending-deletion";
      return NextResponse.redirect(pendingUrl);
    }
  }

  return response;
}

export const config = {
  // Run on everything except static assets. Unlike the old config, this
  // DOES include /api — the previous matcher's "(?!api|...)" exclusion is
  // what left every API route unauthenticated.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
