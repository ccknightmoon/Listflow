// Pure helpers for the item-specifics dropdown (AspectPicker).

const n = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Options matching `query`, best first: exact, starts-with, word-start,
 * contains. Empty query → the list as eBay ordered it. Capped at `limit`.
 */
export function rankOptions(values: string[], query: string, limit = 500): string[] {
  const q = n(query);
  if (!q) return values.slice(0, limit);
  const scored: Array<[number, number, string]> = [];
  values.forEach((v, i) => {
    const x = n(v);
    let s = -1;
    if (x === q) s = 0;
    else if (x.startsWith(q)) s = 1;
    else if ((" " + x).includes(" " + q)) s = 2;
    else if (x.includes(q)) s = 3;
    else if (q.split(" ").every((w) => x.includes(w))) s = 4;
    if (s >= 0) scored.push([s, i, v]);
  });
  return scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, limit).map((x) => x[2]);
}

/** Whether to offer "Use 'xyz'" (free-text aspects, when it isn't already a listed value). */
export function offerCustom(query: string, values: string[], freeText: boolean): boolean {
  const q = query.trim();
  if (!freeText || !q) return false;
  return !values.some((v) => n(v) === n(q));
}

/** Rows to render for a virtualized list (with overscan). */
export function windowRange(scrollTop: number, rowHeight: number, viewHeight: number, total: number, overscan = 6): { start: number; end: number } {
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end = Math.min(total, Math.ceil((scrollTop + viewHeight) / rowHeight) + overscan);
  return { start, end };
}

/** Toggle a value in a multi-select (keeps order, no duplicates, case-insensitive). */
export function toggleValue(values: string[], v: string): string[] {
  return values.some((x) => n(x) === n(v)) ? values.filter((x) => n(x) !== n(v)) : [...values, v];
}
