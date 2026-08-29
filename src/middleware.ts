import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Routes that must stay reachable without this middleware's own session check:
// - "/" and "/login" are the public entry points.
// - "/api/ebay/callback" is eBay's OAuth redirect target — it does its own
//   auth + CSRF `state` check in-route (see api/ebay/callback/route.ts)
//   rather than relying on this middleware, since it's reached via a
//   cross-site top-level redirect from eBay rather than in-app navigation.
//   "/api/ebay/connect" is NOT here on purpose — starting the OAuth flow
//   requires being logged in, same as everything else.
const PUBLIC_PATHS = ["/", "/login"];
const PUBLIC_PREFIXES = ["/_next", "/favicon", "/api/ebay/callback"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

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

  if (user && pathname === "/login") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
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
