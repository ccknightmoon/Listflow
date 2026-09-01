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
//
// IMPORTANT: /api routes are NEVER made public as a blanket rule here.
// Every /api/* route other than the callback above must fall through to
// the same "!user -> 401 JSON" check further down. A version of this file
// briefly existed (as an unused, never-deployed duplicate at the project
// root) that treated ALL "/api" paths as public — that would have made
// every API route reachable with zero authentication, reopening exactly
// the bypass this middleware was rewritten to close. Do not reintroduce
// a blanket "/api" public rule.
const PUBLIC_PATHS = ["/", "/login", "/privacy", "/terms"];
const PUBLIC_PREFIXES = ["/_next", "/favicon", "/api/ebay/callback"];

// Rate limiting on the two AI vision endpoints — the actual cost driver,
// since each call is a real paid OpenAI request. Built defensively: if the
// two Upstash env vars aren't set, rate limiting is silently skipped
// rather than throwing on every single request through this middleware.
// A missing secondary/optional feature should never be able to take down
// the whole app — the same principle behind every other "warn, don't
// block" pattern in this codebase (see storeCategoryWarning in
// api/ebay/list, for one).
const RATE_LIMITED_PATHS = ["/api/analyze-item", "/api/analyze-batch"];
const ratelimit =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Ratelimit({
        redis: Redis.fromEnv(),
        limiter: Ratelimit.slidingWindow(15, "1 m"),
        analytics: true,
        prefix: "listflow:rl",
      })
    : null;

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.includes(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    // Still resolve the user below for the "/login while already signed in" redirect;
    // everything else here just passes through.
    if (pathname !== "/login") {
      return NextResponse.next();
    }
  }

  if (ratelimit && RATE_LIMITED_PATHS.some((p) => pathname.startsWith(p))) {
    const forwardedFor = request.headers.get("x-forwarded-for");
    const ip = request.ip ?? forwardedFor?.split(",", 1)[0]?.trim() ?? "127.0.0.1";
    const { success } = await ratelimit.limit(ip);
    if (!success) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a minute before trying again." },
        { status: 429 }
      );
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
