// Listing quality (Nov 2026): eBay item specifics, measurements, condition,
// title and description, built like a pro reseller's listing.
//
// Everything here is pure (no network) so it is unit-tested and shared by
// the analyze routes, the review screens and publishing.

// ------------------------------------------------------------- aspects --

export interface AspectDef {
  name: string; // eBay's localizedAspectName, original casing
  required: boolean;
  /** eBay's "RECOMMENDED" usage (shown in Seller Hub as recommended). */
  recommended: boolean;
  mode: "FREE_TEXT" | "SELECTION_ONLY";
  multi: boolean;
  values: string[]; // allowed / suggested values
}

/** eBay Taxonomy getItemAspectsForCategory → AspectDef[] (required first, then recommended, then the rest, eBay order kept). */
export function parseAspectDefs(raw: unknown): AspectDef[] {
  const list = (raw as { aspects?: unknown[] })?.aspects;
  if (!Array.isArray(list)) return [];
  const defs: AspectDef[] = [];
  for (const a of list as Array<Record<string, unknown>>) {
    const name = typeof a.localizedAspectName === "string" ? a.localizedAspectName : "";
    if (!name) continue;
    const c = (a.aspectConstraint ?? {}) as Record<string, unknown>;
    const usage = String(c.aspectUsage ?? "").toUpperCase();
    defs.push({
      name,
      required: c.aspectRequired === true || usage === "REQUIRED",
      recommended: usage === "RECOMMENDED",
      mode: c.aspectMode === "SELECTION_ONLY" ? "SELECTION_ONLY" : "FREE_TEXT",
      multi: c.itemToAspectCardinality === "MULTI",
      values: Array.isArray(a.aspectValues)
        ? (a.aspectValues as Array<{ localizedValue?: unknown }>).map((v) => String(v.localizedValue ?? "")).filter(Boolean)
        : [],
    });
  }
  const rank = (d: AspectDef) => (d.required ? 0 : d.recommended ? 1 : 2);
  return defs.map((d, i) => ({ d, i })).sort((x, y) => rank(x.d) - rank(y.d) || x.i - y.i).map((x) => x.d);
}

const norm = (s: string) =>
  s.toLowerCase().replace(/&/g, " and ").replace(/['’`.]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

// A few words sellers/AI use that eBay spells differently.
const SYNONYMS: Record<string, string[]> = {
  grey: ["gray"], gray: ["grey"],
  tshirt: ["t shirt", "tee"], tee: ["t shirt"],
  "crew neck": ["crewneck"], crewneck: ["crew neck"],
  "short sleeve": ["short sleeves"], "long sleeve": ["long sleeves"],
  "full zip": ["zip"], "zip up": ["zip"],
  mens: ["men"], womens: ["women"], "men s": ["men"], "women s": ["women"],
};

/**
 * Best eBay value for `value`. SELECTION_ONLY aspects only accept a listed
 * value (null if none fits — never a guess); FREE_TEXT keeps the seller's
 * text but snaps to a listed value when it's the same thing.
 */
export function matchAllowedValue(value: string, def: Pick<AspectDef, "mode" | "values">): string | null {
  const v = value.trim();
  if (!v) return null;
  const n = norm(v);
  if (!def.values.length) return def.mode === "SELECTION_ONLY" ? null : v.slice(0, 65);
  const byNorm = new Map(def.values.map((a) => [norm(a), a]));
  if (byNorm.has(n)) return byNorm.get(n)!;
  for (const alt of SYNONYMS[n] ?? []) if (byNorm.has(alt)) return byNorm.get(alt)!;
  const compact = n.replace(/ /g, "");
  for (const [k, a] of byNorm) if (k.replace(/ /g, "") === compact) return a;
  // Whole-word containment either way ("Heavyweight Cotton" → "Cotton"),
  // preferring the longest allowed value so "Light Blue" beats "Blue".
  const words = ` ${n} `;
  const hits = [...byNorm.entries()].filter(([k]) => k.length >= 3 && (words.includes(` ${k} `) || ` ${k} `.includes(words)));
  if (hits.length) return hits.sort((a, b) => b[0].length - a[0].length)[0][1];
  return def.mode === "SELECTION_ONLY" ? null : v.slice(0, 65);
}

export type Aspects = Record<string, string[]>;

function cleanValues(values: unknown): string[] {
  const arr = Array.isArray(values) ? values : typeof values === "string" ? values.split(/\s*[,;]\s*/) : [];
  const out: string[] = [];
  for (const x of arr) {
    const s = typeof x === "string" ? x.trim() : "";
    if (!s || /^(null|none|n\/?a|unknown|not visible|unbranded\?)$/i.test(s)) continue;
    if (!out.some((o) => o.toLowerCase() === s.toLowerCase())) out.push(s);
  }
  return out;
}

/**
 * Combine several aspect sources (later sources win per aspect: e.g. the
 * fixed draft fields, then the AI's category fill, then the seller's edits),
 * snap every value to eBay's allowed values for the category, and report
 * required aspects that are still empty.
 */
export function mergeAspects(sources: Aspects[], defs: AspectDef[]): { aspects: Aspects; missingRequired: string[]; dropped: Array<{ name: string; value: string }> } {
  const byLower = new Map(defs.map((d) => [d.name.toLowerCase(), d]));
  const merged = new Map<string, { name: string; values: string[] }>();
  for (const src of sources) {
    for (const [rawName, rawValues] of Object.entries(src ?? {})) {
      const values = cleanValues(rawValues);
      const key = rawName.trim().toLowerCase();
      if (!key) continue;
      if (values.length === 0) { if (merged.has(key) && Array.isArray(rawValues) && rawValues.length === 0) merged.delete(key); continue; }
      const def = byLower.get(key);
      merged.set(key, { name: def?.name ?? rawName.trim(), values });
    }
  }
  const aspects: Aspects = {};
  const dropped: Array<{ name: string; value: string }> = [];
  for (const [key, { name, values }] of merged) {
    const def = byLower.get(key);
    if (!def) { aspects[name] = values.map((v) => v.slice(0, 65)); continue; }
    const out: string[] = [];
    for (const v of values) {
      const m = matchAllowedValue(v, def);
      if (m) { if (!out.includes(m)) out.push(m); } else dropped.push({ name, value: v });
    }
    const final = def.multi ? out.slice(0, 30) : out.slice(0, 1);
    if (final.length) aspects[def.name] = final;
  }
  return { aspects, missingRequired: missingRequiredAspects(aspects, defs), dropped };
}

export function missingRequiredAspects(aspects: Aspects, defs: AspectDef[]): string[] {
  const have = new Set(Object.entries(aspects).filter(([, v]) => v?.length).map(([k]) => k.toLowerCase()));
  return defs.filter((d) => d.required && !have.has(d.name.toLowerCase())).map((d) => d.name);
}

// ------------------------------------------------- draft fields → aspects --

export interface DraftFacts {
  title?: string | null;
  brand?: string | null;
  color?: string | null;
  size?: string | null;
  department?: string | null;
  item_type?: string | null;
  style?: string | null;
  material?: string | null;
  theme?: string | null;
  sleeve_length?: string | null;
  neckline?: string | null;
  fit?: string | null;
  pattern?: string | null;
  vintage?: string | null;
  character?: string | null;
  character_family?: string | null;
  year_manufactured?: string | null;
  season?: string | null;
}

const ok = (v: string | null | undefined): v is string => typeof v === "string" && v.trim() !== "" && v.trim().toLowerCase() !== "null" && v.trim().toLowerCase() !== "unknown";

/** eBay "Size Type" from the tag notation / title (Plus, Petite, Big & Tall…). */
export function detectSizeType(size: string | null | undefined, title: string | null | undefined): string {
  const s = (size || "").trim().toUpperCase();
  const t = (title || "").toLowerCase();
  if (/\bplus[\s-]?size\b/.test(t) || /^[1-5]X$/.test(s) || /\d+W$/.test(s)) return "Plus";
  if (/\bpetite\b/.test(t) || /\dP$/.test(s) || /^[SMLX]+P$/.test(s)) return "Petite";
  if (/\bbig\s*&?\s*tall\b/.test(t) || /^\d*XLT$/.test(s)) return "Big & Tall";
  if (/\bjuniors?\b/.test(t)) return "Juniors";
  if (/\btall\b/.test(t)) return "Tall";
  return "Regular";
}

/** The fixed draft columns as eBay aspect names (the base layer). */
export function aspectsFromDraft(d: DraftFacts): Aspects {
  const a: Aspects = {};
  const title = d.title ?? "";
  const lower = title.toLowerCase();
  const dept = ok(d.department) ? d.department : /\b(women'?s?|ladies)\b/.test(lower) ? "Women" : /\b(men'?s?)\b/.test(lower) ? "Men" : /\bunisex\b/.test(lower) ? "Unisex Adult" : null;
  if (dept) a["Department"] = [dept];
  if (ok(d.brand)) a["Brand"] = [d.brand];
  if (ok(d.color)) a["Color"] = d.color.split(/\s*[,/]\s*/).filter(Boolean);
  if (ok(d.size)) {
    a["Size"] = [d.size];
    a["Size Type"] = [detectSizeType(d.size, title)];
    const pants = d.size.match(/^(\d{2})\s*[xX]\s*(\d{2})$/);
    if (pants) { a["Waist Size"] = [`${pants[1]} in`]; a["Inseam"] = [`${pants[2]} in`]; }
    if (/\b(shoes?|boots?|sneakers?|sandals?|loafers?|heels?)\b/.test(lower)) a["US Shoe Size"] = [d.size];
  }
  if (ok(d.item_type)) a["Type"] = [d.item_type];
  if (ok(d.style)) a["Style"] = [d.style];
  if (ok(d.material)) a["Material"] = d.material.split(/\s*[,/]\s*/).filter(Boolean);
  if (ok(d.theme)) a["Theme"] = d.theme.split(",").map((t) => t.trim()).filter(Boolean);
  if (ok(d.sleeve_length)) a["Sleeve Length"] = [d.sleeve_length];
  if (ok(d.neckline)) a["Neckline"] = [d.neckline];
  if (ok(d.fit)) a["Fit"] = [d.fit];
  if (ok(d.pattern)) a["Pattern"] = [d.pattern];
  if (ok(d.vintage)) a["Vintage"] = [/^y/i.test(d.vintage) ? "Yes" : "No"];
  if (ok(d.character)) a["Character"] = [d.character];
  if (ok(d.character_family)) a["Character Family"] = [d.character_family];
  if (ok(d.year_manufactured)) { a["Year Manufactured"] = [d.year_manufactured]; a["Decade"] = [decadeFromRange(d.year_manufactured)].filter(Boolean) as string[]; }
  if (ok(d.season)) a["Season"] = [d.season];
  for (const k of Object.keys(a)) if (!a[k].length) delete a[k];
  return a;
}

function decadeFromRange(r: string): string | null {
  const m = r.match(/(19|20)(\d)\d/);
  return m ? `${m[1]}${m[2]}0s` : /pre-?1960/i.test(r) ? null : null;
}

// --------------------------------------------------------- measurements --

export interface Measurement {
  key: "pitToPit" | "length" | "sleeve" | "shoulder" | "waist" | "inseam" | "rise" | "legOpening" | "hip";
  inches: number;
  approx: boolean;
}

const MEASUREMENT_LABELS: Record<Measurement["key"], string> = {
  pitToPit: "Pit to pit",
  length: "Length",
  sleeve: "Sleeve",
  shoulder: "Shoulder to shoulder",
  waist: "Waist",
  inseam: "Inseam",
  rise: "Rise",
  legOpening: "Leg opening",
  hip: "Hip",
};
export const MEASUREMENT_ORDER = Object.keys(MEASUREMENT_LABELS) as Measurement["key"][];

/** "22 inches", "~22.5\"", "approx 22 1/2 in" → { inches, approx }. Null if no plausible number. */
export function parseMeasurement(raw: unknown): { inches: number; approx: boolean } | null {
  if (typeof raw === "number") return raw > 0 && raw < 100 ? { inches: raw, approx: false } : null;
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  const approx = /approx|about|around|~|\?|unclear|est/.test(s);
  const cm = /\bcm\b/.test(s);
  const m = s.match(/(\d+(?:\.\d+)?)(?:\s+(\d)\/(\d))?/);
  if (!m) return null;
  let n = parseFloat(m[1]);
  if (m[2] && m[3] && Number(m[3]) > 0) n += Number(m[2]) / Number(m[3]);
  if (cm) n = n / 2.54;
  n = Math.round(n * 4) / 4; // nearest quarter inch
  if (!(n > 0 && n < 100)) return null;
  return { inches: n, approx };
}

export function measurementsFrom(raw: Partial<Record<Measurement["key"], unknown>> | null | undefined): Measurement[] {
  if (!raw) return [];
  const out: Measurement[] = [];
  for (const key of MEASUREMENT_ORDER) {
    const p = parseMeasurement(raw[key]);
    if (p) out.push({ key, ...p });
  }
  return out;
}

const fmtIn = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2).replace(/0$/, "")}"`;

/** "Pit to pit: 22" (approx.)" lines, in a fixed order. */
export function measurementLines(ms: Measurement[]): string[] {
  return MEASUREMENT_ORDER.flatMap((k) => ms.filter((m) => m.key === k)).map((m) => `${MEASUREMENT_LABELS[m.key]}: ${fmtIn(m.inches)}${m.approx ? " (approx.)" : ""}`);
}

/** Measured waist/inseam/rise as aspects, only when the category has them and nothing better is set. */
export function measurementAspects(ms: Measurement[], defs: AspectDef[]): Aspects {
  const names = new Set(defs.map((d) => d.name.toLowerCase()));
  const a: Aspects = {};
  const get = (k: Measurement["key"]) => ms.find((m) => m.key === k);
  const w = get("waist"), i = get("inseam"), r = get("rise");
  if (w && names.has("waist size")) a["Waist Size"] = [`${Math.round(w.inches)} in`];
  if (i && names.has("inseam")) a["Inseam"] = [`${Math.round(i.inches)} in`];
  if (r && names.has("rise")) a["Rise"] = [`${Math.round(r.inches * 2) / 2} in`];
  return a;
}

// ------------------------------------------------------------ condition --

export type ConditionLabel = "New with tags" | "New without tags" | "Excellent used" | "Good - minor flaws" | "Fair - notable flaws";

// Preferred eBay condition enums per Listflow label, best first. Apparel
// categories use the 2025 pre-owned values; others the classic USED_*.
const CONDITION_PREFS: Record<ConditionLabel, string[]> = {
  "New with tags": ["NEW"],
  "New without tags": ["NEW_OTHER", "NEW_WITH_DEFECTS"],
  "Excellent used": ["PRE_OWNED_EXCELLENT", "USED_EXCELLENT", "USED_VERY_GOOD", "USED_GOOD"],
  "Good - minor flaws": ["USED_EXCELLENT", "USED_GOOD", "USED_VERY_GOOD"],
  "Fair - notable flaws": ["PRE_OWNED_FAIR", "USED_ACCEPTABLE", "USED_GOOD"],
};

/**
 * eBay condition enum for this label, chosen from what the CATEGORY accepts
 * (eBay Metadata condition policy). Never upgrades a condition: if nothing
 * matching is allowed, returns null so the caller falls back.
 */
export function pickCondition(label: string | null | undefined, allowed: string[] | null): string | null {
  const prefs = CONDITION_PREFS[(label ?? "") as ConditionLabel];
  if (!prefs) return null;
  if (!allowed || allowed.length === 0) return null;
  const set = new Set(allowed.map((a) => a.toUpperCase()));
  return prefs.find((p) => set.has(p)) ?? null;
}

/** eBay condition-policy IDs → Inventory API enums (Metadata API returns numeric IDs). */
export const CONDITION_ID_TO_ENUM: Record<string, string> = {
  "1000": "NEW", "1500": "NEW_OTHER", "1750": "NEW_WITH_DEFECTS",
  "2750": "LIKE_NEW", "2990": "PRE_OWNED_EXCELLENT", "3000": "USED_EXCELLENT", "3010": "PRE_OWNED_FAIR",
  "4000": "USED_VERY_GOOD", "5000": "USED_GOOD", "6000": "USED_ACCEPTABLE", "7000": "FOR_PARTS_OR_NOT_WORKING",
};

/** Honest buyer-facing condition note: tier + every visible flaw, no fluff. */
export function conditionNote(label: string | null | undefined, flaws: string | null | undefined): string {
  const f = (flaws ?? "").trim().replace(/\s+/g, " ");
  const base: Record<string, string> = {
    "New with tags": "New with tags attached.",
    "New without tags": "New without tags, unworn.",
    "Excellent used": "Pre-owned in excellent condition.",
    "Good - minor flaws": "Pre-owned in good condition with minor wear.",
    "Fair - notable flaws": "Pre-owned in fair condition with noticeable wear.",
  };
  const head = base[label ?? ""] ?? "Pre-owned.";
  if (!f) return /^New/.test(label ?? "") ? head : `${head} No major flaws seen — please see all photos.`;
  return `${head} Flaws: ${f.replace(/\.?$/, ".")} Please see all photos.`;
}

// ---------------------------------------------------------------- title --

export const TITLE_MAX = 80;
// Spammy / against eBay policy or misleading without proof.
const BANNED = /\b(l@@k|look!+|wow!*|must see|rare!*|htf|nwot\?|authentic\??|100% authentic|not fake|free shipping|fast ship(ping)?)\b/gi;

/** Clean a title: no spam words, single spaces, no duplicate words, ≤ 80 chars cut at a word boundary. */
export function fitTitle(raw: string | null | undefined): string {
  let t = (raw ?? "").replace(BANNED, " ").replace(/[|*~^]+/g, " ").replace(/\s+/g, " ").trim();
  const seen = new Set<string>();
  t = t.split(" ").filter((w) => {
    const k = w.toLowerCase().replace(/[^a-z0-9#&/'-]/g, "");
    if (!k) return false;
    if (k.length > 2 && seen.has(k)) return false;
    seen.add(k);
    return true;
  }).join(" ");
  if (t.length <= TITLE_MAX) return t;
  const cut = t.slice(0, TITLE_MAX + 1);
  const at = cut.lastIndexOf(" ");
  return (at > 40 ? cut.slice(0, at) : t.slice(0, TITLE_MAX)).replace(/[\s,\-/&]+$/, "");
}

export interface TitleParts {
  brand?: string | null;
  vintage?: boolean;
  era?: string | null; // "90s", "Y2K"
  department?: string | null; // Men's / Women's
  itemType?: string | null;
  details?: string[]; // team, player, character, style, material, features
  size?: string | null;
  color?: string | null;
}

/**
 * Title in eBay search order: Brand + Vintage/Era + Item type + key details
 * + Size + Color, filled up to 80 chars; lowest-priority details drop first.
 */
export function composeTitle(p: TitleParts): string {
  const head = [
    ok(p.brand) && !/^unbranded$/i.test(p.brand!) ? p.brand : null,
    p.vintage ? "Vintage" : null,
    ok(p.era) ? p.era : null,
  ].filter(Boolean) as string[];
  const dept = ok(p.department) ? (/^wom/i.test(p.department!) ? "Women's" : /^men/i.test(p.department!) ? "Men's" : /unisex/i.test(p.department!) ? "Unisex" : null) : null;
  const type = ok(p.itemType) ? p.itemType! : "";
  const tail = [ok(p.size) ? `Size ${p.size!.replace(/^size\s*/i, "")}` : null, ok(p.color) ? p.color : null].filter(Boolean) as string[];
  const details = (p.details ?? []).filter(ok);
  // Add details while they fit (head + type + details + tail ≤ 80).
  const pick: string[] = [];
  for (const d of details) {
    if ([...head, dept, type, ...pick, d, ...tail].filter(Boolean).join(" ").length <= TITLE_MAX) pick.push(d);
  }
  return fitTitle([...head, dept, type, ...pick, ...tail].filter(Boolean).join(" "));
}

// ---------------------------------------------------------- description --

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface DescriptionInput {
  title: string;
  summary?: string | null; // 1–3 sentence AI blurb (no keyword lists)
  details: Array<[string, string | null | undefined]>; // e.g. ["Brand","Carhartt"]
  measurements: Measurement[];
  conditionLabel?: string | null;
  flaws?: string | null;
  notes?: string | null; // seller's shipping/returns notes (Settings)
  sku?: string | null;
}

/**
 * Clean, mobile-friendly HTML (eBay strips scripts/CSS files; inline styles
 * and simple tags are fine). Consistent sections, no keyword stuffing.
 */
export function buildDescriptionHtml(d: DescriptionInput): string {
  const p = (s: string) => `<p style="margin:0 0 10px">${s}</p>`;
  const h = (s: string) => `<h3 style="font-size:16px;margin:16px 0 6px">${esc(s)}</h3>`;
  const ul = (items: string[]) => (items.length ? `<ul style="margin:0 0 10px;padding-left:18px">${items.map((i) => `<li>${i}</li>`).join("")}</ul>` : "");
  const details = d.details.filter(([, v]) => ok(v ?? null)).map(([k, v]) => `<b>${esc(k)}:</b> ${esc(String(v))}`);
  const meas = measurementLines(d.measurements).map(esc);
  const parts = [
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;max-width:700px">`,
    `<h2 style="font-size:18px;margin:0 0 10px">${esc(fitTitle(d.title))}</h2>`,
    ok(d.summary ?? null) ? p(esc(d.summary!.trim())) : "",
    details.length ? h("Details") + ul(details) : "",
    meas.length ? h("Measurements (taken flat)") + ul(meas) : "",
    h("Condition") + p(esc(conditionNote(d.conditionLabel, d.flaws))),
    ok(d.notes ?? null) ? h("Shipping & returns") + p(esc(d.notes!.trim()).replace(/\n+/g, "<br>")) : "",
    ok(d.sku ?? null) ? `<p style="margin:12px 0 0;color:#888;font-size:12px">SKU ${esc(d.sku!)}</p>` : "",
    `</div>`,
  ];
  return parts.filter(Boolean).join("");
}

/** True if a saved description is already our HTML template (don't wrap it twice). */
export function isTemplateHtml(s: string | null | undefined): boolean {
  return !!s && /^<div style="font-family:Arial/.test(s.trim());
}

/** The seller-facing summary text out of an older plain description (drops our old "Measurements: …" line). */
export function plainSummary(desc: string | null | undefined): string {
  if (!desc || isTemplateHtml(desc)) return "";
  return desc.split(/\n+/).filter((l) => !/^Measurements:/i.test(l.trim())).join(" ").trim();
}

// ------------------------------------------------------ AI fill prompt --

/** Aspects worth asking the AI about (skip ones already filled), with allowed values when the list is short. */
export function aspectsToAsk(defs: AspectDef[], already: Aspects, maxAspects = 45): Array<{ name: string; required: boolean; multi: boolean; allowed?: string[] }> {
  const have = new Set(Object.keys(already).map((k) => k.toLowerCase()));
  return defs
    .filter((d) => (d.required || d.recommended) && !have.has(d.name.toLowerCase()))
    .slice(0, maxAspects)
    .map((d) => ({
      name: d.name,
      required: d.required,
      multi: d.multi,
      ...(d.values.length > 0 && d.values.length <= 60 ? { allowed: d.values } : {}),
    }));
}

/** Parse the AI's {"aspects":[{"name","values"}]} answer into Aspects (unknown/blank dropped). */
export function parseAiAspects(raw: unknown): Aspects {
  const list = (raw as { aspects?: unknown })?.aspects;
  const out: Aspects = {};
  if (!Array.isArray(list)) return out;
  for (const item of list as Array<{ name?: unknown; values?: unknown }>) {
    if (typeof item?.name !== "string") continue;
    const vals = cleanValues(item.values);
    if (vals.length) out[item.name] = vals;
  }
  return out;
}

// ------------------------------------------------------------- storage --

export interface StoredSpecificsShape {
  categoryId: string | null;
  aspects: Aspects;
  measurements: Measurement[];
}

/** Validate drafts.item_specifics input from the browser (bounded, typed). Null if unusable. */
export function sanitizeStoredSpecifics(raw: unknown): StoredSpecificsShape | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const categoryId = typeof r.categoryId === "string" && /^\d{1,12}$/.test(r.categoryId) ? r.categoryId : null;
  const aspects: Aspects = {};
  const src = r.aspects && typeof r.aspects === "object" ? (r.aspects as Record<string, unknown>) : {};
  for (const [k, v] of Object.entries(src).slice(0, 80)) {
    const name = k.trim().slice(0, 65);
    if (!name || !Array.isArray(v)) continue;
    aspects[name] = v.filter((x): x is string => typeof x === "string").map((x) => x.trim().slice(0, 65)).filter(Boolean).slice(0, 30);
  }
  const measurements: Measurement[] = Array.isArray(r.measurements)
    ? (r.measurements as Array<Record<string, unknown>>)
        .filter((m) => MEASUREMENT_ORDER.includes(m?.key as Measurement["key"]) && typeof m.inches === "number" && m.inches > 0 && m.inches < 100)
        .map((m) => ({ key: m.key as Measurement["key"], inches: Math.round((m.inches as number) * 4) / 4, approx: m.approx === true }))
        .slice(0, 12)
    : [];
  return { categoryId, aspects, measurements };
}

/** Supabase/PostgREST error for a column that doesn't exist yet (migration not applied). */
export function isMissingColumnError(err: { code?: string; message?: string } | null | undefined, column: string): boolean {
  if (!err) return false;
  const m = (err.message ?? "").toLowerCase();
  return (err.code === "42703" || err.code === "PGRST204" || m.includes("could not find")) && m.includes(column.toLowerCase());
}

// ------------------------------------------------- listing description --

const LEGACY_LABELS: Array<[RegExp, Measurement["key"]]> = [
  [/pit\s*to\s*pit|p2p|chest/i, "pitToPit"],
  [/^length|body length/i, "length"],
  [/sleeve/i, "sleeve"],
  [/shoulder/i, "shoulder"],
  [/waist/i, "waist"],
  [/inseam/i, "inseam"],
  [/rise/i, "rise"],
  [/leg opening/i, "legOpening"],
];

/** Measurements from an older plain description ("Measurements: Pit to pit: 22 inches, Length: 28 inches."). */
export function measurementsFromDescription(desc: string | null | undefined): Measurement[] {
  if (!desc || isTemplateHtml(desc)) return [];
  const line = desc.split(/\n+/).find((l) => /^\s*Measurements:/i.test(l));
  if (!line) return [];
  const raw: Partial<Record<Measurement["key"], string>> = {};
  for (const part of line.replace(/^\s*Measurements:\s*/i, "").replace(/\.$/, "").split(/\s*,\s*/)) {
    const [label, value] = part.split(/\s*:\s*/);
    const hit = LEGACY_LABELS.find(([re]) => re.test((label ?? "").trim()));
    if (hit && value && !raw[hit[1]]) raw[hit[1]] = value;
  }
  return measurementsFrom(raw);
}

/** The listing's HTML description from the draft + its final aspects. */
export function listingDescriptionHtml(
  draft: { title?: string | null; description?: string | null; condition?: string | null; flaws?: string | null; custom_sku?: string | null },
  aspects: Aspects,
  measurements: Measurement[],
  notes: string | null | undefined,
): string {
  if (isTemplateHtml(draft.description)) return draft.description!.trim();
  const first = (...names: string[]) => names.map((n) => aspects[n]?.join(", ")).find(Boolean) ?? null;
  const details: Array<[string, string | null]> = [
    ["Brand", first("Brand")],
    ["Size", [first("Size"), first("Size Type") && first("Size Type") !== "Regular" ? first("Size Type") : null].filter(Boolean).join(" ") || null],
    ["Department", first("Department")],
    ["Type", first("Type")],
    ["Model / line", [first("Product Line"), first("Model")].filter(Boolean).join(" ") || null],
    ["Team / player", [first("Team"), first("Player"), first("Jersey Number") ? `#${first("Jersey Number")}` : null].filter(Boolean).join(" ") || null],
    ["Era", first("Decade") ?? (first("Vintage") === "Yes" ? "Vintage" : null)],
    ["Material", first("Outer Shell Material", "Material", "Fabric Type")],
    ["Color", first("Color")],
    ["Made in", first("Country/Region of Manufacture")],
  ];
  return buildDescriptionHtml({
    title: draft.title ?? "",
    summary: plainSummary(draft.description),
    details,
    measurements,
    conditionLabel: draft.condition,
    flaws: draft.flaws,
    notes,
    sku: draft.custom_sku ?? null,
  });
}
