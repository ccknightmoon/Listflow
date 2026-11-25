// Size values eBay will actually accept (Nov 25, 2026 bug: a Lacoste polo
// tagged "9" was sent to eBay as Size "9" and rejected with error 21920468,
// '"9" is not a valid value for Size').
//
// Two problems, both fixed here (pure, tested in size-mapping.test.ts):
//
// 1. eBay's Taxonomy metadata labels clothing "Size" as FREE_TEXT, but the
//    listing APIs only accept a value from its list (2XS…8XL, S/M, 28…66,
//    Big 1X…). So "Size" with a real list is treated as selection-only
//    everywhere (strictDefs / effectiveMode): the AI's value is mapped to a
//    listed value or left blank and flagged "Needed to publish" — never sent
//    raw.
// 2. Tags use brand/international sizing the list doesn't have. Known cases
//    are converted (Lacoste numeric 1–10, XXL-style letters, words like
//    "Large", "SMALL 36-38", "IT/EU 50", collar sizes "15.5"). Anything we
//    can't map with confidence is left for the seller to pick.
import type { AspectDef } from "@/lib/item-specifics";

/** Aspects eBay enforces against its value list even though metadata says FREE_TEXT. */
const ENFORCED = new Set(["size"]);
/** Only enforce when eBay actually gave us a real list to choose from. */
const MIN_ENFORCED_VALUES = 10;

export function isEnforcedList(def: Pick<AspectDef, "name" | "values">): boolean {
  return ENFORCED.has(def.name.trim().toLowerCase()) && def.values.length >= MIN_ENFORCED_VALUES;
}

/** The mode eBay really applies when listing (not just what the metadata says). */
export function effectiveMode(def: Pick<AspectDef, "name" | "mode" | "values">): AspectDef["mode"] {
  return def.mode === "SELECTION_ONLY" || isEnforcedList(def) ? "SELECTION_ONLY" : "FREE_TEXT";
}

/** Defs with eBay's enforced lists marked selection-only (idempotent). */
export function strictDefs<T extends AspectDef>(defs: T[]): T[] {
  return defs.map((d) => (d.mode !== "SELECTION_ONLY" && isEnforcedList(d) ? { ...d, mode: "SELECTION_ONLY" as const } : d));
}

export function isSizeAspect(name: string): boolean {
  return name.trim().toLowerCase() === "size";
}

// --------------------------------------------------------------- tables --

/**
 * Brand numeric sizing → US letter size. Lacoste: 1=2XS, 2=XS, 3=S, 4=M,
 * 5=L, 6=XL, 7=2XL, 8=3XL, 9=4XL (Lacoste/Macy's/Shopbop charts); 10 is
 * sold as 5XL ("XG") in the US.
 */
const BRAND_NUMERIC: Array<{ brand: RegExp; label: string; sizes: Record<string, string> }> = [
  {
    brand: /\blacoste\b/i,
    label: "Lacoste",
    sizes: { "1": "2XS", "2": "XS", "3": "S", "4": "M", "5": "L", "6": "XL", "7": "2XL", "8": "3XL", "9": "4XL", "10": "5XL" },
  },
];

/** Italian/EU/FR men's shirt & knit sizes (only when the tag says IT/EU/FR). */
const EU_TOPS: Record<string, string> = { "44": "XS", "46": "S", "48": "M", "50": "L", "52": "XL", "54": "2XL", "56": "3XL", "58": "4XL", "60": "5XL" };

/** Dress-shirt collar (neck) sizes → letter size. */
function collarToLetter(n: number): string | null {
  if (n >= 13.5 && n < 14) return "XS";
  if (n >= 14 && n < 15) return "S";
  if (n >= 15 && n < 16) return "M";
  if (n >= 16 && n < 17) return "L";
  if (n >= 17 && n < 18) return "XL";
  if (n >= 18 && n < 19) return "2XL";
  if (n >= 19 && n < 20) return "3XL";
  return null;
}

/** Letter-size spellings → eBay's canonical spelling. */
const LETTER: Record<string, string> = {
  xxs: "2XS", "2xs": "2XS", "xx small": "2XS", xxsmall: "2XS",
  xs: "XS", "x small": "XS", xsmall: "XS", "extra small": "XS",
  s: "S", sm: "S", small: "S", p: "S", // Petit (FR/CA tags "S/P")
  m: "M", med: "M", medium: "M",
  l: "L", lg: "L", large: "L", g: "L", // Grande ("L/G")
  xl: "XL", "x large": "XL", xlarge: "XL", "extra large": "XL", tg: "XL",
  xxl: "2XL", "2xl": "2XL", "xx large": "2XL", xxlarge: "2XL", "2x": "2XL", "2x large": "2XL",
  xxxl: "3XL", "3xl": "3XL", "xxx large": "3XL", "3x": "3XL", "3x large": "3XL",
  xxxxl: "4XL", "4xl": "4XL", "4x": "4XL", "4x large": "4XL",
  xxxxxl: "5XL", "5xl": "5XL", "5x": "5XL",
  "6xl": "6XL", "7xl": "7XL", "8xl": "8XL",
};
/** eBay lists sometimes spell 2XL as XXL; try both. */
const ALT_SPELLING: Record<string, string[]> = {
  "2XS": ["XXS"], "2XL": ["XXL"], "3XL": ["XXXL"], "4XL": ["XXXXL"], "5XL": ["XXXXXL"],
};

const lower = (s: string) => s.toLowerCase().replace(/[^a-z0-9.\s/]+/g, " ").replace(/\s+/g, " ").trim();

function inList(candidate: string, allowed: string[]): string | null {
  for (const c of [candidate, ...(ALT_SPELLING[candidate] ?? [])]) {
    const hit = allowed.find((a) => a.toLowerCase() === c.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

/** Strip "Size", "Sz", "Tag", "US" and similar noise from a tag size. */
function stripNoise(raw: string): string {
  return raw.trim().replace(/^(tag\s+)?(size|sz|talla|taille)\s*[:#-]?\s*/i, "").replace(/^(us|usa)\s+/i, "").trim();
}

function letterFrom(text: string): string | null {
  const t = lower(text);
  if (LETTER[t]) return LETTER[t];
  // "XL/TG", "L/G", "S/P": the first part is the letter size. (Real combined
  // sizes like "S/M" are matched against eBay's list before this runs.)
  const first = t.split(/[\s/(]+/)[0];
  if (first && LETTER[first]) return LETTER[first];
  // "Small 36-38", "Medium (38-40)", "X-Large Tall"
  const words = t.replace(/\(.*?\)/g, " ").replace(/\d+(\.\d+)?\s*-?\s*\d+(\.\d+)?/g, " ").replace(/\s+/g, " ").trim();
  if (LETTER[words]) return LETTER[words];
  const multi = Object.entries(LETTER).filter(([k]) => k.includes(" ")).sort((a, b) => b[0].length - a[0].length);
  for (const [k, v] of multi) if (words === k || words.startsWith(`${k} `)) return v;
  const w0 = words.split(" ")[0];
  if (w0 && w0.length > 1 && LETTER[w0]) return LETTER[w0];
  return null;
}

export interface SizeMapping {
  /** eBay's exact listed value. */
  value: string;
  /** Why (shown to the seller / in the description): "Lacoste size 9 = 4XL". */
  note: string | null;
}

/**
 * Best eBay Size value for a tag size, or null when it can't be mapped with
 * confidence (then the field is left blank and flagged for the seller).
 * `allowed` is eBay's list for the category.
 */
export function mapTagSize(raw: string | null | undefined, allowed: string[], ctx: { brand?: string | null } = {}): SizeMapping | null {
  if (!raw || !raw.trim() || allowed.length === 0) return null;
  const v = stripNoise(raw);
  const brand = (ctx.brand ?? "").trim();

  // Brand numeric sizing first: Lacoste "9" is 4XL even if a list had "9".
  const bare = v.replace(/^(fr|t|eu)\s*/i, "").trim();
  if (/^\d{1,2}$/.test(bare)) {
    for (const b of BRAND_NUMERIC) {
      if (!b.brand.test(brand)) continue;
      const letter = b.sizes[String(Number(bare))];
      const hit = letter ? inList(letter, allowed) : null;
      if (hit) return { value: hit, note: `${b.label} size ${Number(bare)} = ${hit}` };
    }
  }

  // Already one of eBay's values (any casing).
  const exact = inList(v, allowed);
  if (exact) return { value: exact, note: null };

  // Letter sizes in any spelling ("XXL", "Large", "SMALL 36-38", "L/G").
  const letter = letterFrom(v);
  if (letter) {
    const hit = inList(letter, allowed);
    if (hit) return { value: hit, note: lower(v) === lower(hit) ? null : `Tag size ${v} = ${hit}` };
  }

  // Italian/EU/FR numeric sizes, only when the tag says so ("IT 50", "EU 48").
  const eu = v.match(/^(it|ita|eu|eur|fr)\s*(\d{2})$/i);
  if (eu && EU_TOPS[eu[2]]) {
    const hit = inList(EU_TOPS[eu[2]], allowed);
    if (hit) return { value: hit, note: `${eu[1].toUpperCase()} ${eu[2]} = ${hit}` };
  }

  // Collar size ("15.5", "15 1/2", "16-16.5") when the list has no neck sizes.
  const collar = v.match(/^(\d{2})(?:\.(\d)|\s+1\/2)?(?:\s*-\s*\d{2}(?:\.\d)?)?(?:\s*(?:in|"))?$/i);
  if (collar && (collar[2] || /1\/2/.test(v) || /-/.test(v))) {
    const n = Number(collar[1]) + (collar[2] ? Number(`0.${collar[2]}`) : /1\/2/.test(v) ? 0.5 : 0);
    if (n >= 13.5 && n < 20) {
      const l = collarToLetter(n);
      const hit = l ? inList(l, allowed) : null;
      if (hit) return { value: hit, note: `Collar ${n} = ${hit}` };
    }
  }
  return null;
}

/** mapTagSize, but only for a def that is a strict (enforced) Size list. */
export function mapSizeForDef(raw: string, def: Pick<AspectDef, "name" | "values" | "mode">, ctx: { brand?: string | null } = {}): SizeMapping | null {
  if (!isSizeAspect(def.name) || effectiveMode(def) !== "SELECTION_ONLY") return null;
  return mapTagSize(raw, def.values, ctx);
}
