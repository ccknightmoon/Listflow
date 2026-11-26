// Bin / shelf locations ("B3", "Tote 12") and the To-ship pick list.
// Pure helpers. Column drafts.bin_location (migration 041).

export const MAX_BIN_LENGTH = 24;

/** Trimmed, upper-cased label; "" -> null. Returns undefined when invalid. */
export function normalizeBin(v: unknown): string | null | undefined {
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim().replace(/\s+/g, " ").toUpperCase();
  if (!t) return null;
  if (t.length > MAX_BIN_LENGTH || /[<>]/.test(t)) return undefined;
  return t;
}

/** Natural order: "A2" < "A10" < "B1"; items with no bin last. */
export function compareBins(a: string | null | undefined, b: string | null | undefined): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

export interface PickRow {
  key: string;
  bin: string | null;
  sku: string | null;
  title: string;
}

/** Pick-list order: by bin (natural), then SKU, then title. Never mutates. */
export function sortPickList<T extends PickRow>(rows: T[]): T[] {
  return [...rows].sort((x, y) => compareBins(x.bin, y.bin) || (x.sku ?? "").localeCompare(y.sku ?? "", undefined, { numeric: true }) || x.title.localeCompare(y.title));
}

/** Groups by bin for the printable pick list. */
export function groupByBin<T extends PickRow>(rows: T[]): Array<{ bin: string | null; rows: T[] }> {
  const out: Array<{ bin: string | null; rows: T[] }> = [];
  for (const r of sortPickList(rows)) {
    const last = out[out.length - 1];
    if (last && last.bin === (r.bin ?? null)) last.rows.push(r);
    else out.push({ bin: r.bin ?? null, rows: [r] });
  }
  return out;
}
