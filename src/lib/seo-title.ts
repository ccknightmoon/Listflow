// SEO title from VALIDATED specifics (so it never contradicts them), in
// eBay buyer-search order:
//   Brand · Vintage/era (only if evidenced) · key descriptors (team/player/#,
//   character, model/line, single stitch, graphic) · Men's/Women's · item
//   type (buyer term) · notable features · Size · Color
// ≤ 80 chars, no ALL CAPS, no filler/repeats, nothing unverified.
import { fitTitle, TITLE_MAX, type Aspects } from "@/lib/item-specifics";

// Buyer search terms for common types.
const BUYER_TERMS: Array<[RegExp, (graphic: boolean) => string]> = [
  [/^t-?shirts?$|^tees?$/i, (g) => (g ? "Graphic Tee" : "T-Shirt")],
  [/^hoodies?$|hooded sweatshirt/i, () => "Hoodie"],
  [/^sweatshirts?$|crewneck sweatshirt/i, () => "Sweatshirt"],
  [/^jerseys?$/i, () => "Jersey"],
  [/^jeans?$/i, () => "Jeans"],
  [/^button-?(up|down)( shirt)?$/i, () => "Button-Up Shirt"],
  [/^polos?( shirt)?$/i, () => "Polo Shirt"],
];

const KEEP_UPPER = new Set(["NFL", "NBA", "MLB", "NHL", "MLS", "NCAA", "WNBA", "USA", "UK", "XS", "S", "M", "L", "XL", "XXL", "2XL", "3XL", "4XL", "5XL", "XLT", "LT", "OG", "NWT", "NWOT", "Y2K", "MLB", "UFC", "WWE", "WWF", "NASA", "UCLA", "USC", "LSU", "TCU", "BYU", "DC", "RN", "II", "III", "IV"]);

/** "CARHARTT DETROIT JACKET" → "Carhartt Detroit Jacket", keeping acronyms/sizes. */
export function deCaps(s: string): string {
  return s.split(/(\s+)/).map((w) => {
    const core = w.replace(/[^A-Za-z0-9]/g, "");
    if (!core || KEEP_UPPER.has(core.toUpperCase()) && core === core.toUpperCase()) return w;
    if (core.length > 3 && core === core.toUpperCase() && /[A-Z]/.test(core)) return w.charAt(0) + w.slice(1).toLowerCase();
    return w;
  }).join("");
}

const first = (a: Aspects, ...names: string[]) => names.map((n) => a[n]?.[0]).find((v) => !!v && v.trim()) ?? null;

export interface TitleEvidence {
  vintage?: boolean; // vintage evidenced (date code/tag)
  era?: string | null; // "90s", "Y2K" — evidenced only
  singleStitch?: boolean;
  graphic?: boolean;
}

export function seoTitle(a: Aspects, ev: TitleEvidence = {}): string {
  const brand = first(a, "Brand");
  const typeRaw = first(a, "Type", "Product", "Style") ?? "";
  const graphic = !!ev.graphic || /graphic/i.test(first(a, "Pattern", "Style") ?? "");
  const term = BUYER_TERMS.find(([re]) => re.test(typeRaw.trim()))?.[1](graphic) ?? typeRaw.replace(/^NFL |^NBA |Men's |Women's /gi, "");
  const dept = first(a, "Department");
  const deptWord = dept ? (/^wom/i.test(dept) ? "Women's" : /^men/i.test(dept) ? "Men's" : /^boy/i.test(dept) ? "Boys" : /^girl/i.test(dept) ? "Girls" : null) : null;
  const decade = first(a, "Decade");
  const era = ev.era ?? (decade ? decade.replace(/^19(\d0)s$/, "$1s") : null);
  const num = first(a, "Jersey Number", "Player Number");
  const descriptors = [
    first(a, "Team"),
    first(a, "Player", "Athlete") ? `${first(a, "Player", "Athlete")}${num ? ` #${num.replace(/^#/, "")}` : ""}` : null,
    first(a, "Character"),
    [first(a, "Product Line"), first(a, "Model")].filter(Boolean).join(" ") || null,
    ev.singleStitch ? "Single Stitch" : null,
  ].filter(Boolean) as string[];
  const features = [...(a["Features"] ?? []), ...(a["Theme"] ?? [])].filter((f) => !/^(pockets?|lined)$/i.test(f)).slice(0, 3);
  const size = first(a, "Size", "US Shoe Size");
  const color = first(a, "Color");

  const head = [brand && !/^unbranded$/i.test(brand) ? brand : null, ev.vintage ? "Vintage" : null, era].filter(Boolean) as string[];
  // If a descriptor already names the type ("Detroit Jacket"), don't repeat
  // it; the department then goes with the size ("Men's Size XL").
  const redundant = !!term && descriptors.some((d) => d.toLowerCase().includes(term.toLowerCase()));
  const tail = [redundant ? deptWord : null, size ? `Size ${size.replace(/^size\s*/i, "")}` : null, color].filter(Boolean) as string[];
  const core = (redundant ? [] : [deptWord, term]).filter(Boolean) as string[];
  const parts: string[] = [];
  const fits = (extra: string[]) => [...head, ...parts, ...extra, ...core, ...tail].join(" ").length <= TITLE_MAX;
  for (const d of descriptors) if (fits([d])) parts.push(d);
  const featureParts: string[] = [];
  for (const f of features) if ([...head, ...parts, ...core, ...featureParts, f, ...tail].join(" ").length <= TITLE_MAX) featureParts.push(f);
  return fitTitle(deCaps([...head, ...parts, ...core, ...featureParts, ...tail].join(" ")));
}

/** Does the title agree with the specifics? Returns problems (empty = good). */
export function titleIssues(title: string, a: Aspects): string[] {
  const t = title.toLowerCase();
  const out: string[] = [];
  if (!title.trim()) return ["Title is empty."];
  if (title.length > TITLE_MAX) out.push(`Title is over ${TITLE_MAX} characters.`);
  const brand = first(a, "Brand");
  if (brand && !/^unbranded$/i.test(brand) && !t.includes(brand.toLowerCase())) out.push(`Title doesn't mention the brand (${brand}).`);
  const size = first(a, "Size");
  if (size && !new RegExp(`(^|\\s|size\\s)${size.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(t)) out.push(`Title doesn't show the size (${size}).`);
  if (/\b([A-Z]{5,})\b/.test(title.replace(/\b(NFL|NBA|MLB|NHL|NCAA|WNBA|NASA|UCLA)\b/g, ""))) out.push("Title has ALL-CAPS words.");
  if (/\b(l@@k|wow|rare|must see)\b/i.test(title)) out.push("Title has filler/spam words.");
  return out;
}
