// Weighted comparable-listing pricing (pure, browser-safe).
//
// Input: ACTIVE eBay listings found by the Browse API. eBay doesn't give
// apps sold prices without Marketplace Insights API approval, which
// Listflow doesn't have -- so these are asking prices of items still for
// sale, which usually run ABOVE what things actually sell for. The result
// is a suggestion with a range and a confidence, never applied
// automatically.
//
// Each comp is weighted by how alike it is: same brand, same size, same
// condition class (new vs used), and title overlap. The range is the
// weighted 25th–75th percentile; "typical" is the weighted median.

export interface Comp {
  title: string;
  price: number;
  /** Buyer-paid shipping; 0 = free shipping; null = unknown. */
  shipping: number | null;
  /** eBay conditionId ("1000" new with tags, "1500" new other, "3000" used, ...). */
  conditionId: string | null;
  url?: string | null;
}

export interface CompTarget {
  title: string;
  brand?: string | null;
  size?: string | null;
  /** Listflow condition label ("New with tags", "Excellent used", ...). */
  condition?: string | null;
  /** Our estimated shipping, taken off free-shipping comps' prices (they include it). */
  estShipping?: number;
}

export interface WeightedComp extends Comp {
  value: number;
  weight: number;
  why: string[];
}

export interface CompSummary {
  low: number;
  typical: number;
  high: number;
  confidence: "high" | "medium" | "low";
  /** How many listings were found / used after removing extreme prices. */
  found: number;
  used: number;
  /** Effective number of close matches (sum of weights, squared, over sum of squared weights). */
  effectiveCount: number;
  examples: WeightedComp[];
  note: string;
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/['’]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const STOP = new Set(["the", "a", "and", "with", "for", "of", "in", "size", "mens", "womens", "men", "women", "new", "nwt", "used", "vintage", "vtg"]);
const tokens = (s: string) => new Set(norm(s).split(" ").filter((w) => w.length >= 2 && !STOP.has(w)));

const SIZE_ALIASES: Record<string, string> = {
  "extra small": "xs", "x small": "xs", xsmall: "xs", small: "s", sm: "s", medium: "m", med: "m", md: "m",
  large: "l", lg: "l", "extra large": "xl", "x large": "xl", xlarge: "xl", "xx large": "xxl", "2xl": "xxl", "2x": "xxl", "3xl": "xxxl", "3x": "xxxl",
};
const LETTER_SIZES = ["xxs", "xs", "s", "m", "l", "xl", "xxl", "xxxl"];

/** "Medium" -> "m", "32x30" -> "32x30", "W32 L30" -> "32x30", "10" -> "10". */
export function normalizeSize(size: string | null | undefined): string | null {
  if (!size) return null;
  let s = norm(size);
  const wl = /w\s?(\d{2})\s*l\s?(\d{2})/.exec(s) ?? /\b(\d{2})\s?x\s?(\d{2})\b/.exec(s);
  if (wl) return `${wl[1]}x${wl[2]}`;
  for (const [k, v] of Object.entries(SIZE_ALIASES)) if (s === k) return v;
  s = s.replace(/^size /, "");
  if (LETTER_SIZES.includes(s)) return s;
  if (/^\d{1,2}(\.\d)?$/.test(s)) return s;
  return s.length <= 6 ? s : null;
}

/** Sizes a title mentions (normalized). */
export function sizesInTitle(title: string): Set<string> {
  const t = ` ${norm(title)} `;
  const out = new Set<string>();
  for (const m of t.matchAll(/w\s?(\d{2})\s*l\s?(\d{2})|\b(\d{2})\s?x\s?(\d{2})\b/g)) out.add(`${m[1] ?? m[3]}x${m[2] ?? m[4]}`);
  for (const [k, v] of Object.entries(SIZE_ALIASES)) if (t.includes(` ${k} `)) out.add(v);
  for (const l of LETTER_SIZES) if (new RegExp(` (size )?${l} `).test(t)) out.add(l);
  const num = /\bsize (\d{1,2}(?:\.\d)?)\b/.exec(t);
  if (num) out.add(num[1]);
  return out;
}

/** Listflow condition label -> "new" / "used" class. eBay ids: 1000–1750 new-ish, 2000+ used/refurb. */
export function conditionClass(label: string | null | undefined): "new" | "used" | null {
  if (!label) return null;
  return /^new/i.test(label) ? "new" : "used";
}
function compConditionClass(id: string | null): "new" | "used" | null {
  const n = Number(id);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 2000 ? "new" : "used";
}

export function weighComp(c: Comp, t: CompTarget): WeightedComp {
  const why: string[] = [];
  let w = 1;
  const title = norm(c.title);
  const brand = t.brand && !/^unknown|unbranded$/i.test(t.brand) ? norm(t.brand) : "";
  if (brand) {
    if (` ${title} `.includes(` ${brand} `)) why.push("same brand");
    else { w *= 0.35; why.push("other brand"); }
  }
  const size = normalizeSize(t.size);
  if (size) {
    const found = sizesInTitle(c.title);
    if (found.has(size)) why.push("same size");
    else if (found.size > 0) { w *= 0.45; why.push("other size"); }
    else w *= 0.75;
  }
  const mine = conditionClass(t.condition);
  const theirs = compConditionClass(c.conditionId);
  if (mine && theirs) {
    if (mine === theirs) why.push(mine === "new" ? "also new" : "also used");
    else { w *= 0.45; why.push(theirs === "new" ? "theirs is new" : "theirs is used"); }
  }
  const a = tokens(t.title);
  const b = tokens(c.title);
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const overlap = a.size && b.size ? inter / Math.min(a.size, b.size) : 0;
  w *= 0.4 + 0.6 * Math.min(1, overlap);
  // Free-shipping prices include shipping: take our estimate off.
  const value = c.shipping === 0 && t.estShipping ? Math.max(0.99, c.price - t.estShipping) : c.price;
  return { ...c, value, weight: w, why };
}

export function weightedQuantile(values: number[], weights: number[], q: number): number {
  const pairs = values.map((v, i) => [v, weights[i]] as const).filter(([, w]) => w > 0).sort((x, y) => x[0] - y[0]);
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  if (!pairs.length || total <= 0) return 0;
  let acc = 0;
  for (const [v, w] of pairs) {
    acc += w;
    if (acc >= q * total) return v;
  }
  return pairs[pairs.length - 1][0];
}

const round = (n: number) => (n >= 20 ? Math.round(n) : Math.round(n * 2) / 2);

export function summarizeComps(comps: Comp[], target: CompTarget): CompSummary | null {
  const valid = comps.filter((c) => Number.isFinite(c.price) && c.price > 0 && c.price < 100_000 && c.title);
  if (valid.length === 0) return null;
  const weighed = valid.map((c) => weighComp(c, target));
  // Drop extreme prices (lots, typos, "make offer" placeholders).
  const med = weightedQuantile(weighed.map((c) => c.value), weighed.map(() => 1), 0.5);
  const kept = weighed.filter((c) => c.value >= med / 4 && c.value <= med * 4);
  if (kept.length === 0) return null;
  const vals = kept.map((c) => c.value);
  const ws = kept.map((c) => c.weight);
  const sumW = ws.reduce((a, b) => a + b, 0);
  const sumW2 = ws.reduce((a, b) => a + b * b, 0);
  const effectiveCount = sumW2 > 0 ? (sumW * sumW) / sumW2 : 0;
  const closeMatches = kept.filter((c) => c.weight >= 0.5).length;
  const low = round(weightedQuantile(vals, ws, 0.25));
  const typical = round(weightedQuantile(vals, ws, 0.5));
  const high = round(weightedQuantile(vals, ws, 0.75));
  const spread = typical > 0 ? (high - low) / typical : 1;
  const confidence: CompSummary["confidence"] =
    closeMatches >= 5 && effectiveCount >= 6 && spread <= 0.6 ? "high" : closeMatches >= 2 && effectiveCount >= 3 ? "medium" : "low";
  const examples = [...kept].sort((x, y) => y.weight - x.weight).slice(0, 5);
  return {
    low, typical, high, confidence, found: valid.length, used: kept.length, effectiveCount: Math.round(effectiveCount * 10) / 10, examples,
    note: "Based on items still for sale on eBay (asking prices), not sold prices — eBay doesn't share sold prices with apps like Listflow. Things often sell for less than they're listed at.",
  };
}
