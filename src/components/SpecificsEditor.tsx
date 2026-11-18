"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, ListChecks } from "lucide-react";
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
  title,
  itemType,
  disabled,
  onMeta,
}: {
  aspects: Aspects;
  onChange: (next: Aspects, meta: { categoryId: string | null; missingRequired: string[] }) => void;
  defs?: AspectDef[] | null;
  categoryId?: string | null;
  title?: string | null;
  itemType?: string | null;
  disabled?: boolean;
  /** Fires whenever the category or the list of missing required aspects changes. */
  onMeta?: (meta: { categoryId: string | null; missingRequired: string[] }) => void;
}) {
  const [fetched, setFetched] = useState<{ categoryId: string | null; defs: AspectDef[] } | null>(null);
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
    apiFetch<{ categoryId: string | null; defs: AspectDef[] }>(`/api/ebay/aspects?${q}`)
      .then((r) => { if (!cancelled) setFetched({ categoryId: r.categoryId, defs: r.defs ?? [] }); })
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

  if (!defs.length && filled === 0) return null;

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
