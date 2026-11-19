// One normalization pass for item specifics against the CURRENT category's
// eBay metadata. Used when a draft/batch item is opened (old items get
// cleaned), by the review screens, and at publish — browser-safe (pure).
import { mergeAspects, type AspectDef, type Aspects } from "@/lib/item-specifics";
import { classifyGarment, dedupeAspects, defsForKind, sanitizeForItem, type GarmentKind } from "@/lib/garment";

export interface NormalizeResult {
  aspects: Aspects;
  missingRequired: string[];
  removed: Array<{ name: string; value: string; why: string }>;
  changed: boolean;
}

const canon = (a: Aspects) => JSON.stringify(Object.keys(a).sort().map((k) => [k, a[k]]));

export function normalizeSpecifics(
  aspects: Aspects,
  defs: AspectDef[],
  opts: { kind?: GarmentKind; title?: string | null; itemType?: string | null; vintageEvidence?: boolean; photoFeatures?: string[] } = {},
): NormalizeResult {
  const kind = opts.kind ?? classifyGarment(opts.itemType ?? aspects["Type"]?.[0] ?? null, opts.title ?? null, { team: aspects["Team"]?.[0], league: aspects["League"]?.[0], player: aspects["Player"]?.[0] });
  const fitting = defsForKind(defs, kind);
  const required = defs.filter((d) => d.required).map((d) => d.name);
  const merged = mergeAspects([aspects], fitting, { onlyKnown: fitting.length > 0 });
  const removed: NormalizeResult["removed"] = merged.dropped.map((d) => ({ ...d, why: "not a valid eBay value/aspect for this category" }));
  const s = sanitizeForItem(merged.aspects, kind, {
    vintageEvidence: opts.vintageEvidence ?? !!aspects["Vintage"]?.length,
    photoFeatures: opts.photoFeatures,
    requiredAspects: required,
  });
  removed.push(...s.removed);
  const out = dedupeAspects(s.aspects, fitting.map((d) => d.name));
  return { aspects: out, missingRequired: mergeAspects([out], fitting).missingRequired, removed, changed: canon(out) !== canon(aspects) };
}
