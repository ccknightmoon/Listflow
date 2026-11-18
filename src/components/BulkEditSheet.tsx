"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import Sheet from "@/components/Sheet";
import { ALL_CONDITIONS, previewBulkEdit, type BulkEdit, type BulkTarget, type PriceChange, type TitleChange } from "@/lib/bulk-edit";
import { formatMoney } from "@/lib/format";
import type { StoreCategoryLite } from "@/lib/store-category-match";

type PriceMode = PriceChange["mode"];
type TitleMode = TitleChange["mode"];

/**
 * Bulk edit sheet. `fields` limits what can be edited (Listings = price
 * only, since changing live titles/conditions on eBay is riskier).
 * The preview uses the same function the server applies, so what you see
 * is what gets saved.
 */
export default function BulkEditSheet({
  open,
  items,
  fields,
  onClose,
  onApply,
}: {
  open: boolean;
  items: BulkTarget[];
  fields: Array<"price" | "condition" | "category" | "title">;
  onClose: () => void;
  onApply: (edit: BulkEdit) => Promise<string | null>; // returns an error message or null
}) {
  const [priceMode, setPriceMode] = useState<PriceMode | "">("");
  const [priceValue, setPriceValue] = useState("");
  const [condition, setCondition] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [categories, setCategories] = useState<StoreCategoryLite[] | null>(null);
  const [titleMode, setTitleMode] = useState<TitleMode | "">("");
  const [titleText, setTitleText] = useState("");
  const [titleWith, setTitleWith] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !fields.includes("category") || categories) return;
    fetch("/api/ebay/store-categories")
      .then((r) => r.json())
      .then((d: { categories?: StoreCategoryLite[] }) => setCategories(d.categories ?? []))
      .catch(() => setCategories([]));
  }, [open, fields, categories]);

  const edit: BulkEdit = useMemo(() => {
    const e: BulkEdit = {};
    const v = parseFloat(priceValue);
    if (priceMode && Number.isFinite(v)) e.price = { mode: priceMode, value: v } as PriceChange;
    if (condition) e.condition = condition as BulkEdit["condition"];
    if (categoryId) {
      const c = categories?.find((x) => x.id === categoryId);
      e.storeCategory = categoryId === "__none" ? { id: null, name: null } : { id: categoryId, name: c?.path ?? c?.name ?? null };
    }
    if (titleMode && titleText.trim()) {
      e.title = titleMode === "replace" ? { mode: "replace", text: titleText, with: titleWith } : { mode: titleMode, text: titleText } as TitleChange;
    }
    return e;
  }, [priceMode, priceValue, condition, categoryId, categories, titleMode, titleText, titleWith]);

  const rows = useMemo(() => previewBulkEdit(items, edit), [items, edit]);
  const changing = rows.filter((r) => Object.keys(r.patch).length > 0).length;
  const hasEdit = Object.keys(edit).length > 0;

  async function apply() {
    setSaving(true);
    setError(null);
    const err = await onApply(edit);
    setSaving(false);
    if (err) setError(err);
    else onClose();
  }

  const label = "text-[11px] font-semibold uppercase tracking-wide mb-1.5 block";
  const seg = (active: boolean) => ({
    background: active ? "var(--accent-tint)" : "var(--glass)",
    border: `1px solid ${active ? "var(--accent)" : "var(--glass-line)"}`,
    color: active ? "var(--accent)" : "var(--text-secondary)",
  });

  // Enter in any field applies (same rules as the Apply button).
  const enterApplies = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (hasEdit && changing > 0 && !saving) void apply();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      desktop="drawer"
      title={`Edit ${items.length} item${items.length !== 1 ? "s" : ""}`}
      footer={
        <>
        {error && <p className="text-xs mb-2" style={{ color: "var(--danger)" }}>{error}</p>}
        <button type="button" className="btn btn-primary w-full min-h-[48px]" disabled={!hasEdit || changing === 0 || saving} onClick={apply}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {saving ? "Saving…" : `Apply to ${changing} item${changing !== 1 ? "s" : ""}`}
        </button>
        </>
      }
    >

        {fields.includes("price") && (
          <div className="mb-4">
            <span className={label} style={{ color: "var(--text-tertiary)" }}>Price</span>
            <div className="grid grid-cols-3 gap-1.5 mb-2">
              {([["set", "Set to $"], ["add", "+/− $"], ["percent", "+/− %"]] as const).map(([m, t]) => (
                <button key={m} type="button" className="rounded-xl text-xs font-semibold min-h-[40px]" style={seg(priceMode === m)} onClick={() => setPriceMode(priceMode === m ? "" : m)}>{t}</button>
              ))}
            </div>
            {priceMode && (
              <input onKeyDown={enterApplies}
                type="text"
                inputMode="decimal"
                enterKeyHint="done"
                autoFocus
                placeholder={priceMode === "set" ? "24.99" : priceMode === "add" ? "-2.00 or 5" : "-10 or 15"}
                value={priceValue}
                onChange={(e) => setPriceValue(e.target.value.replace(/[^0-9.\-]/g, ""))}
                className="input w-full"
                aria-label="Price change"
              />
            )}
          </div>
        )}

        {fields.includes("condition") && (
          <div className="mb-4">
            <span className={label} style={{ color: "var(--text-tertiary)" }}>Condition</span>
            <select className="input w-full" value={condition} onChange={(e) => setCondition(e.target.value)} aria-label="Condition">
              <option value="">Keep as is</option>
              {ALL_CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        )}

        {fields.includes("category") && (
          <div className="mb-4">
            <span className={label} style={{ color: "var(--text-tertiary)" }}>Store category</span>
            <select className="input w-full" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Store category" disabled={categories === null}>
              <option value="">{categories === null ? "Loading…" : "Keep as is"}</option>
              <option value="__none">— None —</option>
              {(categories ?? []).map((c) => <option key={c.id} value={c.id}>{c.path}</option>)}
            </select>
          </div>
        )}

        {fields.includes("title") && (
          <div className="mb-4">
            <span className={label} style={{ color: "var(--text-tertiary)" }}>Title words</span>
            <div className="grid grid-cols-4 gap-1.5 mb-2">
              {([["prepend", "Add start"], ["append", "Add end"], ["remove", "Remove"], ["replace", "Replace"]] as const).map(([m, t]) => (
                <button key={m} type="button" className="rounded-xl text-[11px] font-semibold min-h-[40px]" style={seg(titleMode === m)} onClick={() => setTitleMode(titleMode === m ? "" : m)}>{t}</button>
              ))}
            </div>
            {titleMode && (
              <div className="flex gap-2">
                <input onKeyDown={enterApplies} className="input flex-1" placeholder={titleMode === "replace" ? "Find" : "Word(s)"} value={titleText} onChange={(e) => setTitleText(e.target.value)} enterKeyHint="next" aria-label="Title words" />
                {titleMode === "replace" && <input onKeyDown={enterApplies} className="input flex-1" placeholder="Replace with" value={titleWith} onChange={(e) => setTitleWith(e.target.value)} enterKeyHint="done" aria-label="Replace with" />}
              </div>
            )}
          </div>
        )}

        {hasEdit && (
          <div className="rounded-2xl p-3 mb-3 text-xs" style={{ background: "var(--glass)" }}>
            <p className="font-semibold mb-1.5">Preview — {changing} of {items.length} will change</p>
            <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
              {rows.slice(0, 30).map((r) => (
                <div key={r.id}>
                  <p className="truncate" style={{ color: "var(--text-secondary)" }}>{r.after.title ?? r.before.title ?? "Untitled"}</p>
                  {r.patch.suggested_price !== undefined && (
                    <p className="tabular-nums" style={{ color: "var(--text-tertiary)" }}>
                      {r.before.price != null ? formatMoney(r.before.price) : "no price"} → <span style={{ color: "var(--text-primary)" }}>{formatMoney(r.after.price as number)}</span>
                    </p>
                  )}
                  {r.warnings.map((w) => <p key={w} style={{ color: "var(--danger)" }}>{w}</p>)}
                </div>
              ))}
            </div>
          </div>
        )}

    </Sheet>
  );
}
