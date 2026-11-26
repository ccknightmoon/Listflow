// "Storage & pick list" (Phase 1, reworked per Sel). Pure helpers.
//
// Sellers store stock differently, so where an item lives is a per-seller
// setting (app_settings.storage_settings, migration 041), OFF by default:
//   off / "sku_only" -> no location anywhere; To-ship sorts by SKU
//   "sku_boxes"      -> the seller lists boxes as SKU ranges (Box 18 =
//                       SKU 1701–1800); an item's box is worked out from its
//                       SKU, nothing typed per item
//   "bins"           -> a free-text location per item (rack, bin, shelf)
// The pick list sorts by location (box/bin) then SKU, numbers compared as
// numbers (99 < 100 < 1740).

export type StorageMode = "sku_boxes" | "bins" | "sku_only";
export const STORAGE_MODES: StorageMode[] = ["sku_boxes", "bins", "sku_only"];

export interface SkuBox { name: string; from: number; to: number }
export interface StorageSettings { enabled: boolean; mode: StorageMode; boxes: SkuBox[] }

export const STORAGE_DEFAULTS: StorageSettings = { enabled: false, mode: "sku_only", boxes: [] };
export const MAX_BOXES = 500;
export const MAX_LOCATION_LENGTH = 24;
export const MAX_BOX_NAME = 40;
const MAX_SKU_NUMBER = 999_999_999;

/** Whole-number SKU ("1740", "001740") -> 1740; anything else -> null. */
export function skuNumber(sku: string | null | undefined): number | null {
  const t = (sku ?? "").trim();
  if (!/^\d{1,9}$/.test(t)) return null;
  return Number(t);
}

/** Numeric-aware SKU order (99 < 100 < 1740 < A12); missing SKUs last. */
export function compareSku(a: string | null | undefined, b: string | null | undefined): number {
  const x = (a ?? "").trim(), y = (b ?? "").trim();
  if (!x && !y) return 0;
  if (!x) return 1;
  if (!y) return -1;
  const nx = skuNumber(x), ny = skuNumber(y);
  if (nx != null && ny != null) return nx - ny || x.localeCompare(y);
  if (nx != null) return -1;
  if (ny != null) return 1;
  return x.localeCompare(y, undefined, { numeric: true, sensitivity: "base" });
}

/** Natural order for location labels ("Box 2" < "Box 10" < "Rack B"); empty last. */
export function compareLocation(a: string | null | undefined, b: string | null | undefined): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

/** Free-text location: trimmed, upper-cased; "" -> null; undefined = invalid. */
export function normalizeLocation(v: unknown): string | null | undefined {
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim().replace(/\s+/g, " ").toUpperCase();
  if (!t) return null;
  if (t.length > MAX_LOCATION_LENGTH || /[<>]/.test(t)) return undefined;
  return t;
}

/** Problems with a box list (empty = fine). Overlaps are reported by name. */
export function boxErrors(boxes: SkuBox[]): string[] {
  const errs: string[] = [];
  if (boxes.length > MAX_BOXES) errs.push(`At most ${MAX_BOXES} boxes.`);
  boxes.forEach((b, i) => {
    const label = b.name?.trim() || `Row ${i + 1}`;
    if (!b.name || !b.name.trim()) errs.push(`Row ${i + 1}: give the box a name.`);
    else if (b.name.trim().length > MAX_BOX_NAME) errs.push(`${label}: name is too long (max ${MAX_BOX_NAME}).`);
    if (!Number.isInteger(b.from) || !Number.isInteger(b.to) || b.from < 0 || b.to < 0 || b.to > MAX_SKU_NUMBER) errs.push(`${label}: SKUs must be whole numbers.`);
    else if (b.from > b.to) errs.push(`${label}: "from" must not be bigger than "to".`);
  });
  const sorted = boxes.map((b, i) => ({ ...b, i })).filter((b) => Number.isInteger(b.from) && Number.isInteger(b.to) && b.from <= b.to).sort((p, q) => p.from - q.from);
  for (let k = 1; k < sorted.length; k++) {
    const prev = sorted[k - 1], cur = sorted[k];
    if (cur.from <= prev.to) errs.push(`${prev.name.trim() || `Row ${prev.i + 1}`} and ${cur.name.trim() || `Row ${cur.i + 1}`} overlap (SKU ${cur.from}–${Math.min(prev.to, cur.to)}).`);
  }
  const names = new Map<string, number>();
  for (const b of boxes) { const n = b.name?.trim().toLowerCase(); if (n) names.set(n, (names.get(n) ?? 0) + 1); }
  for (const [n, c] of names) if (c > 1) errs.push(`The name "${boxes.find((b) => b.name.trim().toLowerCase() === n)!.name.trim()}" is used ${c} times.`);
  return errs;
}

/** The box a SKU falls in, or null (no number, or no box covers it). */
export function boxForSku(sku: string | null | undefined, boxes: SkuBox[]): string | null {
  const n = skuNumber(sku);
  if (n == null) return null;
  for (const b of boxes) if (n >= b.from && n <= b.to) return b.name.trim();
  return null;
}

/** "Generate boxes": count boxes of perBox SKUs each, starting at startSku. */
export function generateBoxes(o: { startSku: number; perBox: number; count: number; prefix: string; firstNumber?: number }): SkuBox[] {
  const { startSku, perBox, count } = o;
  if (!Number.isInteger(startSku) || startSku < 0 || !Number.isInteger(perBox) || perBox < 1 || !Number.isInteger(count) || count < 1 || count > MAX_BOXES) return [];
  const prefix = (o.prefix ?? "Box").trim().slice(0, MAX_BOX_NAME - 6) || "Box";
  const first = Number.isInteger(o.firstNumber) && (o.firstNumber as number) >= 0 ? (o.firstNumber as number) : 1;
  const out: SkuBox[] = [];
  for (let i = 0; i < count; i++) {
    const from = startSku + i * perBox;
    const to = from + perBox - 1;
    if (to > MAX_SKU_NUMBER) break;
    out.push({ name: `${prefix} ${first + i}`, from, to });
  }
  return out;
}

export const UNASSIGNED = "Unassigned";

/**
 * Where to find an item under the seller's settings:
 *   null      -> no location shown (feature off / SKU only)
 *   string    -> box name or typed location
 *   UNASSIGNED-> boxes mode, but the SKU isn't a number or no box covers it
 */
export function locationFor(item: { sku?: string | null; location?: string | null }, s: StorageSettings): string | null {
  if (!s.enabled || s.mode === "sku_only") return null;
  if (s.mode === "sku_boxes") return boxForSku(item.sku, s.boxes) ?? UNASSIGNED;
  return item.location?.trim() || null;
}

/** Does this setup show a per-item location field in the editor? */
export function showsLocationField(s: StorageSettings | null | undefined): boolean {
  return !!s && s.enabled && s.mode === "bins";
}

export interface PickRow { key: string; sku: string | null; title: string; location: string | null }

/** Pick-list order: SKU only when there are no locations; else location (Unassigned last), then SKU. */
export function sortPickList<T extends PickRow>(rows: T[], s: StorageSettings): T[] {
  const byLoc = s.enabled && s.mode !== "sku_only";
  const loc = (r: T) => (r.location === UNASSIGNED ? null : r.location);
  return [...rows].sort((x, y) =>
    (byLoc ? compareLocation(loc(x), loc(y)) : 0) || compareSku(x.sku, y.sku) || x.title.localeCompare(y.title));
}

/** Groups for the printable pick list (one group "" when there are no locations). */
export function groupPickList<T extends PickRow>(rows: T[], s: StorageSettings): Array<{ location: string | null; rows: T[] }> {
  const sorted = sortPickList(rows, s);
  if (!s.enabled || s.mode === "sku_only") return sorted.length ? [{ location: null, rows: sorted }] : [];
  const out: Array<{ location: string | null; rows: T[] }> = [];
  for (const r of sorted) {
    const l = r.location && r.location !== UNASSIGNED ? r.location : UNASSIGNED;
    const last = out[out.length - 1];
    if (last && last.location === l) last.rows.push(r);
    else out.push({ location: l, rows: [r] });
  }
  return out;
}

/** Reads app_settings.storage_settings safely; anything odd -> OFF. */
export function storageFromRow(raw: unknown): StorageSettings {
  const r = raw as Partial<StorageSettings> | null | undefined;
  if (!r || typeof r !== "object") return { ...STORAGE_DEFAULTS };
  const mode: StorageMode = STORAGE_MODES.includes(r.mode as StorageMode) ? (r.mode as StorageMode) : "sku_only";
  const boxes = Array.isArray(r.boxes)
    ? r.boxes.slice(0, MAX_BOXES).map((b) => ({ name: String((b as SkuBox)?.name ?? "").slice(0, MAX_BOX_NAME), from: Number((b as SkuBox)?.from), to: Number((b as SkuBox)?.to) }))
    : [];
  return { enabled: r.enabled === true, mode, boxes: boxErrors(boxes).length ? [] : boxes };
}

/** Validates a settings PATCH body; returns the clean value or an error. */
export function parseStorageBody(b: unknown): { value: StorageSettings } | { error: string } {
  const x = b as Partial<StorageSettings> | null;
  if (!x || typeof x !== "object") return { error: "Invalid settings." };
  if (typeof x.enabled !== "boolean") return { error: "enabled must be true or false." };
  if (!STORAGE_MODES.includes(x.mode as StorageMode)) return { error: "Pick SKU boxes, Bins / racks or SKU only." };
  if (!Array.isArray(x.boxes)) return { error: "boxes must be a list." };
  const boxes = x.boxes.map((bx) => ({ name: typeof bx?.name === "string" ? bx.name.trim() : "", from: Number(bx?.from), to: Number(bx?.to) }));
  const errs = x.mode === "sku_boxes" ? boxErrors(boxes) : [];
  if (errs.length) return { error: errs.slice(0, 3).join(" ") };
  return { value: { enabled: x.enabled, mode: x.mode as StorageMode, boxes: x.mode === "sku_boxes" ? boxes : boxes.length && !boxErrors(boxes).length ? boxes : [] } };
}
