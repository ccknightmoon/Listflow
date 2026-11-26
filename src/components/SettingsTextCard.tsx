"use client";

// Small building blocks for the text settings cards (Store intro, Shipping &
// returns notes): an auto-growing textarea, a Save row with a clear
// "Saved ✓" state, and a compact mock of where text lands in an eBay
// listing's Description.

import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";
import { Check, Loader2 } from "lucide-react";

/** Grows with its content so the whole text is always visible (no inner scroll). */
export function AutoGrowTextarea({ value, minRows = 3, dimmed, className = "", style, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string; minRows?: number; dimmed?: boolean }) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={minRows}
      value={value}
      className={`input w-full resize-none overflow-hidden leading-relaxed ${className}`}
      style={{ opacity: dimmed ? 0.5 : 1, transition: "opacity .2s", ...style }}
      {...rest}
    />
  );
}

/** Character count, shown only once the text is near the limit. */
export function nearLimitCount(length: number, max: number): string | null {
  return length >= Math.floor(max * 0.85) ? `${length}/${max}` : null;
}

export function SaveRow({ dirty, saving, saved, error, onSave, length, max }: {
  dirty: boolean; saving: boolean; saved: boolean; error: string | null; onSave: () => void; length?: number; max?: number;
}) {
  const count = length !== undefined && max ? nearLimitCount(length, max) : null;
  return (
    <div className="flex items-center gap-3 mt-2">
      {error && <p className="text-xs flex-1" style={{ color: "var(--danger)" }} role="alert">{error}</p>}
      {!error && <span className="flex-1 text-[11px]" style={{ color: length !== undefined && max && length > max ? "var(--danger)" : "var(--text-tertiary)" }}>{count ?? (dirty ? "Unsaved changes" : "")}</span>}
      <button
        type="button"
        onClick={onSave}
        disabled={saving || !dirty}
        className="btn btn-primary text-xs px-4 min-h-[36px]"
        style={!dirty && saved ? { background: "var(--success)", borderColor: "var(--success)", opacity: 1 } : undefined}
      >
        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : !dirty && saved ? <><Check className="w-3.5 h-3.5" /> Saved</> : "Save"}
      </button>
    </div>
  );
}

function Skeleton({ widths }: { widths: string[] }) {
  return (
    <div className="flex flex-col gap-1 mt-1">
      {widths.map((w, i) => <span key={i} className="block h-1.5 rounded-full" style={{ width: w, background: "currentColor", opacity: 0.25 }} />)}
    </div>
  );
}

/** Where the text lands: eBay · Description → intro (highlighted) → item details → shipping & returns. */
export function EbayDescriptionMock({ highlight, dimmed, onPreview }: { highlight: "intro" | "shipping"; dimmed?: boolean; onPreview?: () => void }) {
  const block = (key: "intro" | "details" | "shipping", label: string, widths: string[]) => {
    const on = key === highlight;
    return (
      <div
        key={key}
        className="rounded-md px-2.5 py-2"
        style={on
          ? { background: "color-mix(in srgb, var(--accent) 16%, transparent)", border: "1px solid var(--accent)", color: "var(--accent)" }
          : { background: "var(--glass)", border: "1px solid transparent", color: "var(--text-tertiary)" }}
        data-block={key}
      >
        <p className="text-[10px] font-semibold uppercase tracking-wide">{label}</p>
        <Skeleton widths={widths} />
      </div>
    );
  };
  return (
    <div className="mt-3 rounded-xl p-2.5" style={{ border: "1px solid var(--border)", opacity: dimmed ? 0.45 : 1, transition: "opacity .2s" }} aria-label="Where this appears in an eBay listing">
      <div className="flex items-center justify-between mb-2 px-0.5">
        <p className="text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>eBay · Description</p>
        {onPreview && (
          <button type="button" onClick={onPreview} className="text-[11px] underline" style={{ color: "var(--accent)" }}>
            Preview full description
          </button>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        {block("intro", "Your store intro", ["85%", "70%", "55%"])}
        {block("details", "Item details & measurements", ["90%", "60%"])}
        {block("shipping", "Shipping & returns", ["65%"])}
      </div>
    </div>
  );
}
