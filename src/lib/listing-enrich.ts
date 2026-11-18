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
import { getCategoryIdForTitle } from "@/lib/ebay-inventory";
import { fetchAspectDefs, defsForClient } from "@/lib/ebay-aspects";
import {
  aspectsFromDraft, aspectsToAsk, composeTitle, fitTitle, measurementAspects, measurementLines, measurementsFrom,
  mergeAspects, parseAiAspects, type AspectDef, type Aspects, type Measurement,
} from "@/lib/item-specifics";

export interface EnrichedListing {
  categoryId: string | null;
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

/** Title: the AI's own if it's sensible, else composed from the facts in eBay order. */
export function chooseTitle(v: Vision, aspects: Aspects): string {
  const own = fitTitle(str(v.suggestedTitle));
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

export function fillPrompt(facts: Record<string, unknown>, ask: ReturnType<typeof aspectsToAsk>): string {
  return `You fill eBay item specifics for a secondhand listing.
Use ONLY the facts below (read from the item's photos and tags). If a fact
for an aspect isn't directly supported, leave that aspect out. Never guess.
When an aspect lists allowed values, use one of them exactly.

FACTS:
${JSON.stringify(facts, null, 1)}

ASPECTS TO FILL (name, required?, multi-value?, allowed values):
${JSON.stringify(ask)}

Answer as JSON: {"aspects":[{"name":"<exact aspect name>","values":["…"]}]}`;
}

export async function enrichListing(apiKey: string, v: Vision): Promise<EnrichedListing> {
  const facts = visionFacts(v);
  const ms = visionMeasurements(v);
  const titleForCategory = fitTitle(facts.title) || [facts.brand, facts.item_type].filter(Boolean).join(" ");
  const categoryId = await getCategoryIdForTitle(titleForCategory, facts.item_type || undefined).catch(() => null);
  const defs = categoryId ? await fetchAspectDefs(categoryId) : [];

  const base = mergeAspects([aspectsFromDraft(facts), visionSpecifics(v), measurementAspects(ms, defs)], defs).aspects;

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
          content: fillPrompt({ ...facts, tagText: str(v.tagText), era: str(v.era), flaws: str(v.flaws), specifics: v.specifics ?? {}, measurements: measurementLines(ms) }, ask),
        }],
      })) as { choices?: { message?: { content?: string } }[] };
      ai = parseAiAspects(JSON.parse(res.choices?.[0]?.message?.content ?? "{}"));
    } catch {
      ai = {};
    }
  }

  // Photo-read facts win over the text model's mapping.
  const merged = mergeAspects([ai, base], defs);
  return {
    categoryId,
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
    return { ...v, ...e, measurementLines: lines };
  } catch {
    return { ...v, suggestedTitle: fitTitle(str(v.suggestedTitle)), measurementLines: lines };
  }
}
