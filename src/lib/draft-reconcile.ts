// Finds Listflow drafts that are actually already on eBay (live or
// scheduled) but aren't linked to the listing -- e.g. listed straight from
// the eBay app, or a publish whose link save failed. Pure; no I/O.
//
// Matching, strongest first:
//  * "sku":   the listing's SKU is one Listflow gave this draft (its
//             custom SKU, or one of the older auto-SKU formats).
//  * "title": same words in the title (order/case/punctuation ignored),
//             or nearly the same (>= 85% word overlap and the same
//             leading brand word). Shown as a suggestion the seller confirms.
// Each listing and each draft is used at most once; a listing already
// linked to another draft is never offered.

export interface ReconcileDraft {
  id: string;
  title: string | null;
  custom_sku: string | null;
}

export interface ReconcileListing {
  listingId: string;
  title: string;
  sku: string | null;
  price: number | null;
  thumbnail: string | null;
  status: "active" | "scheduled";
}

export interface ReconcileMatch {
  draftId: string;
  draftTitle: string | null;
  listingId: string;
  listingTitle: string;
  status: "active" | "scheduled";
  reason: "sku" | "title";
  score: number;
}

/** Every SKU Listflow has ever used for this draft (see publish-draft / delist). */
export function listflowSkusFor(d: ReconcileDraft): string[] {
  const hex = d.id.replace(/-/g, "");
  return [
    d.custom_sku ?? "",
    String(parseInt(hex.slice(0, 8), 16) % 1000000),
    `listflow${hex.slice(0, 8)}`,
    `listflow${hex}`,
    `listflow-${d.id}`,
  ].filter(Boolean);
}

export function titleWords(t: string | null | undefined): string[] {
  return (t ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/['\u2019]/g, "") // "Men's" == "mens"
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length > 0);
}

/** 0..1: shared words / all distinct words (Jaccard). */
export function titleSimilarity(a: string | null, b: string | null): number {
  const A = new Set(titleWords(a));
  const B = new Set(titleWords(b));
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / (A.size + B.size - shared);
}

export const TITLE_MATCH_MIN = 0.85;

export function findDraftListingMatches(drafts: ReconcileDraft[], listings: ReconcileListing[], linkedListingIds: Iterable<string> = []): ReconcileMatch[] {
  const taken = new Set(linkedListingIds);
  const usedDrafts = new Set<string>();
  const out: ReconcileMatch[] = [];
  const free = () => listings.filter((l) => l.listingId && !taken.has(l.listingId));

  // 1) SKU: exact, unambiguous.
  for (const d of drafts) {
    const skus = new Set(listflowSkusFor(d).map((s) => s.toLowerCase()));
    const hit = free().find((l) => l.sku && skus.has(l.sku.toLowerCase()));
    if (hit) {
      out.push({ draftId: d.id, draftTitle: d.title, listingId: hit.listingId, listingTitle: hit.title, status: hit.status, reason: "sku", score: 1 });
      taken.add(hit.listingId);
      usedDrafts.add(d.id);
    }
  }

  // 2) Title: best pairs first, so one close title can't steal another's exact one.
  const candidates: ReconcileMatch[] = [];
  for (const d of drafts) {
    if (usedDrafts.has(d.id) || !titleWords(d.title).length) continue;
    for (const l of free()) {
      const score = titleSimilarity(d.title, l.title);
      const sameFirstWord = titleWords(d.title)[0] === titleWords(l.title)[0];
      if (score === 1 || (score >= TITLE_MATCH_MIN && sameFirstWord)) {
        candidates.push({ draftId: d.id, draftTitle: d.title, listingId: l.listingId, listingTitle: l.title, status: l.status, reason: "title", score });
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  for (const c of candidates) {
    if (usedDrafts.has(c.draftId) || taken.has(c.listingId)) continue;
    out.push(c);
    usedDrafts.add(c.draftId);
    taken.add(c.listingId);
  }
  return out;
}
