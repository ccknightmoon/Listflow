// Picks the eBay category for an item (server). Garment-aware queries →
// eBay Taxonomy getCategorySuggestions → first suggestion whose path fits
// the garment (src/lib/garment.ts). If nothing fits, falls back to a safe
// category for the garment and marks it for review instead of guessing.
import { inventoryRequest, getSafeFallbackCategory } from "@/lib/ebay-inventory";
import { classifyGarment, categoryQueries, type GarmentKind } from "@/lib/garment";
import { parseSuggestions, pickFitting, type CategoryPick, type Suggestion } from "@/lib/category-choice";
import { dbCacheGet, dbCacheSet } from "@/lib/metadata-cache";

const cache = new Map<string, { at: number; s: Suggestion[] }>();
const TTL = 6 * 60 * 60 * 1000;

export async function suggestCategories(query: string): Promise<Suggestion[]> {
  const key = query.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.s;
  // Shared 1-day database copy (metadata-cache.ts) for cold instances.
  const saved = await dbCacheGet<Suggestion[]>(`suggest:${key}`);
  if (Array.isArray(saved) && saved.length) {
    cache.set(key, { at: Date.now(), s: saved });
    return saved;
  }
  try {
    const r = await inventoryRequest("GET", `/commerce/taxonomy/v1/category_tree/0/get_category_suggestions?q=${encodeURIComponent(query)}`);
    if (r.status >= 400) return [];
    const s = parseSuggestions(r.data);
    cache.set(key, { at: Date.now(), s });
    if (s.length) dbCacheSet(`suggest:${key}`, s);
    return s;
  } catch {
    return [];
  }
}

export interface ItemForCategory {
  title?: string | null;
  itemType?: string | null;
  brand?: string | null;
  department?: string | null;
  team?: string | null;
  league?: string | null;
  player?: string | null;
}

export async function chooseCategory(item: ItemForCategory): Promise<CategoryPick & { kind: GarmentKind }> {
  const kind = classifyGarment(item.itemType, item.title, item);
  const queries = categoryQueries({ kind, ...item });
  const results: Array<{ query: string; suggestions: Suggestion[] }> = [];
  for (const q of queries) {
    results.push({ query: q, suggestions: await suggestCategories(q) });
    const pick = pickFitting(kind, results);
    if (!pick.needsReview) return { ...pick, kind };
  }
  const pick = pickFitting(kind, results);
  // Nothing fit: a known-safe leaf for this garment, flagged for review.
  const fallbackTitle = `${item.department ?? ""} ${kind === "sports-jersey" ? "jersey shirt" : item.itemType ?? ""} ${item.title ?? ""}`;
  return { ...pick, categoryId: getSafeFallbackCategory(fallbackTitle), categoryPath: null, needsReview: true, kind };
}
