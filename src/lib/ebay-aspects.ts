// eBay category metadata used for listing quality: item aspects (Taxonomy
// API getItemAspectsForCategory) and allowed conditions (Metadata API
// getItemConditionPolicies). Category metadata is the same for every
// seller, so it's cached by category id (12h), in memory per instance.
import { inventoryRequest } from "@/lib/ebay-inventory";
import { parseAspectDefs, CONDITION_ID_TO_ENUM, type AspectDef } from "@/lib/item-specifics";

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

/** Required + recommended + optional aspects for a leaf category ([] if eBay can't be reached). */
export async function fetchAspectDefs(categoryId: string): Promise<AspectDef[]> {
  if (!/^\d+$/.test(categoryId)) return [];
  const hit = aspectCache.get(categoryId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.defs;
  return once(`a:${categoryId}`, async () => {
    try {
      const r = await inventoryRequest("GET", `/commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category?category_id=${categoryId}`);
      if (r.status >= 400) return [];
      const defs = parseAspectDefs(r.data);
      if (defs.length) aspectCache.set(categoryId, { at: Date.now(), defs });
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
    try {
      const r = await inventoryRequest("GET", `/sell/metadata/v1/marketplace/EBAY_US/get_item_condition_policies?filter=categoryIds:%7B${categoryId}%7D`);
      if (r.status >= 400) return null;
      const enums = parseConditionPolicy(r.data);
      conditionCache.set(categoryId, { at: Date.now(), enums });
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

/** Defs trimmed for the browser (Brand alone can list thousands of values). */
export function defsForClient(defs: AspectDef[], maxValues = 120): AspectDef[] {
  return defs.map((d) => ({ ...d, values: d.values.slice(0, maxValues) }));
}
