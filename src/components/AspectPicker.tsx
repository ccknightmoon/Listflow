"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Loader2, Search, X } from "lucide-react";
import Sheet from "@/components/Sheet";
import { apiFetch } from "@/lib/api";
import { offerCustom, rankOptions, toggleValue, windowRange } from "@/lib/combobox";
import { optionsFor } from "@/lib/aspect-fallbacks";
import { effectiveMode } from "@/lib/size-mapping";
import type { AspectDef } from "@/lib/item-specifics";

const ROW = 44;
const VIEW = 352;

/**
 * eBay-style dropdown for one item specific. Opens a searchable list
 * (bottom sheet on phones, centred dialog on computers — the shared Sheet,
 * so it sits on the sheet layer above the nav/tray). Single-value aspects
 * pick and close; multi-value aspects toggle chips. Free-text aspects can
 * also "Use 'what I typed'"; selection-only aspects can't. Long lists are
 * virtualized, and lists the browser only has part of are searched on the
 * server as you type.
 */
export default function AspectPicker({
  def,
  values,
  onChange,
  categoryId,
  missing,
  disabled,
}: {
  def: AspectDef;
  values: string[];
  onChange: (next: string[]) => void;
  categoryId?: string | null;
  missing?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [remote, setRemote] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<string[]>(values);
  const listRef = useRef<HTMLDivElement | null>(null);
  const freeText = effectiveMode(def) !== "SELECTION_ONLY";

  // Full-list search on the server when the browser copy is partial.
  useEffect(() => {
    if (!open || !def.valuesTruncated || !categoryId || query.trim().length < 2) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      setLoading(true);
      apiFetch<{ values: string[] }>(`/api/ebay/aspect-values?categoryId=${encodeURIComponent(categoryId)}&aspect=${encodeURIComponent(def.name)}&q=${encodeURIComponent(query)}`)
        .then((r) => { if (!cancelled) setRemote(r.values ?? []); })
        .catch(() => {})
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [open, query, def.valuesTruncated, def.name, categoryId]);

  const useRemote = !!def.valuesTruncated && !!categoryId && query.trim().length >= 2;
  // eBay's list for this aspect; curated suggestions only for free-text
  // aspects eBay lists nothing for (also covers older saved analyses).
  // Never an empty list on open: eBay's values, else curated suggestions
  // (free text only), plus whatever is currently selected.
  const base = useMemo(() => {
    const list = optionsFor(def).values;
    const extra = values.filter((v) => !list.some((x) => x.toLowerCase() === v.toLowerCase()));
    return [...(freeText ? extra : []), ...list];
  }, [def, values, freeText]);
  const options = useMemo(() => (useRemote && remote) ? remote : rankOptions(base, query, 5000), [useRemote, remote, base, query]);
  const custom = offerCustom(query, options, freeText);
  const rows: Array<{ kind: "custom"; value: string } | { kind: "opt"; value: string }> = useMemo(
    () => [...(custom ? [{ kind: "custom" as const, value: query.trim() }] : []), ...options.map((v) => ({ kind: "opt" as const, value: v }))],
    [custom, options, query],
  );
  const { start, end } = windowRange(scrollTop, ROW, VIEW, rows.length);
  const selected = def.multi ? draft : values;
  const isSel = (v: string) => selected.some((x) => x.toLowerCase() === v.toLowerCase());

  function openPicker() {
    if (disabled) return;
    setDraft(values);
    setQuery("");
    setActive(0);
    setScrollTop(0);
    setOpen(true);
  }
  function pick(v: string) {
    if (def.multi) setDraft((d) => toggleValue(d, v));
    else { onChange([v]); setOpen(false); }
  }
  function done() {
    if (def.multi) onChange(draft);
    setOpen(false);
  }
  function scrollTo(i: number) {
    const el = listRef.current;
    if (!el) return;
    if (i * ROW < el.scrollTop) el.scrollTop = i * ROW;
    else if ((i + 1) * ROW > el.scrollTop + VIEW) el.scrollTop = (i + 1) * ROW - VIEW;
  }
  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); const i = Math.min(rows.length - 1, active + 1); setActive(i); scrollTo(i); }
    else if (e.key === "ArrowUp") { e.preventDefault(); const i = Math.max(0, active - 1); setActive(i); scrollTo(i); }
    else if (e.key === "Enter") { e.preventDefault(); if (rows[active]) pick(rows[active].value); else if (def.multi) done(); }
  }

  const listId = `aspect-list-${def.name.replace(/[^a-z0-9]/gi, "-").toLowerCase()}`;
  return (
    <>
      <button
        type="button"
        onClick={openPicker}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-label={`${def.name}: ${values.length ? values.join(", ") : "not set"}`}
        className="input text-sm py-1.5 flex items-center gap-1 text-left min-h-[38px]"
        style={missing ? { borderColor: "var(--danger)" } : undefined}
      >
        <span className="flex-1 min-w-0 flex flex-wrap gap-1">
          {values.length === 0 ? (
            <span style={{ color: missing ? "var(--danger)" : "var(--text-tertiary)" }}>{missing ? "Needed to publish" : "Choose…"}</span>
          ) : def.multi ? (
            values.map((v) => <span key={v} className="px-1.5 rounded-md text-xs" style={{ background: "var(--accent-tint)", color: "var(--accent)" }}>{v}</span>)
          ) : (
            <span className="truncate">{values[0]}</span>
          )}
        </span>
        <ChevronDown className="w-4 h-4 flex-none" style={{ color: "var(--text-tertiary)" }} />
      </button>

      <Sheet
        open={open}
        onClose={() => (def.multi ? done() : setOpen(false))}
        title={def.name}
        footer={
          <div className="flex gap-2">
            <button type="button" className="btn flex-1 min-h-[44px]" onClick={() => { onChange([]); setOpen(false); }}>Clear</button>
            {def.multi && <button type="button" className="btn btn-primary flex-1 min-h-[44px]" onClick={done}>Done{draft.length ? ` (${draft.length})` : ""}</button>}
          </div>
        }
      >
        {def.multi && draft.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {draft.map((v) => (
              <button key={v} type="button" onClick={() => setDraft((d) => toggleValue(d, v))} className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium" style={{ background: "var(--accent-tint)", color: "var(--accent)" }} aria-label={`Remove ${v}`}>
                {v} <X className="w-3 h-3" />
              </button>
            ))}
          </div>
        )}
        <div className="relative mb-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: "var(--text-tertiary)" }} />
          <input
            className="input w-full"
            style={{ paddingLeft: 34 }}
            placeholder={freeText ? "Search or type your own" : "Search eBay's values"}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); setScrollTop(0); if (listRef.current) listRef.current.scrollTop = 0; }}
            onKeyDown={onKey}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={rows[active] ? `${listId}-${active}` : undefined}
            aria-label={`Search ${def.name}`}
          />
          {loading && useRemote && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin" style={{ color: "var(--text-tertiary)" }} />}
        </div>
        {!freeText && <p className="text-[11px] mb-1.5" style={{ color: "var(--text-tertiary)" }}>eBay only accepts values from this list.</p>}
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-multiselectable={def.multi || undefined}
          aria-label={def.name}
          className="overflow-y-auto overscroll-contain rounded-xl"
          style={{ height: Math.min(VIEW, Math.max(ROW, rows.length * ROW)), border: "1px solid var(--glass-line)" }}
          onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
        >
          {rows.length === 0 ? (
            <p className="text-xs p-3" style={{ color: "var(--text-tertiary)" }}>
              {loading && useRemote ? "Searching…" : query.trim() ? "No matching values." : freeText ? "eBay lists no values for this — type your own above." : "eBay lists no values for this aspect."}
            </p>
          ) : (
            <div style={{ height: rows.length * ROW, position: "relative" }}>
              {rows.slice(start, end).map((r, k) => {
                const i = start + k;
                const sel = r.kind === "opt" && isSel(r.value);
                return (
                  <button
                    key={`${r.kind}:${r.value}`}
                    id={`${listId}-${i}`}
                    type="button"
                    role="option"
                    aria-selected={sel}
                    tabIndex={-1}
                    onClick={() => pick(r.value)}
                    onMouseEnter={() => setActive(i)}
                    className="absolute left-0 right-0 flex items-center gap-2 px-3 text-sm text-left"
                    style={{ top: i * ROW, height: ROW, background: i === active ? "var(--accent-tint)" : undefined, borderBottom: "1px solid var(--border)" }}
                  >
                    <span className="w-4 flex-none">{sel && <Check className="w-4 h-4" style={{ color: "var(--accent)" }} />}</span>
                    <span className="flex-1 truncate">{r.kind === "custom" ? <>Use &ldquo;{r.value}&rdquo;</> : r.value}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </Sheet>
    </>
  );
}
