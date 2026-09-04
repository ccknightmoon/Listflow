"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Loader2, RefreshCw, Shirt, TrendingUp } from "lucide-react";
import Toast from "@/components/Toast";
import { apiFetch } from "@/lib/api";
import { bucketRevenueByWeek } from "@/lib/sales-buckets";

type DayRange = 7 | 30 | 90;

// Compact currency for tight chart labels: $342, $1.2k, $12k — never cents,
// since the point is a quick relative read, not a precise figure (the exact
// total is one tap away in the stat card above and the list below).
function formatCompactCurrency(n: number): string {
  if (n >= 10000) return `$${Math.round(n / 1000)}k`;
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${Math.round(n)}`;
}

interface Sale {
  listingId: string;
  title: string;
  price: number;
  qty: number;
  total: number;
  soldAt: string;
  thumbnail: string | null;
}

export default function SalesPage() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsConnect, setNeedsConnect] = useState(false);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [days, setDays] = useState<DayRange>(30);

  useEffect(() => { load(days); }, [days]);

  async function load(d: DayRange) {
    setLoading(true);
    setError(null);
    setNeedsConnect(false);
    setNeedsReconnect(false);
    try {
      const data = await apiFetch<{ sales?: Sale[]; totalRevenue?: number; error?: string; connect?: boolean; reconnect?: boolean }>(`/api/ebay/sales?days=${d}`);
      if (data.error) {
        setNeedsConnect(!!data.connect);
        setNeedsReconnect(!!data.reconnect);
        throw new Error(data.error);
      }
      setSales(data.sales ?? []);
      setTotalRevenue(data.totalRevenue ?? 0);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative min-h-screen max-w-md mx-auto px-5 pt-6 pb-5 overflow-hidden" style={{ viewTransitionName: "sales-panel" }}>
      <div
        className="bloom d1 stagger"
        style={{ width: 240, height: 240, top: -70, left: -60, background: "var(--glow-primary)" }}
      />
      <div
        className="bloom d1 stagger"
        style={{ width: 200, height: 200, top: 10, right: -70, background: "var(--glow-success)" }}
      />

      <div className="flex items-center gap-3 mb-4">
        <Link
          href="/dashboard"
          className="w-[34px] h-[34px] rounded-[11px] flex items-center justify-center flex-none"
          style={{ background: "var(--glass)", border: "1px solid var(--glass-line)" }}
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-medium">Sales history</h1>
          {!loading && !error && (
            <p className="text-xs text-[var(--text-secondary)]">{sales.length} sale{sales.length !== 1 ? "s" : ""} in last {days} days</p>
          )}
        </div>
        <button
          onClick={() => load(days)}
          disabled={loading}
          className="p-2 rounded-lg hover:bg-[var(--bg-page)] transition-colors"
        >
          {loading
            ? <Loader2 className="w-4 h-4 animate-spin text-[var(--text-secondary)]" />
            : <RefreshCw className="w-4 h-4 text-[var(--text-secondary)]" />
          }
        </button>
      </div>

      <div className="flex gap-2 mb-4">
        {([7, 30, 90] as DayRange[]).map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`flex-1 text-sm py-1.5 rounded-lg border transition-colors ${
              days === d
                ? "border-[var(--accent)] text-[var(--accent)] font-medium"
                : "border-[var(--border)] text-[var(--text-secondary)]"
            }`}
          >
            {d}d
          </button>
        ))}
      </div>

      {!loading && !error && sales.length > 0 && (
        <div className="card p-4 mb-3 flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "color-mix(in srgb, var(--success) 16%, var(--bg-surface))", color: "var(--success)" }}
          >
            <TrendingUp className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
              {sales.length} item{sales.length !== 1 ? "s" : ""} sold
            </p>
            <p className="font-display font-extrabold text-xl">${totalRevenue.toFixed(2)}</p>
          </div>
        </div>
      )}

      {!loading && !error && sales.length > 0 && (() => {
        // Purely client-side from the sales already on hand, no separate API
        // call — and computed by the same shared bucketing function the
        // Dashboard's trend sparkline uses, so the two screens can never
        // disagree about what "this week" means. Recomputed on every
        // render, so as real time passes and `sales` is refreshed, the
        // buckets and their date labels shift forward automatically.
        const { totals, weekStarts } = bucketRevenueByWeek(sales, days);
        const max = Math.max(1, ...totals);
        const barAreaPx = 46;
        return (
          <div className="card p-4 mb-4">
            <p className="text-[11.5px] font-bold mb-2.5" style={{ color: "var(--text-secondary)" }}>Revenue by week</p>
            <div className="flex items-end gap-1.5">
              {totals.map((t, idx) => {
                const isCurrent = idx === totals.length - 1;
                const weekLabel = new Date(weekStarts[idx]).toLocaleDateString("en-US", { month: "short", day: "numeric" });
                return (
                  <div key={idx} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                    <span
                      className="text-[9.5px] font-semibold tabular-nums"
                      style={{ color: isCurrent ? "var(--accent)" : "var(--text-tertiary)" }}
                    >
                      {formatCompactCurrency(t)}
                    </span>
                    <div
                      className="w-full rounded-t"
                      style={{
                        height: `${Math.max(4, (t / max) * barAreaPx)}px`,
                        background: "var(--accent)",
                        opacity: isCurrent ? 1 : 0.85,
                        borderRadius: "5px 5px 2px 2px",
                        transition: "height .4s var(--spring)",
                      }}
                      title={`Week of ${weekLabel}: $${t.toFixed(2)}`}
                    />
                    <span className="text-[9px] truncate" style={{ color: "var(--text-tertiary)" }}>
                      {weekLabel}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {error && (
        <div className="mb-4">
          <Toast
            type="error"
            message={
              <>
                {error}
                {needsConnect && <a href="/api/ebay/connect" className="underline ml-2 font-medium">Connect eBay →</a>}
                {needsReconnect && <a href="/api/ebay/connect" className="underline ml-2 font-medium">Reconnect eBay →</a>}
              </>
            }
            onClose={() => setError(null)}
          />
        </div>
      )}

      {loading && (
        <div className="card p-8 text-center">
          <Loader2 className="w-6 h-6 mx-auto mb-3 animate-spin" />
          <p className="text-sm text-[var(--text-secondary)]">Loading sales...</p>
        </div>
      )}

      {!loading && !error && sales.length === 0 && (
        <div className="card p-8 text-center">
          <p className="text-sm text-[var(--text-secondary)]">No sales in the last {days} days.</p>
        </div>
      )}

      {!loading && sales.length > 0 && (
        <>
          <p className="text-[11.5px] tracking-wide uppercase font-bold mb-2" style={{ color: "var(--text-tertiary)" }}>
            Recent sales
          </p>
          <div className="flex flex-col gap-2">
          {sales.map((s, i) => (
            <div key={i} className={`card stagger p-3 flex items-center gap-3 ${i < 6 ? `d${i + 1}` : ""}`}>
              {s.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.thumbnail} alt={s.title} loading="lazy" decoding="async" className="w-12 h-12 rounded-md object-cover flex-shrink-0" />
              ) : (
                <div className="w-12 h-12 rounded-md bg-[var(--bg-page)] flex items-center justify-center flex-shrink-0">
                  <Shirt className="w-5 h-5 text-[var(--text-secondary)]" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{s.title || "Unknown item"}</p>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                  {s.soldAt ? new Date(s.soldAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""}
                  {s.qty > 1 ? ` · Qty ${s.qty}` : ""}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                <p className="text-sm font-medium" style={{ color: "var(--success)" }}>${s.total.toFixed(2)}</p>
                <a
                  href={`https://www.ebay.com/itm/${s.listingId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center gap-0.5 text-[10px] text-[var(--text-tertiary)] hover:text-[var(--accent)]"
                >
                  <ExternalLink className="w-3 h-3" />
                  eBay
                </a>
              </div>
            </div>
          ))}
          </div>
        </>
      )}
    </main>
  );
}
