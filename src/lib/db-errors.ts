// Shared check for "this table/column isn't in the database yet" (a migration
// that hasn't been applied). Callers fall back to the old behaviour.
/** Postgres/PostgREST "table or column doesn't exist" (migration not applied). */
export function isMissingRelation(error: { code?: string; message?: string } | null | undefined, name: string): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || error.code === "42703" || error.code === "PGRST204" ||
    (new RegExp(name).test(error.message ?? "") && /does not exist|could not find|schema cache/i.test(error.message ?? ""));
}
