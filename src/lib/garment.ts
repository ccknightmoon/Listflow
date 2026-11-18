// What kind of item is this, and which eBay categories/aspects make sense
// for it? (Nov 2026: a Cowboys football jersey was put in a pants/joggers
// category because the category search was just "men's used Jersey" — the
// fabric meaning won — and nothing checked the result.) Pure, tested.

export type GarmentKind =
  | "sports-jersey" | "top" | "outerwear" | "bottom" | "dress" | "shoes" | "hat" | "bag" | "jewelry" | "accessory" | "unknown";

const W = (words: string) => new RegExp(`\\b(${words})\\b`, "i");
const RE = {
  jersey: W("jerseys?"),
  sportsHint: W("nfl|nba|mlb|nhl|mls|ncaa|football|basketball|baseball|hockey|soccer|team"),
  jerseyNumber: /#\s?\d{1,2}\b/,
  outerwear: W("jackets?|coats?|parkas?|puffers?|bombers?|windbreakers?|anoraks?|blazers?|vests?|gilets?|fleece jackets?|hoodies?|sweatshirts?|pullovers?|cardigans?|sweaters?|quarter zip|1/4 zip"),
  top: W("t-?shirts?|tees?|shirts?|tops?|blouses?|polos?|tank tops?|tanks?|henleys?|button[- ]?(ups?|downs?)|camisoles?|tunics?|crop tops?"),
  bottom: W("pants|jeans|shorts|trousers|joggers|sweatpants|leggings|chinos|cargos?|skirts?|overalls|capris|culottes"),
  dress: W("dress(es)?|gowns?|jumpsuits?|rompers?"),
  shoes: W("shoes?|sneakers?|boots?|sandals?|loafers?|heels|cleats|slippers?|clogs?"),
  hat: W("hats?|caps?|beanies?|snapbacks?|fitted cap|bucket hats?|visors?|fedoras?"),
  bag: W("bags?|handbags?|purses?|backpacks?|totes?|wallets?|clutch(es)?"),
  jewelry: W("necklaces?|pendants?|earrings?|rings?|bracelets?|bangles?|chokers?|brooch(es)?"),
  accessory: W("belts?|scarf|scarves|sunglasses|gloves|ties?|socks"),
};

/** Classify from the AI's item type first (most reliable), then the title. */
export function classifyGarment(itemType: string | null | undefined, title: string | null | undefined, hints: { team?: string | null; league?: string | null; player?: string | null } = {}): GarmentKind {
  const t = (itemType ?? "").trim();
  const all = `${t} ${title ?? ""}`;
  const sportsy = !!(hints.team || hints.league || hints.player) || RE.sportsHint.test(all) || RE.jerseyNumber.test(all);
  const check = (s: string): GarmentKind | null => {
    if (!s) return null;
    if (RE.jersey.test(s)) return sportsy ? "sports-jersey" : "top"; // a jersey is a top, never "jersey knit" pants
    if (RE.dress.test(s)) return "dress";
    if (RE.bottom.test(s)) return "bottom";
    if (RE.outerwear.test(s)) return "outerwear";
    if (RE.top.test(s)) return "top";
    if (RE.shoes.test(s)) return "shoes";
    if (RE.hat.test(s)) return "hat";
    if (RE.jewelry.test(s)) return "jewelry";
    if (RE.bag.test(s)) return "bag";
    if (RE.accessory.test(s)) return "accessory";
    return null;
  };
  return check(t) ?? check(title ?? "") ?? "unknown";
}

const isTopLike = (k: GarmentKind) => k === "top" || k === "sports-jersey" || k === "outerwear";

/** Does an eBay category path fit this kind of item? (Tops never in pants, and vice versa.) */
export function categoryFits(kind: GarmentKind, path: string): { ok: boolean; reason?: string } {
  // Judge by everything below the top-level vertical: eBay's root
  // "Clothing, Shoes & Accessories" would otherwise look like "shoes".
  const segs = path.split(">").map((x) => x.trim()).filter(Boolean);
  const p = ` ${(segs.length > 1 ? segs.slice(1) : segs).join(" > ").toLowerCase()} `;
  const has = (re: RegExp) => re.test(p);
  const bottoms = /\b(pants|jeans|shorts|trousers|leggings|joggers|sweatpants|skirts?|bottoms|overalls)\b/;
  const tops = /\b(shirts?|tops|t-shirts|tees|blouses|polos|jerseys|sweaters|sweatshirts|hoodies|coats|jackets|vests)\b/;
  if (isTopLike(kind) && has(bottoms)) return { ok: false, reason: "a top in a pants/shorts category" };
  if (kind === "bottom" && has(tops) && !has(bottoms)) return { ok: false, reason: "pants/shorts in a tops category" };
  if (kind === "hat" && !has(/\b(hats?|caps?|headwear|beanies?)\b/)) return { ok: false, reason: "a hat outside a hats category" };
  if (kind === "shoes" && !has(/\b(shoes|sneakers|boots|sandals|footwear|cleats)\b/)) return { ok: false, reason: "shoes outside a shoes category" };
  if (isTopLike(kind) && has(/\b(shoes|footwear|hats|caps|jewelry|handbags)\b/)) return { ok: false, reason: "clothing in an accessories category" };
  if (kind === "bottom" && has(/\b(shoes|footwear|hats|caps|jewelry)\b/)) return { ok: false, reason: "clothing in an accessories category" };
  if (kind === "sports-jersey" && !has(/\b(jerseys?|fan apparel|shirts?|tops|activewear)\b/)) return { ok: false, reason: "a jersey outside a jerseys/fan apparel/tops category" };
  return { ok: true };
}

/** eBay category-suggestion queries to try, most precise first. */
export function categoryQueries(f: { kind: GarmentKind; itemType?: string | null; brand?: string | null; department?: string | null; team?: string | null; league?: string | null; player?: string | null; title?: string | null }): string[] {
  const clean = (s: string | null | undefined) => (s ?? "").replace(/[^\w\s&'-]/g, " ").replace(/\s+/g, " ").trim();
  const dept = /^wom/i.test(f.department ?? "") ? "women's" : /^men/i.test(f.department ?? "") ? "men's" : "";
  const type = clean(f.itemType) || (f.kind === "sports-jersey" ? "jersey" : "");
  const out: string[] = [];
  if (f.kind === "sports-jersey") {
    out.push(clean(`${f.brand ?? ""} ${f.team ?? ""} ${f.player ?? ""} jersey`));
    if (f.league || f.team) out.push(clean(`${f.league ?? ""} ${f.team ?? ""} football jersey`.replace(/football (?=.*\b(nba|mlb|nhl|basketball|baseball|hockey)\b)/i, "")));
    out.push("NFL football jersey");
  } else {
    if (type) out.push(clean(`${f.brand ?? ""} ${dept} ${type}`));
    if (type) out.push(clean(`${dept} ${type}`));
  }
  if (f.title) out.push(clean(f.title).split(" ").slice(0, 10).join(" "));
  return [...new Set(out.filter((q) => q.length >= 3))];
}

// --------------------------------------------------- aspects per kind --

const BOTTOM_ONLY = new Set(["inseam", "rise", "waist size", "leg style", "bottoms size (men's)", "bottoms size (women's)", "fabric wash", "front type", "leg opening"]);
const TOP_ONLY = new Set(["sleeve length", "neckline", "chest size", "collar style", "sleeve type", "jersey number"]);
const CLOTHING_FIT = new Set([...BOTTOM_ONLY, ...TOP_ONLY, "fit", "size type"]);

/** Should this aspect exist on this kind of item at all? */
export function aspectFitsKind(aspect: string, kind: GarmentKind): boolean {
  const a = aspect.toLowerCase();
  if (isTopLike(kind)) return !BOTTOM_ONLY.has(a);
  if (kind === "bottom") return !TOP_ONLY.has(a);
  if (kind === "hat" || kind === "bag" || kind === "jewelry" || kind === "accessory" || kind === "shoes") return !CLOTHING_FIT.has(a);
  return true;
}

const BOTTOM_WORDS = /\b(pants|jeans|shorts|trousers|joggers|sweatpants|leggings|chinos|cargo|skirts?|capris|overalls)\b/i;
const TOP_WORDS = /\b(t-?shirt|tee|shirt|top|blouse|polo|jersey|hoodie|sweatshirt|sweater|jacket|coat|vest|tank)\b/i;

/** A Type/Style value that contradicts the item (e.g. Type "Joggers" on a jersey). */
export function valueContradictsKind(aspect: string, value: string, kind: GarmentKind): boolean {
  const a = aspect.toLowerCase();
  if (!["type", "style", "product type", "garment type"].includes(a)) return false;
  if (isTopLike(kind)) return BOTTOM_WORDS.test(value);
  if (kind === "bottom") return TOP_WORDS.test(value) && !BOTTOM_WORDS.test(value);
  return false;
}

/** Measurement keys that make sense for this kind. */
export function measurementKeysFor(kind: GarmentKind): Set<string> {
  if (isTopLike(kind) || kind === "dress") return new Set(["pitToPit", "length", "sleeve", "shoulder"]);
  if (kind === "bottom") return new Set(["waist", "inseam", "rise", "legOpening", "hip", "length"]);
  return new Set();
}

// Fabric constructions that aren't materials ("Jersey" is a knit, not a fiber).
const CONSTRUCTIONS = /^(jersey|jersey knit|knit|mesh|twill|french terry|terry|pique|rib|ribbed|interlock)$/i;
export function isFabricConstruction(v: string): boolean {
  return CONSTRUCTIONS.test(v.trim());
}

// ------------------------------------------------- sanitize + self-check --

export type AspectMap = Record<string, string[]>;

const lc = (s: string) => s.toLowerCase();
const get = (a: AspectMap, name: string) => Object.entries(a).find(([k]) => lc(k) === lc(name))?.[1] ?? [];

/**
 * Remove aspects/values that can't be right for this item:
 * cross-garment aspects, contradicting Type/Style, player names as
 * "Character", fabric constructions as "Material", and vintage/decade
 * without evidence. Returns what was removed so it can be reported.
 */
// Feature values that belong to other garments: dropped unless the photos
// showed them (analyze time passes the photo-read features as evidence).
const FEATURE_CONFLICTS: Partial<Record<GarmentKind, RegExp>> = {
  "sports-jersey": /^(pockets?|zip(per)? pockets?|cargo pockets?|side pockets?|belt loops?|drawstring|elastic waist(band)?|hood(ed)?|zip(per)?|full zip|lined|insulated)$/i,
  top: /^(cargo pockets?|belt loops?|elastic waist(band)?|drawstring waist)$/i,
  bottom: /^(hood(ed)?|collar(ed)?|chest pocket)$/i,
  hat: /^(pockets?|belt loops?|hood(ed)?)$/i,
};

export function sanitizeForItem(aspects: AspectMap, kind: GarmentKind, opts: { vintageEvidence?: boolean; photoFeatures?: string[] } = {}): { aspects: AspectMap; removed: Array<{ name: string; value: string; why: string }> } {
  const out: AspectMap = {};
  const removed: Array<{ name: string; value: string; why: string }> = [];
  const people = [...get(aspects, "Player"), ...get(aspects, "Team"), ...get(aspects, "League"), ...get(aspects, "Athlete")]
    .flatMap((v) => v.toLowerCase().split(/[\s,#]+/)).filter((w) => w.length > 2);
  const sports = kind === "sports-jersey" || people.length > 0;
  for (const [name, values] of Object.entries(aspects)) {
    const n = lc(name);
    if (!aspectFitsKind(name, kind)) { values.forEach((v) => removed.push({ name, value: v, why: "doesn't apply to this kind of item" })); continue; }
    const keep: string[] = [];
    for (const v of values) {
      if (valueContradictsKind(name, v, kind)) { removed.push({ name, value: v, why: "contradicts the item type" }); continue; }
      if ((n === "character" || n === "character family") && sports && (people.some((w) => lc(v).includes(w)) || kind === "sports-jersey")) {
        removed.push({ name, value: v, why: "players/teams go in Player/Team, not Character" }); continue;
      }
      if (n === "material" && isFabricConstruction(v)) {
        removed.push({ name, value: v, why: "a knit/weave, not a fiber — moved to Fabric Type" });
        if (!get(aspects, "Fabric Type").length && !get(out, "Fabric Type").length) out["Fabric Type"] = [v];
        continue;
      }
      if ((n === "features" || n === "accents") && opts.photoFeatures && FEATURE_CONFLICTS[kind]?.test(v.trim())
        && !opts.photoFeatures.some((f) => lc(f) === lc(v))) {
        removed.push({ name, value: v, why: "doesn't fit this kind of item and wasn't seen in the photos" }); continue;
      }
      if ((n === "vintage" && lc(v) === "no")) { removed.push({ name, value: v, why: "not verified" }); continue; }
      if ((n === "vintage" || n === "decade" || n === "year manufactured") && !opts.vintageEvidence) { removed.push({ name, value: v, why: "no evidence in the photos" }); continue; }
      keep.push(v);
    }
    if (keep.length) out[name] = keep;
  }
  return { aspects: out, removed };
}

/** Rule-based consistency check: title vs category vs Type vs measurements. */
export function consistencyIssues(f: { title?: string | null; kind: GarmentKind; categoryPath?: string | null; aspects: AspectMap; measurementKeys?: string[] }): string[] {
  const issues: string[] = [];
  if (f.categoryPath) {
    const fit = categoryFits(f.kind, f.categoryPath);
    if (!fit.ok) issues.push(`Category looks wrong: ${fit.reason} (${f.categoryPath}). Change the category.`);
  }
  const titleKind = classifyGarment(null, f.title ?? "");
  if (titleKind !== "unknown" && f.kind !== "unknown" && (isTopLike(titleKind) !== isTopLike(f.kind) || (titleKind === "bottom") !== (f.kind === "bottom"))) {
    issues.push("The title and the item type disagree (top vs bottom) — check both.");
  }
  for (const t of [...get(f.aspects, "Type"), ...get(f.aspects, "Style")]) {
    if (valueContradictsKind("Type", t, f.kind)) issues.push(`Type/Style "${t}" doesn't match this item.`);
  }
  const allowed = measurementKeysFor(f.kind);
  for (const k of f.measurementKeys ?? []) {
    if (allowed.size && !allowed.has(k)) issues.push(`Measurement "${k}" doesn't apply to this kind of item.`);
  }
  for (const name of Object.keys(f.aspects)) {
    if (!aspectFitsKind(name, f.kind)) issues.push(`"${name}" doesn't apply to this kind of item.`);
  }
  return [...new Set(issues)];
}

/**
 * Drop "extra" aspects (not in the category's list) whose values just repeat
 * a real aspect — e.g. a leftover Type "Jersey" next to the category's own
 * Product "Jersey". Category aspects are always kept.
 */
export function dedupeAspects(aspects: AspectMap, categoryAspectNames: string[]): AspectMap {
  const known = new Set(categoryAspectNames.map(lc));
  if (known.size === 0) return aspects;
  const knownValues = new Set(Object.entries(aspects).filter(([k]) => known.has(lc(k))).flatMap(([, v]) => v.map(lc)));
  const out: AspectMap = {};
  for (const [k, v] of Object.entries(aspects)) {
    if (!known.has(lc(k)) && v.length && v.every((x) => knownValues.has(lc(x)))) continue;
    out[k] = v;
  }
  return out;
}

// Aspects only the photos can tell (the text-only fill step must not invent them).
export const PHOTO_ONLY_ASPECTS = new Set(["features", "accents", "closure", "pattern", "color", "neckline", "sleeve length", "fabric type", "collar style", "lining material", "jersey number", "signed"]);
