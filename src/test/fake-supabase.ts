// Minimal chainable stand-in for the Supabase client in route tests.
// `rows[table]` is what single()/maybeSingle()/await resolve to; every
// call is recorded so tests can assert on filters (e.g. user_id scoping).
export interface FakeCall { table: string; ops: Array<[string, unknown[]]> }

export function fakeSupabase(rows: Record<string, { data: unknown; error?: unknown; count?: number }>) {
  const calls: FakeCall[] = [];
  const from = (table: string) => {
    const call: FakeCall = { table, ops: [] };
    calls.push(call);
    const result = () => Promise.resolve({ error: null, ...(rows[table] ?? { data: null }) });
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "not", "in", "order", "limit", "range", "update", "insert", "upsert", "delete", "neq", "gte", "lte"]) {
      builder[m] = (...args: unknown[]) => {
        call.ops.push([m, args]);
        return builder;
      };
    }
    builder.single = () => { call.ops.push(["single", []]); return result(); };
    builder.maybeSingle = () => { call.ops.push(["maybeSingle", []]); return result(); };
    builder.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => result().then(res, rej);
    return builder;
  };
  return { client: { from }, calls };
}
