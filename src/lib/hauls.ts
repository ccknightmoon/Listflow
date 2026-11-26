// Hauls: one sourcing trip ("Rag house X, Nov 26, paid $120 for 60 pieces").
// Pure helpers (browser + server safe). Migration 041.
//
// splitHaulCost spreads the trip's total cost across its items, to the
// cent, so the per-item costs always add up to exactly the total:
//   even  -> same share for every item
//   price -> share proportional to each item's list price (a $40 jacket
//            carries more of the bag's cost than a $12 tee). Items without
//            a price get the even share of what's left.
// haulSummary turns a haul + its drafts + matched sales into
// "$120 in -> $612 out so far, 41% sold".

export type SplitMode = "even" | "price";

export interface Haul {
  id: string;
  name: string;
  source: string | null;
  boughtOn: string; // YYYY-MM-DD
  totalCost: number;
  weightLb: number | null;
  notes: string | null;
  splitMode: SplitMode;
}

export interface HaulItem {
  id: string;
  price: number | null;
}

const cents = (n: number) => Math.round(n * 100);

/** Item id -> cost in dollars. Sum equals `total` exactly (largest remainder). */
export function splitHaulCost(total: number, items: HaulItem[], mode: SplitMode): Record<string, number> {
  const out: Record<string, number> = {};
  if (!items.length) return out;
  const totalC = Math.max(0, cents(Number.isFinite(total) ? total : 0));
  const priced = items.map((i) => (typeof i.price === "number" && Number.isFinite(i.price) && i.price > 0 ? i.price : 0));
  const priceSum = priced.reduce((s, p) => s + p, 0);
  let weights: number[];
  if (mode === "price" && priceSum > 0) {
    const unpriced = priced.filter((p) => p === 0).length;
    // Unpriced items weigh as much as an average priced item.
    const avg = priceSum / (items.length - unpriced || 1);
    weights = priced.map((p) => (p > 0 ? p : avg));
  } else {
    weights = items.map(() => 1);
  }
  const wSum = weights.reduce((s, w) => s + w, 0);
  const raw = weights.map((w) => (totalC * w) / wSum);
  const base = raw.map((r) => Math.floor(r));
  let left = totalC - base.reduce((s, b) => s + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    base[i]++;
    left--;
  }
  items.forEach((it, i) => (out[it.id] = base[i] / 100));
  return out;
}

export interface HaulDraft {
  id: string;
  haulId: string | null;
  title: string | null;
  costBasis: number | null;
  listingId: string | null;
  price: number | null;
}

export interface HaulSale {
  listingId: string;
  itemTotal: number;
  /** Real eBay fee when known, else the estimate. */
  fee: number;
  /** Ad fee / label cost already attributed to this sale, if known. */
  otherCosts?: number;
}

export interface HaulSummary {
  haulId: string;
  items: number;
  listed: number;
  sold: number;
  sellThrough: number; // 0..1 of items
  costIn: number; // the haul's total cost
  grossOut: number; // item totals of sold items
  feesOut: number;
  netOut: number; // gross - fees - other costs
  profit: number; // net - cost of the items SOLD
  roi: number | null; // netOut / costIn (whole haul), null when cost is 0
  unsoldCost: number; // cost still sitting in unsold items
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function haulSummary(haul: Pick<Haul, "id" | "totalCost">, drafts: HaulDraft[], sales: HaulSale[]): HaulSummary {
  const mine = drafts.filter((d) => d.haulId === haul.id);
  const byListing = new Map<string, HaulSale[]>();
  for (const s of sales) {
    if (!s.listingId) continue;
    const arr = byListing.get(s.listingId) ?? [];
    arr.push(s);
    byListing.set(s.listingId, arr);
  }
  let sold = 0, listed = 0, gross = 0, fees = 0, other = 0, soldCost = 0, unsoldCost = 0;
  for (const d of mine) {
    if (d.listingId) listed++;
    const ss = d.listingId ? byListing.get(d.listingId) ?? [] : [];
    const cost = typeof d.costBasis === "number" && Number.isFinite(d.costBasis) ? d.costBasis : 0;
    if (ss.length) {
      sold++;
      soldCost += cost;
      for (const s of ss) {
        gross += s.itemTotal;
        fees += s.fee;
        other += s.otherCosts ?? 0;
      }
    } else {
      unsoldCost += cost;
    }
  }
  const net = gross - fees - other;
  return {
    haulId: haul.id,
    items: mine.length,
    listed,
    sold,
    sellThrough: mine.length ? sold / mine.length : 0,
    costIn: r2(haul.totalCost),
    grossOut: r2(gross),
    feesOut: r2(fees),
    netOut: r2(net),
    profit: r2(net - soldCost),
    roi: haul.totalCost > 0 ? net / haul.totalCost : null,
    unsoldCost: r2(unsoldCost),
  };
}

/** Per-item profit (null when the item hasn't sold). */
export function itemProfit(d: Pick<HaulDraft, "costBasis" | "listingId">, sales: HaulSale[]): number | null {
  if (!d.listingId) return null;
  const ss = sales.filter((s) => s.listingId === d.listingId);
  if (!ss.length) return null;
  const cost = typeof d.costBasis === "number" && Number.isFinite(d.costBasis) ? d.costBasis : 0;
  return r2(ss.reduce((t, s) => t + s.itemTotal - s.fee - (s.otherCosts ?? 0), 0) - cost);
}

/** Validates a create/update body. Returns an error message or null. */
export function haulBodyError(b: Record<string, unknown>, partial = false): string | null {
  const has = (k: string) => b[k] !== undefined;
  if (!partial || has("name")) {
    if (typeof b.name !== "string" || !b.name.trim() || b.name.trim().length > 120) return "Give the haul a name (up to 120 characters).";
  }
  if (has("source") && b.source !== null && (typeof b.source !== "string" || b.source.length > 120)) return "Source must be up to 120 characters.";
  if (has("boughtOn") && (typeof b.boughtOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.boughtOn) || Number.isNaN(Date.parse(b.boughtOn)))) return "Date must look like 2026-11-26.";
  if (!partial || has("totalCost")) {
    if (typeof b.totalCost !== "number" || !Number.isFinite(b.totalCost) || b.totalCost < 0 || b.totalCost > 100000) return "Total cost must be $0–$100,000.";
  }
  if (has("weightLb") && b.weightLb !== null && (typeof b.weightLb !== "number" || !Number.isFinite(b.weightLb) || b.weightLb < 0 || b.weightLb > 100000)) return "Weight must be a positive number.";
  if (has("notes") && b.notes !== null && (typeof b.notes !== "string" || b.notes.length > 2000)) return "Notes must be up to 2000 characters.";
  if (has("splitMode") && b.splitMode !== "even" && b.splitMode !== "price") return "Split must be 'even' or 'price'.";
  return null;
}

export function haulFromRow(r: Record<string, unknown>): Haul {
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    source: (r.source as string | null) ?? null,
    boughtOn: String(r.bought_on ?? ""),
    totalCost: Number(r.total_cost ?? 0),
    weightLb: r.weight_lb == null ? null : Number(r.weight_lb),
    notes: (r.notes as string | null) ?? null,
    splitMode: r.split_mode === "price" ? "price" : "even",
  };
}

export { isMissingRelation } from "./db-errors";
