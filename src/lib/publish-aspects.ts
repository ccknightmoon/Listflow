// The aspects actually sent to eBay at publish time (pure, so the whole
// path is tested). Same validation as analyze time: values matched to the
// category's eBay metadata, only the category's own aspects, garment guard,
// duplicates removed.
import { aspectsFromDraft, measurementAspects, measurementsFromDescription, mergeAspects, sanitizeStoredSpecifics, type AspectDef, type Aspects, type DraftFacts, type Measurement } from "@/lib/item-specifics";
import { classifyGarment, dedupeAspects, defsForKind, measurementKeysFor, sanitizeForItem, type GarmentKind } from "@/lib/garment";

export interface PublishAspects {
  aspects: Aspects;
  missingRequired: string[];
  measurements: Measurement[];
  kind: GarmentKind;
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
  const required = defs.filter((d) => d.required).map((d) => d.name);
  const vintageOk = (/^y/i.test(draft.vintage ?? "") && !!draft.year_manufactured) || !!stored?.aspects?.["Vintage"]?.length;
  const merged = mergeAspects([aspectsFromDraft(draft), measurementAspects(ms, fitting), stored?.aspects ?? {}], fitting, { onlyKnown: true });
  const aspects = dedupeAspects(sanitizeForItem(merged.aspects, kind, { vintageEvidence: vintageOk, requiredAspects: required }).aspects, fitting.map((d) => d.name));
  return { aspects, missingRequired: mergeAspects([aspects], fitting).missingRequired, measurements: ms, kind };
}
