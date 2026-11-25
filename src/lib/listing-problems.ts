// Field-level problems with a listing, found BEFORE eBay is asked (from the
// category's aspect metadata) and AFTER (parsed out of eBay's error text),
// so the review card can point at the exact field instead of a red sentence
// under the stats. Pure; tested in listing-problems.test.ts.
import { isRejectedValue, suggestAllowedValues, type AspectDef, type Aspects } from "@/lib/item-specifics";
import { effectiveMode, strictDefs } from "@/lib/size-mapping";

export interface FieldProblem {
  /** eBay aspect name ("Size"). */
  aspect: string;
  kind: "missing" | "invalid";
  /** The value eBay won't take ("9"). */
  value?: string;
  /** A few valid values to offer as one-tap fixes. */
  options: string[];
  message: string;
}

const valuesOf = (aspects: Aspects, name: string) => {
  const key = Object.keys(aspects).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? aspects[key] ?? [] : [];
};

/** Required-but-empty and off-list values, checked against the category's eBay metadata. */
export function aspectProblems(aspects: Aspects, defsIn: AspectDef[]): FieldProblem[] {
  const out: FieldProblem[] = [];
  for (const d of strictDefs(defsIn)) {
    const vals = valuesOf(aspects, d.name);
    const strict = effectiveMode(d) === "SELECTION_ONLY";
    const bad = vals.filter((v) => isRejectedValue(v, d));
    if (bad.length) {
      const sug = suggestAllowedValues(bad[0], d);
      out.push({
        aspect: d.name,
        kind: "invalid",
        value: bad[0],
        options: sug.length ? sug : d.values.slice(0, 8),
        message: `${d.name}: "${bad[0]}" isn't one of eBay's ${d.name.toLowerCase()} values — pick one from the list`,
      });
    } else if (d.required && vals.length === 0) {
      out.push({
        aspect: d.name,
        kind: "missing",
        options: strict ? d.values.slice(0, 8) : [],
        message: `${d.name} is required by eBay — needs your pick`,
      });
    }
  }
  return out;
}

/**
 * eBay's error text → the fields it complains about. Handles the Trading
 * API wording seen in production, e.g.
 *   '"9" is not a valid value for Size. Select a value from the available options. (code 21920468)'
 *   'The item specific Size is missing. Add Size to this listing, enter a valid value, and then try again.'
 */
export function parseEbayFieldErrors(message: string | null | undefined): FieldProblem[] {
  const text = message ?? "";
  const out: FieldProblem[] = [];
  const seen = new Set<string>();
  const add = (p: FieldProblem) => {
    const k = `${p.kind}:${p.aspect.toLowerCase()}`;
    if (!seen.has(k)) { seen.add(k); out.push(p); }
  };
  for (const m of text.matchAll(/["“]([^"”]{0,80})["”]\s+is\s+not\s+a\s+valid\s+value\s+for\s+([A-Za-z0-9 '’&/()-]{1,60}?)\s*(?:\.|,|\(|$)/gi)) {
    add({ aspect: m[2].trim(), kind: "invalid", value: m[1], options: [], message: `${m[2].trim()}: eBay won't accept "${m[1]}" — pick one from the list` });
  }
  for (const m of text.matchAll(/item\s+specific\s+([A-Za-z0-9 '’&/()-]{1,60}?)\s+is\s+missing/gi)) {
    add({ aspect: m[1].trim(), kind: "missing", options: [], message: `${m[1].trim()} is required by eBay — needs your pick` });
  }
  for (const m of text.matchAll(/(?:enter|provide|add)\s+(?:a\s+(?:valid\s+)?value\s+for\s+)?(?:the\s+)?item\s+specific\s+["“]?([A-Za-z0-9 '’&/()-]{1,60}?)["”]?\s*(?:\.|,|$)/gi)) {
    add({ aspect: m[1].trim(), kind: "missing", options: [], message: `${m[1].trim()} is required by eBay — needs your pick` });
  }
  return out;
}

/** Aspect names to highlight on the card (lower-cased). */
export function problemAspectNames(problems: FieldProblem[]): string[] {
  return [...new Set(problems.map((p) => p.aspect.toLowerCase()))];
}
