"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, ExternalLink, Loader2, RefreshCw, Shirt, TrendingUp } from "lucide-react";
import Toast from "@/components/Toast";
import { apiFetch } from "@/lib/api";
import { bucketRevenue, formatCompactCurrency } from "@/lib/sales-buckets";
import { groupSalesByCategory } from "@/lib/insights";
import { useCountUp } from "@/lib/use-count-up";
import { getPageCache, setPageCache } from "@/lib/page-cache";

// Cached per day-range (7/30/90 each get their own entry) so flipping back
// to a tab you already viewed this session shows its numbers instantly
// instead of reflashing the loading state while it silently refetches.
function salesCacheKey(days: DayRange) {
  return `sales:${days}`;
}
interface RealFees {
  totalFees: number;
  saleCount: number;
  truncated: boolean;
}
interface CachedSales {
  sales: Sale[];
  totalRevenue: number;
  totalFees: number;
  netRevenue: number;
  feePercent: number;
  trueProfit: number;
  itemsWithCost: number;
  itemsMissingCost: number;
  realFees: RealFees | null;
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
  // Estimated eBay final value fee for this sale -- see the disclaimer on
  // the summary card. Always present from the API (defaults to 0 there),
  // optional here only so an old cached page-cache entry (pre-this-feature)
  // doesn't crash the render.
  estimatedFee?: number;
  // Seller-entered cost of the item, from drafts.cost_basis -- null when
  // never entered (see src/lib/profit.ts). Optional for the same
  // old-cache-entry reason as estimatedFee above.
  costBasis?: number | null;
  // Sourcing-insights fields, same drafts join / old-cache-entry optionality
  // as costBasis above -- see src/lib/insights.ts for how these are used.
  itemType?: string | null;
  storeCategoryName?: string | null;
  draftCreatedAt?: string | null;
}

// RFC 4180-ish: quote any field containing a comma, quote, or newline, and
// double up embedded quotes. Titles routinely contain commas, so this
// isn't optional -- an unescaped one would silently shift every later
// column in that row.
function csvField(value: string | number): string {
  const s = String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((row) => row.map(csvField).join(",")).join("\r\n");
  // Leading BOM so Excel (still the most likely place this gets opened)
  // detects UTF-8 instead of guessing a local codepage and mangling any
  // non-ASCII characters in a title.
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const INITIAL_DAYS: DayRange = 30;

export default function SalesPage() {
  const [sales, setSales] = useState<Sale[]>(() => getPageCache<CachedSales>(salesCacheKey(INITIAL_DAYS))?.sales ?? []);
  const [totalRevenue, setTotalRevenue] = useState(() => getPageCache<CachedSales>(salesCacheKey(INITIAL_DAYS))?.totalRevenue ?? 0);
  const [totalFees, setTotalFees] = useState(() => getPageCache<CachedSales>(salesCacheKey(INITIAL_DAYS))?.totalFees ?? 0);
  const [netRevenue, setNetRevenue] = useState(() => getPageCache<CachedSales>(salesCacheKey(INITIAL_DAYS))?.netRevenue ?? 0);
  const [feePercent, setFeePercent] = useState(() => getPageCache<CachedSales>(salesCacheKey(INITIAL_DAYS))?.feePercent ?? 0);
  const [trueProfit, setTrueProfit] = useState(() => getPageCache<CachedSales>(salesCacheKey(INITIAL_DAYS))?.trueProfit ?? 0);
  const [itemsWithCost, setItemsWithCost] = useState(() => getPageCache<CachedSales>(salesCacheKey(INITIAL_DAYS))?.itemsWithCost ?? 0);
  const [itemsMissingCost, setItemsMissingCost] = useState(() => getPageCache<CachedSales>(salesCacheKey(INITIAL_DAYS))?.itemsMissingCost ?? 0);
  // Real, eBay-reported fee total for the current window -- only present
  // once the seller has reconnected eBay with the sell.finances scope
  // (see EBAY_SCOPES in ebay-oauth.ts). null means "not available yet,"
  // not an error -- the estimate above always renders regardless.
  const [realFees, setRealFees] = useState<RealFees | null>(() => getPageCache<CachedSales>(salesCacheKey(INITIAL_DAYS))?.realFees ?? null);
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
      const data = await apiFetch<{ sales?: Sale[]; totalRevenue?: number; totalFees?: number; netRevenue?: number; feePercent?: number; trueProfit?: number; itemsWithCost?: number; itemsMissingCost?: number; realFees?: RealFees | null; error?: string; connect?: boolean; reconnect?: boolean }>(`/api/ebay/sales?days=${d}`);
      if (data.error) {
        setNeedsConnect(!!data.connect);
        setNeedsReconnect(!!data.reconnect);
        throw new Error(data.error);
      }
      const newSales = data.sales ?? [];
      const newTotalRevenue = data.totalRevenue ?? 0;
      const newTotalFees = data.totalFees ?? 0;
      const newNetRevenue = data.netRevenue ?? newTotalRevenue;
      const newFeePercent = data.feePercent ?? 0;
      const newTrueProfit = data.trueProfit ?? newNetRevenue;
      const newItemsWithCost = data.itemsWithCost ?? 0;
      const newItemsMissingCost = data.itemsMissingCost ?? 0;
      const newRealFees = data.realFees ?? null;
      setSales(newSales);
      setTotalRevenue(newTotalRevenue);
      setTotalFees(newTotalFees);
      setNetRevenue(newNetRevenue);
      setFeePercent(newFeePercent);
      setTrueProfit(newTrueProfit);
      setItemsWithCost(newItemsWithCost);
      setItemsMissingCost(newItemsMissingCost);
      setRealFees(newRealFees);
      setPageCache(salesCacheKey(d), {
        sales: newSales,
        totalRevenue: newTotalRevenue,
        totalFees: newTotalFees,
        netRevenue: newNetRevenue,
        feePercent: newFeePercent,
        trueProfit: newTrueProfit,
        itemsWithCost: newItemsWithCost,
        itemsMissingCost: newItemsMissingCost,
        realFees: newRealFees,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function handleExportCsv() {
    const header = ["Date", "Title", "Listing ID", "Qty", "Price", "Total", "Est. fee", "Cost", "Profit"];
    const rows = sales.map((s) => {
      const fee = s.estimatedFee ?? 0;
      const cost = s.costBasis ?? null;
      // Only claim a profit figure when a real cost was entered -- with no
      // cost on file this would otherwise silently pass off "revenue minus
      // estimated fee" as profit, the exact estimate/actual conflation the
      // summary card's own disclaimer exists to avoid.
      const profit = cost != null ? s.total - fee - cost : null;
      return [
        s.soldAt ? new Date(s.soldAt).toLocaleDateString("en-US") : "",
        s.title || "Unknown item",
        s.listingId,
        String(s.qty),
        s.price.toFixed(2),
        s.total.toFixed(2),
        fee.toFixed(2),
        cost != null ? cost.toFixed(2) : "",
        profit != null ? profit.toFixed(2) : "",
      ];
    });
    const today = new Date().toISOString().slice(0, 10);
    downloadCsv(`listflow-sales-${days}d-${today}.csv`, [header, ...rows]);
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
        {!loading && !error && sales.length > 0 && (
          <button
            onClick={handleExportCsv}
            title="Export CSV"
            className="p-2 rounded-lg hover:bg-[var(--bg-page)] transition-colors"
          >
            <Download className="w-4 h-4 text-[var(--text-secondary)]" />
          </button>
        )}
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
        <div className="card p-4 mb-3">
          <div className="flex items-center gap-3">
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

          <div className="grid grid-cols-2 gap-3 mt-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
            <div>
              <p className="text-[10px] font-medium" style={{ color: "var(--text-tertiary)" }}>Est. eBay fees</p>
              <p className="text-sm font-semibold" style={{ color: "var(--danger)" }}>&minus;${totalFees.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-[10px] font-medium" style={{ color: "var(--text-tertiary)" }}>Est. net profit</p>
              <p className="text-sm font-semibold" style={{ color: "var(--success)" }}>${netRevenue.toFixed(2)}</p>
            </div>
          </div>
          <p className="text-[10px] mt-2 leading-relaxed" style={{ color: "var(--text-tertiary)" }}>
            Estimated at {feePercent}% + eBay&apos;s per-order fee — not your exact eBay invoice.{" "}
            <Link href="/settings" className="underline">Adjust rate</Link>
          </p>
          {realFees && realFees.saleCount > 0 && (
            <p className="text-[10px] mt-1 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              Actual fees eBay reported for this period: <span className="font-semibold">${realFees.totalFees.toFixed(2)}</span>
              {" "}({realFees.saleCount} transaction{realFees.saleCount !== 1 ? "s" : ""} from your Finances data{realFees.truncated ? ", partial" : ""})
            </p>
          )}
          {itemsWithCost > 0 && (
            <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
              <p className="text-[10px] font-medium" style={{ color: "var(--text-tertiary)" }}>True profit (after fees &amp; cost)</p>
              <p className="text-sm font-semibold" style={{ color: "var(--success)" }}>${trueProfit.toFixed(2)}</p>
              {itemsMissingCost > 0 && (
                <p className="text-[10px] mt-1 leading-relaxed" style={{ color: "var(--text-tertiary)" }}>
                  {itemsMissingCost} of {itemsWithCost + itemsMissingCost} sale{itemsWithCost + itemsMissingCost !== 1 ? "s" : ""} have no cost entered — showing profit for the rest.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {!loading && !error && sales.length > 0 && (() => {
        // Purely client-side from the sales already on hand (itemType/
        // storeCategoryName/costBasis/draftCreatedAt are already joined in
        // by the API) -- no separate fetch, and it recomputes automatically
        // whenever `sales` refreshes, same pattern as the revenue chart
        // just below reusing bucketRevenue().
        const categoryInsights = groupSalesByCategory(
          sales.map((s) => ({
            category: s.storeCategoryName ?? s.itemType ?? null,
            total: s.total,
            costBasis: s.costBasis ?? null,
            soldAt: s.soldAt,
            listedAt: s.draftCreatedAt ?? null,
          }))
        );
        if (categoryInsights.length === 0) return null;
        return (
          <div className="card p-4 mb-3">
            <p className="text-sm font-semibold mb-3">By category</p>
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ color: "var(--text-tertiary)" }}>
                    <th className="text-left font-medium px-1 pb-2">Category</th>
                    <th className="text-right font-medium px-1 pb-2">Sold</th>
                    <th className="text-right font-medium px-1 pb-2">Revenue</th>
                    <th className="text-right font-medium px-1 pb-2">Margin</th>
                    <th className="text-right font-medium px-1 pb-2">Avg days</th>
                  </tr>
                </thead>
                <tbody>
                  {categoryInsights.map((c) => (
                    <tr key={c.category} style={{ borderTop: "1px solid var(--border)" }}>
                      <td className="px-1 py-1.5 font-medium truncate max-w-[120px]">{c.category}</td>
                      <td className="text-right px-1 py-1.5">{c.count}</td>
                      <td className="text-right px-1 py-1.5">{formatCompactCurrency(c.revenue)}</td>
                      <td className="text-right px-1 py-1.5" style={{ color: c.marginPercent != null ? "var(--success)" : "var(--text-tertiary)" }}>
                        {c.marginPercent != null ? `${c.marginPercent.toFixed(0)}%` : "—"}
                      </td>
                      <td className="text-right px-1 py-1.5" style={{ color: "var(--text-secondary)" }}>
                        {c.avgDaysToSell != null ? `${c.avgDaysToSell.toFixed(0)}d` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] mt-2 leading-relaxed" style={{ color: "var(--text-tertiary)" }}>
              Margin and avg. days to sell only cover sales with a cost entered and a known list date — see Sales for what each covers.
              Days to sell is approximate — based on when you added the item, not always exactly when it went live on eBay.
            </p>
          </div>
        );
      })()}

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
                {typeof s.estimatedFee === "number" && s.estimatedFee > 0 && (
                  <p className="text-[9.5px]" style={{ color: "var(--text-tertiary)" }}>net ${(s.total - s.estimatedFee).toFixed(2)}</p>
                )}
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
