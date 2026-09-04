"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Loader2, RefreshCw, Shirt, TrendingUp } from "lucide-react";
import Toast from "@/components/Toast";
import { apiFetch } from "@/lib/api";
import { bucketRevenue, formatCompactCurrency } from "@/lib/sales-buckets";
import { useCountUp } from "@/lib/use-count-up";
import { getPageCache, setPageCache } from "@/lib/page-cache";

// Cached per day-range (7/30/90 each get their own entry) so flipping back
// to a tab you already viewed this session shows its numbers instantly
// instead of reflashing the loading state while it silently refetches.
function salesCacheKey(days: DayRange) {
  return `sales:${days}`;
}
interface CachedSales {
  sales: Sale[];
  totalRevenue: number;
}

type DayRange = 7 | 30 | 90;

interface Sale {
  listingId: string;
  title: string;
  price: number;
  qty: number;
  total: number;
  soldAt: string;
  thumbnail: string | null;
}

const INITIAL_DAYS: DayRange = 30;

export default function SalesPage() {
  const [sales, setSales] = useState<Sale[]>(() => getPageCache<CachedSales>(salesCacheKey(INITIAL_DAYS))?.sales ?? []);
  const [totalRevenue, setTotalRevenue] = useState(() => getPageCache<CachedSales>(salesCacheKey(INITIAL_DAYS))?.totalRevenue ?? 0);
  const displayTotalRevenue = useCountUp(totalRevenue);
  const [loading, setLoading] = useState(() => getPageCache<CachedSales>(salesCacheKey(INITIAL_DAYS)) === undefined);
  const [error, setError] = useState<string | null>(null);
  const [needsConnect, setNeedsConnect] = useState(false);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [days, setDays] = useState<DayRange>(INITIAL_DAYS);

  useEffect(() => { load(days); }, [days]);

  async function load(d: DayRange) {
    // Show whatever this specific range last loaded (if anything) right
    // away instead of blanking to a spinner on every tab switch — the real
    // fetch below still always runs and corrects it moments later. Written
    // against the requested `d`, not the reactive `days` state, so a rapid
    // tab switch can never write one range's numbers into another's cache
    // entry.
    const cached = getPageCache<CachedSales>(salesCacheKey(d));
    if (cached) {
      setSales(cached.sales);
      setTotalRevenue(cached.totalRevenue);
    } else {
      setLoading(true);
    }
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
      const newSales = data.sales ?? [];
      const newTotalRevenue = data.totalRevenue ?? 0;
      setSales(newSales);
      setTotalRevenue(newTotalRevenue);
      setPageCache(salesCacheKey(d), { sales: newSales, totalRevenue: newTotalRevenue });
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

      {(() => {
        const dayOptions: DayRange[] = [7, 30, 90];
        const activeIndex = dayOptions.indexOf(days);
        return (
          <div
            className="relative flex mb-4 rounded-xl overflow-hidden"
            style={{ background: "var(--glass)", border: "1px solid var(--glass-line)" }}
          >
            {/* Sliding accent pill behind the active tab — position/width
                computed from activeIndex so it glides to the new tab
                instead of the flat border/color swap this used to be. */}
            <div
              className="absolute rounded-lg pointer-events-none"
              style={{
                top: 3,
                bottom: 3,
                left: `calc(${activeIndex} * 100% / 3 + 3px)`,
                width: `calc(100% / 3 - 6px)`,
                background: "var(--accent-tint)",
                border: "1px solid var(--accent)",
                transition: "left .35s var(--spring)",
              }}
            />
            {dayOptions.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className="tap relative z-10 flex-1 text-sm py-2 font-medium"
                style={{ color: days === d ? "var(--accent)" : "var(--text-secondary)" }}
              >
                {d}d
              </button>
            ))}
          </div>
        );
      })()}

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
            <p className="font-display font-extrabold text-xl">${(displayTotalRevenue ?? 0).toFixed(2)}</p>
          </div>
        </div>
      )}

      {!loading && !error && sales.length > 0 && (() => {
        // Purely client-side from the sales already on hand, no separate API
        // call — and computed by the same shared bucketing function the
        // Dashboard's trend sparkline uses, so the two screens can never
        // disagree about what a given period's revenue is. Recomputed on
        // every render, so as real time passes and `sales` is refreshed,
        // the buckets and their date labels shift forward automatically.
        // The 7-day tab buckets by day (a real day-by-day trend instead of
        // one giant bar); 30/90-day tabs bucket by week and cover the full
        // window rather than being capped to a handful of recent weeks.
        const { totals, bucketStarts } = bucketRevenue(sales, days);
        const max = Math.max(1, ...totals);
        const barAreaPx = 46;
        const isDaily = days <= 7;
        return (
          <div className="card p-4 mb-4">
            <p className="text-[11.5px] font-bold mb-2.5" style={{ color: "var(--text-secondary)" }}>
              Revenue by {isDaily ? "day" : "week"}
            </p>
            <div className={`flex items-end ${totals.length > 8 ? "gap-1" : "gap-1.5"}`}>
              {totals.map((t, idx) => {
                const isCurrent = idx === totals.length - 1;
                const bucketDate = new Date(bucketStarts[idx]);
                const barLabel = isDaily
                  ? bucketDate.toLocaleDateString("en-US", { weekday: "short" })
                  : bucketDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                const tooltipDate = bucketDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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
                      title={`${isDaily ? tooltipDate : `Week of ${tooltipDate}`}: $${t.toFixed(2)}`}
                    />
                    <span className="text-[9px] truncate" style={{ color: "var(--text-tertiary)" }}>
                      {barLabel}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      <Toast
        type="error"
        message={
          error ? (
            <>
              {error}
              {needsConnect && <a href="/api/ebay/connect" className="underline ml-2 font-medium">Connect eBay →</a>}
              {needsReconnect && <a href="/api/ebay/connect" className="underline ml-2 font-medium">Reconnect eBay →</a>}
            </>
          ) : null
        }
        onClose={() => setError(null)}
      />

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
