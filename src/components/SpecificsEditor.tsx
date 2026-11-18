"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, ListChecks, FolderTree, Loader2, Search } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { matchAllowedValue, missingRequiredAspects, type AspectDef, type Aspects } from "@/lib/item-specifics";

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
  /** Fires whenever the category or the list of missing required aspects changes. */
  onMeta?: (meta: { categoryId: string | null; missingRequired: string[] }) => void;
}) {
  const [fetched, setFetched] = useState<{ categoryId: string | null; categoryPath?: string | null; categoryNeedsReview?: boolean; defs: AspectDef[] } | null>(null);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<Array<{ id: string; path: string; fits: boolean }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);
  const [open, setOpen] = useState(true);
  const defs = useMemo(() => givenDefs ?? fetched?.defs ?? [], [givenDefs, fetched]);
  const catId = categoryId ?? fetched?.categoryId ?? null;

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

  const missing = missingRequiredAspects(aspects, defs);
  const missingKey = missing.join("|");
  const metaRef = useRef(onMeta);
  useEffect(() => { metaRef.current = onMeta; }, [onMeta]);
  useEffect(() => {
    metaRef.current?.({ categoryId: catId, missingRequired: missingKey ? missingKey.split("|") : [] });
  }, [catId, missingKey]);
  const filled = Object.values(aspects).filter((v) => v?.length).length;
  const byLower = new Map(defs.map((d) => [d.name.toLowerCase(), d]));
  const valueOf = (name: string) => {
    const key = Object.keys(aspects).find((k) => k.toLowerCase() === name.toLowerCase());
    return key ? aspects[key] ?? [] : [];
  };

  const required = defs.filter((d) => d.required);
  const filledOther = [
    ...defs.filter((d) => !d.required && valueOf(d.name).length),
    ...Object.keys(aspects).filter((k) => !byLower.has(k.toLowerCase()) && aspects[k]?.length).map((k): AspectDef => ({ name: k, required: false, recommended: false, mode: "FREE_TEXT", multi: true, values: [] })),
  ];
  const emptyRecommended = defs.filter((d) => !d.required && d.recommended && !valueOf(d.name).length);

  function set(def: AspectDef, raw: string) {
    const parts = def.multi ? raw.split(",").map((s) => s.trim()) : [raw.trim()];
    const next: Aspects = { ...aspects };
    for (const k of Object.keys(next)) if (k.toLowerCase() === def.name.toLowerCase()) delete next[k];
    const vals = parts.filter(Boolean);
    next[def.name] = vals; // empty list = "cleared by the seller"
    onChange(next, { categoryId: catId, missingRequired: missingRequiredAspects(next, defs) });
  }

  const row = (d: AspectDef) => {
    const vals = valueOf(d.name);
    const text = vals.join(", ");
    const isMissing = d.required && vals.length === 0;
    const offList = d.mode === "SELECTION_ONLY" && d.values.length > 0 && vals.some((v) => matchAllowedValue(v, d) === null);
    const listId = d.values.length ? `asp-${d.name.replace(/[^a-z0-9]/gi, "-").toLowerCase()}` : undefined;
    return (
      <label key={d.name} className="flex flex-col gap-1 min-w-0">
        <span className="text-[11px] font-semibold flex items-center gap-1" style={{ color: isMissing ? "var(--danger)" : "var(--text-secondary)" }}>
          {d.name}
          {d.required && <span className="text-[9px] px-1 rounded" style={{ background: isMissing ? "var(--warning-bg)" : "var(--glass)", border: `1px solid ${isMissing ? "var(--warning-border)" : "var(--glass-line)"}` }}>Required</span>}
        </span>
        <input
          className="input text-sm py-1.5"
          style={isMissing ? { borderColor: "var(--danger)" } : undefined}
          defaultValue={text}
          key={`${d.name}:${text}`}
          list={listId}
          disabled={disabled}
          placeholder={isMissing ? "Needed to publish" : d.multi ? "Values, comma-separated" : ""}
          onBlur={(e) => { if (e.target.value.trim() !== text) set(d, e.target.value); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
          aria-invalid={isMissing || offList || undefined}
        />
        {listId && (
          <datalist id={listId}>
            {d.values.map((v) => <option key={v} value={v} />)}
          </datalist>
        )}
        {offList && <span className="text-[10px]" style={{ color: "var(--danger)" }}>Pick one of eBay&apos;s values for this.</span>}
      </label>
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
    <div className="card p-3 mb-4">
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
