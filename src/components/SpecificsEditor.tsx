"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, ListChecks, FolderTree, Loader2, Search } from "lucide-react";
import { apiFetch } from "@/lib/api";
import AspectPicker from "@/components/AspectPicker";
import { normalizeSpecifics } from "@/lib/normalize-specifics";
import { strictDefs } from "@/lib/size-mapping";
import { aspectProblems } from "@/lib/listing-problems";
import { isRejectedValue, matchAllowedValue, missingRequiredAspects, suggestAllowedValues, type AspectDef, type Aspects } from "@/lib/item-specifics";

/**
 * Edit eBay item specifics fast (phone and desktop). Required aspects come
 * first and are highlighted when empty; filled ones follow; the rest of
 * eBay's recommended aspects sit behind "Show more". Inputs suggest eBay's
 * allowed values; multi-value aspects take comma-separated values.
 */
export default function SpecificsEditor({
  aspects,
  onChange,
  defs: givenDefs,
  categoryId,
  categoryPath,
  categoryNeedsReview,
  issues,
  title,
  itemType,
  disabled,
  onMeta,
  onCategoryChange,
  highlight,
}: {
  aspects: Aspects;
  onChange: (next: Aspects, meta: { categoryId: string | null; missingRequired: string[] }) => void;
  categoryPath?: string | null;
  categoryNeedsReview?: boolean;
  /** Self-check contradictions to show (title vs category vs Type…). */
  issues?: string[];
  /** Seller picked another category: new specifics, defs and checks. */
  onCategoryChange?: (r: { categoryId: string; categoryPath: string; aspects: Aspects; missingRequired: string[]; defs: AspectDef[]; issues: string[] }) => void;
  defs?: AspectDef[] | null;
  categoryId?: string | null;
  title?: string | null;
  itemType?: string | null;
  disabled?: boolean;
  /** Fires whenever the category, the missing required aspects or the off-list values change. */
  onMeta?: (meta: { categoryId: string | null; missingRequired: string[]; invalid: Array<{ name: string; value: string }> }) => void;
  /** Aspects eBay just complained about (from its error): outlined in red and scrolled to. */
  highlight?: string[];
}) {
  const [fetched, setFetched] = useState<{ categoryId: string | null; categoryPath?: string | null; categoryNeedsReview?: boolean; defs: AspectDef[] } | null>(null);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<Array<{ id: string; path: string; fits: boolean }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);
  const [open, setOpen] = useState(true);
  // After "Change category" the new category's list wins until the parent
  // passes it back in — never a stale list from the previous category.
  const [changed, setChanged] = useState<{ categoryId: string; defs: AspectDef[] } | null>(null);
  const catId = changed?.categoryId ?? categoryId ?? fetched?.categoryId ?? null;
  // strictDefs: older saved analyses carry eBay's raw "FREE_TEXT" Size;
  // eBay rejects off-list sizes, so the picker/validation treat it as a list.
  const defs = useMemo(
    () => strictDefs(changed && changed.categoryId === catId ? changed.defs : givenDefs ?? (fetched && (!categoryId || fetched.categoryId === categoryId) ? fetched.defs : [])),
    [changed, catId, givenDefs, fetched, categoryId],
  );

  // Load eBay's aspect list when the analysis didn't include it (older drafts).
  useEffect(() => {
    if (givenDefs && givenDefs.length) return;
    if (!categoryId && !title) return;
    let cancelled = false;
    const q = categoryId ? `categoryId=${encodeURIComponent(categoryId)}` : `title=${encodeURIComponent(title ?? "")}&itemType=${encodeURIComponent(itemType ?? "")}`;
    apiFetch<{ categoryId: string | null; categoryPath?: string | null; categoryNeedsReview?: boolean; defs: AspectDef[] }>(`/api/ebay/aspects?${q}`)
      .then((r) => {
        if (cancelled) return;
        setFetched((prev) => ({
          categoryId: r.categoryId,
          categoryPath: r.categoryPath ?? (prev?.categoryId === r.categoryId ? prev?.categoryPath : null),
          categoryNeedsReview: r.categoryNeedsReview,
          defs: r.defs ?? [],
        }));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [givenDefs, categoryId, title, itemType]);

  // Re-validate saved/older values once per category as soon as eBay's list
  // is loaded: drafts and batch items analyzed before the current rules get
  // cleaned (invalid values, extra aspects, two values in a single-value
  // aspect, a league as Brand, features that don't fit). The cleaned values
  // go through onChange, so the next autosave stores them. It runs once per
  // category, so the seller's own later edits aren't overridden.
  const normalizedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!defs.length || disabled) return;
    const key = `${catId ?? ""}:${defs.length}`;
    if (normalizedFor.current === key) return;
    normalizedFor.current = key;
    const n = normalizeSpecifics(aspects, defs, { title, itemType, photoFeatures: [] });
    if (n.changed) onChange(n.aspects, { categoryId: catId, missingRequired: n.missingRequired });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per category/defs load, by design
  }, [defs, catId, disabled]);

  const missing = missingRequiredAspects(aspects, defs);
  const missingKey = missing.join("|");
  // Off-list values for list-only aspects (Size "9"): eBay rejects them, so
  // they block listing just like a missing required aspect.
  const invalid = aspectProblems(aspects, defs).filter((p) => p.kind === "invalid").map((p) => ({ name: p.aspect, value: p.value ?? "" }));
  const invalidKey = invalid.map((x) => `${x.name}=${x.value}`).join("|");
  const metaRef = useRef(onMeta);
  useEffect(() => { metaRef.current = onMeta; }, [onMeta]);
  useEffect(() => {
    metaRef.current?.({
      categoryId: catId,
      missingRequired: missingKey ? missingKey.split("|") : [],
      invalid: invalidKey ? invalidKey.split("|").map((kv) => { const i = kv.indexOf("="); return { name: kv.slice(0, i), value: kv.slice(i + 1) }; }) : [],
    });
  }, [catId, missingKey, invalidKey]);
  const hl = new Set((highlight ?? []).map((h) => h.toLowerCase()));
  const hlKey = [...hl].join("|");
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Jump to the field eBay complained about (opening the panel if closed).
  useEffect(() => {
    if (!hlKey) return;
    const t0 = window.setTimeout(() => setOpen(true), 0);
    const t = window.setTimeout(() => {
      const el = rootRef.current?.querySelector<HTMLElement>("[data-aspect-highlight='true'] button");
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      el?.focus({ preventScroll: true });
    }, 60);
    return () => { window.clearTimeout(t0); window.clearTimeout(t); };
  }, [hlKey]);
  const filled = Object.values(aspects).filter((v) => v?.length).length;
  const valueOf = (name: string) => {
    const key = Object.keys(aspects).find((k) => k.toLowerCase() === name.toLowerCase());
    return key ? aspects[key] ?? [] : [];
  };

  const required = defs.filter((d) => d.required);
  // An aspect eBay flagged but this list wouldn't otherwise show (empty, not required).
  const flaggedExtra = defs.filter((d) => hl.has(d.name.toLowerCase()) && !d.required && !valueOf(d.name).length);
  // Only this category's aspects are shown (and sent to eBay). Older saved
  // extras without eBay metadata appear only while the list isn't loaded.
  const filledOther = [
    ...defs.filter((d) => !d.required && valueOf(d.name).length),
    ...(defs.length === 0
      ? Object.keys(aspects).filter((k) => aspects[k]?.length).map((k): AspectDef => ({ name: k, required: false, recommended: false, mode: "FREE_TEXT", multi: true, values: [] }))
      : []),
  ];
  const emptyRecommended = defs.filter((d) => !d.required && d.recommended && !valueOf(d.name).length);

  function set(def: AspectDef, list: string[]) {
    // Snap to eBay's exact spelling where there is one ("usa" → "United States").
    const parts = (def.multi ? list : list.slice(0, 1)).map((s) => s.trim())
      .map((p) => (p && def.values.length ? matchAllowedValue(p, def) ?? p : p));
    const next: Aspects = { ...aspects };
    for (const k of Object.keys(next)) if (k.toLowerCase() === def.name.toLowerCase()) delete next[k];
    const vals = parts.filter(Boolean);
    next[def.name] = vals; // empty list = "cleared by the seller"
    onChange(next, { categoryId: catId, missingRequired: missingRequiredAspects(next, defs) });
  }

  const row = (d: AspectDef) => {
    const vals = valueOf(d.name);
    const isMissing = d.required && vals.length === 0;
    // Only a real problem: a selection-only aspect, full list known, and no
    // allowed value matches (casing/synonyms like "USA" are fine).
    const rejected = vals.filter((v) => isRejectedValue(v, d));
    const offList = rejected.length > 0;
    const flagged = hl.has(d.name.toLowerCase());
    const labelId = `asp-label-${d.name.replace(/[^a-z0-9]/gi, "-").toLowerCase()}`;
    return (
      <div key={d.name} className="flex flex-col gap-1 min-w-0" role="group" aria-labelledby={labelId}
        data-aspect-highlight={flagged || offList ? "true" : undefined}
        style={flagged ? { outline: "2px solid var(--danger)", outlineOffset: 3, borderRadius: 10 } : undefined}>
        <span id={labelId} className="text-[11px] font-semibold flex items-center gap-1" style={{ color: isMissing || flagged || offList ? "var(--danger)" : "var(--text-secondary)" }}>
          {d.name}
          {d.required && <span className="text-[9px] px-1 rounded" style={{ background: isMissing ? "var(--warning-bg)" : "var(--glass)", border: `1px solid ${isMissing ? "var(--warning-border)" : "var(--glass-line)"}` }}>Required</span>}
        </span>
        <AspectPicker def={d} values={vals} categoryId={catId} missing={isMissing || flagged || offList} disabled={disabled} onChange={(next) => set(d, next)} />
        {flagged && !offList && !isMissing && (
          <span className="text-[10px]" style={{ color: "var(--danger)" }} role="alert">eBay flagged this field — check the value.</span>
        )}
        {flagged && isMissing && d.values.length > 0 && (
          <span className="text-[10px] flex flex-wrap items-center gap-1" style={{ color: "var(--danger)" }} role="alert">
            Needs your pick:
            {d.values.slice(0, 6).map((sug) => (
              <button key={sug} type="button" disabled={disabled} onClick={(e) => { e.preventDefault(); set(d, [sug]); }}
                className="px-1.5 py-0.5 rounded-md font-semibold" style={{ background: "var(--accent-tint)", color: "var(--accent)" }}>
                {sug}
              </button>
            ))}
            <span>or open the list.</span>
          </span>
        )}
        {offList && (
          <span className="text-[10px] flex flex-wrap items-center gap-1" style={{ color: "var(--danger)" }} role="alert">
            eBay doesn&apos;t accept &ldquo;{rejected[0]}&rdquo; here.
            {suggestAllowedValues(rejected[0], d).map((sug) => (
              <button key={sug} type="button" disabled={disabled}
                onClick={(e) => { e.preventDefault(); set(d, d.multi ? vals.map((v) => (v === rejected[0] ? sug : v)) : [sug]); }}
                className="px-1.5 py-0.5 rounded-md font-semibold" style={{ background: "var(--accent-tint)", color: "var(--accent)" }}>
                Use &ldquo;{sug}&rdquo;
              </button>
            ))}
            {suggestAllowedValues(rejected[0], d).length === 0 && <span>Pick one from the list.</span>}
          </span>
        )}
      </div>
    );
  };

  const shownPath = categoryPath ?? fetched?.categoryPath ?? null;
  const needsReview = categoryNeedsReview ?? fetched?.categoryNeedsReview ?? false;

  async function searchCategories(q: string) {
    setPickError(null);
    setBusy(true);
    try {
      const r = await apiFetch<{ categories?: Array<{ id: string; path: string; fits: boolean }> }>(
        `/api/ebay/categories?q=${encodeURIComponent(q)}&itemType=${encodeURIComponent(itemType ?? "")}&title=${encodeURIComponent(title ?? "")}`,
      );
      setOptions(r.categories ?? []);
    } catch (e) {
      setPickError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function chooseCategory(c: { id: string; path: string }) {
    setBusy(true);
    setPickError(null);
    try {
      const r = await apiFetch<{ itemSpecifics: Aspects; missingRequired: string[]; aspectDefs: AspectDef[]; issues: string[] }>("/api/ebay/specifics-refill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId: c.id, categoryPath: c.path, title, itemType, aspects }),
      });
      setFetched({ categoryId: c.id, categoryPath: c.path, categoryNeedsReview: false, defs: r.aspectDefs ?? [] });
      setChanged({ categoryId: c.id, defs: r.aspectDefs ?? [] });
      onCategoryChange?.({ categoryId: c.id, categoryPath: c.path, aspects: r.itemSpecifics ?? {}, missingRequired: r.missingRequired ?? [], defs: r.aspectDefs ?? [], issues: r.issues ?? [] });
      setPicking(false);
      setOptions(null);
    } catch (e) {
      setPickError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const categoryBlock = (
    <div className="mb-3 rounded-xl p-2.5" style={{ background: needsReview ? "var(--warning-bg)" : "var(--glass)", border: `1px solid ${needsReview ? "var(--warning-border)" : "var(--glass-line)"}` }}>
      <div className="flex items-start gap-2">
        <FolderTree className="w-4 h-4 flex-none mt-0.5" style={{ color: needsReview ? "var(--danger)" : "var(--accent)" }} />
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold" style={{ color: "var(--text-tertiary)" }}>eBay category</p>
          <p className="text-sm font-medium break-words">{shownPath ?? (catId ? `Category #${catId}` : "Not chosen yet")}</p>
          {needsReview && <p className="text-[11px] mt-0.5" style={{ color: "var(--danger)" }}>Please confirm — no suggested category clearly fit this item.</p>}
        </div>
        {!disabled && onCategoryChange && (
          <button type="button" className="btn text-xs px-2.5 py-1.5 flex-none" onClick={() => { setPicking((v) => !v); if (!query) setQuery([title].filter(Boolean).join(" ").slice(0, 60)); }}>
            Change category
          </button>
        )}
      </div>
      {picking && (
        <div className="mt-2">
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void searchCategories(query); }}>
            <input className="input text-sm flex-1" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. Dallas Cowboys football jersey" aria-label="Search eBay categories" />
            <button type="submit" className="btn text-xs px-3" disabled={busy || query.trim().length < 2} aria-label="Search">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            </button>
          </form>
          {pickError && <p className="text-xs mt-1" style={{ color: "var(--danger)" }}>{pickError}</p>}
          {options && (
            <div className="mt-2 flex flex-col gap-1 max-h-60 overflow-y-auto">
              {options.length === 0 && <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>No categories found — try other words.</p>}
              {options.map((o) => (
                <button key={o.id} type="button" disabled={busy} onClick={() => void chooseCategory(o)}
                  className="text-left text-xs rounded-lg px-2.5 py-2 hover:bg-[var(--accent-tint)]"
                  style={{ border: "1px solid var(--glass-line)", opacity: o.fits ? 1 : 0.6 }}>
                  {o.path}{!o.fits && <span className="ml-1" style={{ color: "var(--danger)" }}>· doesn&apos;t look like this item</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {issues && issues.length > 0 && (
        <ul className="mt-2 text-[11px] list-disc pl-4" style={{ color: "var(--danger)" }}>
          {issues.map((i) => <li key={i}>{i}</li>)}
        </ul>
      )}
    </div>
  );

  if (!defs.length && filled === 0 && !shownPath && !catId) return null;

  return (
    <div className="card p-3 mb-4" ref={rootRef}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 text-left" aria-expanded={open}>
        <ListChecks className="w-4 h-4" style={{ color: "var(--accent)" }} />
        <span className="text-sm font-semibold flex-1">Item specifics</span>
        <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>{filled} filled</span>
        {missing.length > 0 && (
          <span className="text-[11px] font-semibold flex items-center gap-1" style={{ color: "var(--danger)" }}>
            <AlertTriangle className="w-3 h-3" /> {missing.length} required missing
          </span>
        )}
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>
      {open && (
        <div className="mt-3">
          {categoryBlock}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2.5">
            {required.map(row)}
            {flaggedExtra.map(row)}
            {filledOther.map(row)}
            {showMore && emptyRecommended.map(row)}
          </div>
          {emptyRecommended.length > 0 && (
            <button type="button" onClick={() => setShowMore((v) => !v)} className="mt-2 text-xs font-medium" style={{ color: "var(--accent)" }}>
              {showMore ? "Show fewer" : `Show ${emptyRecommended.length} more recommended by eBay`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
