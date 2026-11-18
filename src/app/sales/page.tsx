"use client";

// Sales analytics. Loads ~6 months of sales ONCE (GET /api/ebay/sales/analytics,
// cached on the server and in this tab), then every 7d / 30d / 90d view —
// totals, previous-period comparison, chart, categories, tips — is derived
// locally by deriveView() in src/lib/sales-analytics.ts. Switching tabs never
// waits on eBay.

import CurrencyInput from "@/components/CurrencyInput";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Download, ExternalLink, Lightbulb, Loader2, RefreshCw, Shirt,
} from "lucide-react";
import Toast from "@/components/Toast";
import { apiFetch } from "@/lib/api";
import { formatMoney, formatMoneyShort } from "@/lib/format";
import { getPageCache, setPageCache } from "@/lib/page-cache";
import { buildLedger, compareWithSummary, payoutBridge, salesBreakdown, displayLines, LINE_LABELS, type EbaySummaryByStatus, type LedgerTx, type Payout, type PeriodRange } from "@/lib/ledger";
import { saleEconomics, shippingSplit, categoryProfit, collapseCategories, bestAndWorst, staleListings, storeTips, activeCountAt, exactSellThroughTrend, type Snapshot } from "@/lib/store-insights";
import {
  deriveView, chooseFee, resolveCategory, toC, percentChange, type AnalyticsSale, type ActiveListing, type Change, type DatedAmount, type DayRange,
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
  feedStart?: string;
  ledger?: LedgerTx[];
  payouts?: Payout[] | null;
  snapshots?: Snapshot[] | null;
}

type FeedResponse = Partial<Feed> & { error?: string; connect?: boolean; reconnect?: boolean };

const FEED_CACHE_KEY = "sales-analytics-feed";
const FEED_CACHE_MS = 5 * 60_000;
const DAY_OPTIONS: DayRange[] = [7, 30, 90];
const PAGE_SIZE = 20;

const money = formatMoney;
const cents = (c: number) => formatMoney(c / 100);
const pctOf = (part: number, whole: number) => (whole > 0 ? `${((Math.abs(part) / whole) * 100).toFixed(1)}%` : "—");
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

function ChangeBadge({ change, days, note }: { change: Change | null; days: number; note?: string }) {
  const muted = { color: "var(--text-tertiary)" };
  if (!change) return <span className="text-[10.5px]" style={muted}>{note ?? "no comparison"}</span>;
  if (change.pct == null) {
    return <span className="text-[10.5px]" style={muted}>{change.direction === "new" ? `new vs prev ${days}d` : "no sales either period"}</span>;
  }
  if (change.pct === 0) return <span className="text-[10.5px]" style={muted}>— no change vs prev {days}d</span>;
  const up = change.pct > 0;
  return (
    <span className="text-[10.5px] tabular-nums" style={muted}>
      <span className="font-semibold" style={{ color: up ? "var(--success)" : "var(--danger)" }}>
        {up ? "▲" : "▼"} {Math.abs(change.pct)}%
      </span>{" "}
      vs prev {days}d
    </span>
  );
}

/** Small "i" that toggles a one-line explanation, instead of footnote walls. */
function InfoTip({ children, label = "More info" }: { children: React.ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-bold align-middle ml-1"
        style={{ border: "1px solid var(--glass-line)", color: "var(--text-tertiary)" }}
      >
        i
      </button>
      {open && (
        <span className="block text-[10.5px] leading-relaxed mt-1.5 font-normal" style={{ color: "var(--text-tertiary)" }}>
          {children}
        </span>
      )}
    </>
  );
}

/** Tiny trend line for KPI tiles (pure SVG, no library). */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2 || values.every((v) => v === 0)) return null;
  const w = 64, h = 18;
  const max = Math.max(...values), min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 2 - ((v - min) / span) * (h - 4)}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="flex-none">
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />
    </svg>
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
  const [openLine, setOpenLine] = useState<string | null>(null);
  const [showRecon, setShowRecon] = useState(false);
  const [summaries, setSummaries] = useState<Record<string, EbaySummaryByStatus | null | "loading">>({});

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

  // All money from eBay Finances (integer cents, eBay transaction dates).
  const fin = useMemo(() => {
    if (!feed || !view) return null;
    const ledger = feed.ledger ?? [];
    const hasLedger = feed.finances.available && ledger.length > 0;
    const P = view.period;
    const inP = (x: FeedSale, r: PeriodRange) => { const t = Date.parse(x.bookedAt || x.soldAt); return t >= r.start && t < r.end; };
    const tieLines = (r: PeriodRange) => feed.sales
      .filter((x) => x.bookedAt && inP(x, r))
      .map((x) => ({ orderId: x.orderId ?? null, itemCents: toC(x.itemTotal), shippingCents: toC(x.shippingPaid), taxCents: toC(x.taxPaid) }));
    const costIn = (r: PeriodRange) => feed.sales.filter((x) => inP(x, r)).reduce((a, x) => a + (typeof x.costBasis === "number" ? toC(x.costBasis) : 0), 0);

    const L = hasLedger ? buildLedger(ledger, P) : null;
    const sb = L ? salesBreakdown(ledger, P, tieLines(P)) : null;
    const lines = L ? displayLines(ledger, P, L, sb) : null;
    const econ = saleEconomics(view.sales, ledger, P, feed.feePercent);
    const costCents = econ.reduce((a, e) => a + (e.costCents ?? 0), 0);
    // Sales tax is never income: if eBay's sale figure included it, take it back out.
    const taxOut = sb?.taxInPayoutCents ?? 0;
    const profitCents = L ? L.netCents - taxOut - costCents : toC(view.current.profit);
    let prevProfitCents: number | null = null;
    if (view.previous) {
      if (hasLedger) {
        const PL = buildLedger(ledger, view.previousBounds);
        const psb = salesBreakdown(ledger, view.previousBounds, tieLines(view.previousBounds));
        prevProfitCents = PL.netCents - psb.taxInPayoutCents - costIn(view.previousBounds);
      } else {
        prevProfitCents = toC(view.previous.profit);
      }
    }
    // Item sales tile = items on eBay Finances (sales line) + sales eBay hasn't settled yet.
    const awaiting = view.sales.filter((x) => !x.bookedAt);
    const awaitingCents = awaiting.reduce((a, x) => a + toC(x.itemTotal), 0);
    const tileTieDiff = sb ? toC(view.current.itemSales) - (sb.itemCents + awaitingCents) : 0;

    // Sell-through: exact only. Now = live count; past = recorded daily counts (migration 026).
    const liveActive = feed.activeCount ?? null;
    const prevActive = view.previous ? activeCountAt(feed.snapshots, view.previousBounds.end) : null;
    const stPrev = view.previous && prevActive != null ? Math.round((view.previous.units / Math.max(1, view.previous.units + prevActive)) * 1000) / 10 : null;

    const shipping = shippingSplit(view.sales, ledger, P, feed.feePercent);
    const cats = categoryProfit(view.sales, econ);
    const stale = staleListings(feed.active, nowMs);
    return {
      hasLedger,
      L,
      sb,
      lines,
      taxOut,
      econ,
      costCents,
      costedCount: econ.filter((e) => e.costCents != null).length,
      profitCents,
      profitChange: prevProfitCents == null ? null : percentChange(profitCents, prevProfitCents),
      awaitingCount: awaiting.length,
      awaitingCents,
      tileTieDiff,
      stChange: stPrev != null && view.sellThroughNow != null ? percentChange(view.sellThroughNow, stPrev) : null,
      stTrend: exactSellThroughTrend(view.buckets, feed.snapshots, liveActive, nowMs),
      snapshotsOn: feed.snapshots != null,
      shipping,
      cats,
      bw: bestAndWorst(econ),
      stale,
      tips: storeTips({ categories: cats, econ, shipping, stale }),
      bridge: L && feed.payouts ? payoutBridge(ledger, feed.payouts, P) : null,
      unbooked: awaiting.length,
      estFees: econ.filter((e) => !e.feeActual).length,
      titleCategories: view.sales.filter((x) => !x.ebayCategory && !x.storeCategoryName && !x.itemType).length,
      noStartDate: view.sales.filter((x) => !x.listedAt).length,
    };
  }, [feed, view, nowMs]);

  // eBay's own summary for this exact period, to cross-check the ledger.
  const periodKey = view ? `${view.period.start}-${view.period.end}` : "";
  useEffect(() => {
    if (!view || !fin?.hasLedger || periodKey in summaries) return;
    const from = new Date(view.period.start).toISOString();
    const to = new Date(view.period.end).toISOString();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- marks the request in flight
    setSummaries((p) => ({ ...p, [periodKey]: "loading" }));
    apiFetch<{ summary?: EbaySummaryByStatus | null }>(`/api/ebay/finances/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .then((r) => setSummaries((p) => ({ ...p, [periodKey]: r.summary ?? null })))
      .catch(() => setSummaries((p) => ({ ...p, [periodKey]: null })));
  }, [view, fin?.hasLedger, periodKey, summaries]);

  const recon = useMemo(() => {
    if (!feed || !view || !fin?.L) return null;
    const sum = summaries[periodKey];
    const checks = sum && sum !== "loading" ? compareWithSummary(feed.ledger ?? [], view.period, sum) : [];
    const f = fin.L.funds;
    const fundsSum = f.paidOut + f.processing + f.onHold + f.available + f.other;
    const offCents = checks.reduce((a, c) => a + Math.abs(c.diff), 0) + Math.abs(fundsSum - fin.L.netCents) + Math.abs(fin.L.linesSumCents - fin.L.netCents);
    const unrecognized = fin.L.lines.find((l) => l.key === "unclassified");
    return {
      // "Matches eBay" only when eBay's own totals were actually compared.
      state: sum === "loading" || sum === undefined ? "checking" : sum === null || checks.length === 0 ? "no_summary" : offCents === 0 ? "match" : "off",
      checks,
      offCents,
      fundsSum,
      unrecognized,
    } as const;
  }, [feed, view, fin, summaries, periodKey]);

  function switchDays(d: DayRange) {
    setDays(d);
    setOpenLine(null);
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
    <main className="relative min-h-screen max-w-md lg:max-w-[1360px] mx-auto px-5 lg:px-8 pt-6 lg:pt-8 pb-8 overflow-hidden" style={{ viewTransitionName: "sales-panel" }}>
      <div className="bloom d1 stagger" style={{ width: 240, height: 240, top: -70, left: -60, background: "var(--glow-primary)" }} />
      <div className="bloom d1 stagger" style={{ width: 200, height: 200, top: 10, right: -70, background: "var(--glow-success)" }} />

      {/* Header — positioned above the background glow so it never renders blurred */}
      <div className="relative flex items-start gap-3 mb-4">
        <Link
          href="/dashboard"
          className="w-[34px] h-[34px] rounded-[11px] flex items-center justify-center flex-none lg:hidden"
          style={{ background: "var(--glass)", border: "1px solid var(--glass-line)" }}
          aria-label="Back to dashboard"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-medium leading-tight">Sales</h1>
          {view && feed && (
            <p className="text-xs leading-snug" style={{ color: "var(--text-secondary)" }}>
              {shortDate(view.period.start)} – today · updated {new Date(feed.generatedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
            </p>
          )}
        </div>
        {view && view.sales.length > 0 && (
          <button onClick={handleExportCsv} title="Export CSV" aria-label="Export CSV" className="p-2 rounded-lg transition-colors">
            <Download className="w-4 h-4 text-[var(--text-secondary)]" />
          </button>
        )}
        <button
          onClick={() => load(true)}
          disabled={refreshing || loading}
          title="Refresh from eBay"
          aria-label="Refresh from eBay"
          className="p-2 rounded-lg transition-colors"
        >
          {refreshing || loading
            ? <Loader2 className="w-4 h-4 animate-spin text-[var(--text-secondary)]" />
            : <RefreshCw className="w-4 h-4 text-[var(--text-secondary)]" />}
        </button>
      </div>

      {/* Range tabs — instant, no network. Solid surface (no overflow clip)
          so iOS Safari doesn't paint the blurred background through it unevenly. */}
      <div
        role="tablist"
        aria-label="Date range"
        className="relative grid grid-cols-3 p-[3px] mb-4 rounded-xl"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--glass-line)" }}
      >
        <div
          className="absolute rounded-lg pointer-events-none"
          style={{
            top: 3, bottom: 3,
            left: `calc(3px + ${activeIndex} * (100% - 6px) / 3)`,
            width: "calc((100% - 6px) / 3)",
            background: "var(--accent-tint)",
            border: "1px solid var(--accent)",
            transition: "left .25s var(--spring)",
          }}
        />
        {DAY_OPTIONS.map((d) => (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={days === d}
            onClick={() => switchDays(d)}
            className="tap relative z-10 text-sm py-2 font-semibold"
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
          {/* Desktop (lg): 3 columns — profit | where the money goes | KPIs + chart. Phones: one column, same order as before. */}
          <div className="lg:grid lg:grid-cols-3 lg:gap-4 lg:items-start">
          <div className="min-w-0">
          {/* Hero: profit first, money from eBay Finances */}
          {fin && (
            <div className="card p-4 mb-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                  {fin.costedCount === view.sales.length && view.sales.length > 0 ? "Profit" : "Profit before item costs"}
                  <InfoTip label="What's in this profit">
                    {fin.hasLedger
                      ? "Your eBay net for these dates (every sale, fee, label, ad, refund and credit on your eBay account, dated by eBay's transaction date)"
                      : "Estimated: item sales + buyer shipping − estimated eBay fees"}
                    {fin.costedCount > 0 ? ", minus the item costs you've entered." : "."}
                    {fin.costedCount < view.sales.length && ` ${view.sales.length - fin.costedCount} sale${view.sales.length - fin.costedCount !== 1 ? "s have" : " has"} no item cost yet, so true profit is lower.`}
                  </InfoTip>
                </p>
                {recon ? (
                  <button
                    type="button"
                    onClick={() => setShowRecon((v) => !v)}
                    className="tap text-[10.5px] font-semibold rounded-full px-2.5 py-1"
                    style={{
                      background: recon.state === "off" ? "color-mix(in srgb, var(--danger) 14%, transparent)" : "color-mix(in srgb, var(--success) 14%, transparent)",
                      color: recon.state === "off" ? "var(--danger)" : recon.state === "checking" ? "var(--text-secondary)" : "var(--success)",
                    }}
                  >
                    {recon.state === "match" ? "✓ Matches eBay" : recon.state === "off" ? `Off by ${cents(recon.offCents)}` : recon.state === "checking" ? "Checking with eBay…" : "✓ From eBay Finances"}
                  </button>
                ) : (
                  <span className="text-[10.5px] rounded-full px-2.5 py-1" style={{ background: "var(--glass)", color: "var(--text-tertiary)" }}>Estimate</span>
                )}
              </div>
              <div className="flex items-end justify-between gap-3 mt-1">
                <p className="font-display font-extrabold text-[34px] leading-none tabular-nums" style={{ color: fin.profitCents >= 0 ? "var(--text-primary)" : "var(--danger)" }}>
                  {cents(fin.profitCents)}
                </p>
                <ChangeBadge change={fin.profitChange} days={days} note={days === 90 ? "eBay keeps 90 days" : undefined} />
              </div>
              <p className="text-xs mt-2 tabular-nums" style={{ color: "var(--text-secondary)" }}>
                {money(c.itemSales)} item sales · {c.units.toLocaleString("en-US")} item{c.units !== 1 ? "s" : ""} sold
              </p>
              {fin.costedCount < view.sales.length && (
                <button
                  type="button"
                  onClick={() => setShowCostEditor(true)}
                  className="tap mt-3 w-full text-left text-xs font-semibold rounded-xl px-3 py-2"
                  style={{ background: "var(--accent-tint)", color: "var(--accent)", border: "1px solid color-mix(in srgb, var(--accent) 40%, transparent)" }}
                >
                  + Add item costs to see true profit ({view.sales.length - fin.costedCount} missing)
                </button>
              )}
              {!fin.hasLedger && (
                <p className="text-[10.5px] mt-3" style={{ color: "var(--text-tertiary)" }}>
                  These are estimates. <a href="/api/ebay/connect" className="underline">Reconnect eBay</a> (Finances access) for exact numbers from your account.
                </p>
              )}

              {/* Reconciliation details */}
              {showRecon && recon && fin.L && (
                <div className="mt-3 pt-3 text-[11px] tabular-nums flex flex-col gap-2" style={{ borderTop: "1px solid var(--border)" }}>
                  <p className="font-semibold text-xs">Check against your eBay account</p>
                  {recon.checks.length > 0 ? (
                    recon.checks.map((ch) => (
                      <div key={ch.label} className="flex justify-between gap-2">
                        <span style={{ color: "var(--text-secondary)" }}>{ch.label}: ours {cents(ch.ours)} · eBay {cents(ch.ebay)}</span>
                        <span style={{ color: ch.diff === 0 ? "var(--success)" : "var(--danger)" }}>{ch.diff === 0 ? "✓" : `${ch.diff > 0 ? "+" : "−"}${cents(Math.abs(ch.diff))}`}</span>
                      </div>
                    ))
                  ) : (
                    <p style={{ color: "var(--text-tertiary)" }}>
                      {recon.state === "checking" ? "Asking eBay for its own totals…" : "eBay's summary wasn't available to cross-check; totals below come straight from your eBay transactions."}
                    </p>
                  )}
                  <div className="flex justify-between gap-2">
                    <span style={{ color: "var(--text-secondary)" }}>Lines add up to eBay net ({fin.L.txCount} transactions)</span>
                    <span style={{ color: fin.L.linesSumCents === fin.L.netCents ? "var(--success)" : "var(--danger)" }}>{fin.L.linesSumCents === fin.L.netCents ? "✓" : cents(fin.L.linesSumCents - fin.L.netCents)}</span>
                  </div>
                  <p className="font-semibold text-xs mt-1">Where your {cents(fin.L.netCents)} eBay net is now</p>
                  {([
                    ["Paid out to your bank", fin.L.funds.paidOut],
                    ["Processing", fin.L.funds.processing],
                    ["On hold", fin.L.funds.onHold],
                    ["Available for payout", fin.L.funds.available],
                    ["Other status", fin.L.funds.other],
                  ] as const).filter(([, v]) => v !== 0).map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-2"><span style={{ color: "var(--text-secondary)" }}>{k}</span><span>{cents(v)}</span></div>
                  ))}
                  <div className="flex justify-between gap-2">
                    <span style={{ color: "var(--text-secondary)" }}>Adds up to the net</span>
                    <span style={{ color: recon.fundsSum === fin.L.netCents ? "var(--success)" : "var(--danger)" }}>{recon.fundsSum === fin.L.netCents ? "✓" : cents(recon.fundsSum - fin.L.netCents)}</span>
                  </div>
                  {fin.bridge && (
                    <>
                      <p className="font-semibold text-xs mt-1">Payouts sent to your bank in these dates: {cents(fin.bridge.payoutsSentCents)}</p>
                      <p style={{ color: "var(--text-tertiary)" }}>
                        Net {cents(fin.L.netCents)} − payouts {cents(fin.bridge.payoutsSentCents)} = not paid out yet {cents(fin.bridge.notYetPaidCents)} − money from earlier dates {cents(fin.bridge.fromEarlierCents)}.
                      </p>
                    </>
                  )}
                  {recon.unrecognized && (
                    <p style={{ color: "var(--danger)" }}>{cents(recon.unrecognized.cents)} is in transaction types Listflow doesn&apos;t recognize — shown as its own line below.</p>
                  )}
                  <p className="font-semibold text-xs mt-1">What isn&apos;t from eBay</p>
                  <ul className="flex flex-col gap-0.5" style={{ color: "var(--text-tertiary)" }}>
                    <li>• Item costs: what you entered ({fin.costedCount} of {view.sales.length} sales).</li>
                    {fin.estFees > 0 && <li>• {fin.estFees} per-sale fee{fin.estFees !== 1 ? "s" : ""} in the category/best-worst tables are estimated (sales eBay hasn&apos;t settled yet). The totals above use eBay&apos;s real fees.</li>}
                    {fin.titleCategories > 0 && <li>• {fin.titleCategories} sale{fin.titleCategories !== 1 ? "s" : ""} grouped by title keywords (eBay didn&apos;t return a category).</li>}
                    {fin.noStartDate > 0 && <li>• {fin.noStartDate} sale{fin.noStartDate !== 1 ? "s" : ""} left out of days-to-sell: no real listing start date.</li>}
                    <li>• Labels bought outside eBay aren&apos;t on your eBay account.</li>
                  </ul>
                  {fin.unbooked > 0 && (
                    <p style={{ color: "var(--text-tertiary)" }}>{fin.unbooked} sale{fin.unbooked !== 1 ? "s" : ""} aren&apos;t in eBay Finances yet (just sold); they&apos;re dated by order date.</p>
                  )}
                  {(feed.truncated || feed.finances.truncated) && <p style={{ color: "var(--danger)" }}>eBay returned more history than one load holds — some transactions may be missing.</p>}
                </div>
              )}
            </div>
          )}

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
                          <CurrencyInput
                            size="sm"
                            className="w-24"
                            placeholder="0.00"
                            value={costInputs[s.key] ?? ""}
                            onChange={(v) => setCostInputs((p) => ({ ...p, [s.key]: v }))}
                            onKeyDown={(e) => { if (e.key === "Enter" && (costInputs[s.key] ?? "").trim() && costSaving !== s.key) { e.preventDefault(); void saveCost(s); } }}
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

          </div>
          <div className="min-w-0">
          {/* Where the money goes — tap a line to see the transactions behind it */}
          {fin && (() => {
            type WRow = { key: string; label: string; cents: number; detail: "ledger" | "costs" | null; txIds?: string[]; part?: boolean; note?: string };
            const rows: WRow[] = fin.lines
              ? [
                  ...fin.lines.map((l) => ({
                    key: l.key, label: l.label, cents: l.cents, txIds: l.txIds, part: l.part, note: l.note,
                    detail: l.part ? null : ("ledger" as const),
                  })),
                  ...(fin.taxOut ? [{ key: "tax_out", label: "Less sales tax (not your income)", cents: -fin.taxOut, detail: null }] : []),
                  { key: "costs", label: `Item costs (${fin.costedCount}/${view.sales.length} entered)`, cents: -fin.costCents, detail: "costs" as const },
                ]
              : [
                  { key: "sales", label: "Item sales", cents: toC(c.itemSales), detail: null },
                  { key: "ship", label: "Shipping paid by buyers", cents: toC(c.shippingPaidByBuyers), detail: null },
                  { key: "fees", label: `eBay fees (estimated, ${feed.feePercent}%)`, cents: -toC(c.fees), detail: null },
                  { key: "costs", label: `Item costs (${fin.costedCount}/${view.sales.length} entered)`, cents: -fin.costCents, detail: "costs" as const },
                ];
            // Percentages are a share of SALES (the first line), so profit reads as a margin.
            const base = Math.max(1, fin.L ? fin.L.salesCents : toC(c.itemSales) + toC(c.shippingPaidByBuyers));
            const ledgerById = new Map((feed.ledger ?? []).map((t) => [t.id, t]));
            return (
              <div className="card p-4 mb-3">
                <p className="text-sm font-semibold mb-3">
                  Where the money goes
                  <InfoTip label="About this breakdown">
                    {fin.hasLedger
                      ? `Straight from your eBay Finances transactions dated ${shortDate(view.period.start)} – today. Percentages are a share of sales. Indented lines break sales into item prices and shipping and tie to the Item sales tile. Tap a line to see each transaction.`
                      : "Estimated from your orders. Reconnect eBay for exact numbers."}
                  </InfoTip>
                </p>
                <div className="flex flex-col gap-2.5">
                  {rows.map((r) => {
                    const open = openLine === r.key;
                    const positive = r.cents >= 0;
                    if (r.part) {
                      return (
                        <div key={r.key} className="flex justify-between gap-2 text-[11px] tabular-nums pl-3 -mt-1" style={{ color: "var(--text-tertiary)" }}>
                          <span>↳ {r.label}</span>
                          <span>{cents(r.cents)}<span className="ml-1.5">{pctOf(r.cents, base)}</span></span>
                        </div>
                      );
                    }
                    return (
                      <div key={r.key}>
                        <button
                          type="button"
                          disabled={!r.detail}
                          onClick={() => setOpenLine(open ? null : r.key)}
                          className="w-full text-left"
                          aria-expanded={open}
                        >
                          <div className="flex justify-between gap-2 text-xs tabular-nums">
                            <span style={{ color: "var(--text-secondary)" }}>
                              {r.label}{r.detail && <span className="ml-1" style={{ color: "var(--text-tertiary)" }}>{open ? "▾" : "▸"}</span>}
                              {r.note && <span className="block text-[10.5px]" style={{ color: "var(--success)" }}>{r.note}</span>}
                            </span>
                            <span className="font-semibold" style={{ color: positive ? "var(--text-primary)" : "var(--danger)" }}>
                              {positive ? "" : "−"}{cents(Math.abs(r.cents))}
                              <span className="font-normal ml-1.5" style={{ color: "var(--text-tertiary)" }}>{pctOf(r.cents, base)}</span>
                            </span>
                          </div>
                          <div className="h-1.5 rounded-full mt-1" style={{ background: "var(--glass)" }}>
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${Math.min(100, (Math.abs(r.cents) / base) * 100)}%`, background: positive ? "var(--success)" : "var(--danger)", opacity: 0.85 }}
                            />
                          </div>
                        </button>
                        {open && r.detail === "ledger" && (
                          <div className="mt-2 flex flex-col gap-1 text-[11px] tabular-nums max-h-64 overflow-y-auto">
                            {(r.txIds ?? [])
                              .map((id) => ledgerById.get(id))
                              .filter((t): t is LedgerTx => Boolean(t))
                              .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
                              .map((t) => {
                                const amt = r.key === "fees" ? -t.feeCents : r.key === "sales" ? t.amountCents + t.feeCents : t.amountCents;
                                return (
                                  <div key={`${r.key}-${t.id}`} className="flex justify-between gap-2">
                                    <span className="truncate" style={{ color: "var(--text-tertiary)" }}>
                                      {shortDate(Date.parse(t.date))} · {t.memo || t.feeType?.replace(/_/g, " ").toLowerCase() || LINE_LABELS[r.key as keyof typeof LINE_LABELS]}
                                      {t.orderId ? ` · ${t.orderId}` : ""}
                                    </span>
                                    <span style={{ color: amt < 0 ? "var(--danger)" : "var(--text-secondary)" }}>{amt < 0 ? "−" : ""}{cents(Math.abs(amt))}</span>
                                  </div>
                                );
                              })}
                          </div>
                        )}
                        {open && r.detail === "costs" && (
                          <div className="mt-2 flex flex-col gap-1 text-[11px] tabular-nums max-h-64 overflow-y-auto">
                            {fin.econ.filter((e) => e.costCents != null).length === 0 ? (
                              <button type="button" className="text-left underline" style={{ color: "var(--accent)" }} onClick={() => setShowCostEditor(true)}>No costs entered yet — add them</button>
                            ) : (
                              fin.econ.filter((e) => e.costCents != null).map((e) => (
                                <div key={e.key} className="flex justify-between gap-2">
                                  <span className="truncate" style={{ color: "var(--text-tertiary)" }}>{e.title}</span>
                                  <span>{cents(e.costCents as number)}</span>
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <div className="flex justify-between gap-2 pt-2.5 text-sm font-semibold tabular-nums" style={{ borderTop: "1px solid var(--border)" }}>
                    <span>{fin.costedCount === view.sales.length && view.sales.length > 0 ? "Profit" : "Profit before item costs"}</span>
                    <span style={{ color: fin.profitCents >= 0 ? "var(--success)" : "var(--danger)" }}>
                      {cents(fin.profitCents)}
                      <span className="font-normal text-[11px] ml-1.5" style={{ color: "var(--text-tertiary)" }}>{pctOf(fin.profitCents, base)}</span>
                    </span>
                  </div>
                </div>
              </div>
            );
          })()}

          </div>
          <div className="min-w-0">
          {/* KPI tiles */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            {[
              { label: "Item sales", value: money(c.itemSales), change: view.changes.itemSales, spark: view.buckets.map((b) => b.total) },
              { label: "Items sold", value: c.units.toLocaleString("en-US"), change: view.changes.units, spark: view.buckets.map((b) => b.units) },
              { label: "Avg sale price", value: c.avgSalePrice != null ? money(c.avgSalePrice) : "—", change: view.changes.avgSalePrice, spark: view.buckets.filter((b) => b.units > 0).map((b) => b.total / b.units) },
            ].map((k) => (
              <div key={k.label} className="card p-3">
                <div className="flex items-start justify-between gap-1">
                  <p className="text-[10.5px] font-medium" style={{ color: "var(--text-tertiary)" }}>{k.label}</p>
                  <Sparkline values={k.spark} />
                </div>
                <p className="font-display font-extrabold text-lg tabular-nums leading-tight mt-0.5">{k.value}</p>
                <ChangeBadge change={k.change} days={days} note={days === 90 ? "no prior 90d" : undefined} />
              </div>
            ))}
            <div className="card p-3">
              <p className="text-[10.5px] font-medium" style={{ color: "var(--text-tertiary)" }}>
                Sell-through
                <InfoTip label="How sell-through is worked out">
                  Items sold ÷ (items sold + {(feed.activeCount ?? feed.active.length).toLocaleString("en-US")} listings active right now, from eBay).
                  {fin?.snapshotsOn
                    ? " Past periods and the trend use the active count Listflow recorded that day; they appear once enough days are recorded."
                    : " eBay doesn't keep past active counts, so comparisons and the trend start once daily recording is switched on (database update 026)."}
                </InfoTip>
              </p>
              <div className="flex items-end justify-between gap-1">
                <p className="font-display font-extrabold text-lg tabular-nums leading-tight mt-0.5">{view.sellThroughNow != null ? `${view.sellThroughNow}%` : "—"}</p>
                {fin?.stTrend && <Sparkline values={fin.stTrend} />}
              </div>
              {fin?.stChange ? <ChangeBadge change={fin.stChange} days={days} /> : (
                <span className="text-[10.5px]" style={{ color: "var(--text-tertiary)" }}>{fin?.snapshotsOn ? "building history…" : "of active stock now"}</span>
              )}
            </div>
          </div>
          {fin?.sb && (
            <p className="text-[10.5px] mb-1 px-1" style={{ color: "var(--text-tertiary)" }}>
              Dates are eBay transaction dates. Item sales {money(c.itemSales)} = {cents(fin.sb.itemCents)} settled on eBay Finances
              {fin.awaitingCount > 0 ? ` + ${cents(fin.awaitingCents)} from ${fin.awaitingCount} sale${fin.awaitingCount !== 1 ? "s" : ""} eBay hasn't settled yet` : ""}
              {fin.tileTieDiff === 0 ? " ✓" : ` (differs by ${cents(fin.tileTieDiff)})`}
            </p>
          )}
          {view.previous && (
            <p className="text-[10.5px] mb-3 px-1" style={{ color: "var(--text-tertiary)" }}>
              Previous {days} days ({shortDate(view.previousBounds.start)} – {shortDate(view.previousBounds.end - 1)}): {money(view.previous.itemSales)} · {view.previous.units} items
              {(feed.excluded.cancelled > 0 || feed.excluded.awaitingPayment > 0) &&
                ` · not counted: ${feed.excluded.cancelled} cancelled${feed.excluded.awaitingPayment ? `, ${feed.excluded.awaitingPayment} unpaid` : ""}`}
            </p>
          )}

          {/* Chart: bars line up with the period and add up to the total */}
          {view.sales.length > 0 && (() => {
            const max = Math.max(1, ...view.buckets.map((b) => b.total));
            const daily = days <= 7;
            const sel = selectedBar != null ? view.buckets[selectedBar] : null;
            const dense = view.buckets.length > 8;
            const last = view.buckets[view.buckets.length - 1];
            return (
              <div className="card p-4 mb-3">
                <div className="flex items-baseline justify-between mb-3">
                  <p className="text-sm font-semibold">
                    Item sales by {daily ? "day" : "week"}
                    {!daily && last?.partial && (
                      <InfoTip label="About the last bar">
                        Weeks start {shortDate(view.period.start)}. The striped last bar is a partial week ({last.days} day{last.days !== 1 ? "s" : ""}). Bars add up to {money(c.itemSales)}.
                      </InfoTip>
                    )}
                  </p>
                  <p className="text-[11px] tabular-nums" style={{ color: "var(--text-secondary)" }}>
                    {sel ? `${shortDate(sel.start)}${sel.days > 1 ? `–${shortDate(sel.end - 1)}` : ""} · ${sel.count} sold` : "Tap a bar"}
                  </p>
                </div>
                <div className={`flex items-end ${dense ? "gap-1" : "gap-2"}`} style={{ height: 92 }}>
                  {view.buckets.map((b, idx) => {
                    const active = selectedBar === idx;
                    const showLabel = !dense || active;
                    return (
                      <button
                        key={b.start}
                        type="button"
                        onClick={() => setSelectedBar(active ? null : idx)}
                        className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0 h-full rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                        aria-label={`${shortDate(b.start)}: ${money(b.total)}`}
                        aria-pressed={active}
                        title={`${shortDate(b.start)}: ${money(b.total)} — click for details`}
                      >
                        {showLabel && (
                          <span className="text-[10px] font-semibold tabular-nums whitespace-nowrap" style={{ color: active ? "var(--accent)" : "var(--text-secondary)" }}>
                            {formatMoneyShort(b.total)}
                          </span>
                        )}
                        <div
                          className="w-full"
                          style={{
                            height: `${Math.max(6, (b.total / max) * 64)}px`,
                            borderRadius: "6px 6px 3px 3px",
                            background: b.partial
                              ? "repeating-linear-gradient(135deg, var(--accent) 0 5px, color-mix(in srgb, var(--accent) 55%, transparent) 5px 9px)"
                              : "var(--accent)",
                            opacity: selectedBar == null || active ? 1 : 0.55,
                            transition: "height .3s var(--spring), opacity .15s",
                          }}
                        />
                      </button>
                    );
                  })}
                </div>
                <div className={`flex ${dense ? "gap-1" : "gap-2"} mt-1.5`}>
                  {view.buckets.map((b, idx) => (
                    <span key={b.start} className="flex-1 text-center text-[10px] truncate" style={{ color: "var(--text-tertiary)" }}>
                      {daily
                        ? new Date(b.start).toLocaleDateString("en-US", { weekday: "short" })
                        : dense && idx % 3 !== 0 ? "" : shortDate(b.start)}
                    </span>
                  ))}
                </div>
                {sel && (
                  <p className="text-xs mt-2 tabular-nums" style={{ color: "var(--text-secondary)" }}>
                    <span className="font-semibold" style={{ color: "var(--text-primary)" }}>{money(sel.total)}</span> from {sel.count} sale{sel.count !== 1 ? "s" : ""}
                    {sel.partial ? ` (partial: ${sel.days} day${sel.days !== 1 ? "s" : ""})` : ""}
                  </p>
                )}
              </div>
            );
          })()}

          </div>
          </div>
          <div className="lg:grid lg:grid-cols-3 lg:gap-4 lg:items-start">
          <div className="min-w-0">
          {/* Shipping: legacy free-shipping vs calculated, no nagging */}
          {fin?.hasLedger && view.sales.length > 0 && (
            <div className="card p-4 mb-3">
              <p className="text-sm font-semibold mb-2">
                Shipping
                <InfoTip label="About shipping">
                  What buyers paid for shipping vs what eBay labels cost, by listing type. Labels bought outside eBay aren&apos;t on your eBay account, so they can&apos;t show here.
                </InfoTip>
              </p>
              <table className="w-full text-xs tabular-nums" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ color: "var(--text-tertiary)" }}>
                    <th className="text-left font-medium pb-1.5">Listings</th>
                    <th className="text-right font-medium pb-1.5">Sales</th>
                    <th className="text-right font-medium pb-1.5">Buyers paid</th>
                    <th className="text-right font-medium pb-1.5">Labels</th>
                    <th className="text-right font-medium pb-1.5">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {([["Calculated", fin.shipping.calculated], ["Free (older listings)", fin.shipping.free]] as const).map(([label, g]) => (
                    <tr key={label} style={{ borderTop: "1px solid var(--border)" }}>
                      <td className="py-1.5">{label}</td>
                      <td className="text-right py-1.5">{g.sales}</td>
                      <td className="text-right py-1.5">{cents(g.buyerPaidCents)}</td>
                      <td className="text-right py-1.5">{cents(g.labelCents)}</td>
                      <td className="text-right py-1.5 font-semibold" style={{ color: g.netCents < 0 ? "var(--danger)" : "var(--success)" }}>
                        {g.netCents < 0 ? "−" : ""}{cents(Math.abs(g.netCents))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {fin.shipping.unlinkedLabelCents !== 0 && (
                <p className="text-[10.5px] mt-2" style={{ color: "var(--text-tertiary)" }}>
                  + {cents(fin.shipping.unlinkedLabelCents)} in labels not tied to a sale shown here (e.g. a label for an older sale).
                </p>
              )}
            </div>
          )}

          {/* How to improve — actionable tips from real data */}
          {fin && fin.tips.length > 0 && (
            <div className="card p-4 mb-3">
              <p className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                <Lightbulb className="w-4 h-4" style={{ color: "var(--accent)" }} /> How to improve
              </p>
              <ul className="flex flex-col gap-2">
                {fin.tips.map((t) => (
                  <li key={t.kind} className="text-xs leading-relaxed flex gap-2">
                    <span style={{ color: "var(--accent)" }}>•</span>
                    <span>
                      {t.text}
                      {t.kind === "missing_costs" && (
                        <button type="button" className="underline ml-1" style={{ color: "var(--accent)" }} onClick={() => setShowCostEditor(true)}>Add costs</button>
                      )}
                      {t.kind === "stale" && <Link href="/store" className="underline ml-1" style={{ color: "var(--accent)" }}>See listings</Link>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          </div>
          <div className="min-w-0">
          {/* Profit by category */}
          {fin && fin.cats.length > 0 && (() => {
            const anyMargin = fin.cats.some((r) => r.marginPercent != null);
            return (
              <div className="card p-4 mb-3">
                <p className="text-sm font-semibold mb-2">
                  Profit by category
                  <InfoTip label="About categories">
                    Net = what buyers paid (item + shipping) − eBay fees − eBay labels for those orders − item costs you entered. Category comes from eBay, else your store category or the title. Days = listing start to sale.
                    {!anyMargin && " Margin appears once every sale in a category has a cost."}
                  </InfoTip>
                </p>
                <table className="w-full text-xs tabular-nums" style={{ borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ color: "var(--text-tertiary)" }}>
                      <th className="text-left font-medium px-1 pb-1.5">Category</th>
                      <th className="text-right font-medium px-1 pb-1.5">Sold</th>
                      <th className="text-right font-medium px-1 pb-1.5">Net</th>
                      <th className="text-right font-medium px-1 pb-1.5">{anyMargin ? "Margin" : "Per item"}</th>
                      <th className="text-right font-medium px-1 pb-1.5">Days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {collapseCategories(fin.cats, 8).map((r) => (
                      <tr key={r.category} style={{ borderTop: "1px solid var(--border)" }}>
                        <td className="px-1 py-1.5 font-medium truncate max-w-[130px]">{r.category}</td>
                        <td className="text-right px-1 py-1.5">{r.units}</td>
                        <td className="text-right px-1 py-1.5" style={{ color: r.netCents < 0 ? "var(--danger)" : undefined }}>{formatMoneyShort(r.netCents / 100)}</td>
                        <td className="text-right px-1 py-1.5" style={{ color: "var(--text-secondary)" }}>
                          {anyMargin ? (r.marginPercent != null ? `${r.marginPercent.toFixed(0)}%` : "—") : cents(r.netPerItemCents)}
                        </td>
                        <td className="text-right px-1 py-1.5" style={{ color: "var(--text-secondary)" }}>{r.avgDaysToSell != null ? `${Math.round(r.avgDaysToSell)}d` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                      <td className="px-1 py-1.5 font-semibold">Total</td>
                      <td className="text-right px-1 py-1.5 font-semibold">{fin.cats.reduce((a, r) => a + r.units, 0)}</td>
                      <td className="text-right px-1 py-1.5 font-semibold">{formatMoneyShort(fin.cats.reduce((a, r) => a + r.netCents, 0) / 100)}</td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
                {c.avgDaysToSell != null && (
                  <p className="text-[10.5px] mt-2" style={{ color: "var(--text-tertiary)" }}>Average {Math.round(c.avgDaysToSell)} days from listing to sale ({c.salesWithDays} sales with a known start date).</p>
                )}
              </div>
            );
          })()}

          {/* Best and worst sales */}
          {fin && fin.econ.length >= 2 && (
            <div className="card p-4 mb-3">
              <p className="text-sm font-semibold mb-2">
                Best &amp; worst sales
                <InfoTip label="How these are ranked">Ranked by net after eBay fees, the eBay label for that order and your item cost (when entered).</InfoTip>
              </p>
              {([["Best", fin.bw.best, "var(--success)"], ["Worst", fin.bw.worst, "var(--danger)"]] as const).map(([label, list, color]) => (
                list.length > 0 && (
                  <div key={label} className="mb-2 last:mb-0">
                    <p className="text-[10.5px] font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--text-tertiary)" }}>{label}</p>
                    {list.map((e) => (
                      <div key={e.key} className="flex items-center gap-2 text-xs py-0.5 tabular-nums">
                        <span className="flex-1 truncate">{e.title}</span>
                        <span style={{ color: "var(--text-tertiary)" }}>{cents(e.grossCents)}</span>
                        <span className="font-semibold w-16 text-right" style={{ color: e.netCents < 0 ? "var(--danger)" : color }}>
                          {e.netCents < 0 ? "−" : ""}{cents(Math.abs(e.netCents))}
                        </span>
                      </div>
                    ))}
                  </div>
                )
              ))}
            </div>
          )}

          </div>
          <div className="min-w-0">
          {/* Stale listings */}
          {fin && feed.active.length > 0 && (() => {
            const total = fin.stale.bands.reduce((a, b) => a + b.count, 0) || 1;
            const colors = ["var(--success)", "var(--accent)", "color-mix(in srgb, var(--danger) 60%, var(--accent))", "var(--danger)"];
            return (
              <div className="card p-4 mb-4">
                <p className="text-sm font-semibold mb-2">
                  Active listings by age
                  <InfoTip label="About listing age">Days since each active listing started on eBay. Listings 60+ days old are the first candidates for a price drop or refresh.</InfoTip>
                </p>
                <div className="flex h-2.5 rounded-full overflow-hidden mb-2" role="img" aria-label="Listing age distribution">
                  {fin.stale.bands.map((b, i) => (b.count > 0 ? <div key={b.label} style={{ width: `${(b.count / total) * 100}%`, background: colors[i] }} /> : null))}
                </div>
                <div className="grid grid-cols-4 gap-1 text-[10.5px] tabular-nums mb-2">
                  {fin.stale.bands.map((b, i) => (
                    <div key={b.label}>
                      <span className="inline-block w-2 h-2 rounded-full mr-1 align-middle" style={{ background: colors[i] }} />
                      <span style={{ color: "var(--text-secondary)" }}>{b.count.toLocaleString("en-US")}</span>
                      <p style={{ color: "var(--text-tertiary)" }}>{b.label}</p>
                    </div>
                  ))}
                </div>
                {fin.stale.oldest.length > 0 && (
                  <>
                    <p className="text-[10.5px] font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--text-tertiary)" }}>Oldest</p>
                    {fin.stale.oldest.map((a) => (
                      <a key={a.listingId} href={`https://www.ebay.com/itm/${a.listingId}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-xs py-0.5">
                        <span className="flex-1 truncate">{a.title}</span>
                        <span className="tabular-nums" style={{ color: "var(--text-tertiary)" }}>{a.price != null ? money(a.price) : ""}</span>
                        <span className="tabular-nums w-12 text-right" style={{ color: "var(--danger)" }}>{a.daysLive}d</span>
                      </a>
                    ))}
                  </>
                )}
              </div>
            );
          })()}

          </div>
          </div>
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
