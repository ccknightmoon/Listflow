// Turns the vision answer into a pro-level eBay listing (Nov 2026):
//  1. pick the eBay category (same function publishing uses),
//  2. load that category's required + recommended aspects,
//  3. fill aspects from what the photos showed (draft fields, tag text,
//     measurements, the vision "specifics"),
//  4. ask a cheap text-only model to map the remaining facts onto the
//     category's exact aspect names/values — facts only, blanks allowed,
//  5. fit the title and flag required aspects that are still empty.
// Runs inside an eBay request context (taxonomy calls use the seller's token).
import { openAIPost } from "@/lib/openai-request";
import { chooseCategory } from "@/lib/ebay-category";
import { aspectFitsKind, classifyGarment, consistencyIssues, measurementKeysFor, sanitizeForItem, type GarmentKind } from "@/lib/garment";
import { fetchAspectDefs, defsForClient } from "@/lib/ebay-aspects";
import {
  aspectsFromDraft, aspectsToAsk, composeTitle, fitTitle, measurementAspects, measurementLines, measurementsFrom,
  mergeAspects, parseAiAspects, type AspectDef, type Aspects, type Measurement,
} from "@/lib/item-specifics";

export interface EnrichedListing {
  categoryId: string | null;
  categoryPath: string | null;
  categoryNeedsReview: boolean;
  garmentKind: GarmentKind;
  /** Contradictions found by the self-check (shown on the review screen). */
  issues: string[];
  itemSpecifics: Aspects;
  missingRequired: string[];
  aspectDefs: AspectDef[];
  measurementsList: Measurement[];
  suggestedTitle: string;
}

type Vision = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Old prompt returned measurements at the top level; new one nests them. Accept both. */
export function visionMeasurements(v: Vision): Measurement[] {
  const nested = (v.measurements && typeof v.measurements === "object" ? v.measurements : {}) as Record<string, unknown>;
  return measurementsFrom({
    pitToPit: nested.pitToPit ?? v.pitToPit, length: nested.length ?? v.length, sleeve: nested.sleeve, shoulder: nested.shoulder,
    waist: nested.waist ?? v.waist, inseam: nested.inseam ?? v.inseam, rise: nested.rise, legOpening: nested.legOpening,
  });
}

export function visionFacts(v: Vision) {
  return {
    title: str(v.suggestedTitle), brand: str(v.brand), color: str(v.color), size: str(v.size), department: str(v.department),
    item_type: str(v.itemType), style: str(v.style), material: str(v.material), theme: str(v.theme), sleeve_length: str(v.sleeveLength),
    neckline: str(v.neckline), fit: str(v.fit), pattern: str(v.pattern), vintage: str(v.vintage), character: str(v.character),
    character_family: str(v.characterFamily), year_manufactured: str(v.yearManufactured), season: str(v.season),
  };
}

function visionSpecifics(v: Vision): Aspects {
  const s = (v.specifics && typeof v.specifics === "object" ? v.specifics : {}) as Record<string, unknown>;
  const out: Aspects = {};
  for (const [k, val] of Object.entries(s)) {
    const t = str(val);
    if (t) out[k] = k === "Features" || k === "Accents" ? t.split(/\s*,\s*/).filter(Boolean) : [t];
  }
  return out;
}

/** eBay search order starts with the brand: "Vintage 90s Carhartt Jacket" → "Carhartt Vintage 90s Jacket". */
export function brandFirst(title: string, brand: string | null | undefined): string {
  const b = (brand ?? "").trim();
  if (!b || /^unbranded$/i.test(b) || !title) return title;
  const i = title.toLowerCase().indexOf(b.toLowerCase());
  if (i <= 0) return title;
  return fitTitle(`${title.slice(i, i + b.length)} ${title.slice(0, i)}${title.slice(i + b.length)}`);
}

/** Title: the AI's own if it's sensible, else composed from the facts in eBay order. */
export function chooseTitle(v: Vision, aspects: Aspects): string {
  const own = brandFirst(fitTitle(str(v.suggestedTitle)), aspects["Brand"]?.[0] ?? str(v.brand));
  if (own.length >= 25) return own;
  const first = (k: string) => aspects[k]?.[0] ?? null;
  return composeTitle({
    brand: first("Brand"),
    vintage: first("Vintage") === "Yes",
    era: str(v.era) || null,
    department: first("Department"),
    itemType: first("Type") ?? str(v.itemType),
    details: [first("Product Line"), first("Model"), first("Team"), first("Player"), first("Character"), first("Style"), first("Material"), ...(aspects["Features"] ?? []).slice(0, 2)].filter(Boolean) as string[],
    size: first("Size"),
    color: first("Color"),
  }) || own;
}

const FILL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["aspects"],
  properties: {
    aspects: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "values"],
        properties: { name: { type: "string" }, values: { type: "array", items: { type: "string" } } },
      },
    },
  },
};

export function fillPrompt(facts: Record<string, unknown>, ask: ReturnType<typeof aspectsToAsk>, itemDescription = ""): string {
  return `You fill eBay item specifics for a secondhand listing.
THE ITEM IS: ${itemDescription || "see facts"}.
Use ONLY the facts below (read from the item's photos and tags). If a fact
for an aspect isn't directly supported, leave that aspect out. Never guess.
When an aspect lists allowed values, use one of them exactly — but if none
of the allowed values truly describes THIS item, leave the aspect out
(never pick the "closest" value: e.g. no "Joggers" for a jersey).
Players, teams and leagues go in Player/Team/League/Sport, never in
Character or Character Family (those are for cartoon/movie characters).
Material means fiber from the tag (e.g. Polyester, Cotton) — "jersey" or
"knit" is a fabric construction, not a material.

FACTS:
${JSON.stringify(facts, null, 1)}

ASPECTS TO FILL (name, required?, multi-value?, allowed values):
${JSON.stringify(ask)}

Answer as JSON: {"aspects":[{"name":"<exact aspect name>","values":["…"]}]}`;
}

/** Vintage/decade only with evidence: the vision step said vintage AND gave an era/date. */
export function vintageEvidence(v: Vision): boolean {
  const yes = /^y/i.test(str(v.vintage));
  return yes && !!(str(v.era) || str(v.yearManufactured) || /(©|\(c\)|copyright)\s*(19|20)\d\d|\b(19[5-9]\d)\b/i.test(str(v.tagText)));
}

const specific = (v: Vision, k: string) => str(((v.specifics ?? {}) as Record<string, unknown>)[k]);

export async function enrichListing(apiKey: string, v: Vision): Promise<EnrichedListing> {
  const facts = visionFacts(v);
  const hints = { team: specific(v, "Team") || null, league: specific(v, "League") || null, player: specific(v, "Player") || null };
  const titleForCategory = fitTitle(facts.title) || [facts.brand, facts.item_type].filter(Boolean).join(" ");
  const kind = classifyGarment(facts.item_type, titleForCategory, hints);

  // Garment-aware category (never a pants leaf for a jersey); flagged when unsure.
  const cat = await chooseCategory({ title: titleForCategory, itemType: facts.item_type, brand: facts.brand, department: facts.department, ...hints })
    .catch(() => null);
  const categoryId = cat?.categoryId ?? null;
  const defsAll = categoryId ? await fetchAspectDefs(categoryId) : [];
  const defs = defsAll.filter((d) => aspectFitsKind(d.name, kind));

  // Measurements only for this kind of garment (no inseam on a top).
  const allowedKeys = measurementKeysFor(kind);
  const ms = visionMeasurements(v).filter((m) => allowedKeys.size === 0 || allowedKeys.has(m.key));
  const evidence = vintageEvidence(v);

  const base = sanitizeForItem(
    mergeAspects([aspectsFromDraft(facts), visionSpecifics(v), measurementAspects(ms, defs)], defs).aspects,
    kind,
    { vintageEvidence: evidence },
  ).aspects;

  let ai: Aspects = {};
  const ask = aspectsToAsk(defs, base);
  if (ask.length > 0) {
    try {
      const res = (await openAIPost(apiKey, {
        model: "gpt-4o-mini",
        max_tokens: 1200,
        response_format: { type: "json_schema", json_schema: { name: "item_specifics", strict: true, schema: FILL_SCHEMA } },
        messages: [{
          role: "user",
          content: fillPrompt(
            { ...facts, tagText: str(v.tagText), era: str(v.era), flaws: str(v.flaws), specifics: v.specifics ?? {}, measurements: measurementLines(ms) },
            ask,
            `${facts.item_type || kind}${hints.team ? ` (${hints.team})` : ""}${cat?.categoryPath ? ` — eBay category: ${cat.categoryPath}` : ""}`,
          ),
        }],
      })) as { choices?: { message?: { content?: string } }[] };
      ai = sanitizeForItem(parseAiAspects(JSON.parse(res.choices?.[0]?.message?.content ?? "{}")), kind, { vintageEvidence: evidence }).aspects;
    } catch {
      ai = {};
    }
  }

  // Photo-read facts win over the text model's mapping.
  const merged = mergeAspects([ai, base], defs);
  const issues = consistencyIssues({ title: titleForCategory, kind, categoryPath: cat?.categoryPath ?? null, aspects: merged.aspects, measurementKeys: ms.map((m) => m.key) });
  if (cat?.needsReview) issues.unshift("Couldn't find an eBay category that clearly fits this item — please choose one.");
  return {
    categoryId,
    categoryPath: cat?.categoryPath ?? null,
    categoryNeedsReview: !!cat?.needsReview,
    garmentKind: kind,
    issues,
    itemSpecifics: merged.aspects,
    missingRequired: merged.missingRequired,
    aspectDefs: defsForClient(defs),
    measurementsList: ms,
    suggestedTitle: chooseTitle(v, merged.aspects),
  };
}

/** Back-compat: flatten nested measurements to the old top-level fields the UI reads. */
export function flattenVision(v: Vision): Vision {
  const m = (v.measurements && typeof v.measurements === "object" ? v.measurements : {}) as Record<string, unknown>;
  return {
    ...v,
    pitToPit: v.pitToPit ?? m.pitToPit ?? "",
    length: v.length ?? m.length ?? "",
    waist: v.waist ?? m.waist ?? "",
    inseam: v.inseam ?? m.inseam ?? "",
  };
}

/**
 * Vision answer → full listing data. Category specifics need the seller's
 * eBay connection; without it the vision fields are returned as before.
 * Never throws: a failed enrichment just means fewer filled specifics.
 */
export async function enrichVisionResult(
  apiKey: string,
  vision: Vision,
  runWithEbay: (<T>(fn: () => Promise<T>) => Promise<T>) | null,
): Promise<Vision & Partial<EnrichedListing> & { measurementLines?: string[] }> {
  const v = flattenVision(vision);
  const lines = measurementLines(visionMeasurements(v));
  if (!runWithEbay) return { ...v, suggestedTitle: fitTitle(str(v.suggestedTitle)) || str(v.suggestedTitle), measurementLines: lines };
  try {
    const e = await runWithEbay(() => enrichListing(apiKey, v));
    return { ...v, ...e, measurementLines: measurementLines(e.measurementsList) };
  } catch {
    return { ...v, suggestedTitle: fitTitle(str(v.suggestedTitle)), measurementLines: lines };
  }
}

/**
 * "Change category" on the review screen: re-check the current specifics
 * against the newly chosen category, drop what doesn't belong, and fill
 * what the category recommends from the facts already known (no photos).
 */
export async function refillForCategory(
  apiKey: string | null,
  input: { categoryId: string; categoryPath: string | null; title: string; itemType: string | null; aspects: Aspects },
): Promise<Pick<EnrichedListing, "categoryId" | "categoryPath" | "categoryNeedsReview" | "garmentKind" | "issues" | "itemSpecifics" | "missingRequired" | "aspectDefs">> {
  const first = (k: string) => input.aspects[k]?.[0] ?? null;
  const kind = classifyGarment(input.itemType ?? first("Type"), input.title, { team: first("Team"), league: first("League"), player: first("Player") });
  const defs = (await fetchAspectDefs(input.categoryId)).filter((d) => aspectFitsKind(d.name, kind));
  const evidence = !!input.aspects["Vintage"]?.length;
  const base = sanitizeForItem(mergeAspects([input.aspects], defs).aspects, kind, { vintageEvidence: evidence }).aspects;
  let ai: Aspects = {};
  const ask = aspectsToAsk(defs, base);
  if (apiKey && ask.length) {
    try {
      const res = (await openAIPost(apiKey, {
        model: "gpt-4o-mini",
        max_tokens: 1000,
        response_format: { type: "json_schema", json_schema: { name: "item_specifics", strict: true, schema: FILL_SCHEMA } },
        messages: [{ role: "user", content: fillPrompt({ title: input.title, itemType: input.itemType, known: base }, ask, `${input.itemType ?? kind} — eBay category: ${input.categoryPath ?? input.categoryId}`) }],
      })) as { choices?: { message?: { content?: string } }[] };
      ai = sanitizeForItem(parseAiAspects(JSON.parse(res.choices?.[0]?.message?.content ?? "{}")), kind, { vintageEvidence: evidence }).aspects;
    } catch {
      ai = {};
    }
  }
  const merged = mergeAspects([ai, base], defs);
  return {
    categoryId: input.categoryId,
    categoryPath: input.categoryPath,
    categoryNeedsReview: false,
    garmentKind: kind,
    issues: consistencyIssues({ title: input.title, kind, categoryPath: input.categoryPath, aspects: merged.aspects }),
    itemSpecifics: merged.aspects,
    missingRequired: merged.missingRequired,
    aspectDefs: defsForClient(defs),
  };
}
