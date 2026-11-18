// Pure part of category selection (tested): turn eBay category suggestions
// into a path and pick the first one that fits the garment.
import { categoryFits, type GarmentKind } from "@/lib/garment";

export interface Suggestion {
  id: string;
  path: string; // "Clothing, Shoes & Accessories > Men > Men's Clothing > Shirts"
}

/** eBay getCategorySuggestions response → suggestions with root→leaf paths. */
export function parseSuggestions(data: unknown): Suggestion[] {
  const list = (data as { categorySuggestions?: unknown[] })?.categorySuggestions;
  if (!Array.isArray(list)) return [];
  return (list as Array<{ category?: { categoryId?: string; categoryName?: string }; categoryTreeNodeAncestors?: Array<{ categoryName?: string; categoryTreeNodeLevel?: number }> }>)
    .filter((s) => s.category?.categoryId)
    .map((s) => {
      const ancestors = [...(s.categoryTreeNodeAncestors ?? [])].sort((a, b) => (a.categoryTreeNodeLevel ?? 0) - (b.categoryTreeNodeLevel ?? 0)).map((a) => a.categoryName ?? "").filter(Boolean);
      return { id: String(s.category!.categoryId), path: [...ancestors, s.category!.categoryName ?? ""].filter(Boolean).join(" > ") };
    });
}

export interface CategoryPick {
  categoryId: string | null;
  categoryPath: string | null;
  /** True when nothing eBay suggested fit the item: the seller should pick. */
  needsReview: boolean;
  query: string | null;
  rejected: Array<{ path: string; reason: string }>;
}

/** First suggestion (query by query, in eBay's order) whose path fits the item. */
export function pickFitting(kind: GarmentKind, results: Array<{ query: string; suggestions: Suggestion[] }>): CategoryPick {
  const rejected: Array<{ path: string; reason: string }> = [];
  for (const { query, suggestions } of results) {
    for (const s of suggestions) {
      const fit = categoryFits(kind, s.path);
      if (fit.ok) return { categoryId: s.id, categoryPath: s.path, needsReview: false, query, rejected };
      rejected.push({ path: s.path, reason: fit.reason ?? "doesn't fit" });
    }
  }
  return { categoryId: null, categoryPath: null, needsReview: true, query: null, rejected };
}
