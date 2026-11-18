// Price drops for live listings: presets, custom amounts, and a floor.
// Exact cents. A cut never goes below $0.99, the floor you set, or the
// item's cost when you've entered one -- and never RAISES a price.
import { applyPrice, MIN_PRICE, type PriceChange } from "./bulk-edit";

export const PRICE_CUT_PRESETS = [10, 15, 20] as const;

export interface CutTarget {
  id: string;
  title: string;
  price: number | null;
  costBasis?: number | null;
}

export interface CutRow {
  id: string;
  title: string;
  from: number | null;
  to: number | null; // null = skipped
  reason?: "no_price" | "at_floor" | "no_change";
  limitedBy?: "floor" | "cost" | "minimum";
}

const c = (n: number) => Math.round(n * 100);

export function planPriceCut(items: CutTarget[], change: PriceChange, floor?: number | null): CutRow[] {
  return items.map((it) => {
    if (it.price == null || !Number.isFinite(it.price)) return { id: it.id, title: it.title, from: null, to: null, reason: "no_price" as const };
    const raw = applyPrice(it.price, change);
    if (raw == null) return { id: it.id, title: it.title, from: it.price, to: null, reason: "no_price" as const };
    const guards: Array<[number, CutRow["limitedBy"]]> = [[c(MIN_PRICE), "minimum"]];
    if (floor != null && Number.isFinite(floor) && floor > 0) guards.push([c(floor), "floor"]);
    if (it.costBasis != null && Number.isFinite(it.costBasis) && it.costBasis > 0) guards.push([c(it.costBasis), "cost"]);
    let toC = c(raw);
    let limitedBy: CutRow["limitedBy"];
    for (const [g, why] of guards) if (toC < g) { toC = g; limitedBy = why; }
    if (toC >= c(it.price)) {
      return { id: it.id, title: it.title, from: it.price, to: null, reason: limitedBy ? "at_floor" as const : "no_change" as const, limitedBy };
    }
    return { id: it.id, title: it.title, from: it.price, to: toC / 100, limitedBy };
  });
}

export function summarizeCut(rows: CutRow[]) {
  const changing = rows.filter((r) => r.to != null);
  const reductionC = changing.reduce((a, r) => a + c(r.from as number) - c(r.to as number), 0);
  return {
    changing: changing.length,
    skipped: rows.length - changing.length,
    atFloor: rows.filter((r) => r.reason === "at_floor").length,
    limited: changing.filter((r) => r.limitedBy).length,
    totalReduction: reductionC / 100,
  };
}

// ------------------------------------------------- big-run safety (Nov 2026)
// Lowering many prices at once is one click away from a costly mistake
// (QA: 896 stale listings, $6,627.79 off). From BULK_CONFIRM_AT listings up,
// the seller must type the number of listings to confirm; from
// BULK_WARN_AT up, the confirm step also suggests smaller batches.
export const BULK_CONFIRM_AT = 20;
export const BULK_WARN_AT = 250;

export function needsTypedConfirm(changing: number): boolean {
  return changing >= BULK_CONFIRM_AT;
}

/** "896", " 896 ", "896 listings" and "896" all confirm 896; anything else doesn't. */
export function typedConfirmMatches(typed: string, changing: number): boolean {
  const digits = typed.replace(/[^\d]/g, "");
  return digits.length > 0 && Number(digits) === changing;
}
