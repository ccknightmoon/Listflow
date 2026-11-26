"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, RotateCcw, Shirt, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { confirmAction } from "@/lib/confirm";
import { formatMoney } from "@/lib/format";
import { forgetDeleted } from "@/lib/deleted-drafts";

interface Item { id: string; title: string | null; thumbnail: string | null; price: number | null; deletedAt: string; purgeAfter: string }

export function daysLeft(purgeAfter: string, now = Date.now()): number {
  return Math.max(0, Math.ceil((Date.parse(purgeAfter) - now) / 86_400_000));
}

// "Recently deleted" at the bottom of Inventory → Draft. Hidden when the
// bin is empty or migration 037 isn't applied (deletes are permanent then).
export default function RecycleBinPanel({ refreshKey, onRestored, onAvailability }: { refreshKey: number; onRestored: (ids: string[]) => void; onAvailability?: (available: boolean) => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch<{ items?: Item[]; available?: boolean }>("/api/drafts/trash", { redirectOnUnauthorized: false })
      .then((r) => { setItems(r.available ? r.items ?? [] : []); onAvailability?.(!!r.available); })
      .catch(() => {});
  }, [onAvailability]);
  useEffect(() => { load(); }, [load, refreshKey]);

  async function restore(ids: string[]) {
    setBusy(ids.length === 1 ? ids[0] : "all");
    setError(null);
    try {
      const r = await apiFetch<{ restored?: string[]; skuCleared?: string[]; error?: string }>("/api/drafts/trash", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
      if (r.error) throw new Error(r.error);
      const back = r.restored ?? [];
      forgetDeleted(back);
      setItems((prev) => prev.filter((i) => !back.includes(i.id)));
      if (back.length) onRestored(back);
      if (r.skuCleared?.length) setError(`${r.skuCleared.length} restored without its SKU (another draft uses it now).`);
      else if (back.length < ids.length) setError("Some items couldn't be restored — try again.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function purge(ids: string[]) {
    if (!(await confirmAction({ title: ids.length === 1 ? "Delete for good?" : `Delete ${ids.length} for good?`, message: "Removes them and their photos from Listflow now. This can't be undone. Anything on eBay stays on eBay.", confirmLabel: "Delete for good", destructive: true }))) return;
    setBusy(ids.length === 1 ? ids[0] : "all");
    try {
      const r = await apiFetch<{ purged?: string[]; error?: string }>("/api/drafts/trash", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
      if (r.error) throw new Error(r.error);
      const gone = r.purged ?? [];
      setItems((prev) => prev.filter((i) => !gone.includes(i.id)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!items.length) return null;
  return (
    <section className="card p-3 mt-6" aria-label="Recently deleted">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 text-sm" aria-expanded={open}>
        <Trash2 className="w-4 h-4 text-[var(--text-tertiary)]" />
        <span className="flex-1 text-left font-medium">Recently deleted ({items.length})</span>
        <span className="text-xs text-[var(--text-tertiary)]">kept 7 days</span>
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="mt-3">
          {error && <p className="text-xs mb-2" style={{ color: "var(--danger)" }}>{error}</p>}
          <div className="flex gap-2 mb-3">
            <button type="button" className="btn text-xs" disabled={!!busy} onClick={() => restore(items.map((i) => i.id))}><RotateCcw className="w-3.5 h-3.5" /> Restore all</button>
            <button type="button" className="btn text-xs" disabled={!!busy} onClick={() => purge(items.map((i) => i.id))}>Empty bin</button>
          </div>
          <ul className="flex flex-col gap-2">
            {items.map((i) => (
              <li key={i.id} className="flex items-center gap-3">
                {i.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element -- draft photo
                  <img src={i.thumbnail} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0 opacity-70" />
                ) : (
                  <div className="w-10 h-10 rounded-lg shrink-0 flex items-center justify-center" style={{ background: "var(--glass)" }}><Shirt className="w-4 h-4 text-[var(--text-tertiary)]" /></div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{i.title || "Untitled draft"}</p>
                  <p className="text-xs text-[var(--text-tertiary)]">
                    {i.price != null ? `${formatMoney(i.price)} · ` : ""}
                    {daysLeft(i.purgeAfter) === 0 ? "Deleted for good today" : `Deleted for good in ${daysLeft(i.purgeAfter)} day${daysLeft(i.purgeAfter) === 1 ? "" : "s"}`}
                  </p>
                </div>
                <button type="button" className="btn text-xs" disabled={!!busy} onClick={() => restore([i.id])}>{busy === i.id ? "…" : "Restore"}</button>
                <button type="button" aria-label="Delete for good" className="btn text-xs" disabled={!!busy} onClick={() => purge([i.id])}><Trash2 className="w-3.5 h-3.5" /></button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
