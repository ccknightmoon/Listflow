# Listflow — change notes

## Nov 25, 2026 — `fix/size-category-validation` (Lacoste polo: Size "9", frozen card, wrong shelf)

Reported: a Lacoste polo tagged "9" failed to list with `"9" is not a valid value for Size … (code 21920468)`, the batch card then couldn't be edited, and the item had been put on the "Outerwear & Coats" store shelf.

### Root causes (checked against the live draft row `5b77e243…` and the cached eBay metadata)
1. **Invalid Size.** eBay's Taxonomy metadata for Men's Polos (185101), T-Shirts (15687) and Coats (57988) marks `Size` as **FREE_TEXT** (84 listed values), so Listflow kept the AI's raw tag value. eBay's listing API actually enforces the list. Nothing translated brand sizing (Lacoste 9 = 4XL).
2. **Frozen card.** Every field on a Batch Upload card was `disabled={saveStatus === "saved"}`. "List on eBay" saves the draft first (→ "saved"), so when eBay rejected the listing the card stayed locked with no way to fix and retry.
3. **Wrong shelf.** The eBay category was right (Shirts > Polos); the *store* category was wrong. Store-category choices are kept per item **position** and were never cleared between batches (discarding a recovered batch kept them; the recovery snapshot re-saved them), so item #1 of the new batch inherited an earlier item #1's "Outerwear & Coats". The free keyword matcher also couldn't put a polo anywhere (it needs every word of "Tops, Tees & Sweaters" in the title), so nothing replaced the stale pick, and nothing checked the shelf against the item.

### What changed
- `src/lib/size-mapping.ts` (new): `strictDefs`/`effectiveMode` treat eBay's clothing **Size** list as selection-only; `mapTagSize` maps Lacoste 1–10 (2XS…5XL), XXL-style letters, "Large", "SMALL 36-38", "L/G", "IT/EU 50", collar sizes. Unmappable sizes are left blank → "Needed to publish", never sent raw.
- `mergeAspects` (all analyze/review/publish paths) applies the above using the item's Brand; `fetchAspectDefs` returns strict defs; `SpecificsEditor`/`AspectPicker` apply them to older saved analyses too.
- Publish: `buildPublishAspects` reports `rejected` values; `verifyWithFixes` refuses before calling eBay with `"9" is not a valid value for Size. Pick one of eBay's values (e.g. …)`. Mapped brand sizes keep the tag size: title `Size 9 (4XL)` (if ≤ 80 chars) and description `Size: 4XL (tag: Lacoste size 9 = 4XL)`.
- `src/lib/listing-problems.ts` (new): `aspectProblems` (pre-post check against the category's metadata) and `parseEbayFieldErrors` (eBay error text → field). Readiness gets `invalidSpecifics` and `storeCategoryIssue` blockers.
- Batch card: locked only while saving/listing or once listed (`src/lib/batch-card-state.ts`); a failed List drops "Saved" back to "Backed up"; edits re-enable Save; the field eBay named is outlined red, scrolled to and offered one-tap valid values. New **Check with eBay** button (VerifyAddFixedPriceItem — nothing listed). Per-item state is reset on a new batch / discard.
- Categories: `categoryFits` now rejects a top in Coats/Jackets/Vests and outerwear in Polos/T-Shirts/Dress Shirts; `consistencyIssues` flags Type vs category (Type "Polo" in Coats). Store shelf: kind-based fallback (polo → "Tops, Tees & Sweaters", jacket → "Outerwear & Coats"), `storeCategoryConflict` flags/blocks a polo on an outerwear shelf, and conflicting stale picks are replaced automatically.
- Tests: `size-mapping`, `listing-problems`, `batch-card-state`, `polo-category`, extra `trading-publish` cases (pre-flight never calls eBay; Lacoste sent as 4XL). 830+ tests green, `tsc` + `next build` clean.

### Notes / limits
- Only brand charts we're sure of are mapped (Lacoste). Other bare numbers are left for the seller.
- Changing the eBay category already reloads that category's aspects via `/api/ebay/specifics-refill`; values are re-validated against the new list (strict Size included).
- No migration. No data was changed.
