// Free, code-level equivalent of Supabase's paid "leaked password protection"
// toggle (that one requires a Pro-plan-and-up subscription — see CLAUDE.md).
// Same underlying technique and the same data source (HaveIBeenPwned's
// Pwned Passwords database), just called directly from the app instead of
// through Supabase's Auth service.
//
// Uses the "k-anonymity" model HaveIBeenPwned's API is specifically designed
// for: only the first 5 characters of the password's SHA-1 hash are ever
// sent over the network. The API returns every known breached hash sharing
// that 5-character prefix (a few hundred to a few thousand), and the match
// against the full hash happens locally in the browser. The actual password,
// and even its full hash, never leaves the device.
//
// Runs client-side (Web Crypto's SubtleCrypto, browser-only — this is called
// from the "use client" login/signup form).

export interface PwnedCheckResult {
  pwned: boolean;
  count: number;
}

async function sha1Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-1", bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

// Returns null (rather than throwing) on any failure — a network hiccup or
// the HIBP API being briefly unreachable should never block someone from
// creating an account. The caller only blocks signup when this resolves to
// { pwned: true }; anything else (including null) lets signup proceed.
export async function checkPasswordPwned(password: string): Promise<PwnedCheckResult | null> {
  try {
    const hash = await sha1Hex(password);
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    let res: Response;
    try {
      res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
        signal: controller.signal,
        headers: { "Add-Padding": "true" },
      });
    } finally {
      clearTimeout(timeoutId);
    }
    if (!res.ok) return null;

    const body = await res.text();
    const match = body
      .split("\n")
      .map((line) => line.trim().split(":"))
      .find(([lineSuffix]) => lineSuffix === suffix);

    if (!match) return { pwned: false, count: 0 };
    const count = parseInt(match[1] ?? "0", 10) || 0;
    return { pwned: count > 0, count };
  } catch {
    return null;
  }
}
