import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";

/**
 * Per-request Supabase client that reads the session from this request's
 * cookies (set by the browser's createBrowserClient during sign-in).
 *
 * Use this instead of a bare `createClient(url, anonKey)` in API routes —
 * that pattern runs every query as Supabase's `anon` role with no session
 * attached, which only works at all if Row Level Security on the table is
 * disabled or wide open. This client lets RLS policies scoped to
 * `authenticated` actually recognize who's calling.
 */
export function getServerSupabase() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Route handlers can set cookies; some contexts (e.g. called from
            // a Server Component) can't. Safe to ignore — middleware refreshes
            // the session cookie on every request regardless.
          }
        },
      },
    }
  );
}

/**
 * Defense-in-depth auth check for API routes. Middleware already blocks
 * unauthenticated requests before they reach here, but routes shouldn't rely
 * on that alone — call this at the top of every non-public route handler.
 *
 * Usage:
 *   const auth = await requireUser();
 *   if (!auth.user) return auth.unauthorized;
 *   const { supabase, user } = auth;
 */
export async function requireUser() {
  const supabase = getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return {
      user: null as null,
      supabase,
      unauthorized: NextResponse.json({ error: "Not authenticated" }, { status: 401 }),
    };
  }
  return { user, supabase, unauthorized: null as null };
}
