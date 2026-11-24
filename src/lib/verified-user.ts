// Shared by src/proxy.ts and requireUser() (src/lib/auth.ts). No next/headers here.
export interface AuthedUser {
  id: string;
  email?: string;
  /** user_metadata full_name / name from the token, when set. */
  name?: string;
}

/**
 * The signed-in user from the session's JWT, verified locally against the
 * project's published signing key (ES256 / JWKS, cached) -- no round trip
 * to Supabase Auth on every request (it was ~70 ms each way from iad1 to
 * us-west-2). Falls back to a network check inside supabase-js for
 * symmetric (HS256) tokens. Trade-off: a session revoked server-side stays
 * usable until its access token expires (max 1 hour).
 */
export async function verifiedUser(supabase: { auth: { getClaims: () => Promise<{ data: { claims?: Record<string, unknown> } | null; error: unknown }> } }): Promise<AuthedUser | null> {
  try {
    const { data, error } = await supabase.auth.getClaims();
    const sub = data?.claims?.sub;
    if (error || typeof sub !== "string" || !sub) return null;
    const email = data?.claims?.email;
    const meta = (data?.claims?.user_metadata ?? {}) as Record<string, unknown>;
    const name = [meta.full_name, meta.name].find((v): v is string => typeof v === "string" && v.trim().length > 0);
    return { id: sub, email: typeof email === "string" ? email : undefined, ...(name ? { name } : {}) };
  } catch {
    return null;
  }
}

