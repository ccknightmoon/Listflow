"use client";

// Settings → Automation. Every switch here is OFF until the seller turns it
// on. Each group loads/saves on its own (/api/settings/automation), so a
// missing migration only hides that one group.
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { SKIP_LABELS, type AutoOfferSettings, type OfferPlan } from "@/lib/auto-offers";
import { formatMoney } from "@/lib/format";

interface AutomationResponse { autoOffers: AutoOfferSettings | null; autoOffersLive: boolean; learnFixes: boolean | null }
interface PreviewResponse { available: boolean; reason?: string; plan?: OfferPlan; log?: Array<{ ebay_listing_id: string; discount_percent: number; offer_price: number | null; status: string; created_at: string }> }

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className="relative w-10 h-6 rounded-full flex-none transition-colors"
      style={{ background: checked ? "var(--accent)" : "var(--glass-line)", opacity: disabled ? 0.5 : 1 }}>
      <span className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all" style={{ left: checked ? 18 : 2 }} />
    </button>
  );
}

export default function AutomationSettings() {
  const [data, setData] = useState<AutomationResponse | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    apiFetch<AutomationResponse>("/api/settings/automation").then(setData, () => setMsg("Couldn't load automation settings."));
  }, []);

  async function save(body: Record<string, unknown>, next: AutomationResponse) {
    const prev = data;
    setData(next);
    try {
      await apiFetch("/api/settings/automation", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      setMsg("Saved ✓");
    } catch (e) {
      setData(prev);
      setMsg((e as Error).message);
    }
  }

  async function runPreview() {
    setPreviewing(true);
    try { setPreview(await apiFetch<PreviewResponse>("/api/auto-offers/preview")); }
    catch (e) { setPreview({ available: false, reason: (e as Error).message }); }
    finally { setPreviewing(false); }
  }

  if (!data) return <p className="text-xs flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Loading…</p>;
  const a = data.autoOffers;
  const setA = (patch: Partial<AutoOfferSettings>) => a && void save({ autoOffers: patch }, { ...data, autoOffers: { ...a, ...patch } });

  return (
    <div className="flex flex-col gap-3" data-testid="automation-settings">
      {/* Automatic offers to watchers */}
      <div className="card p-3">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <p className="text-sm font-medium">Automatic offers to watchers</p>
            <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>Once a day, send an offer to people watching your items. Never below the item&apos;s floor or cost.</p>
          </div>
          {a && <Switch label="Automatic offers" checked={a.enabled} onChange={(v) => setA({ enabled: v })} />}
        </div>
        {!a ? (
          <p className="text-[11px] mt-2" style={{ color: "var(--text-tertiary)" }}>Needs a one-time database update (migration 042).</p>
        ) : (
          <div className="mt-3 flex flex-col gap-2 text-xs" style={{ opacity: a.enabled ? 1 : 0.6 }}>
            <label className="flex items-center gap-2">Discount
              <select className="input py-1" value={a.percent} onChange={(e) => setA({ percent: Number(e.target.value) })}>
                {[5, 10, 15, 20, 25, 30].map((p) => <option key={p} value={p}>{p}%</option>)}
              </select>
              <span style={{ color: "var(--text-tertiary)" }}>(lowered automatically if it would go below floor/cost)</span>
            </label>
            <label className="flex items-center gap-2">Wait
              <select className="input py-1" value={a.minDays} onChange={(e) => setA({ minDays: Number(e.target.value) })}>
                {[0, 1, 3, 7, 14, 30].map((d) => <option key={d} value={d}>{d} days</option>)}
              </select> after listing, then at most every
              <select className="input py-1" value={a.repeatDays} onChange={(e) => setA({ repeatDays: Number(e.target.value) })}>
                {[3, 7, 14, 30].map((d) => <option key={d} value={d}>{d} days</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={a.allItems} onChange={(e) => setA({ allItems: e.target.checked })} />
              All live items (otherwise only items you tick &ldquo;Include in automatic offers&rdquo; on)
            </label>
            <p className="text-[11px] p-2 rounded" style={{ background: "var(--warning-bg)", border: "1px solid var(--warning-border)" }}>
              eBay also has its own &ldquo;Send automated offers&rdquo; (Seller Hub → Active listings). Don&apos;t use both on the same items, or buyers get two offers. Items need a floor or a cost so Listflow knows the lowest safe price.
            </p>
            {!data.autoOffersLive && (
              <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>Safety switch: sending is also off on the server (AUTO_OFFERS_ENABLED isn&apos;t set), so for now this only previews.</p>
            )}
            <button type="button" className="btn text-xs py-1.5 px-2.5 self-start" disabled={previewing} onClick={() => void runPreview()}>
              {previewing ? <Loader2 className="w-3 h-3 animate-spin" /> : null} Preview what would be sent (sends nothing)
            </button>
            {preview && (
              <div className="text-[11px]" data-testid="auto-offer-preview">
                {preview.reason && <p>{preview.reason}</p>}
                {preview.plan && (preview.plan.send.length === 0 ? <p>No offers would go out right now.</p> : (
                  <ul>{preview.plan.send.map((o) => <li key={o.listingId}>{o.title}: {o.discountPercent}% off {formatMoney(o.price)} → {formatMoney(o.offerPrice)}{o.limitedBy ? ` (limited by ${o.limitedBy})` : ""}</li>)}</ul>
                ))}
                {preview.plan && preview.plan.skipped.length > 0 && (
                  <details className="mt-1"><summary>{preview.plan.skipped.length} skipped</summary>
                    <ul>{preview.plan.skipped.map((s) => <li key={s.listingId}>{s.title}: {SKIP_LABELS[s.reason]}</li>)}</ul>
                  </details>
                )}
                {(preview.log?.length ?? 0) > 0 && (
                  <details className="mt-1"><summary>Recent automatic offers</summary>
                    <ul>{preview.log!.map((l, i) => <li key={i}>{l.created_at.slice(0, 10)} · {l.ebay_listing_id} · {l.discount_percent}% · {l.status}</li>)}</ul>
                  </details>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Learn my fixes */}
      <div className="card p-3 flex items-center gap-3">
        <div className="flex-1">
          <p className="text-sm font-medium">Learn my fixes</p>
          <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
            When you correct the same AI value twice (e.g. brand &ldquo;Polo RL&rdquo; → &ldquo;Polo Ralph Lauren&rdquo;), new items get your fix automatically. Brand, color, material, style, pattern, type, neckline, sleeve and fit only — never size, condition or price.
          </p>
          {data.learnFixes === null && <p className="text-[11px] mt-1" style={{ color: "var(--text-tertiary)" }}>Needs a one-time database update (migration 043).</p>}
        </div>
        {data.learnFixes !== null && <Switch label="Learn my fixes" checked={data.learnFixes} onChange={(v) => void save({ learnFixes: v }, { ...data, learnFixes: v })} />}
      </div>
      {msg && <p className="text-[11px]" role="status" style={{ color: "var(--text-tertiary)" }}>{msg}</p>}
    </div>
  );
}
