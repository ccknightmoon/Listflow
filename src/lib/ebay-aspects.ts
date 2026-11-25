// eBay category metadata used for listing quality: item aspects (Taxonomy
// API getItemAspectsForCategory) and allowed conditions (Metadata API
// getItemConditionPolicies). Category metadata is the same for every
// seller, so it's cached by category id (12h) in memory per instance, with a
// shared 1-day copy in the database (metadata-cache.ts, migration 028) so
// a cold instance doesn't have to ask eBay again.
import { inventoryRequest } from "@/lib/ebay-inventory";
import { parseAspectDefs, CONDITION_ID_TO_ENUM, type AspectDef } from "@/lib/item-specifics";
import { optionsFor } from "@/lib/aspect-fallbacks";
import { dbCacheGet, dbCacheSet } from "@/lib/metadata-cache";
import { strictDefs } from "@/lib/size-mapping";

const TTL_MS = 12 * 60 * 60 * 1000;
const aspectCache = new Map<string, { at: number; defs: AspectDef[] }>();
const conditionCache = new Map<string, { at: number; enums: string[] | null }>();
const inflight = new Map<string, Promise<unknown>>();

function once<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const p = inflight.get(key) as Promise<T> | undefined;
  if (p) return p;
  const q = fn().finally(() => inflight.delete(key));
  inflight.set(key, q);
  return q;
}

/**
 * Required + recommended + optional aspects for a leaf category ([] if eBay
 * can't be reached). Lists eBay enforces despite FREE_TEXT metadata (Size)
 * come back selection-only — see src/lib/size-mapping.ts.
 */
export async function fetchAspectDefs(categoryId: string): Promise<AspectDef[]> {
  return strictDefs(await fetchAspectDefsRaw(categoryId));
}

async function fetchAspectDefsRaw(categoryId: string): Promise<AspectDef[]> {
  if (!/^\d+$/.test(categoryId)) return [];
  const hit = aspectCache.get(categoryId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.defs;
  return once(`a:${categoryId}`, async () => {
    const saved = await dbCacheGet<AspectDef[]>(`aspects:${categoryId}`);
    if (Array.isArray(saved) && saved.length) {
      aspectCache.set(categoryId, { at: Date.now(), defs: saved });
      return saved;
    }
    try {
      const r = await inventoryRequest("GET", `/commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category?category_id=${categoryId}`);
      if (r.status >= 400) return [];
      const defs = parseAspectDefs(r.data);
      if (defs.length) {
        aspectCache.set(categoryId, { at: Date.now(), defs });
        dbCacheSet(`aspects:${categoryId}`, defs);
      }
      return defs;
    } catch {
      return [];
    }
  });
}

/** Condition enums the category accepts, or null if unknown (caller falls back). */
export async function fetchAllowedConditions(categoryId: string): Promise<string[] | null> {
  if (!/^\d+$/.test(categoryId)) return null;
  const hit = conditionCache.get(categoryId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.enums;
  return once(`c:${categoryId}`, async () => {
    const saved = await dbCacheGet<{ enums: string[] | null }>(`conditions:${categoryId}`);
    if (saved && "enums" in saved) {
      conditionCache.set(categoryId, { at: Date.now(), enums: saved.enums });
      return saved.enums;
    }
    try {
      const r = await inventoryRequest("GET", `/sell/metadata/v1/marketplace/EBAY_US/get_item_condition_policies?filter=categoryIds:%7B${categoryId}%7D`);
      if (r.status >= 400) return null;
      const enums = parseConditionPolicy(r.data);
      conditionCache.set(categoryId, { at: Date.now(), enums });
      dbCacheSet(`conditions:${categoryId}`, { enums });
      return enums;
    } catch {
      return null;
    }
  });
}

export function parseConditionPolicy(data: unknown): string[] | null {
  const pol = (data as { itemConditionPolicies?: Array<{ itemConditions?: Array<{ conditionId?: string }> }> })?.itemConditionPolicies?.[0];
  const ids = (pol?.itemConditions ?? []).map((c) => String(c.conditionId ?? "")).filter(Boolean);
  const enums = ids.map((id) => CONDITION_ID_TO_ENUM[id]).filter(Boolean);
  return enums.length ? enums : null;
}

/**
 * Defs for the browser. Free-text lists (Brand can have thousands) are
 * trimmed and marked `valuesTruncated` so the editor never flags a value
 * just because it fell off the trimmed list. Selection-only lists are sent
 * whole (bug, Nov 2026: Country/Region of Manufacture has ~250 values,
 * "United States" was past the old 120 cut, so a correct value showed an
 * error under the field).
 */
export function defsForClient(defs: AspectDef[], maxFreeTextValues = 120, maxSelectionValues = 1500): AspectDef[] {
  return defs.map((d) => {
    // Free-text aspects eBay lists no values for get a curated list (any
    // text is accepted there); selection-only lists are never invented.
    const opts = optionsFor(d);
    const base = opts.curated ? { ...d, values: opts.values, curated: true } : d;
    const cap = base.mode === "SELECTION_ONLY" ? maxSelectionValues : maxFreeTextValues;
    return base.values.length > cap ? { ...base, values: base.values.slice(0, cap), valuesTruncated: true } : base;
  });
}
