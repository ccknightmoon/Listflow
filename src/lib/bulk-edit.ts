// Bulk edit for drafts (price, condition, store category, title words) and
// live listings (price). Pure + integer cents so previews equal results.
import type { Condition } from "./pricing";

export const ALL_CONDITIONS: Condition[] = [
  "New with tags",
  "New without tags",
  "Excellent used",
  "Good - minor flaws",
  "Fair - notable flaws",
];

export type PriceChange =
  | { mode: "set"; value: number } // set to $X
  | { mode: "add"; value: number } // + or - $X
  | { mode: "percent"; value: number }; // + or - X%

export type TitleChange =
  | { mode: "prepend"; text: string }
  | { mode: "append"; text: string }
  | { mode: "remove"; text: string } // remove a word/phrase (case-insensitive)
  | { mode: "replace"; text: string; with: string };

export interface BulkEdit {
  price?: PriceChange;
  condition?: Condition;
  storeCategory?: { id: string | null; name: string | null };
  title?: TitleChange;
}

export const MIN_PRICE = 0.99;
export const MAX_TITLE = 80;

const toC = (n: number) => Math.round(n * 100);

/** New price in dollars (2 decimals), never below $0.99. null = can't compute (no current price for +/-). */
export function applyPrice(current: number | null | undefined, change: PriceChange): number | null {
  let cents: number;
  if (change.mode === "set") cents = toC(change.value);
  else {
    if (current == null || !Number.isFinite(current)) return null;
    cents = change.mode === "add" ? toC(current) + toC(change.value) : Math.round(toC(current) * (1 + change.value / 100));
  }
  return Math.max(toC(MIN_PRICE), cents) / 100;
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function applyTitle(title: string, change: TitleChange): string {
  const t = squash(title);
  const text = squash(change.text);
  if (!text && change.mode !== "replace") return t;
  switch (change.mode) {
    case "prepend": return squash(`${text} ${t}`);
    case "append": return squash(`${t} ${text}`);
    case "remove": return squash(t.replace(new RegExp(`(^|\\s)${escapeRe(text)}(?=\\s|$)`, "gi"), " "));
    case "replace": return text ? squash(t.replace(new RegExp(escapeRe(text), "gi"), squash(change.with))) : t;
  }
}

export interface BulkTarget {
  id: string;
  title: string | null;
  price: number | null;
  condition: string | null;
}

export interface BulkPreviewRow {
  id: string;
  before: BulkTarget;
  after: { title: string | null; price: number | null; condition: string | null };
  patch: Record<string, unknown>; // drafts column -> value
  warnings: string[];
}

export function previewBulkEdit(items: BulkTarget[], edit: BulkEdit): BulkPreviewRow[] {
  return items.map((it) => {
    const patch: Record<string, unknown> = {};
    const warnings: string[] = [];
    let price = it.price;
    let title = it.title;
    let condition = it.condition;
    if (edit.price) {
      const p = applyPrice(it.price, edit.price);
      if (p == null) warnings.push("No current price to adjust");
      else { price = p; patch.suggested_price = p; if (p === MIN_PRICE && edit.price.mode !== "set") warnings.push("Hit the $0.99 minimum"); }
    }
    if (edit.title && it.title != null) {
      const t = applyTitle(it.title, edit.title);
      if (t.length > MAX_TITLE) warnings.push(`Title would be ${t.length} characters (eBay max ${MAX_TITLE}) — not changed`);
      else if (!t) warnings.push("Title would be empty — not changed");
      else if (t !== it.title) { title = t; patch.title = t; }
    }
    if (edit.condition) { condition = edit.condition; patch.condition = edit.condition; }
    if (edit.storeCategory) { patch.store_category_id = edit.storeCategory.id; patch.store_category_name = edit.storeCategory.name; }
    return { id: it.id, before: it, after: { title, price, condition }, patch, warnings };
  });
}

export function isValidBulkEdit(e: unknown): e is BulkEdit {
  if (!e || typeof e !== "object") return false;
  const x = e as BulkEdit;
  if (!x.price && !x.condition && !x.storeCategory && !x.title) return false;
  if (x.price) {
    if (!["set", "add", "percent"].includes(x.price.mode) || typeof x.price.value !== "number" || !Number.isFinite(x.price.value)) return false;
    if (x.price.mode === "set" && x.price.value < MIN_PRICE) return false;
    if (x.price.mode === "percent" && (x.price.value <= -100 || x.price.value > 500)) return false;
  }
  if (x.condition && !ALL_CONDITIONS.includes(x.condition)) return false;
  if (x.title) {
    if (!["prepend", "append", "remove", "replace"].includes(x.title.mode) || typeof x.title.text !== "string" || x.title.text.length > 80) return false;
    if (x.title.mode === "replace" && typeof (x.title as { with?: unknown }).with !== "string") return false;
  }
  if (x.storeCategory && (typeof x.storeCategory !== "object" || (x.storeCategory.id !== null && typeof x.storeCategory.id !== "string"))) return false;
  return true;
}
