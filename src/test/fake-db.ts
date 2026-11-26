// Tiny chainable stand-in for the Supabase client in unit tests.
// tables[name] = rows; filters eq/in/is/gte are applied; inserts are recorded.
export type Row = Record<string, unknown>;

export function fakeDb(tables: Record<string, Row[] | { error: { code?: string; message: string } }>) {
  const inserts: Array<{ table: string; row: Row }> = [];
  const updates: Array<{ table: string; patch: Row }> = [];
  function from(table: string) {
    const filters: Array<(r: Row) => boolean> = [];
    let single = false;
    let op: "select" | "update" = "select";
    let patch: Row = {};
    const b = {
      select: () => b,
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), b),
      neq: (k: string, v: unknown) => (filters.push((r) => r[k] !== v), b),
      in: (k: string, v: unknown[]) => (filters.push((r) => v.includes(r[k])), b),
      is: (k: string, v: unknown) => (filters.push((r) => (r[k] ?? null) === v), b),
      not: () => b,
      gte: (k: string, v: string) => (filters.push((r) => String(r[k]) >= v), b),
      lte: (k: string, v: string) => (filters.push((r) => String(r[k]) <= v), b),
      order: () => b,
      limit: () => b,
      maybeSingle: () => ((single = true), b),
      single: () => ((single = true), b),
      update: (p: Row) => ((op = "update"), (patch = p), b),
      insert: (row: Row) => (inserts.push({ table, row }), Promise.resolve({ error: null })),
      upsert: (row: Row) => (inserts.push({ table, row }), Promise.resolve({ error: null })),
      then(resolve: (v: unknown) => void) {
        const t = tables[table];
        if (t && !Array.isArray(t)) return resolve({ data: null, error: t.error });
        const rows = (t ?? []).filter((r) => filters.every((f) => f(r)));
        if (op === "update") { updates.push({ table, patch }); rows.forEach((r) => Object.assign(r, patch)); }
        resolve({ data: single ? rows[0] ?? null : rows, error: null });
      },
    };
    return b;
  }
  return { db: { from } as never, inserts, updates };
}
