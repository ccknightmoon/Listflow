"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import NeedsAttention from "@/components/NeedsAttention";
import { getPublishQueue, type PublishItem } from "@/lib/publish-queue";
import Link from "next/link";
import { Plus, ImagePlus, FileText, BarChart2, TrendingUp } from "lucide-react";
import MorphLink from "@/components/MorphLink";
import { createBrowserClient } from "@supabase/ssr";
import { apiFetch } from "@/lib/api";
import { bucketRevenue, type BucketableSale } from "@/lib/sales-buckets";
import { formatMoney, formatMoneyShort } from "@/lib/format";
import { useCountUp } from "@/lib/use-count-up";
import { getPageCache, setPageCache } from "@/lib/page-cache";

// See src/lib/page-cache.ts. Each of this page's four independent fetches
// gets its own entry so the hero tile can show last session's numbers the
// instant you land here, while all four quietly refetch in the background.
const STATS_CACHE_KEY = "dashboard:stats";
const SHIP_COUNT_CACHE_KEY = "dashboard:shipCount";
const DISPLAY_NAME_CACHE_KEY = "dashboard:displayName";
const TREND_SALES_CACHE_KEY = "dashboard:trendSales";
const PENDING_OFFERS_CACHE_KEY = "dashboard:pendingOffers";
const BUYER_QUESTIONS_CACHE_KEY = "dashboard:buyerQuestions";
const STALE_LISTINGS_CACHE_KEY = "dashboard:staleListings";
const DRAFT_GAPS_CACHE_KEY = "dashboard:draftGaps";
const NO_ITEMS: PublishItem[] = [];

interface DashboardSummaryResponse {
  connected?: boolean;
  drafts?: number | null;
  active?: number | null;
  weeklyRevenue?: number | null;
  weeklySales?: number | null;
  trendSales?: BucketableSale[] | null;
  shipCount?: number | null;
  pendingOffers?: number | null;
  buyerQuestions?: number | null;
  staleListings?: number | null;
}

interface Stats {
  drafts: number | null;
  active: number | null;
  weeklyRevenue: number | null;
  weeklySales: number | null;
}

// How far back the hero tile's trend sparkline looks — 4 whole weeks,
// matching a typical "how's business been lately" glance rather than the
// full history the Sales page itself offers.
const TREND_DAYS = 28;

function greeting(hour: number) {
  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(() => getPageCache<Stats>(STATS_CACHE_KEY) ?? null);
  const [statsLoaded, setStatsLoaded] = useState(() => getPageCache<Stats>(STATS_CACHE_KEY) !== undefined);
  const [shipCount, setShipCount] = useState<number | null>(() => getPageCache<number>(SHIP_COUNT_CACHE_KEY) ?? null);
  const [displayName, setDisplayName] = useState<string | null>(() => getPageCache<string>(DISPLAY_NAME_CACHE_KEY) ?? null);
  const [eyebrow, setEyebrow] = useState("Welcome back");
  // Backs the hero tile's trend sparkline — null until loaded (or if it
  // fails, which just means the tile shows no sparkline, same as today).
  const [trendSales, setTrendSales] = useState<BucketableSale[] | null>(() => getPageCache<BucketableSale[]>(TREND_SALES_CACHE_KEY) ?? null);
  // Best Offers pending a response -- see store/page.tsx's "Pending
  // offers" card for why this isn't a bottom-nav badge (one GetBestOffers
  // call per active listing makes it too expensive to fire on every
  // in-app navigation). Firing it once here, when the dashboard itself
  // loads, is the same cost class as the other independent fetches below.
  const [pendingOffersCount, setPendingOffersCount] = useState<number | null>(() => getPageCache<number>(PENDING_OFFERS_CACHE_KEY) ?? null);
  // Unanswered buyer questions -- same cost class as pending offers (one
  // cheap call, fired once when the dashboard loads), so it's fine to
  // check on every visit the same way.
  const [buyerQuestionsCount, setBuyerQuestionsCount] = useState<number | null>(() => getPageCache<number>(BUYER_QUESTIONS_CACHE_KEY) ?? null);
  // Stale listings (30+ days active, no sale) -- every other "needs
  // attention" state already has a Dashboard tile; this one didn't, so it
  // was easy to go unnoticed unless Sel happened to open /store itself.
  // Reuses the same GET /api/ebay/store call and STALE_DAYS_THRESHOLD
  // formula /store itself uses (src/lib/stale-listings.ts), so the two
  // counts can't drift apart.
  const [draftGaps, setDraftGaps] = useState<{ photo: number; price: number } | null>(() => getPageCache<{ photo: number; price: number }>(DRAFT_GAPS_CACHE_KEY) ?? null);
  const queue = typeof window === "undefined" ? null : getPublishQueue();
  const queueItems = useSyncExternalStore(
    (cb) => (queue ? queue.subscribe(cb) : () => {}),
    () => (queue ? queue.getItems() : NO_ITEMS),
    () => NO_ITEMS,
  );
  const failedListings = queueItems.filter((i) => i.status === "failed").length;
  const [staleListingsCount, setStaleListingsCount] = useState<number | null>(() => getPageCache<number>(STALE_LISTINGS_CACHE_KEY) ?? null);

  const supabase = useMemo(
    () =>
      createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
      ),
    []
  );

  useEffect(() => {
    setEyebrow(greeting(new Date().getHours()));

    // One cached server summary for every eBay-backed number on this page
    // (src/lib/dashboard-summary.ts) instead of six separate eBay-backed
    // requests per visit. Any number eBay couldn't supply comes back null,
    // and we keep showing whatever we had (cached) rather than a false 0.
    void (async () => {
      try {
        const s = await apiFetch<DashboardSummaryResponse>("/api/dashboard/summary");
        const prev = getPageCache<Stats>(STATS_CACHE_KEY);
        const keep = (v: number | null | undefined, old: number | null | undefined) =>
          s.connected === false ? (v ?? null) : (v ?? old ?? null);
        const nextStats: Stats = {
          drafts: s.drafts ?? prev?.drafts ?? null,
          active: keep(s.active, prev?.active),
          weeklyRevenue: keep(s.weeklyRevenue, prev?.weeklyRevenue),
          weeklySales: keep(s.weeklySales, prev?.weeklySales),
        };
        setStats(nextStats);
        setPageCache(STATS_CACHE_KEY, nextStats);
        const apply = <T,>(v: T | null | undefined, set: (v: T) => void, key: string) => {
          if (v === null || v === undefined) return;
          set(v);
          setPageCache(key, v);
        };
        apply(s.shipCount, setShipCount, SHIP_COUNT_CACHE_KEY);
        apply(s.trendSales, setTrendSales, TREND_SALES_CACHE_KEY);
        apply(s.pendingOffers, setPendingOffersCount, PENDING_OFFERS_CACHE_KEY);
        apply(s.buyerQuestions, setBuyerQuestionsCount, BUYER_QUESTIONS_CACHE_KEY);
        apply(s.staleListings, setStaleListingsCount, STALE_LISTINGS_CACHE_KEY);
      } catch {
        // Transient failure: keep whatever (cached) numbers are showing.
      } finally {
        setStatsLoaded(true);
      }
    })();

    void (async () => {
      const { data } = await supabase.auth.getUser();
      const user = data.user;
      const name =
        user?.user_metadata?.full_name ||
        user?.user_metadata?.name ||
        user?.email?.split("@")[0] ||
        null;
      setDisplayName(name);
      if (name) setPageCache(DISPLAY_NAME_CACHE_KEY, name);
    })();

    // Drafts that can't be listed yet (Needs attention).
    void (async () => {
      try {
        const [photo, price] = await Promise.all([
          apiFetch<{ total?: number }>("/api/drafts?filter=needs-photo&page=1&pageSize=1"),
          apiFetch<{ total?: number }>("/api/drafts?filter=needs-price&page=1&pageSize=1"),
        ]);
        const gaps = { photo: photo.total ?? 0, price: price.total ?? 0 };
        setDraftGaps(gaps);
        setPageCache(DRAFT_GAPS_CACHE_KEY, gaps);
      } catch {
        // leave as-is
      }
    })();

  }, [supabase]);

  const trend = trendSales ? bucketRevenue(trendSales, TREND_DAYS) : null;
  const trendMax = trend ? Math.max(1, ...trend.totals) : 1;

  const drafts = stats?.drafts ?? null;
  const active = stats?.active ?? null;
  const revenue = stats?.weeklyRevenue ?? null;
  const displayRevenue = useCountUp(revenue);
  const weeklySales = stats?.weeklySales ?? null;

  return (
    <main className="relative min-h-screen flex flex-col max-w-md lg:max-w-[1360px] mx-auto px-4 lg:px-8 pt-5 lg:pt-8 pb-8 overflow-hidden">
      <div
        className="bloom d1 stagger"
        style={{ width: 260, height: 260, top: -80, left: -60, background: "var(--glow-primary)" }}
      />
      <div
        className="bloom d1 stagger"
        style={{ width: 220, height: 220, top: 40, right: -80, background: "var(--glow-secondary)" }}
      />

      <div
        className="relative flex items-center justify-between mb-3 rounded-3xl px-4 py-3 stagger"
        style={{ background: "var(--glass)", border: "1px solid var(--glass-line)", backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)" }}
      >
        <div>
          <p className="text-[11px] font-semibold" style={{ color: "var(--text-tertiary)" }}>{eyebrow}</p>
          <h1 className="font-display font-bold text-lg mt-0.5">{displayName ?? "My store"}</h1>
        </div>
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center font-display font-bold text-sm text-white"
          style={{ background: "var(--accent)" }}
        >
          {displayName ? displayName[0].toUpperCase() : "S"}
        </div>
      </div>

      {/* Phone: the familiar 2-column stack. Desktop (lg): KPI tiles in one
          row, a wide weekly chart under them, actions below, and Needs
          attention as a side panel on the right. */}
      <div className="relative grid flex-1 grid-cols-[1.3fr_1fr] gap-2.5 mb-2.5 lg:flex-none lg:grid-cols-12 lg:gap-4 lg:content-start">
        <Link
          href="/sales"
          className="card d1 stagger row-span-2 p-4 flex flex-col active:scale-[.97] lg:row-span-1 lg:col-start-1 lg:col-span-2 lg:row-start-1 lg:hover:border-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          style={{ transitionTimingFunction: "var(--spring)" }}
        >
          <div>
            <p className="text-[10.5px] font-bold tracking-wide uppercase" style={{ color: "var(--text-tertiary)" }}>This week</p>
            <p className="font-display font-extrabold text-3xl mt-1.5">
              {displayRevenue !== null ? formatMoneyShort(displayRevenue) : "—"}
            </p>
          </div>

          {/* Real revenue-by-week trend, same numbers the Sales page's own
              chart shows for the same period — fills what used to be dead
              space in this tile with something actually informative. This
              flex-1 slot is always present (so the layout doesn't jump
              once data loads); it only draws bars once there's real trend
              data to show, and stays an empty spacer otherwise — same look
              as before for a brand-new or not-yet-loaded store. */}
          <div className="flex-1 flex flex-col justify-center min-h-0 my-1 lg:hidden">
            {trend && trend.totals.some((t) => t > 0) && (
              <>
                <p className="text-[9px] font-bold mb-1.5" style={{ color: "var(--text-tertiary)" }}>
                  Last {trend.totals.length} weeks
                </p>
                <div className="flex items-end gap-1.5" style={{ height: 38 }}>
                  {trend.totals.map((t, i) => {
                    const isCurrent = i === trend.totals.length - 1;
                    return (
                      <div key={i} className="flex-1 flex flex-col items-center justify-end gap-0.5 h-full min-w-0">
                        <span
                          className="text-[7px] font-semibold tabular-nums leading-none"
                          style={{ color: isCurrent ? "var(--accent)" : "var(--text-tertiary)" }}
                        >
                          {formatMoneyShort(t)}
                        </span>
                        <div
                          className="w-full rounded-t"
                          style={{
                            height: `${Math.max(3, (t / trendMax) * 24)}px`,
                            background: "var(--accent)",
                            opacity: isCurrent ? 1 : 0.45,
                            borderRadius: "3px 3px 1px 1px",
                          }}
                          title={formatMoney(t)}
                        />
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {weeklySales !== null && weeklySales > 0 && (
            <p className="text-[11.5px] font-bold mt-2 flex items-center gap-1 lg:hidden" style={{ color: "var(--success)" }}>
              <TrendingUp className="w-3.5 h-3.5" /> {weeklySales} sold this week
            </p>
          )}
        </Link>

        <Link
          href="/sales"
          className="hidden lg:block card d2 stagger p-4 lg:col-start-3 lg:col-span-2 lg:row-start-1 lg:hover:border-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
        >
          <p className="text-[10.5px] font-bold tracking-wide uppercase" style={{ color: "var(--text-tertiary)" }}>Sold this week</p>
          <p className="font-display font-extrabold text-3xl mt-1.5">{weeklySales !== null ? weeklySales : "—"}</p>
        </Link>
        <Link
          href="/drafts"
          className="card d2 stagger p-3.5 active:scale-[.97] lg:p-4 lg:col-start-5 lg:col-span-2 lg:row-start-1 lg:hover:border-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          style={{ transitionTimingFunction: "var(--spring)" }}
        >
          <p className="text-[10px] font-bold" style={{ color: "var(--text-tertiary)" }}>DRAFTS</p>
          <p className="font-display font-extrabold text-xl mt-1.5">{drafts !== null ? drafts : "—"}</p>
        </Link>
        <Link
          href="/store"
          className="card d3 stagger p-3.5 active:scale-[.97] lg:p-4 lg:col-start-7 lg:col-span-2 lg:row-start-1 lg:hover:border-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          style={{ transitionTimingFunction: "var(--spring)" }}
        >
          <p className="text-[10px] font-bold" style={{ color: "var(--text-tertiary)" }}>ACTIVE</p>
          <p className="font-display font-extrabold text-xl mt-1.5">{active !== null ? active : "—"}</p>
        </Link>

        <WeeklyChart trend={trend} trendMax={trendMax} />

        <Link
          href="/new-listing"
          className="btn btn-primary d4 stagger col-span-2 py-3.5 text-[14.5px] lg:col-start-1 lg:col-span-3 lg:row-start-3 lg:h-full"
          style={{ boxShadow: "0 16px 28px -16px var(--accent-tint)" }}
        >
          <Plus className="w-4 h-4" />
          New listing
        </Link>

        <div className="col-span-2 grid grid-cols-4 gap-2 lg:col-start-4 lg:col-span-5 lg:row-start-3">
          <ActionTile href="/batch-upload" viewTransitionName="batch-panel" icon={ImagePlus} title="Batch upload" delay="d5" />
          <ActionTile href="/drafts" viewTransitionName="drafts-panel" icon={FileText} title="Review drafts" delay="d6" />
          <ActionTile href="/store" viewTransitionName="store-panel" icon={BarChart2} title="View store" delay="d6" />
          <ActionTile href="/sales" viewTransitionName="sales-panel" icon={TrendingUp} title="Sales history" delay="d6" />
        </div>

        <div className="col-span-2 lg:col-start-9 lg:col-span-4 lg:row-start-1 lg:row-span-3 lg:self-start">
        <NeedsAttention
          counts={{
            toShip: shipCount,
            offers: pendingOffersCount,
            questions: buyerQuestionsCount,
            failedListings,
            draftsNeedPhoto: draftGaps?.photo ?? null,
            draftsNeedPrice: draftGaps?.price ?? null,
            stale: staleListingsCount,
          }}
        />
        </div>
      </div>

      {!statsLoaded && (
        <p className="text-center text-xs mt-3" style={{ color: "var(--text-tertiary)" }}>Loading your store…</p>
      )}
    </main>
  );
}

// Desktop-only: the weekly revenue trend at full width, with week labels.
// Hover (or keyboard focus) on a bar shows that week's exact total.
function WeeklyChart({ trend, trendMax }: { trend: ReturnType<typeof bucketRevenue> | null; trendMax: number }) {
  const has = !!trend && trend.totals.some((t) => t > 0);
  return (
    <Link
      href="/sales"
      className="hidden lg:flex card d4 stagger p-5 flex-col lg:col-start-1 lg:col-span-8 lg:row-start-2 lg:hover:border-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
      aria-label="Revenue by week — open Sales"
    >
      <div className="flex items-baseline justify-between mb-4">
        <p className="text-[10.5px] font-bold tracking-wide uppercase" style={{ color: "var(--text-tertiary)" }}>Revenue by week</p>
        <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>Last {trend?.totals.length ?? 4} weeks · open Sales for details</p>
      </div>
      {has ? (
        <div className="flex items-end gap-4 h-44">
          {trend!.totals.map((t, i) => {
            const isCurrent = i === trend!.totals.length - 1;
            const start = new Date(trend!.bucketStarts[i]);
            const label = isCurrent ? "This week" : start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
            return (
              <div key={i} className="group flex-1 flex flex-col items-center justify-end gap-1.5 h-full min-w-0" title={`${label}: ${formatMoney(t)}`}>
                <span className="text-xs font-semibold tabular-nums" style={{ color: isCurrent ? "var(--accent)" : "var(--text-secondary)" }}>{formatMoneyShort(t)}</span>
                <div
                  className="w-full max-w-[120px] rounded-t-md transition-opacity group-hover:opacity-100"
                  style={{ height: `${Math.max(4, (t / trendMax) * 130)}px`, background: "var(--accent)", opacity: isCurrent ? 1 : 0.5 }}
                />
                <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>{label}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="h-44 flex items-center justify-center text-sm" style={{ color: "var(--text-tertiary)" }}>No sales in the last 4 weeks yet.</div>
      )}
    </Link>
  );
}

function ActionTile({
  href,
  viewTransitionName,
  icon: Icon,
  title,
  delay,
}: {
  href: string;
  viewTransitionName: string;
  icon: React.ElementType;
  title: string;
  delay: string;
}) {
  return (
    <MorphLink
      href={href}
      viewTransitionName={viewTransitionName}
      className={`card ${delay} stagger p-2.5 flex flex-col items-start gap-2 active:scale-[.94]`}
      style={{ transitionTimingFunction: "var(--spring)" }}
    >
      <div
        className="w-[30px] h-[30px] rounded-lg flex items-center justify-center"
        style={{ background: "var(--accent-tint)", color: "var(--accent-soft)" }}
      >
        <Icon className="w-[15px] h-[15px]" />
      </div>
      <p className="text-[11.5px] font-bold leading-tight">{title}</p>
    </MorphLink>
  );
}
