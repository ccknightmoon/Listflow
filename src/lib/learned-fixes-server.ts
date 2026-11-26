// DB side of "Learn my fixes" (migration 043). Every function is
// best-effort: a missing table or any error = no rules / nothing recorded,
// never a failed save or analysis.
import type { SupabaseClient } from "@supabase/supabase-js";
import { activeRules, correctionFromRow, LEARNABLE, BODY_KEY, type Correction, type CorrectionRow } from "@/lib/learned-fixes";

/** Rules to apply for this seller: [] unless "Learn my fixes" is ON. */
export async function loadLearnedRules(db: SupabaseClient, userId: string): Promise<Correction[]> {
  try {
    const { data: s, error } = await db.from("app_settings").select("learn_fixes_enabled").eq("user_id", userId).maybeSingle();
    if (error || (s as { learn_fixes_enabled?: boolean } | null)?.learn_fixes_enabled !== true) return [];
    const { data, error: cErr } = await db.from("ai_corrections").select("field, from_value, to_value, count").eq("user_id", userId).gte("count", 2).limit(2000);
    if (cErr) return [];
    return activeRules((data ?? []).map((r) => correctionFromRow(r as Record<string, unknown>)).filter((r): r is CorrectionRow => !!r));
  } catch {
    return [];
  }
}

/** Columns to read before a save, when the body touches a learnable field. */
export function learnableColumnsIn(body: Record<string, unknown>): string[] {
  return (Object.keys(LEARNABLE) as Array<keyof typeof LEARNABLE>).filter((f) => BODY_KEY[f] in body);
}

export async function recordCorrections(db: SupabaseClient, userId: string, corrections: Correction[]): Promise<number> {
  let n = 0;
  for (const c of corrections.slice(0, 10)) {
    try {
      const { data, error } = await db
        .from("ai_corrections")
        .select("count")
        .eq("user_id", userId)
        .eq("field", c.field)
        .eq("from_value", c.from)
        .eq("to_value", c.to)
        .maybeSingle();
      if (error) return n; // table missing -> stop quietly
      const count = Number((data as { count?: number } | null)?.count ?? 0) + 1;
      const { error: uErr } = await db.from("ai_corrections").upsert(
        { user_id: userId, field: c.field, from_value: c.from, to_value: c.to, count, updated_at: new Date().toISOString() },
        { onConflict: "user_id,field,from_value,to_value" },
      );
      if (!uErr) n++;
    } catch {
      return n;
    }
  }
  return n;
}
