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
// the seller (or the AI pass) pick.
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

// English singular/plural is genuinely ambiguous from the surface form
// alone without a real dictionary: "Dresses"/"Purses"/"Hoodies" all end in
// the literal substring "es", but only "Dresses" should have that "es"
// stripped in full (dress -> dresses, a sibilant-ending base) -- "Purses"
// and "Hoodies" are words that already end in "e" (purse, hoodie) with
// just a plain "s" added, so stripping "es" from them wrongly cuts into the
// real word (-> "purs", "hoodi"). Rather than guess which rule applies,
// this returns every plausible normalized form of one word (as-is, minus a
// trailing "s", minus a trailing "es") and matching (below) accepts ANY
// shared form between an item word and a category word. That's what makes
// an item titled "Dress" match a "Dresses" category and "Hoodie" match a
// "Hoodies" category, without pulling in a real stemming library.
function wordVariants(rawWord: string): string[] {
  const w = rawWord.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!w) return [];
  const variants = new Set([w]);
  if (w.length > 4 && w.endsWith("es")) variants.add(w.slice(0, -2));
  if (w.length > 3 && w.endsWith("s")) variants.add(w.slice(0, -1));
  return Array.from(variants);
}

function splitWords(text: string): string[] {
  return text.split(/[\s\-/,.()|&]+/);
}

// Every variant of every significant word in `text`, flattened into one
// set -- used for the item side, where we only need "is this form present
// anywhere," not which original word it came from.
function significantWordVariantSet(text: string): Set<string> {
  const set = new Set<string>();
  for (const raw of splitWords(text)) {
    for (const v of wordVariants(raw)) {
      if (v.length >= 2 && !STOP_WORDS.has(v)) set.add(v);
    }
  }
  return set;
}

// One entry per significant word in `text`, each entry its own list of
// variants -- used for the category side, where "every word in the
// category name must match" has to be checked word-by-word, not against a
// flattened set.
function significantWordEntries(text: string): string[][] {
  const entries: string[][] = [];
  for (const raw of splitWords(text)) {
    const variants = wordVariants(raw).filter((v) => v.length >= 2 && !STOP_WORDS.has(v));
    if (variants.length > 0) entries.push(variants);
  }
  return entries;
}

export function matchStoreCategoryByKeyword(
  item: { title?: string | null; itemType?: string | null; brand?: string | null },
  categories: StoreCategoryLite[]
): StoreCategoryLite | null {
  const itemText = [item.title, item.itemType, item.brand].filter(Boolean).join(" ");
  const itemVariants = significantWordVariantSet(itemText);
  if (itemVariants.size === 0 || categories.length === 0) return null;

  let best: StoreCategoryLite | null = null;
  let bestScore = 0;

  for (const category of categories) {
    const categoryWordEntries = significantWordEntries(category.name);
    if (categoryWordEntries.length === 0) continue;
    const allMatch = categoryWordEntries.every((variants) => variants.some((v) => itemVariants.has(v)));
    if (!allMatch) continue;
    // Prefer the most specific (most-worded) matching category name over a
    // broader one that also happens to fully match -- e.g. "Tees" vs.
    // "Vintage Band Tees" both matching a vintage band tee -- the longer
    // name is the more useful shelf to file it under.
    if (categoryWordEntries.length > bestScore) {
      bestScore = categoryWordEntries.length;
      best = category;
    }
  }

  return best;
}
