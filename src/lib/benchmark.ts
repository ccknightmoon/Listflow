// Accuracy benchmark against Sel's own live listings (gold = Sel's
// hand-made title, category and item specifics). Pure scoring + parsing;
// the API routes under /api/benchmark do the (read-only) eBay/AI calls.
import { xmlFind, xmlFindAll } from "@/lib/ebay-listings";
import { decodeEntities } from "@/lib/html-entities";
import { titleIssues } from "@/lib/seo-title";
import type { Aspects } from "@/lib/item-specifics";

export interface GoldItem {
  itemId: string;
  title: string;
  categoryId: string;
  categoryPath: string; // "Clothing, Shoes & Accessories > Men > …"
  specifics: Aspects;
  pictures: string[];
}

/** eBay GetItem (IncludeItemSpecifics) → gold item. */
export function parseGetItem(body: string): GoldItem | null {
  const item = xmlFind(body, "Item");
  const itemId = xmlFind(item, "ItemID");
  if (!itemId) return null;
  const cat = xmlFind(item, "PrimaryCategory");
  const specifics: Aspects = {};
  for (const nv of xmlFindAll(xmlFind(item, "ItemSpecifics"), "NameValueList")) {
    const name = decodeEntities(xmlFind(nv, "Name"));
    const values = xmlFindAll(nv, "Value").map((v) => decodeEntities(v)).filter(Boolean);
    if (name && values.length) specifics[name] = values;
  }
  return {
    itemId,
    title: decodeEntities(xmlFind(item, "Title")),
    categoryId: xmlFind(cat, "CategoryID"),
    categoryPath: decodeEntities(xmlFind(cat, "CategoryName")).split(":").join(" > "),
    specifics,
    pictures: xmlFindAll(xmlFind(item, "PictureDetails"), "PictureURL").filter((u) => /^https:\/\//.test(u)).slice(0, 8),
  };
}

export interface Prediction {
  categoryId: string | null;
  categoryPath: string | null;
  specifics: Aspects;
  title: string;
  missingRequired: string[];
  ready: boolean;
}

export const BENCH_FIELDS = ["Brand", "Size", "Color", "Type", "Department", "Team", "Player", "Material", "Sleeve Length", "Country/Region of Manufacture"] as const;

const n = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/['’`.]/g, "").replace(/[^a-z0-9]+/g, " ").trim()
  .replace(/^(mens|men s)$/, "men").replace(/^(womens|women s)$/, "women").replace(/^grey$/, "gray").replace(/^(usa|us|united states of america)$/, "united states");

/** Same value ignoring case/punctuation/plural; multi-value: any overlap counts. */
export function valuesAgree(gold: string[], pred: string[]): boolean {
  const g = gold.map(n).map((x) => x.replace(/s$/, ""));
  return pred.map(n).map((x) => x.replace(/s$/, "")).some((p) => g.includes(p));
}

export interface ItemScore {
  itemId: string;
  categoryExact: boolean;
  categoryBranch: boolean; // same top 3 path segments (e.g. Men's Clothing > Shirts)
  requiredComplete: boolean;
  ready: boolean;
  fields: Record<string, "match" | "wrong" | "missing" | "extra" | "n/a">;
  titleScore: number; // 0-100
  titleProblems: string[];
  errors: string[];
}

export function titleScore(title: string, specifics: Aspects): { score: number; problems: string[] } {
  const problems = titleIssues(title, specifics);
  let score = 100 - problems.length * 20;
  if (title.length < 50) { score -= 15; problems.push("Title uses under 50 of 80 characters."); }
  return { score: Math.max(0, score), problems };
}

export function scoreItem(gold: GoldItem, pred: Prediction): ItemScore {
  const errors: string[] = [];
  const categoryExact = !!pred.categoryId && pred.categoryId === gold.categoryId;
  const seg = (p: string | null) => (p ?? "").split(">").map((x) => n(x)).slice(0, 3).join(">");
  const categoryBranch = categoryExact || (!!pred.categoryPath && seg(pred.categoryPath) === seg(gold.categoryPath));
  if (!categoryExact) errors.push(categoryBranch ? "category: sibling leaf" : "category: wrong branch");
  const fields: ItemScore["fields"] = {};
  for (const f of BENCH_FIELDS) {
    const g = gold.specifics[f] ?? [];
    const p = pred.specifics[f] ?? [];
    if (!g.length && !p.length) fields[f] = "n/a";
    else if (!g.length) fields[f] = "extra";
    else if (!p.length) { fields[f] = "missing"; errors.push(`${f}: missing`); }
    else if (valuesAgree(g, p)) fields[f] = "match";
    else { fields[f] = "wrong"; errors.push(`${f}: wrong`); }
  }
  if (pred.missingRequired.length) errors.push("required specifics missing");
  const t = titleScore(pred.title, pred.specifics);
  if (t.score < 80) errors.push("title quality");
  return { itemId: gold.itemId, categoryExact, categoryBranch, requiredComplete: pred.missingRequired.length === 0, ready: pred.ready, fields, titleScore: t.score, titleProblems: t.problems, errors };
}

export interface BenchmarkReport {
  items: number;
  categoryExact: number; // %
  categoryBranch: number;
  requiredComplete: number;
  ready: number;
  /** Ready items whose checked fields were all right (precision of "Ready"). */
  readyPrecision: number | null;
  fieldAccuracy: Record<string, { accuracy: number | null; compared: number }>;
  overallFieldAccuracy: number | null;
  titleScore: number;
  topErrors: Array<{ error: string; count: number }>;
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);

export function aggregate(scores: ItemScore[]): BenchmarkReport {
  const fieldAccuracy: BenchmarkReport["fieldAccuracy"] = {};
  let allMatch = 0, allCompared = 0;
  for (const f of BENCH_FIELDS) {
    const compared = scores.filter((s) => ["match", "wrong", "missing"].includes(s.fields[f])).length;
    const match = scores.filter((s) => s.fields[f] === "match").length;
    fieldAccuracy[f] = { accuracy: compared ? pct(match, compared) : null, compared };
    allMatch += match; allCompared += compared;
  }
  const counts = new Map<string, number>();
  for (const s of scores) for (const e of s.errors) counts.set(e, (counts.get(e) ?? 0) + 1);
  const ready = scores.filter((s) => s.ready);
  const readyClean = ready.filter((s) => !Object.values(s.fields).some((v) => v === "wrong") && s.categoryBranch);
  return {
    items: scores.length,
    categoryExact: pct(scores.filter((s) => s.categoryExact).length, scores.length),
    categoryBranch: pct(scores.filter((s) => s.categoryBranch).length, scores.length),
    requiredComplete: pct(scores.filter((s) => s.requiredComplete).length, scores.length),
    ready: pct(ready.length, scores.length),
    readyPrecision: ready.length ? pct(readyClean.length, ready.length) : null,
    fieldAccuracy,
    overallFieldAccuracy: allCompared ? pct(allMatch, allCompared) : null,
    titleScore: scores.length ? Math.round(scores.reduce((a, s) => a + s.titleScore, 0) / scores.length) : 0,
    topErrors: [...counts.entries()].map(([error, count]) => ({ error, count })).sort((a, b) => b.count - a.count).slice(0, 10),
  };
}

/** Evenly spread sample across the active list (different categories tend to be listed at different times). */
export function sampleIds(ids: string[], n: number): string[] {
  if (ids.length <= n) return [...ids];
  const step = ids.length / n;
  return Array.from({ length: n }, (_, i) => ids[Math.floor(i * step)]);
}
