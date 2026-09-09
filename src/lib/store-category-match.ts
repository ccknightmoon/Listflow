// Free, no-AI heuristic for guessing which of a seller's own eBay Store
// Categories an item belongs in, from nothing but the item's own detected
// fields. Runs entirely client-side (see src/app/batch-upload/page.tsx and
// src/app/drafts/[id]/page.tsx) -- no network call, no AI usage consumed --
// so it's always on as the default suggestion for every seller, with the
// opt-in AI suggestion (Settings -> "Store category suggestions" -> AI
// suggestions, see src/app/api/ebay/store-categories/suggest/route.ts)
// layered on top for anyone who wants a smarter guess, and the manual
// picker as the final word either way.
//
// The bar is deliberately strict: a category is only suggested if EVERY
// significant word in its own name shows up in the item's text. A partial
// or fuzzy match risks silently mis-filing an item into the wrong shelf of
// someone's storefront, which is worse than suggesting nothing and letting
// the seller (or the AI pass) pick. Naive suffix-stripping ("tees" / "tee")
// covers the common singular/plural mismatch without pulling in a real
// stemming library for what is otherwise a short list of short words.
export interface StoreCategoryLite {
  id: string;
  name: string;
  // Full "Parent / Child" path -- see src/lib/ebay-store-categories.ts,
  // which is where this shape actually comes from server-side.
  path: string;
}

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "of", "for", "with", "in", "on", "at", "to",
  "other", "misc", "miscellaneous", "items", "item", "all",
]);

function normalizeWord(word: string): string {
  const w = word.toLowerCase().replace(/[^a-z0-9]/g, "");
  // Naive singular/plural fold ("tees" -> "tee", "dresses" -> "dresse") --
  // close enough for a set-membership comparison, not meant to be a real
  // stemmer.
  if (w.length > 4 && w.endsWith("es")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s")) return w.slice(0, -1);
  return w;
}

function significantWords(text: string): Set<string> {
  return new Set(
    text
      .split(/[\s\-/,.()|&]+/)
      .map(normalizeWord)
      .filter((w) => w.length >= 2 && !STOP_WORDS.has(w))
  );
}

export function matchStoreCategoryByKeyword(
  item: { title?: string | null; itemType?: string | null; brand?: string | null },
  categories: StoreCategoryLite[]
): StoreCategoryLite | null {
  const itemText = [item.title, item.itemType, item.brand].filter(Boolean).join(" ");
  const itemWords = significantWords(itemText);
  if (itemWords.size === 0 || categories.length === 0) return null;

  let best: StoreCategoryLite | null = null;
  let bestScore = 0;

  for (const category of categories) {
    const categoryWords = Array.from(significantWords(category.name));
    if (categoryWords.length === 0) continue;
    const allMatch = categoryWords.every((w) => itemWords.has(w));
    if (!allMatch) continue;
    // Prefer the most specific (most-worded) matching category name over a
    // broader one that also happens to fully match -- e.g. "Tees" vs.
    // "Vintage Band Tees" both matching a vintage band tee -- the longer
    // name is the more useful shelf to file it under.
    if (categoryWords.length > bestScore) {
      bestScore = categoryWords.length;
      best = category;
    }
  }

  return best;
}
