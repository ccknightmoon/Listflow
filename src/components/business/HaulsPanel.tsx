"use client";

// Hauls (sourcing trips) with cost split + profit per haul and per item.
// Data: GET /api/hauls (hauls, their items, candidates) + the Sales feed the
// Sales page already uses (GET /api/ebay/sales/analytics) for what sold.
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Plus, Scissors, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { confirmAction } from "@/lib/confirm";
import { formatMoney } from "@/lib/format";
import { haulSummary, itemProfit, type Haul, type HaulDraft, type HaulSale, type SplitMode } from "@/lib/hauls";
import { chooseFee, type AnalyticsSale } from "@/lib/sales-analytics";
import { EBAY_STANDARD_FEE_PERCENT } from "@/lib/ebay-fees";

type Item = HaulDraft & { thumbnail?: string | null; createdAt?: string };
interface HaulsResponse { available: boolean; error?: string; hauls?: Haul[]; drafts?: Item[]; candidates?: Item[] }
interface SalesResponse { sales?: AnalyticsSale[]; feePercent?: number; error?: string; feedStart?: string }

const today = () => new Date().toISOString().slice(0, 10);
const pct = (n: number) => `${Math.round(n * 100)}%`;

export function salesToHaulSales(sales: AnalyticsSale[] | undefined, feePercent: number): HaulSale[] {
  return (sales ?? []).map((s) => ({ listingId: s.listingId, itemTotal: s.itemTotal, fee: chooseFee(s, feePercent).fee }));
}

export default function HaulsPanel() {
  const [data, setData] = useState<HaulsResponse | null>(null);
  const [sales, setSales] = useState<HaulSale[]>([]);
  const [salesNote, setSalesNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [form, setForm] = useState({ name: "", source: "", boughtOn: today(), totalCost: "", splitMode: "even" as SplitMode });
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await apiFetch<HaulsResponse>("/api/hauls"));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    apiFetch<HaulsResponse>("/api/hauls").then(setData, (e: Error) => setError(e.message));
    apiFetch<SalesResponse>("/api/ebay/sales/analytics")
      .then((r) => {
        if (r.error) { setSalesNote("Sales couldn't be loaded, so profit shows $0 sold for now."); return; }
        setSales(salesToHaulSales(r.sales, r.feePercent ?? EBAY_STANDARD_FEE_PERCENT));
        if (r.feedStart) setSalesNote(`Profit counts sales since ${new Date(r.feedStart).toLocaleDateString()} (what eBay's sales history covers here).`);
      })
      .catch(() => setSalesNote("Sales couldn't be loaded, so profit shows $0 sold for now."));
  }, []);

  const summaries = useMemo(() => {
    const m = new Map<string, ReturnType<typeof haulSummary>>();
    for (const h of data?.hauls ?? []) m.set(h.id, haulSummary(h, data?.drafts ?? [], sales));
    return m;
  }, [data, sales]);

  async function createHaul() {
    const totalCost = Number(form.totalCost || 0);
    setBusy(true);
    try {
      await apiFetch("/api/hauls", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, totalCost, source: form.source || null }) });
      setForm({ name: "", source: "", boughtOn: today(), totalCost: "", splitMode: "even" });
      setShowForm(false);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(true);
    try {
      const r = await apiFetch<{ costsWritten?: number; skippedManual?: number }>(`/api/hauls/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      await load();
      return r;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function splitCost(h: Haul) {
    const items = (data?.drafts ?? []).filter((d) => d.haulId === h.id);
    if (!items.length) { setError("Add items to this haul first."); return; }
    const withCost = items.filter((d) => d.costBasis != null).length;
    let overwrite = false;
    if (withCost > 0) {
      overwrite = await confirmAction({
        title: `${withCost} of ${items.length} items already have a cost`,
        message: "Replace them all with an even re-split of the haul total? Choose Keep to fill only the items without a cost (with what's left of the total).",
        confirmLabel: "Replace all",
        cancelLabel: "Keep existing",
      });
    }
    const r = await patch(h.id, { applyCost: true, overwrite });
    if (r) setError(null);
  }

  async function removeHaul(h: Haul) {
    if (!(await confirmAction({ title: `Delete haul “${h.name}”?`, message: "Items stay, with the cost they already have; they just won't be grouped under this haul.", confirmLabel: "Delete", destructive: true }))) return;
    setBusy(true);
    try {
      await apiFetch(`/api/hauls/${h.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <div className="card p-6 flex items-center gap-2 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Loading hauls…</div>;
  if (!data.available) return <div className="card p-6 text-sm" data-testid="hauls-pending">{data.error ?? "Hauls need a one-time database update."}</div>;

  const candidates = data.candidates ?? [];
  const byDay = new Map<string, Item[]>();
  for (const c of candidates) {
    const day = (c.createdAt ?? "").slice(0, 10) || "unknown";
    byDay.set(day, [...(byDay.get(day) ?? []), c]);
  }

  return (
    <section className="flex flex-col gap-3" data-testid="hauls-panel">
      {error && <p className="text-xs" role="alert" style={{ color: "var(--danger)" }}>{error}</p>}
      <div className="flex items-center justify-between">
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>Log what each trip cost; Listflow splits it across the items and shows real profit.</p>
        <button type="button" className="btn text-xs py-1.5 px-2.5" onClick={() => setShowForm((v) => !v)}><Plus className="w-3.5 h-3.5" /> New haul</button>
      </div>

      {showForm && (
        <div className="card p-3 grid grid-cols-2 gap-2">
          <label className="col-span-2 text-xs">Name<input className="input w-full" placeholder="Rag house, Nov 26" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className="text-xs">Where<input className="input w-full" placeholder="Rag house X" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} /></label>
          <label className="text-xs">Date<input className="input w-full" type="date" value={form.boughtOn} onChange={(e) => setForm({ ...form, boughtOn: e.target.value })} /></label>
          <label className="text-xs">Total paid ($)<input className="input w-full" inputMode="decimal" placeholder="120" value={form.totalCost} onChange={(e) => setForm({ ...form, totalCost: e.target.value.replace(/[^0-9.]/g, "") })} /></label>
          <label className="text-xs">Split cost<select className="input w-full" value={form.splitMode} onChange={(e) => setForm({ ...form, splitMode: e.target.value as SplitMode })}><option value="even">Evenly</option><option value="price">By list price</option></select></label>
          <button type="button" className="btn btn-primary col-span-2 text-sm" disabled={busy || !form.name.trim()} onClick={() => void createHaul()}>Save haul</button>
        </div>
      )}

      {salesNote && <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>{salesNote}</p>}
      {(data.hauls ?? []).length === 0 && <div className="card p-6 text-sm text-center">No hauls yet. Add your last trip to see profit per haul.</div>}

      {(data.hauls ?? []).map((h) => {
        const s = summaries.get(h.id)!;
        const items = (data.drafts ?? []).filter((d) => d.haulId === h.id);
        const isOpen = open === h.id;
        return (
          <div key={h.id} className="card p-3" data-testid="haul-card">
            <button type="button" className="w-full flex items-start gap-3 text-left" onClick={() => setOpen(isOpen ? null : h.id)} aria-expanded={isOpen}>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{h.name}</p>
                <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>{[h.source, h.boughtOn].filter(Boolean).join(" · ")} · {s.items} item{s.items === 1 ? "" : "s"} · {pct(s.sellThrough)} sold</p>
                <p className="text-xs mt-1">
                  {formatMoney(s.costIn)} in → {formatMoney(s.netOut)} out so far · <strong style={{ color: s.profit >= 0 ? "var(--success)" : "var(--danger)" }}>{formatMoney(s.profit)} profit</strong>
                  {s.roi != null && <span style={{ color: "var(--text-tertiary)" }}> · {s.roi.toFixed(1)}× return</span>}
                </p>
              </div>
              {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            {isOpen && (
              <div className="mt-3 flex flex-col gap-2">
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn text-xs py-1.5 px-2.5" disabled={busy} onClick={() => { setAdding(adding === h.id ? null : h.id); setPicked(new Set()); }}><Plus className="w-3.5 h-3.5" /> Add items</button>
                  <button type="button" className="btn text-xs py-1.5 px-2.5" disabled={busy || !items.length} onClick={() => void splitCost(h)}><Scissors className="w-3.5 h-3.5" /> Split {formatMoney(h.totalCost)} {h.splitMode === "price" ? "by price" : "evenly"}</button>
                  <button type="button" className="btn text-xs py-1.5 px-2.5" disabled={busy} onClick={() => void patch(h.id, { splitMode: h.splitMode === "price" ? "even" : "price" })}>Switch to {h.splitMode === "price" ? "even" : "by price"}</button>
                  <button type="button" className="btn text-xs py-1.5 px-2.5" disabled={busy} onClick={() => void removeHaul(h)} aria-label="Delete haul"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
                {s.unsoldCost > 0 && <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>{formatMoney(s.unsoldCost)} of cost still in unsold items.</p>}

                {adding === h.id && (
                  <div className="border rounded-lg p-2 max-h-80 overflow-auto" style={{ borderColor: "var(--glass-line)" }}>
                    {candidates.length === 0 && <p className="text-xs">Every item is already in a haul.</p>}
                    {[...byDay.entries()].map(([day, list]) => (
                      <div key={day} className="mb-2">
                        <div className="flex items-center justify-between">
                          <p className="text-[11px] font-semibold">{day}</p>
                          <button type="button" className="text-[11px] underline" onClick={() => setPicked((p) => { const n = new Set(p); list.forEach((c) => n.add(c.id)); return n; })}>Select all {list.length}</button>
                        </div>
                        {list.map((c) => (
                          <label key={c.id} className="flex items-center gap-2 text-xs py-0.5">
                            <input type="checkbox" checked={picked.has(c.id)} onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(c.id); else n.delete(c.id); return n; })} />
                            <span className="truncate flex-1">{c.title || "Untitled"}</span>
                            {c.price != null && <span style={{ color: "var(--text-tertiary)" }}>{formatMoney(c.price)}</span>}
                          </label>
                        ))}
                      </div>
                    ))}
                    <button type="button" className="btn btn-primary text-xs w-full mt-1" disabled={busy || picked.size === 0} onClick={async () => { await patch(h.id, { addDraftIds: [...picked] }); setAdding(null); }}>Add {picked.size} item{picked.size === 1 ? "" : "s"}</button>
                  </div>
                )}

                <ul className="text-xs">
                  {items.map((d) => {
                    const p = itemProfit(d, sales);
                    return (
                      <li key={d.id} className="flex items-center gap-2 py-1 border-b last:border-0" style={{ borderColor: "var(--glass-line)" }}>
                        <span className="flex-1 truncate">{d.title || "Untitled"}</span>
                        <span style={{ color: "var(--text-tertiary)" }}>cost {d.costBasis != null ? formatMoney(d.costBasis) : "—"}</span>
                        <span className="w-20 text-right" style={{ color: p == null ? "var(--text-tertiary)" : p >= 0 ? "var(--success)" : "var(--danger)" }}>{p == null ? (d.listingId ? "listed" : "draft") : formatMoney(p)}</span>
                        <button type="button" className="text-[11px] underline" disabled={busy} onClick={() => void patch(h.id, { removeDraftIds: [d.id] })}>Remove</button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
