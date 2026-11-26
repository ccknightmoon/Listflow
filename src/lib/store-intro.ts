// Store intro (Settings → "Store intro (added to every listing)").
//
// A short welcome paragraph the seller writes once. It's added to the TOP of
// every listing description at publish time (Trading add + verify, "Update on
// eBay" revise, and the Inventory fallback) -- never written into
// drafts.description, so review cards stay clean and the intro always matches
// what's saved in Settings right now.
//
// Idempotent: the intro is wrapped in a marked <div> (class + data attribute
// + comment markers). Any existing marked block is removed before the
// current one is inserted, so a re-publish/revise never stacks two copies.
// If the text is already present unmarked (e.g. pasted by hand, or eBay
// stripped the markers), nothing is added.
//
// Pure functions only (unit tested in store-intro.test.ts).

export const STORE_INTRO_MAX = 2000;

/** Prefilled in Settings only when the seller has no saved intro yet. */
export const STORE_INTRO_DEFAULT = [
  "Welcome to our store :)!",
  "Explore unique second-hand treasures with detailed photos!",
  "Each order is carefully packed and shipped fast for quick delivery.",
  "Questions? Contact support anytime; help is ready!",
  "Shop quality pre-owned items, including vintage and collectible finds.",
  "Don't miss other great deals!",
  "Grab yours now and return for more!",
  "",
  "Item Condition: Just as seen in the pictures!",
  "See photos for details and measurements for accurate fit.",
].join("\n");

export const SEE_PHOTOS_MEASUREMENTS = "See photos for measurements.";

export interface DescriptionPrefs {
  /** Trimmed intro text when the toggle is on and text is non-empty; else null. */
  storeIntro: string | null;
  /** Replace the AI's measurement list with "See photos for measurements." */
  measurementsSeePhotos: boolean;
}

export const NO_DESCRIPTION_PREFS: DescriptionPrefs = { storeIntro: null, measurementsSeePhotos: false };

/** From an app_settings row (columns may be missing before migration 036). */
export function descriptionPrefsFrom(row: { store_intro_enabled?: unknown; store_intro_text?: unknown; measurements_see_photos?: unknown } | null | undefined): DescriptionPrefs {
  // Never cut: the length is checked when it's saved (PATCH /api/settings).
  const text = typeof row?.store_intro_text === "string" ? row.store_intro_text.trim() : "";
  return {
    storeIntro: row?.store_intro_enabled === true && text ? text : null,
    measurementsSeePhotos: row?.measurements_see_photos === true,
  };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Plain text → safe HTML, line for line as typed: every newline becomes
 * <br> (a blank line stays a blank line), text is HTML-escaped, nothing is
 * reworded or cut. Only leading/trailing blank lines and trailing spaces go.
 */
export function introTextToHtml(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/\s+$/, ""));
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (!lines.length) return "";
  return `<p style="margin:0">${lines.map(esc).join("<br>")}</p>`;
}

const OPEN_MARK = "<!--lf-store-intro-->";
const CLOSE_MARK = "<!--/lf-store-intro-->";

/** The marked block that goes at the top of the description. */
export function storeIntroBlock(text: string): string {
  const body = introTextToHtml(text);
  if (!body) return "";
  return `${OPEN_MARK}<div class="lf-store-intro" data-lf="store-intro" style="margin:0 0 14px;padding:10px 12px;background:#f6f6f6;border-radius:6px;font-size:15px;line-height:1.5">${body}</div>${CLOSE_MARK}`;
}

// Our block never contains a nested <div>, so the first </div> closes it.
const markedBlock = () =>
  /(?:<!--lf-store-intro-->)?\s*<div\b[^>]*(?:data-lf=["']store-intro["']|class=["'][^"']*\blf-store-intro\b[^"']*["'])[^>]*>[\s\S]*?<\/div>\s*(?:<!--\/lf-store-intro-->)?/gi;
const commentBlock = () => /<!--lf-store-intro-->[\s\S]*?<!--\/lf-store-intro-->/gi;

/** Removes every store-intro block we previously inserted. */
export function stripStoreIntro(html: string): string {
  return html.replace(markedBlock(), "").replace(commentBlock(), "");
}

/** Lowercased words only: compares text regardless of tags, spacing, entities or punctuation. */
function words(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#0?39;|&apos;|&rsquo;|’/gi, "'")
    .replace(/&quot;/gi, '"')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** True when the text already appears in the html/plain text (ignoring formatting). */
export function containsIntroText(haystack: string | null | undefined, intro: string): boolean {
  const n = words(intro);
  return !!n && ` ${words(haystack ?? "")} `.includes(` ${n} `);
}

/**
 * Removes a copy of the intro the seller typed/pasted into a plain-text
 * description (so it isn't shown twice once the real intro is added).
 * Exact-text match only (whitespace/case-insensitive); anything else is kept.
 */
export function removeIntroFromPlainText(desc: string | null | undefined, intro: string | null): string | null | undefined {
  if (!desc || !intro || /<[a-z][^>]*>/i.test(desc)) return desc;
  const lines = intro.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return desc;
  const pattern = lines.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")).join("\\s+");
  return desc.replace(new RegExp(pattern, "i"), "").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Puts the intro at the top of a listing description (idempotent).
 * - Listflow template (`<div style="font-family:Arial…">`): inside the
 *   wrapper, before the title, so it shares the same font/width.
 * - Anything else (an eBay-made description): the block is put first; the
 *   seller's own HTML after it is untouched.
 * - intro null/empty: any previously inserted block is removed.
 */
export function applyStoreIntro(html: string, intro: string | null): string {
  const clean = stripStoreIntro(html);
  const text = (intro ?? "").trim();
  if (!text) return clean;
  const block = storeIntroBlock(text);
  if (!block) return clean;
  // Already there without our markers (hand-pasted, or eBay dropped them).
  if (containsIntroText(clean, text)) return clean;
  const template = clean.match(/^\s*<div style="font-family:Arial[^>]*>/);
  if (template) return template[0] + block + clean.slice(template[0].length);
  // Any other HTML (an eBay-made description): the block goes first, so the
  // intro is the very top of eBay's Description on every listing.
  return block + clean;
}

const MEASUREMENT_SECTION = /<h3\b[^>]*>Measurements \(taken flat\)<\/h3>\s*<ul\b[^>]*>[\s\S]*?<\/ul>/i;

/** Swaps the measurement list for one line pointing to the tape-measure photos. */
export function measurementsSeePhotos(html: string): string {
  return html.replace(
    MEASUREMENT_SECTION,
    `<h3 style="font-size:16px;margin:16px 0 6px">Measurements</h3><p style="margin:0 0 10px">${SEE_PHOTOS_MEASUREMENTS}</p>`,
  );
}

/** Last step before a description goes to eBay. */
export function finalizeListingDescription(html: string, prefs: DescriptionPrefs | null | undefined): string {
  const p = prefs ?? NO_DESCRIPTION_PREFS;
  const out = p.measurementsSeePhotos ? measurementsSeePhotos(html) : html;
  return applyStoreIntro(out, p.storeIntro);
}
