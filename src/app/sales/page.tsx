"use client";

// Sales analytics. Loads ~6 months of sales ONCE (GET /api/ebay/sales/analytics,
// cached on the server and in this tab), then every 7d / 30d / 90d view —
// totals, previous-period comparison, chart, categories, tips — is derived
// locally by deriveView() in src/lib/sales-analytics.ts. Switching tabs never
// waits on eBay.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Download, ExternalLink, Lightbulb, Loader2, RefreshCw, Shirt,
} from "lucide-react";
import Toast from "@/components/Toast";
import { apiFetch } from "@/lib/api";
import { formatCompactCurrency } from "@/lib/sales-buckets";
import { getPageCache, setPageCache } from "@/lib/page-cache";
import {
  deriveView, chooseFee, resolveCategory, type AnalyticsSale, type ActiveListing, type Change, type DatedAmount, type DayRange,
} from "@/lib/sales-analytics";

type FeedSale = AnalyticsSale & { thumbnail: string | null; hasDraft: boolean };

interface Feed {
  generatedAt: string;
  sales: FeedSale[];
  excluded: { cancelled: number; awaitingPayment: number };
  truncated: boolean;
  finances: { available: boolean; truncated: boolean; refunds: DatedAmount[]; labels: DatedAmount[]; otherCharges: DatedAmount[] };
  active: ActiveListing[];
  activeCount: number | null;
  feePercent: number;
  saleCostsAvailable: boolean;
}

type FeedResponse = Partial<Feed> & { error?: string; connect?: boolean; reconnect?: boolean };

const FEED_CACHE_KEY = "sales-analytics-feed";
const FEED_CACHE_MS = 5 * 60_000;
const DAY_OPTIONS: DayRange[] = [7, 30, 90];
const PAGE_SIZE = 20;

const money = (n: number) => `$${n.toFixed(2)}`;
const shortDate = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });

function csvField(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((row) => row.map(csvField).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function ChangeBadge({ change, days }: { change: Change | null; days: number }) {
  if (!change) return <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>—</span>;
  if (change.pct == null) {
    return (
      <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
        {change.direction === "new" ? `new vs prev ${days}d` : `no sales prev ${days}d`}
      </span>
    );
  }
  const up = change.pct > 0;
  const flat = change.pct === 0;
  const color = flat ? "var(--text-tertiary)" : up ? "var(--success)" : "var(--danger)";
  return (
    <span className="text-[10px] font-semibold tabular-nums" style={{ color }}>
      {flat ? "■" : up ? "▲" : "▼"} {Math.abs(change.pct)}%
      <span className="font-normal" style={{ color: "var(--text-tertiary)" }}> vs prev {days}d</span>
    </span>
  );
}

function Skeleton({ h }: { h: number }) {
  return <div className="card mb-3 animate-pulse" style={{ height: h, opacity: 0.6 }} />;
}

export default function SalesPage() {
  const [feed, setFeed] = useState<Feed | null>(() => getPageCache<Feed>(FEED_CACHE_KEY, FEED_CACHE_MS) ?? null);
  const [loading, setLoading] = useState(() => !getPageCache<Feed>(FEED_CACHE_KEY, FEED_CACHE_MS));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsConnect, setNeedsConnect] = useState(false);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [days, setDays] = useState<DayRange>(30);
  const [selectedBar, setSelectedBar] = useState<number | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});
  const [showCostEditor, setShowCostEditor] = useState(false);
  const [costInputs, setCostInputs] = useState<Record<string, string>>({});
  const [costSaving, setCostSaving] = useState<string | null>(null);
  const [costNotice, setCostNotice] = useState<string | null>(null);

  const load = useCallback(async (refresh: boolean) => {
    if (refresh) setRefreshing(true);
    setError(null);
    setNeedsConnect(false);
    setNeedsReconnect(false);
    try {
      const data = await apiFetch<FeedResponse>(`/api/ebay/sales/analytics${refresh ? "?refresh=1" : ""}`);
      if (data.error) {
        setNeedsConnect(!!data.connect);
        setNeedsReconnect(!!data.reconnect);
        throw new Error(data.error);
      }
      const next = data as Feed;
      setFeed(next);
      setPageCache(FEED_CACHE_KEY, next);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // One load per visit (instant if this tab already has a fresh copy).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount; state is set after the await
    if (!getPageCache<Feed>(FEED_CACHE_KEY, FEED_CACHE_MS)) void load(false);
  }, [load]);

  // "Now" is pinned to when the data was fetched, so every tab is computed
  // against the same moment the eBay data describes.
  const nowMs = useMemo(() => (feed ? Date.parse(feed.generatedAt) : 0), [feed]);
  const view = useMemo(() => (feed ? deriveView(feed, days, nowMs) : null), [feed, days, nowMs]);

  function switchDays(d: DayRange) {
    setDays(d);
    setSelectedBar(null);
    setVisibleCount(PAGE_SIZE);
  }

  // Photos for the visible rows only, one small request.
  const visibleSales = useMemo(() => view?.sales.slice(0, visibleCount) ?? [], [view, visibleCount]);
  useEffect(() => {
    const ids = [...new Set(visibleSales.filter((s) => !(s as FeedSale).thumbnail && !(s.listingId in thumbs)).map((s) => s.listingId))].slice(0, 24);
    if (ids.length === 0) return;
    let cancelled = false;
    apiFetch<{ thumbnails?: Record<string, string | null> }>(`/api/ebay/sales/thumbnails?ids=${ids.join(",")}`)
      .then((r) => { if (!cancelled) setThumbs((prev) => ({ ...prev, ...(r.thumbnails ?? {}) })); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [visibleSales, thumbs]);

  const missingCostSales = useMemo(
    () => (view?.sales ?? []).filter((s) => s.costBasis == null).slice(0, 30) as FeedSale[],
    [view],
  );

  async function saveCost(s: FeedSale) {
    const value = parseFloat(costInputs[s.key] ?? "");
    if (!Number.isFinite(value) || value < 0) {
      setCostNotice("Enter a cost of $0 or more.");
      return;
    }
    setCostSaving(s.key);
    setCostNotice(null);
    try {
      const res = await fetch("/api/sales/costs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ saleKey: s.key, listingId: s.listingId, cost: value }),
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) throw new Error(data.error ?? "Couldn't save that cost.");
      // Update locally so the numbers move immediately.
      setFeed((prev) => {
        if (!prev) return prev;
        const next = { ...prev, sales: prev.sales.map((x) => (x.key === s.key ? { ...x, costBasis: value } : x)) };
        setPageCache(FEED_CACHE_KEY, next);
        return next;
      });
    } catch (err) {
      setCostNotice((err as Error).message);
    } finally {
      setCostSaving(null);
    }
  }

  function handleExportCsv() {
    if (!view || !feed) return;
    const header = ["Date", "Title", "Listing ID", "Category", "Qty", "Item total", "Buyer shipping", "Tax", "eBay fee", "Fee source", "Cost", "Profit"];
    const rows = view.sales.map((s) => {
      const f = chooseFee(s, feed.feePercent);
      const profit = s.costBasis != null ? s.itemTotal + s.shippingPaid - f.fee - s.costBasis : null;
      return [
        new Date(s.soldAt).toLocaleDateString("en-US"),
        s.title || "Unknown item",
        s.listingId,
        resolveCategory(s),
        String(s.qty),
        s.itemTotal.toFixed(2),
        s.shippingPaid.toFixed(2),
        s.taxPaid.toFixed(2),
        f.fee.toFixed(2),
        f.actual ? "eBay" : "estimate",
        s.costBasis != null ? s.costBasis.toFixed(2) : "",
        profit != null ? profit.toFixed(2) : "",
      ];
    });
    downloadCsv(`listflow-sales-${days}d-${new Date().toISOString().slice(0, 10)}.csv`, [header, ...rows]);
  }

  const c = view?.current;
  const activeIndex = DAY_OPTIONS.indexOf(days);

  return (
    <main className="relative min-h-screen max-w-md mx-auto px-5 pt-6 pb-8 overflow-hidden" style={{ viewTransitionName: "sales-panel" }}>
      <div className="bloom d1 stagger" style={{ width: 240, height: 240, top: -70, left: -60, background: "var(--glow-primary)" }} />
      <div className="bloom d1 stagger" style={{ width: 200, height: 200, top: 10, right: -70, background: "var(--glow-success)" }} />

      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <Link
          href="/dashboard"
          className="w-[34px] h-[34px] rounded-[11px] flex items-center justify-center flex-none"
          style={{ background: "var(--glass)", border: "1px solid var(--glass-line)" }}
          aria-label="Back to dashboard"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-medium">Sales</h1>
          {view && (
            <p className="text-xs text-[var(--text-secondary)] truncate">
              {c!.orders} sale{c!.orders !== 1 ? "s" : ""} · {shortDate(view.period.start)} – today
              {feed && ` · updated ${new Date(feed.generatedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`}
            </p>
          )}
        </div>
        {view && view.sales.length > 0 && (
          <button onClick={handleExportCsv} title="Export CSV" className="p-2 rounded-lg hover:bg-[var(--bg-page)] transition-colors">
            <Download className="w-4 h-4 text-[var(--text-secondary)]" />
          </button>
        )}
        <button
          onClick={() => load(true)}
          disabled={refreshing || loading}
          title="Refresh from eBay"
          className="p-2 rounded-lg hover:bg-[var(--bg-page)] transition-colors"
        >
          {refreshing || loading
            ? <Loader2 className="w-4 h-4 animate-spin text-[var(--text-secondary)]" />
            : <RefreshCw className="w-4 h-4 text-[var(--text-secondary)]" />}
        </button>
      </div>

      {/* Range tabs — instant, no network */}
      <div className="relative flex mb-4 rounded-xl overflow-hidden" style={{ background: "var(--glass)", border: "1px solid var(--glass-line)" }}>
        <div
          className="absolute rounded-lg pointer-events-none"
          style={{
            top: 3, bottom: 3,
            left: `calc(${activeIndex} * 100% / 3 + 3px)`,
            width: `calc(100% / 3 - 6px)`,
            background: "var(--accent-tint)",
            border: "1px solid var(--accent)",
            transition: "left .25s var(--spring)",
          }}
        />
        {DAY_OPTIONS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => switchDays(d)}
            className="tap relative z-10 flex-1 text-sm py-2 font-medium"
            style={{ color: days === d ? "var(--accent)" : "var(--text-secondary)" }}
          >
            {d}d
          </button>
        ))}
      </div>

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

      {loading && !view && (
        <>
          <div className="grid grid-cols-2 gap-2 mb-3">
            {[0, 1, 2, 3].map((i) => <div key={i} className="card animate-pulse" style={{ height: 76, opacity: 0.6 }} />)}
          </div>
          <Skeleton h={190} />
          <Skeleton h={130} />
          <p className="text-center text-xs text-[var(--text-secondary)]">Loading 6 months of sales from eBay — after this, switching ranges is instant.</p>
        </>
      )}

      {view && c && feed && (
        <>
          {/* KPI tiles with previous-period comparison */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            {[
              { label: "Item sales", value: money(c.itemSales), change: view.changes.itemSales },
              { label: "Items sold", value: String(c.units), change: view.changes.units },
              { label: "Avg sale price", value: c.avgSalePrice != null ? money(c.avgSalePrice) : "—", change: view.changes.avgSalePrice },
              {
                label: "Sell-through (approx.)",
                value: view.sellThroughNow != null ? `${view.sellThroughNow}%` : "—",
                change: view.changes.sellThrough,
              },
            ].map((k) => (
              <div key={k.label} className="card p-3">
                <p className="text-[10px] font-medium" style={{ color: "var(--text-tertiary)" }}>{k.label}</p>
                <p className="font-display font-extrabold text-lg tabular-nums">{k.value}</p>
                <ChangeBadge change={k.change} days={days} />
              </div>
            ))}
          </div>
          <p className="text-[10px] mb-3 leading-relaxed" style={{ color: "var(--text-tertiary)" }}>
            Item sales exclude shipping and sales tax. Sell-through = items sold ÷ (sold + {feed.activeCount ?? feed.active.length} listings active now).
            {(feed.excluded.cancelled > 0 || feed.excluded.awaitingPayment > 0) &&
              ` Not counted: ${feed.excluded.cancelled} cancelled, ${feed.excluded.awaitingPayment} awaiting payment (last 6 months).`}
          </p>

          {/* Profit breakdown — every line says whether it's eBay's number or an estimate */}
          <div className="card p-4 mb-3">
            <p className="text-sm font-semibold mb-2">Profit</p>
            <div className="flex flex-col gap-1 text-xs tabular-nums">
              <Row label="Item sales" value={money(c.itemSales)} />
              <Row label="Shipping paid by buyers" value={`+${money(c.shippingPaidByBuyers)}`} />
              <Row
                label={
                  c.feesEstimatedCount === 0 ? "eBay fees (from eBay)"
                  : c.feesActualCount === 0 ? `eBay fees (estimated, ${feed.feePercent}%)`
                  : `eBay fees (${c.feesActualCount} from eBay, ${c.feesEstimatedCount} est.)`
                }
                value={`−${money(c.fees)}`}
                negative
              />
              {feed.finances.available ? (
                <>
                  {c.refunds > 0 && <Row label="Refunds" value={`−${money(c.refunds)}`} negative />}
                  <Row label="eBay shipping labels" value={`−${money(c.labelCosts)}`} negative />
                  {c.otherCharges !== 0 && <Row label="Other eBay charges (ads etc.)" value={`−${money(c.otherCharges)}`} negative />}
                </>
              ) : (
                <p className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
                  Refunds, eBay label costs and ad fees need eBay Finances access —{" "}
                  <a href="/api/ebay/connect" className="underline">reconnect eBay</a> to include them.
                </p>
              )}
              <Row
                label={`Item costs (${c.salesWithCost} of ${c.orders} entered)`}
                value={`−${money(c.cogs)}`}
                negative
              />
              <div className="flex justify-between pt-2 mt-1 font-semibold text-sm" style={{ borderTop: "1px solid var(--border)" }}>
                <span>{c.profitCoversAllCosts ? "Profit" : "Profit (before missing costs)"}</span>
                <span style={{ color: c.profit >= 0 ? "var(--success)" : "var(--danger)" }}>{money(c.profit)}</span>
              </div>
            </div>
            <p className="text-[10px] mt-2 leading-relaxed" style={{ color: "var(--text-tertiary)" }}>
              Labels bought outside eBay aren&apos;t included.{" "}
              {c.feesEstimatedCount > 0 && <>Estimated fees use {feed.feePercent}% of item + shipping + tax + eBay&apos;s per-order fee — <Link href="/settings" className="underline">adjust rate</Link>. </>}
              {c.salesMissingCost > 0 && (
                <button type="button" className="underline" style={{ color: "var(--accent)" }} onClick={() => setShowCostEditor(true)}>
                  Add costs for {c.salesMissingCost} sale{c.salesMissingCost !== 1 ? "s" : ""}
                </button>
              )}
            </p>
          </div>

          {/* Quick cost entry */}
          {showCostEditor && missingCostSales.length > 0 && (
            <div className="card p-4 mb-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold">Add item costs</p>
                <button type="button" className="text-xs underline" onClick={() => setShowCostEditor(false)}>Done</button>
              </div>
              <p className="text-[10px] mb-2" style={{ color: "var(--text-tertiary)" }}>
                What you paid for each item. Saved instantly; profit and margins update right away.
              </p>
              {costNotice && <p className="text-[11px] mb-2" style={{ color: "var(--danger)" }}>{costNotice}</p>}
              <div className="flex flex-col gap-2">
                {missingCostSales.map((s) => {
                  const blocked = !s.hasDraft && !feed.saleCostsAvailable;
                  return (
                    <div key={s.key} className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs truncate">{s.title}</p>
                        <p className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>{shortDate(Date.parse(s.soldAt))} · sold {money(s.itemTotal)}</p>
                      </div>
                      {blocked ? (
                        <span className="text-[10px] text-right max-w-[110px]" style={{ color: "var(--text-tertiary)" }}>Needs DB update (025)</span>
                      ) : (
                        <>
                          <input
                            type="number" inputMode="decimal" min="0" step="0.01" placeholder="$0.00"
                            value={costInputs[s.key] ?? ""}
                            onChange={(e) => setCostInputs((p) => ({ ...p, [s.key]: e.target.value }))}
                            className="input w-20 text-xs py-1 px-2"
                            aria-label={`Cost for ${s.title}`}
                          />
                          <button
                            type="button"
                            className="btn text-xs px-2 py-1"
                            disabled={costSaving === s.key || !(costInputs[s.key] ?? "").trim()}
                            onClick={() => saveCost(s)}
                          >
                            {costSaving === s.key ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Revenue chart: bars line up with the period and add up to the total */}
          {view.sales.length > 0 && (() => {
            const max = Math.max(1, ...view.buckets.map((b) => b.total));
            const daily = days <= 7;
            const sel = selectedBar != null ? view.buckets[selectedBar] : null;
            return (
              <div className="card p-4 mb-3">
                <div className="flex items-baseline justify-between mb-2.5">
                  <p className="text-[11.5px] font-bold" style={{ color: "var(--text-secondary)" }}>
                    Item sales by {daily ? "day" : "week"}
                  </p>
                  <p className="text-[10.5px] tabular-nums" style={{ color: "var(--text-secondary)" }}>
                    {sel
                      ? `${shortDate(sel.start)}${sel.days > 1 ? `–${shortDate(sel.end - 1)}` : ""}: ${money(sel.total)} · ${sel.count} sold`
                      : "Tap a bar for details"}
                  </p>
                </div>
                <div className={`flex items-end ${view.buckets.length > 8 ? "gap-1" : "gap-1.5"}`} style={{ height: 70 }}>
                  {view.buckets.map((b, idx) => (
                    <button
                      key={b.start}
                      type="button"
                      onClick={() => setSelectedBar(idx === selectedBar ? null : idx)}
                      className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0 h-full"
                      aria-label={`${shortDate(b.start)}: ${money(b.total)}`}
                    >
                      {view.buckets.length <= 7 && (
                        <span className="text-[9px] font-semibold tabular-nums" style={{ color: "var(--text-tertiary)" }}>{formatCompactCurrency(b.total)}</span>
                      )}
                      <div
                        className="w-full"
                        style={{
                          height: `${Math.max(3, (b.total / max) * 46)}px`,
                          background: "var(--accent)",
                          opacity: selectedBar === idx ? 1 : b.partial ? 0.45 : 0.8,
                          borderRadius: "5px 5px 2px 2px",
                          transition: "height .3s var(--spring)",
                        }}
                      />
                    </button>
                  ))}
                </div>
                <div className={`flex ${view.buckets.length > 8 ? "gap-1" : "gap-1.5"} mt-1`}>
                  {view.buckets.map((b, idx) => (
                    <span key={b.start} className="flex-1 text-center text-[9px] truncate" style={{ color: "var(--text-tertiary)" }}>
                      {daily
                        ? new Date(b.start).toLocaleDateString("en-US", { weekday: "short" })
                        : view.buckets.length > 8 && idx % 2 === 1 ? "" : shortDate(b.start)}
                    </span>
                  ))}
                </div>
                {view.buckets.some((b) => b.partial) && (
                  <p className="text-[10px] mt-2" style={{ color: "var(--text-tertiary)" }}>
                    Bars start {shortDate(view.period.start)}; the faded last bar covers only {view.buckets[view.buckets.length - 1].days} day{view.buckets[view.buckets.length - 1].days !== 1 ? "s" : ""}. Bars add up to {money(c.itemSales)}.
                  </p>
                )}
              </div>
            );
          })()}

          {/* How to improve */}
          {view.insights.length > 0 && (
            <div className="card p-4 mb-3">
              <p className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                <Lightbulb className="w-4 h-4" style={{ color: "var(--accent)" }} /> How to improve
              </p>
              <ul className="flex flex-col gap-1.5">
                {view.insights.map((t) => (
                  <li key={t.kind} className="text-xs leading-relaxed flex gap-2">
                    <span style={{ color: "var(--accent)" }}>•</span>
                    <span>
                      {t.text}
                      {t.kind === "missing_costs" && (
                        <button type="button" className="underline ml-1" style={{ color: "var(--accent)" }} onClick={() => setShowCostEditor(true)}>Add costs</button>
                      )}
                      {t.kind === "slow_movers" && <Link href="/store" className="underline ml-1" style={{ color: "var(--accent)" }}>See listings</Link>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Top categories */}
          {view.categories.length > 0 && (() => {
            const showMargin = view.categories.some((r) => r.marginPercent != null);
            return (
              <div className="card p-4 mb-3">
                <p className="text-sm font-semibold mb-2">Top categories</p>
                <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ color: "var(--text-tertiary)" }}>
                      <th className="text-left font-medium px-1 pb-1.5">Category</th>
                      <th className="text-right font-medium px-1 pb-1.5">Sold</th>
                      <th className="text-right font-medium px-1 pb-1.5">Sales</th>
                      <th className="text-right font-medium px-1 pb-1.5">{showMargin ? "Margin" : "Share"}</th>
                      <th className="text-right font-medium px-1 pb-1.5">Days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.categories.slice(0, 8).map((r) => (
                      <tr key={r.category} style={{ borderTop: "1px solid var(--border)" }}>
                        <td className="px-1 py-1.5 font-medium truncate max-w-[130px]">{r.category}</td>
                        <td className="text-right px-1 py-1.5 tabular-nums">{r.units}</td>
                        <td className="text-right px-1 py-1.5 tabular-nums">{formatCompactCurrency(r.revenue)}</td>
                        <td className="text-right px-1 py-1.5 tabular-nums" style={{ color: "var(--text-secondary)" }}>
                          {showMargin ? (r.marginPercent != null ? `${r.marginPercent.toFixed(0)}%` : "—") : `${r.share.toFixed(0)}%`}
                        </td>
                        <td className="text-right px-1 py-1.5 tabular-nums" style={{ color: "var(--text-secondary)" }}>
                          {r.avgDaysToSell != null ? `${Math.round(r.avgDaysToSell)}d` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-[10px] mt-2 leading-relaxed" style={{ color: "var(--text-tertiary)" }}>
                  Category comes from eBay, else your store category or the item title.
                  {showMargin && " Margin covers only sales with a cost entered."} Days = listing start to sale
                  {c.avgDaysToSell != null && ` (avg ${Math.round(c.avgDaysToSell)}d across ${c.salesWithDays} sales)`}.
                </p>
              </div>
            );
          })()}

          {/* Top sales */}
          {view.top.length > 0 && (
            <div className="card p-4 mb-4">
              <p className="text-sm font-semibold mb-2">Top sales</p>
              <div className="flex flex-col gap-1.5">
                {view.top.map((s, i) => (
                  <div key={s.key} className="flex items-center gap-2 text-xs">
                    <span className="w-4 text-right tabular-nums" style={{ color: "var(--text-tertiary)" }}>{i + 1}</span>
                    <span className="flex-1 truncate">{s.title}</span>
                    <span className="font-semibold tabular-nums">{money(s.itemTotal)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {view.sales.length === 0 && (
            <div className="card p-8 text-center mb-4">
              <p className="text-sm text-[var(--text-secondary)]">No sales in the last {days} days.</p>
            </div>
          )}

          {/* Sales list — paged, photos load only for rows on screen */}
          {view.sales.length > 0 && (
            <>
              <p className="text-[11.5px] tracking-wide uppercase font-bold mb-2" style={{ color: "var(--text-tertiary)" }}>
                Sales ({view.sales.length})
              </p>
              <div className="flex flex-col gap-2">
                {visibleSales.map((s) => {
                  const fs = s as FeedSale;
                  const thumb = fs.thumbnail ?? thumbs[s.listingId] ?? null;
                  const f = chooseFee(s, feed.feePercent);
                  return (
                    <div key={s.key} className="card p-3 flex items-center gap-3">
                      {thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumb} alt="" loading="lazy" decoding="async" width={48} height={48} className="w-12 h-12 rounded-md object-cover flex-shrink-0" />
                      ) : (
                        <div className="w-12 h-12 rounded-md bg-[var(--bg-page)] flex items-center justify-center flex-shrink-0">
                          <Shirt className="w-5 h-5 text-[var(--text-secondary)]" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{s.title || "Unknown item"}</p>
                        <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                          {new Date(s.soldAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                          {s.qty > 1 ? ` · Qty ${s.qty}` : ""}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                        <p className="text-sm font-medium" style={{ color: "var(--success)" }}>{money(s.itemTotal)}</p>
                        <p className="text-[9.5px]" style={{ color: "var(--text-tertiary)" }}>
                          fee {money(f.fee)}{f.actual ? "" : " est."}
                        </p>
                        <a
                          href={`https://www.ebay.com/itm/${s.listingId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-0.5 text-[10px] text-[var(--text-tertiary)] hover:text-[var(--accent)]"
                        >
                          <ExternalLink className="w-3 h-3" /> eBay
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
              {visibleCount < view.sales.length && (
                <button type="button" className="btn w-full mt-3 text-sm" onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}>
                  Show more ({view.sales.length - visibleCount} left)
                </button>
              )}
              {(feed.truncated || feed.finances.truncated) && (
                <p className="text-[10px] mt-2" style={{ color: "var(--text-tertiary)" }}>
                  eBay returned more history than one load can hold; some older sales may be missing.
                </p>
              )}
            </>
          )}
        </>
      )}
    </main>
  );
}

function Row({ label, value, negative }: { label: string; value: string; negative?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span style={{ color: "var(--text-secondary)" }}>{label}</span>
      <span style={{ color: negative ? "var(--danger)" : undefined }}>{value}</span>
    </div>
  );
}
