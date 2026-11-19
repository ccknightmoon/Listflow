// Pass B: the chosen category's real aspect schema as an OpenAI structured-
// output JSON schema, so the model can only answer with valid aspect names
// and (for selection-only aspects) eBay's exact values. Every field is
// nullable: no evidence → null → left blank.
import type { AspectDef, Aspects } from "@/lib/item-specifics";

// OpenAI strict-mode limits (kept well inside them).
export const MAX_SCHEMA_PROPERTIES = 80;
export const MAX_ENUM_VALUES_PER_ASPECT = 250;
export const MAX_ENUM_VALUES_TOTAL = 900;

/** Property keys must be stable and simple; map them back to eBay names. */
export function aspectKey(name: string, i: number): string {
  return `a${i}_${name.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40)}`;
}

export interface AspectSchema {
  schema: Record<string, unknown>;
  keys: Array<{ key: string; def: AspectDef; enumerated: boolean }>;
}

export function buildAspectSchema(defs: AspectDef[]): AspectSchema {
  const ordered = [...defs].sort((a, b) => Number(b.required) - Number(a.required) || Number(b.recommended) - Number(a.recommended)).slice(0, MAX_SCHEMA_PROPERTIES);
  let enumBudget = MAX_ENUM_VALUES_TOTAL;
  const properties: Record<string, unknown> = {};
  const keys: AspectSchema["keys"] = [];
  ordered.forEach((def, i) => {
    const key = aspectKey(def.name, i);
    const canEnum = def.mode === "SELECTION_ONLY" && def.values.length > 0 && def.values.length <= MAX_ENUM_VALUES_PER_ASPECT && def.values.length <= enumBudget;
    if (canEnum) enumBudget -= def.values.length;
    const item = canEnum ? { type: "string", enum: def.values } : { type: "string" };
    const description = `${def.name}${def.required ? " (required by eBay)" : ""}${def.mode === "SELECTION_ONLY" ? " — eBay value only" : ""}. Null if the facts don't show it.`;
    properties[key] = def.multi
      ? { anyOf: [{ type: "array", items: item }, { type: "null" }], description }
      : { anyOf: [item, { type: "null" }], description };
    keys.push({ key, def, enumerated: canEnum });
  });
  return {
    schema: { type: "object", additionalProperties: false, required: keys.map((k) => k.key), properties },
    keys,
  };
}

/** The model's answer → Aspects (eBay names). Nulls, blanks and junk dropped. */
export function parseSchemaAnswer(answer: unknown, s: AspectSchema): Aspects {
  const out: Aspects = {};
  const obj = (answer && typeof answer === "object" ? answer : {}) as Record<string, unknown>;
  for (const { key, def } of s.keys) {
    const raw = obj[key];
    const list = (Array.isArray(raw) ? raw : raw == null ? [] : [raw])
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim())
      .filter((v) => v && !/^(null|none|n\/a|unknown|not visible)$/i.test(v));
    if (list.length) out[def.name] = def.multi ? [...new Set(list)] : list.slice(0, 1);
  }
  return out;
}
