// Sequential numeric SKU assignment ("1", "2", "3", ...) for a draft that
// has no SKU yet, safe under concurrent listing (batch "List all" runs
// several /api/ebay/list calls at once).
//
// The database is the referee: drafts has UNIQUE (user_id, custom_sku), and
// the claim is a conditional update (`... where custom_sku is null`). Two
// requests that compute the same next number can't both win -- the loser
// gets a unique-violation and simply tries again with a fresh read.
//
// Kept free of Supabase/Next imports so the retry logic is unit-testable.

export type ClaimResult =
  | { kind: "claimed" }
  | { kind: "conflict" } // another draft already holds this SKU (23505)
  | { kind: "already_set" } // this draft got a SKU from a parallel request
  | { kind: "error"; message: string };

export interface SkuAssignDeps {
  /** All of this user's existing non-null SKUs. */
  readSkus: () => Promise<Array<string | null>>;
  /** Try to set `candidate` on the draft, only if it has no SKU yet. */
  tryClaim: (candidate: string) => Promise<ClaimResult>;
  /** Re-read this draft's own SKU (used after "already_set"). */
  readCurrent: () => Promise<string | null>;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  maxAttempts?: number;
}

export type SkuAssignOutcome =
  | { ok: true; sku: string; attempts: number }
  | { ok: false; reason: "exhausted" | "error"; message: string };

export function highestNumericSku(skus: Array<string | null>): number {
  let max = 0;
  for (const s of skus) {
    if (s == null) continue;
    const t = s.trim();
    // Only pure digit strings count -- "12abc" or "A-7" must not be read as
    // 12 / NaN-but-accepted by parseInt's prefix parsing.
    if (!/^\d+$/.test(t)) continue;
    const n = Number(t);
    if (Number.isSafeInteger(n) && n > max) max = n;
  }
  return max;
}

export async function assignSequentialSku(deps: SkuAssignDeps): Promise<SkuAssignOutcome> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = deps.random ?? Math.random;
  const maxAttempts = deps.maxAttempts ?? 8;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const existing = await deps.readSkus();
    const candidate = String(highestNumericSku(existing) + 1);
    const result = await deps.tryClaim(candidate);

    if (result.kind === "claimed") return { ok: true, sku: candidate, attempts: attempt + 1 };

    if (result.kind === "already_set") {
      const current = await deps.readCurrent();
      if (current) return { ok: true, sku: current, attempts: attempt + 1 };
      // Row changed under us but has no SKU now -- just go around again.
      continue;
    }

    if (result.kind === "error") return { ok: false, reason: "error", message: result.message };

    // Conflict: a parallel request took this number first. Back off a
    // little (randomized so parallel losers don't collide again in
    // lockstep), then re-read the max and try the next free number.
    await sleep(Math.round(20 + random() * 80 * (attempt + 1)));
  }
  return { ok: false, reason: "exhausted", message: "Could not assign a unique SKU. Please try again." };
}
