import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

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
//
// IMPORTANT: /api routes are NEVER made public as a blanket rule here.
// Every /api/* route other than the two above must fall through to the
// same "!user -> 401 JSON" check further down. A version of this file
// briefly existed (as an unused, never-deployed duplicate at the project
// root) that treated ALL "/api" paths as public — that would have made
// every API route reachable with zero authentication, reopening exactly
// the bypass this middleware was rewritten to close. Do not reintroduce
// a blanket "/api" public rule.
const PUBLIC_PATHS = ["/", "/login", "/privacy", "/terms"];
const PUBLIC_PREFIXES = ["/_next", "/favicon", "/api/ebay/callback", "/api/auth/lockout"];

// Rate limiting, two tiers. Built defensively either way: if the two
// Upstash env vars aren't set, rate limiting is silently skipped rather
// than throwing on every single request through this middleware. A missing
// secondary/optional feature should never be able to take down the whole
// app — the same principle behind every other "warn, don't block" pattern
// in this codebase (see storeCategoryWarning in api/ebay/list, for one).
//
// Tier 1 — AI_RATE_LIMITED_PATHS: every endpoint that triggers a real paid
// OpenAI call, or fans out multiple eBay calls per invocation (originally
// just analyze-item/analyze-batch; group-photos and ai/suggest-specifics
// are the same OpenAI cost shape and were simply missed when this was
// first added; pricing/suggest fans out several eBay Browse API calls per
// item, so it gets the tighter limit too). 15 requests/min/IP, matching
// the original limit.
//
// Tier 2 — everything else under /api (except the eBay OAuth callback,
// which isn't reached through normal in-app navigation and doesn't need
// gating here). A much looser 60 requests/min/IP catch-all: cheap
// Supabase-backed CRUD and read endpoints don't need the AI tier's limit,
// but "no limit at all" left the entire rest of the API surface open to
// unbounded scripted requests. 60/min comfortably covers real usage
// (a page loading a couple of parallel fetches, or the store/sales pages
// refetching on a filter change) while still capping abuse.
const AI_RATE_LIMITED_PATHS = [
  "/api/analyze-item",
  "/api/analyze-batch",
  "/api/group-photos",
  "/api/ai/suggest-specifics",
  "/api/pricing/suggest",
];
const hasUpstash = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
const redis = hasUpstash ? Redis.fromEnv() : null;
const aiRatelimit = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(15, "1 m"), analytics: true, prefix: "listflow:rl:ai" })
  : null;
const generalRatelimit = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(60, "1 m"), analytics: true, prefix: "listflow:rl:general" })
  : null;

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Deliberately runs BEFORE the public-path bypass below: "/api/auth/lockout"
  // is both public (reachable pre-sign-in) AND rate-limited, and the eBay
  // callback is the only /api path that should skip this entirely (it's a
  // one-time OAuth redirect, not a route a script would hammer).
  if (redis && pathname.startsWith("/api") && !pathname.startsWith("/api/ebay/callback")) {
    const isAiPath = AI_RATE_LIMITED_PATHS.some((p) => pathname.startsWith(p));
    const limiter = isAiPath ? aiRatelimit : generalRatelimit;
    if (limiter) {
      const forwardedFor = request.headers.get("x-forwarded-for");
      const ip = request.ip ?? forwardedFor?.split(",", 1)[0]?.trim() ?? "127.0.0.1";
      const { success } = await limiter.limit(ip);
      if (!success) {
        return NextResponse.json(
          { error: "Too many requests. Please wait a minute before trying again." },
          { status: 429 }
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

  const { data: { user } } = await supabase.auth.getUser();

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
