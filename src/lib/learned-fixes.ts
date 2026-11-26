// "Learn my fixes" (Phase 1, migration 043). Pure helpers.
//
// When the seller changes a value on a draft (e.g. brand "Polo RL" ->
// "Polo Ralph Lauren"), the (field, from, to) pair is counted. A pair made
// at least MIN_REPEATS times becomes a rule, and -- only if the seller
// turned "Learn my fixes" on -- new AI results get it applied.
// Only normalisation-type fields are learned. Never size, condition, price,
// flaws, measurements or description.
import type { AiResult } from "@/lib/ai-result";

export const MIN_REPEATS = 2;
const MAX_TITLE = 80;

export const LEARNABLE = {
  brand: { key: "brand", aspects: ["Brand"] },
  color: { key: "color", aspects: ["Color"] },
  material: { key: "material", aspects: ["Material"] },
  style: { key: "style", aspects: ["Style"] },
  pattern: { key: "pattern", aspects: ["Pattern"] },
  item_type: { key: "itemType", aspects: ["Type"] },
  neckline: { key: "neckline", aspects: ["Neckline"] },
  sleeve_length: { key: "sleeveLength", aspects: ["Sleeve Length"] },
  fit: { key: "fit", aspects: ["Fit"] },
} as const;
export type LearnableField = keyof typeof LEARNABLE;
/** drafts API body key for each column. */
export const BODY_KEY: Record<LearnableField, string> = {
  brand: "brand", color: "color", material: "material", style: "style", pattern: "pattern",
  item_type: "itemType", neckline: "neckline", sleeve_length: "sleeveLength", fit: "fit",
};

export interface Correction { field: LearnableField; from: string; to: string }
export interface CorrectionRow extends Correction { count: number }

const clean = (v: unknown) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "");
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** What changed between the saved row (columns) and an update body (camelCase). */
export function diffCorrections(before: Record<string, unknown>, body: Record<string, unknown>): Correction[] {
  const out: Correction[] = [];
  for (const field of Object.keys(LEARNABLE) as LearnableField[]) {
    const bk = BODY_KEY[field];
    if (!(bk in body)) continue;
    const from = clean(before[field]);
    const to = clean(body[bk]);
    if (!from || !to || from === to) continue;
    if (from.length > 120 || to.length > 120) continue;
    out.push({ field, from, to });
  }
  return out;
}

/** Rules: for each (field, from) the single `to` made >= MIN_REPEATS times (ties = no rule). */
export function activeRules(rows: CorrectionRow[], min = MIN_REPEATS): Correction[] {
  const groups = new Map<string, CorrectionRow[]>();
  for (const r of rows) {
    if (!(r.field in LEARNABLE) || r.count < min) continue;
    const k = `${r.field}\u0000${r.from.toLowerCase()}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const rules: Correction[] = [];
  for (const list of groups.values()) {
    const sorted = [...list].sort((a, b) => b.count - a.count);
    if (sorted.length > 1 && sorted[0].count === sorted[1].count) continue; // ambiguous
    const best = sorted[0];
    if (same(best.from, best.to) && best.from === best.to) continue;
    rules.push({ field: best.field, from: best.from, to: best.to });
  }
  return rules;
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** New result with the rules applied (title too, when it still fits 80). */
export function applyLearnedFixes<T extends Partial<AiResult>>(result: T, rules: Correction[]): T & { learnedFixes?: Correction[] } {
  if (!rules.length) return result;
  const out: T & { learnedFixes?: Correction[]; itemSpecifics?: Record<string, string[]> } = { ...result };
  const applied: Correction[] = [];
  for (const rule of rules) {
    const def = LEARNABLE[rule.field];
    if (!def) continue;
    const cur = clean((out as Record<string, unknown>)[def.key]);
    let hit = false;
    if (cur && same(cur, rule.from)) {
      (out as Record<string, unknown>)[def.key] = rule.to;
      hit = true;
    }
    if (out.itemSpecifics) {
      const specs = { ...out.itemSpecifics };
      for (const name of def.aspects) {
        const vals = specs[name];
        if (Array.isArray(vals) && vals.some((v) => same(clean(v), rule.from))) {
          specs[name] = vals.map((v) => (same(clean(v), rule.from) ? rule.to : v));
          hit = true;
        }
      }
      out.itemSpecifics = specs;
    }
    if (hit && rule.field === "brand" && typeof out.suggestedTitle === "string") {
      const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(rule.from)}(?=$|[^\\p{L}\\p{N}])`, "iu");
      const t = out.suggestedTitle.replace(re, (_m, pre: string) => `${pre}${rule.to}`);
      if (t.length <= MAX_TITLE) out.suggestedTitle = t;
    }
    if (hit) applied.push(rule);
  }
  if (applied.length) out.learnedFixes = applied;
  return out;
}

export function correctionFromRow(r: Record<string, unknown>): CorrectionRow | null {
  const field = String(r.field) as LearnableField;
  if (!(field in LEARNABLE)) return null;
  return { field, from: String(r.from_value ?? ""), to: String(r.to_value ?? ""), count: Number(r.count ?? 0) };
}
