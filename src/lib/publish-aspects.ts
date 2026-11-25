// The aspects actually sent to eBay at publish time (pure, so the whole
// path is tested). Same validation as analyze time: values matched to the
// category's eBay metadata, only the category's own aspects, garment guard,
// duplicates removed.
import { aspectsFromDraft, measurementAspects, measurementsFromDescription, mergeAspects, sanitizeStoredSpecifics, type AspectDef, type Aspects, type DraftFacts, type Measurement } from "@/lib/item-specifics";
import { classifyGarment, defsForKind, measurementKeysFor, type GarmentKind } from "@/lib/garment";
import { normalizeSpecifics } from "@/lib/normalize-specifics";
import { effectiveMode, strictDefs } from "@/lib/size-mapping";

export interface PublishAspects {
  aspects: Aspects;
  missingRequired: string[];
  measurements: Measurement[];
  kind: GarmentKind;
  /**
   * Values the seller/AI set that eBay won't accept for a list-only aspect
   * and that left the aspect empty (Size "9" with no known mapping). The
   * publish path refuses to send these to eBay and names the field.
   */
  rejected: Array<{ name: string; value: string; options: string[] }>;
  /** How a tag size was converted ("Lacoste size 9 = 4XL"), for the description. */
  sizeNote: string | null;
}

export function buildPublishAspects(
  draft: DraftFacts & { item_specifics?: unknown; description?: string | null },
  defs: AspectDef[],
): PublishAspects {
  const stored = sanitizeStoredSpecifics(draft.item_specifics);
  const measurementsAll = stored?.measurements?.length ? stored.measurements : measurementsFromDescription(draft.description);
  const kind = classifyGarment(draft.item_type, draft.title);
  const keys = measurementKeysFor(kind);
  const ms = measurementsAll.filter((m) => keys.size === 0 || keys.has(m.key));
  const fitting = defsForKind(defs, kind);
  const vintageOk = (/^y/i.test(draft.vintage ?? "") && !!draft.year_manufactured) || !!stored?.aspects?.["Vintage"]?.length;
  // Fixed draft columns + measurements + saved specifics, then the same
  // normalization the review screens use (src/lib/normalize-specifics.ts).
  const merged = mergeAspects([aspectsFromDraft(draft), measurementAspects(ms, fitting), stored?.aspects ?? {}], fitting, { onlyKnown: true });
  const layered = merged.aspects;
  const n = normalizeSpecifics(layered, defs, { kind, vintageEvidence: vintageOk });
  const aspects = n.aspects;
  const strict = new Map(strictDefs(fitting).filter((d) => effectiveMode(d) === "SELECTION_ONLY").map((d) => [d.name.toLowerCase(), d]));
  const has = (name: string) => Object.entries(aspects).some(([k, v]) => k.toLowerCase() === name.toLowerCase() && v.length > 0);
  const rejected: PublishAspects["rejected"] = [];
  for (const d of [...merged.dropped, ...n.removed.filter((r) => /not a valid eBay value/.test(r.why))]) {
    const def = strict.get(d.name.toLowerCase());
    if (!def || has(def.name) || rejected.some((r) => r.name === def.name)) continue;
    rejected.push({ name: def.name, value: d.value, options: def.values.slice(0, 12) });
  }
  return { aspects, missingRequired: n.missingRequired, measurements: ms, kind, rejected, sizeNote: merged.sizeNote ?? null };
}
