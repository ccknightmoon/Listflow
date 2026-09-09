"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, ExternalLink, Shirt, Trash2, Pencil, Search, X, ChevronRight, Check, Tag, RotateCcw, MessageCircle } from "lucide-react";
import BottomNav from "@/components/BottomNav";
import Toast from "@/components/Toast";
import { apiFetch } from "@/lib/api";
import { useCountUp } from "@/lib/use-count-up";
import { getPageCache, setPageCache } from "@/lib/page-cache";

// See src/lib/page-cache.ts — shows the last merged Supabase+eBay listing
// set instantly on revisit while both phases below quietly refresh it.
const STORE_CACHE_KEY = "store:listings";

type SortKey = "newest" | "oldest" | "price-asc" | "price-desc";

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (d === 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

// An active listing sitting this long with no sale is a real, actionable
// signal to a reseller (eBay's own search ranking rewards freshness, and a
// stale listing is the natural next thing to price-drop or refresh) -- flag
// it rather than let it silently sit unnoticed among newer listings.
const STALE_DAYS_THRESHOLD = 30;

function daysSinceDate(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const ms = Date.now() - new Date(dateStr).getTime();
  if (isNaN(ms)) return null;
  return Math.floor(ms / 86400000);
}

interface StoreListing {
  listingId: string;
  title: string;
  price: number | null;
  thumbnail: string | null;
  sku: string | null;
  startTime: string | null;
  endTime: string | null;
  status: "active" | "ended";
  draftId?: string | null;
}

export default function StorePage() {
  const [listings, setListings] = useState<StoreListing[]>(() => getPageCache<StoreListing[]>(STORE_CACHE_KEY) ?? []);
  const [loading, setLoading] = useState(() => getPageCache<StoreListing[]>(STORE_CACHE_KEY) === undefined);
  const [error, setError] = useState<string | null>(null);
  const [needsConnect, setNeedsConnect] = useState(false);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [deleting, setDeleting] = useState<Set<string>>(new Set());
  const [relisting, setRelisting] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<"active" | "ended">("active");
  const [staleOnly, setStaleOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("newest");
  const [search, setSearch] = useState("");
  const [editingPrice, setEditingPrice] = useState<Map<string, string>>(new Map());
  const [savingPrice, setSavingPrice] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPrice, setBulkPrice] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkSuccessMsg, setBulkSuccessMsg] = useState("");

  async function loadAll() {
    // No setLoading(true) here: the initial state above already reflects
    // whether we had a cached, previously-merged list to show. loadAll()
    // only ever runs once (on mount, via the useEffect below) — so
    // there's no later re-run that would need this to flip back on.
    setError(null);

    // Fire both independent requests together — Listflow's own DB
    // (Supabase, usually fast) and eBay's live listing set (Trading API,
    // paginated, usually slower for a store of any real size). Neither is
    // painted on its own: see the comment above this function for why.
    const supabasePromise = apiFetch<{ listings?: Array<{ listingId: string; title: string; price: string | null; thumbnail: string | null; sku: string | null; startTime: string | null; draftId: string }> }>("/api/ebay/inventory");
    // /api/ebay/store's real response never had a `total` field (it's
    // `activeTotal` + `unsoldTotal`, added when the route started
    // returning ended/unsold listings too) -- the old `data.total` read
    // below was always undefined, which silently defeated the
    // "only trust this as complete" safety check it was guarding.
    const ebayPromise = apiFetch<{ listings?: StoreListing[]; activeTotal?: number; unsoldTotal?: number; error?: string; connect?: boolean; reconnect?: boolean }>("/api/ebay/store");

    let supabaseItems: StoreListing[] = [];
    let supabaseListingIds = new Set<string>();
    try {
      const data = await supabasePromise;
      supabaseItems = (data.listings ?? []).map((l) => ({
        listingId: l.listingId,
        title: l.title,
        price: l.price != null ? parseFloat(l.price) : null,
        thumbnail: l.thumbnail,
        sku: l.sku,
        startTime: l.startTime,
        endTime: null,
        status: "active" as const,
        draftId: l.draftId,
      }));
      supabaseListingIds = new Set(supabaseItems.map((i) => i.listingId));
    } catch {
      // non-fatal — eBay load below may still work, and we fall back to
      // an empty Supabase set rather than blocking on it.
    }

    try {
      const data = await ebayPromise;
      if (data.error) {
        setNeedsConnect(!!data.connect);
        setNeedsReconnect(!!data.reconnect);
        throw new Error(data.error || "Failed to load store");
      }
      // Already both active AND ended/unsold listings, each carrying a
      // real `status`/`endTime` (see toListing() in ebay-listings.ts).
      const ebayListings: StoreListing[] = data.listings ?? [];
      // The route paginates every page of both lists up to its own safety
      // cap, so ebayListings.length should always reach activeTotal +
      // unsoldTotal. This check is a defensive fallback for the rare case
      // that cap was hit -- when the fetch might be incomplete, "missing
      // from eBay's set" can't safely be read as "sold", so nothing
      // Supabase already knew about gets dropped.
      const expectedTotal = (data.activeTotal ?? 0) + (data.unsoldTotal ?? 0);
      const complete = ebayListings.length >= expectedTotal;
      const ebayById = new Map(ebayListings.map((l) => [l.listingId, l]));
      const ebayItems: StoreListing[] = ebayListings
        .filter((l) => !supabaseListingIds.has(l.listingId))
        .map((l) => ({ ...l, draftId: null }));
      // Supabase-tracked items: eBay is the source of truth for anything
      // it still knows about (active or ended) -- take its live
      // price/status/endTime, keeping only the local draftId link. A
      // Supabase item eBay has no record of at all is presumed sold once
      // the fetch above is trusted as complete; otherwise it's kept as-is
      // rather than guessed at.
      const reconciledSupabaseItems = supabaseItems
        .map((l) => {
          const match = ebayById.get(l.listingId);
          return match ? { ...match, draftId: l.draftId } : l;
        })
        .filter((l) => ebayById.has(l.listingId) || !complete);
      const merged = [...reconciledSupabaseItems, ...ebayItems];
      setListings(merged);
    } catch (err) {
      // eBay failed — fall back to whatever Supabase had rather than an
      // empty screen, and only surface an error if that was empty too.
      setListings(supabaseItems);
      if (supabaseItems.length === 0) setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);
  // Keeps the cache in sync with every change to `listings` — both load
  // phases below, plus delist/price-update mutations further down — without
  // needing a separate cache write at each individual call site.
  useEffect(() => { setPageCache(STORE_CACHE_KEY, listings); }, [listings]);

  async function handleDelist(listing: StoreListing) {
    if (!confirm(`End listing "${listing.title}"? This will remove it from eBay.`)) return;
    setDeleting((prev) => new Set(prev).add(listing.listingId));
    try {
      const body = listing.draftId
        ? { draftId: listing.draftId }
        : { listingId: listing.listingId };
      const data = await apiFetch<{ error?: string }>("/api/ebay/delist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (data.error) {
        setError(data.error ?? "Failed to delist");
      } else {
        setListings((prev) => prev.filter((l) => l.listingId !== listing.listingId));
        window.dispatchEvent(new Event("listflow:counts-changed"));
      }
    } catch {
      setError("Network error");
    } finally {
      setDeleting((prev) => { const next = new Set(prev); next.delete(listing.listingId); return next; });
    }
  }

  // Trading API's RelistFixedPriceItem (see relistItemByListingId in
  // ebay-inventory.ts for why the FixedPriceItem variant, not the plain
  // RelistItem), same one-Item-ID call pattern as EndItem above -- eBay
  // assigns a new ItemID to the relisted item by default, so the row swaps
  // to it rather than staying under the old (still-ended) one. Like every
  // other irreversible eBay action here, confirmed first.
  async function handleRelist(listing: StoreListing) {
    if (!confirm(`Relist "${listing.title}" on eBay? This creates a new active listing from the ended one.`)) return;
    setRelisting((prev) => new Set(prev).add(listing.listingId));
    try {
      const data = await apiFetch<{ error?: string; newListingId?: string }>("/api/ebay/relist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId: listing.listingId }),
      });
      if (data.error) {
        setError(data.error);
        return;
      }
      setListings((prev) => prev.map((l) =>
        l.listingId === listing.listingId
          ? { ...l, listingId: data.newListingId ?? l.listingId, status: "active" as const, endTime: null, startTime: new Date().toISOString() }
          : l
      ));
      setBulkSuccessMsg("Relisted — now active again");
      setTimeout(() => setBulkSuccessMsg(""), 3000);
      window.dispatchEvent(new Event("listflow:counts-changed"));
    } catch {
      setError("Network error");
    } finally {
      setRelisting((prev) => { const next = new Set(prev); next.delete(listing.listingId); return next; });
    }
  }

  async function handleUpdatePrice(listing: StoreListing) {
    const newPrice = editingPrice.get(listing.listingId);
    if (!newPrice) return;
    setSavingPrice((prev) => new Set(prev).add(listing.listingId));
    try {
      const data = await apiFetch<{ error?: string }>("/api/ebay/update-price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId: listing.listingId, price: newPrice, draftId: listing.draftId }),
      });
      if (data.error) throw new Error(data.error);
      setListings((prev) => prev.map((l) =>
        l.listingId === listing.listingId ? { ...l, price: parseFloat(newPrice) } : l
      ));
      setEditingPrice((prev) => { const next = new Map(prev); next.delete(listing.listingId); return next; });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingPrice((prev) => { const next = new Set(prev); next.delete(listing.listingId); return next; });
    }
  }

  async function handleBulkPrice() {
    if (!bulkPrice || selected.size === 0) return;
    setBulkSaving(true);
    const targets = sorted.filter((l) => selected.has(l.listingId));
    let failed = 0;
    for (const l of targets) {
      try {
        const data = await apiFetch<{ error?: string }>("/api/ebay/update-price", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ listingId: l.listingId, price: bulkPrice, draftId: l.draftId }),
        });
        if (!data.error) {
          setListings((prev) => prev.map((x) =>
            x.listingId === l.listingId ? { ...x, price: parseFloat(bulkPrice) } : x
          ));
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }
    setBulkSaving(false);
    const succeeded = targets.length - failed;
    setSelected(new Set());
    setSelectMode(false);
    setBulkPrice("");
    if (failed > 0) setError(`${failed} item(s) failed to update`);
    if (succeeded > 0) {
      setBulkSuccessMsg(`Updated ${succeeded} item${succeeded !== 1 ? "s" : ""}`);
      setTimeout(() => setBulkSuccessMsg(""), 3000);
    }
  }

  const q = search.trim().toLowerCase();

  const activeCount = useMemo(() => listings.filter((l) => l.status !== "ended").length, [listings]);
  const endedCount = useMemo(() => listings.filter((l) => l.status === "ended").length, [listings]);
  const tabListings = useMemo(
    () => listings.filter((l) => (tab === "active" ? l.status !== "ended" : l.status === "ended")),
    [listings, tab]
  );

  const staleCount = useMemo(
    () => tabListings.filter((l) => {
      const d = daysSinceDate(l.startTime);
      return d !== null && d >= STALE_DAYS_THRESHOLD;
    }).length,
    [tabListings]
  );

  // Was recomputed from scratch on every render (every keystroke in search,
  // every price edit, every select-mode toggle) even though listings/search/
  // sort are the only things that actually change the result — worth
  // skipping for a store that can hold hundreds of listings.
  const filtered = useMemo(() => {
    const base = staleOnly
      ? tabListings.filter((l) => {
          const d = daysSinceDate(l.startTime);
          return d !== null && d >= STALE_DAYS_THRESHOLD;
        })
      : tabListings;
    if (!q) return base;
    return base.filter((l) => {
      const sku = (l.sku ?? "").toLowerCase();
      if (q.length === 1) return sku === q;
      if (sku && (sku === q || sku.startsWith(q))) return true;
      const qWords = q.split(/\s+/);
      const titleWords = l.title.toLowerCase().split(/[\s\-\/,.()&]+/);
      return qWords.every((qw) => titleWords.some((tw) => tw.startsWith(qw)));
    });
  }, [tabListings, q, staleOnly]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (sort === "newest" || sort === "oldest") {
        const ta = a.startTime ? new Date(a.startTime).getTime() : 0;
        const tb = b.startTime ? new Date(b.startTime).getTime() : 0;
        return sort === "newest" ? tb - ta : ta - tb;
      }
      const pa = a.price ?? 0;
      const pb = b.price ?? 0;
      return sort === "price-asc" ? pa - pb : pb - pa;
    });
  }, [filtered, sort]);

  // Extra bottom clearance while the bulk-price bar is floating above
  // BottomNav (bottom-20, plus its own card height) — pb-24 alone isn't
  // enough room and the last listing row ends up hidden behind it.
  const bulkBarActive = selectMode && selected.size > 0;
  const displayCount = useCountUp(listings.length);

  return (
    <main
      className={`relative min-h-screen max-w-md mx-auto px-5 pt-6 overflow-hidden ${bulkBarActive ? "pb-56" : "pb-24"}`}
      style={{ viewTransitionName: "store-panel" }}
    >
      <div
        className="bloom d1 stagger"
        style={{ width: 240, height: 240, top: -70, left: -60, background: "var(--glow-primary)" }}
      />
      <div
        className="bloom d1 stagger"
        style={{ width: 200, height: 200, top: 10, right: -70, background: "var(--glow-secondary)" }}
      />

      <div className="flex items-center gap-3 mb-4">
        <Link
          href="/dashboard"
          className="w-[34px] h-[34px] rounded-[11px] flex items-center justify-center flex-none"
          style={{ background: "var(--glass)", border: "1px solid var(--glass-line)" }}
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-medium">
            {loading ? "Store" : `Store (${Math.round(displayCount ?? 0)})`}
          </h1>
          {!loading && !error && (
            <p className="text-xs text-[var(--text-secondary)]">
              {tab === "active" ? "All active eBay listings" : "Recently ended, unsold listings"}
            </p>
          )}
        </div>
        {!loading && listings.length > 0 && tab === "active" && (
          selectMode ? (
            <button onClick={() => { setSelectMode(false); setSelected(new Set()); setBulkPrice(""); }} className="text-sm text-[var(--text-secondary)]">Cancel</button>
          ) : (
            <button onClick={() => setSelectMode(true)} className="text-sm" style={{ color: "var(--accent)" }}>Select</button>
          )
        )}
      </div>

      {!loading && !error && (
        <Link
          href="/offers"
          className="tap card p-3 flex items-center gap-3 mb-4"
        >
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "color-mix(in srgb, var(--accent) 16%, var(--bg-surface))", color: "var(--accent)" }}
          >
            <Tag className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Pending offers</p>
            <p className="text-xs text-[var(--text-secondary)]">Review and respond to Best Offers</p>
          </div>
          <ChevronRight className="w-4 h-4 text-[var(--text-tertiary)] flex-shrink-0" />
        </Link>
      )}

      {!loading && !error && (
        <Link
          href="/messages"
          className="tap card p-3 flex items-center gap-3 mb-4"
        >
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "color-mix(in srgb, var(--accent) 16%, var(--bg-surface))", color: "var(--accent)" }}
          >
            <MessageCircle className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Buyer questions</p>
            <p className="text-xs text-[var(--text-secondary)]">Reply to questions from buyers</p>
          </div>
          <ChevronRight className="w-4 h-4 text-[var(--text-tertiary)] flex-shrink-0" />
        </Link>
      )}

      {!loading && !error && listings.length > 0 && (
        <div className="flex gap-1 p-1 rounded-xl mb-4" style={{ background: "var(--glass)", border: "1px solid var(--glass-line)" }}>
          <button
            onClick={() => { setTab("active"); setSelectMode(false); setSelected(new Set()); setStaleOnly(false); }}
            className="flex-1 text-sm py-1.5 rounded-lg transition-colors"
            style={tab === "active" ? { background: "var(--bg-surface)", color: "var(--text-primary)", fontWeight: 500 } : { color: "var(--text-secondary)" }}
          >
            Active ({activeCount})
          </button>
          <button
            onClick={() => { setTab("ended"); setSelectMode(false); setSelected(new Set()); setStaleOnly(false); }}
            className="flex-1 text-sm py-1.5 rounded-lg transition-colors"
            style={tab === "ended" ? { background: "var(--bg-surface)", color: "var(--text-primary)", fontWeight: 500 } : { color: "var(--text-secondary)" }}
          >
            Ended ({endedCount})
          </button>
        </div>
      )}

      {!loading && listings.length > 0 && (
        <div className="flex flex-col gap-2 mb-4">
          <div className="flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)] pointer-events-none" />
              <input
                type="search"
                placeholder="Search by title..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full text-sm rounded-xl border pl-9 pr-9 py-2 text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                style={{ background: "var(--glass)", borderColor: "var(--glass-line)", backdropFilter: "blur(10px)" }}
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="tap absolute right-3 top-1/2 -translate-y-1/2"
                >
                  <X className="w-4 h-4 text-[var(--text-tertiary)]" />
                </button>
              )}
            </div>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="shrink-0 w-[108px] text-sm rounded-xl border px-2 py-2 text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              style={{ background: "var(--glass)", borderColor: "var(--glass-line)", backdropFilter: "blur(10px)" }}
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="price-asc">Price: low to high</option>
              <option value="price-desc">Price: high to low</option>
            </select>
          </div>
          {tab === "active" && staleCount > 0 && (
            <button
              onClick={() => setStaleOnly((v) => !v)}
              className="self-start text-xs font-medium px-3 py-1.5 rounded-full transition-colors"
              style={
                staleOnly
                  ? { background: "var(--warning-bg)", color: "var(--danger)", border: "1px solid var(--warning-border)" }
                  : { background: "var(--glass)", color: "var(--text-secondary)", border: "1px solid var(--glass-line)" }
              }
            >
              {staleOnly ? "Showing stale only" : `${staleCount} stale (${STALE_DAYS_THRESHOLD}+ days, no sale)`}
            </button>
          )}
          {q && (
            <p className="text-xs text-[var(--text-secondary)]">
              {sorted.length} result{sorted.length !== 1 ? "s" : ""} for &ldquo;{search.trim()}&rdquo;
            </p>
          )}
        </div>
      )}

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
      <Toast type="success" message={bulkSuccessMsg} onClose={() => setBulkSuccessMsg("")} />

      {loading && (
        <div className="card p-8 text-center">
          <Loader2 className="w-6 h-6 mx-auto mb-3 animate-spin" />
          <p className="text-sm text-[var(--text-secondary)]">Loading store...</p>
        </div>
      )}

      {!loading && !error && listings.length === 0 && (
        <div className="card p-8 text-center">
          <p className="text-sm text-[var(--text-secondary)]">No eBay listings found.</p>
        </div>
      )}

      {!loading && listings.length > 0 && tabListings.length === 0 && (
        <div className="card p-8 text-center">
          <p className="text-sm text-[var(--text-secondary)]">
            {tab === "active" ? "No active listings." : "No ended listings — anything unsold recently will show up here."}
          </p>
        </div>
      )}

      {!loading && tabListings.length > 0 && sorted.length === 0 && (
        <div className="card p-8 text-center">
          <p className="text-sm text-[var(--text-secondary)]">No listings match &ldquo;{search.trim()}&rdquo;.</p>
        </div>
      )}

      {selectMode && (
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => {
              const allSelected = sorted.every((l) => selected.has(l.listingId));
              if (allSelected) {
                setSelected(new Set());
              } else {
                setSelected(new Set(sorted.map((l) => l.listingId)));
              }
            }}
            className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            {sorted.every((l) => selected.has(l.listingId)) ? "Deselect all" : "Select all"}
          </button>
          {selected.size > 0 && (
            <p className="text-xs text-[var(--text-secondary)]">{selected.size} selected</p>
          )}
        </div>
      )}

      {!loading && sorted.length > 0 && (
        <div className="flex flex-col gap-2">
          {sorted.map((l, rowIndex) => (
            <div
              key={l.listingId}
              className={`card stagger p-3 ${rowIndex < 6 ? `d${rowIndex + 1}` : ""} ${selectMode && selected.has(l.listingId) ? "ring-2 ring-[var(--accent)]" : ""}`}
              onClick={
                selectMode
                  ? () =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (next.has(l.listingId)) {
                          next.delete(l.listingId);
                        } else {
                          next.add(l.listingId);
                        }
                        return next;
                      })
                  : undefined
              }
              style={selectMode ? { cursor: "pointer" } : undefined}
            >
              <div className="flex items-center gap-3">
                {l.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={l.thumbnail}
                    alt={l.title}
                    loading="lazy"
                    decoding="async"
                    className="w-14 h-14 rounded-md object-cover flex-shrink-0"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-md bg-[var(--bg-page)] flex items-center justify-center flex-shrink-0">
                    <Shirt className="w-6 h-6 text-[var(--text-secondary)]" />
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{l.title}</p>
                  {editingPrice.has(l.listingId) ? (
                    <div className="flex items-center gap-1 mt-1">
                      <span className="text-xs text-[var(--text-secondary)]">$</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0.99"
                        value={editingPrice.get(l.listingId)}
                        onChange={(e) => setEditingPrice((prev) => new Map(prev).set(l.listingId, e.target.value))}
                        className="w-20 text-xs border border-[var(--border)] rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleUpdatePrice(l);
                          if (e.key === "Escape") setEditingPrice((prev) => { const next = new Map(prev); next.delete(l.listingId); return next; });
                        }}
                      />
                      <button onClick={() => handleUpdatePrice(l)} disabled={savingPrice.has(l.listingId)} style={{ color: "var(--success)" }}>
                        {savingPrice.has(l.listingId) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      </button>
                      <button onClick={() => setEditingPrice((prev) => { const next = new Map(prev); next.delete(l.listingId); return next; })} className="text-[var(--text-tertiary)]">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <p
                      className={`text-xs text-[var(--text-secondary)] mt-0.5 ${l.status === "ended" ? "" : "cursor-pointer hover:text-[var(--accent)]"}`}
                      onClick={
                        l.status === "ended"
                          ? undefined
                          : () => setEditingPrice((prev) => new Map(prev).set(l.listingId, l.price != null ? l.price.toFixed(2) : ""))
                      }
                    >
                      {l.price != null ? `$${l.price.toFixed(2)}` : "Tap to set price"}
                      {l.sku ? ` · SKU: ${l.sku}` : ""}
                      {l.status === "ended"
                        ? (l.endTime ? ` · Ended ${timeAgo(l.endTime)}` : " · Ended")
                        : (l.startTime ? ` · Listed ${timeAgo(l.startTime)}` : "")}
                      {l.price == null && l.status !== "ended" && <span className="ml-1 opacity-40 text-[10px]">edit</span>}
                      {l.status !== "ended" && (() => {
                        const d = daysSinceDate(l.startTime);
                        return d !== null && d >= STALE_DAYS_THRESHOLD ? (
                          <span
                            className="inline-flex items-center ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold align-middle"
                            style={{ background: "var(--warning-bg)", color: "var(--danger)", border: "1px solid var(--warning-border)" }}
                          >
                            Stale
                          </span>
                        ) : null;
                      })()}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 mt-2 pt-2 border-t border-[var(--border)]">
                {l.status === "ended" ? (
                  <>
                    <a
                      href={`https://www.ebay.com/itm/${l.listingId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="tap flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex-1 justify-center py-1"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      View
                    </a>
                    <div className="w-px h-4 bg-[var(--border)]" />
                    <button
                      onClick={() => handleRelist(l)}
                      disabled={relisting.has(l.listingId)}
                      className="tap flex items-center gap-1 text-xs flex-1 justify-center py-1 disabled:opacity-50"
                      style={{ color: "var(--accent)" }}
                    >
                      {relisting.has(l.listingId) ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="w-3.5 h-3.5" />
                      )}
                      {relisting.has(l.listingId) ? "Relisting..." : "Relist"}
                    </button>
                  </>
                ) : (
                  <>
                    <a
                      href={`https://www.ebay.com/sh/edit-item/${l.listingId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="tap flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex-1 justify-center py-1"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Edit on eBay
                    </a>
                    <div className="w-px h-4 bg-[var(--border)]" />
                    <a
                      href={`https://www.ebay.com/itm/${l.listingId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="tap flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex-1 justify-center py-1"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      View
                    </a>
                    {l.draftId && (
                      <>
                        <div className="w-px h-4 bg-[var(--border)]" />
                        <Link
                          href={`/drafts/${l.draftId}`}
                          className="tap flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex-1 justify-center py-1"
                        >
                          <ChevronRight className="w-3.5 h-3.5" />
                          Edit
                        </Link>
                      </>
                    )}
                    <div className="w-px h-4 bg-[var(--border)]" />
                    <button
                      onClick={() => handleDelist(l)}
                      disabled={deleting.has(l.listingId)}
                      className="tap flex items-center gap-1 text-xs flex-1 justify-center py-1 disabled:opacity-50"
                      style={{ color: "var(--danger)" }}
                    >
                      {deleting.has(l.listingId) ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                      {deleting.has(l.listingId) ? "Ending..." : "Delist"}
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {selectMode && selected.size > 0 && (
        <div className="fixed bottom-20 left-0 right-0 max-w-md mx-auto px-5">
          <div className="card p-3 flex flex-col gap-2">
            <p className="text-xs text-[var(--text-secondary)]">{selected.size} item{selected.size !== 1 ? "s" : ""} selected</p>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--text-secondary)]">$</span>
                <input
                  type="number"
                  step="0.01"
                  min="0.99"
                  placeholder="New price"
                  value={bulkPrice}
                  onChange={(e) => setBulkPrice(e.target.value)}
                  className="input w-full pl-7"
                />
              </div>
              <button
                onClick={handleBulkPrice}
                disabled={!bulkPrice || bulkSaving}
                className="btn btn-primary px-4"
              >
                {bulkSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Update"}
              </button>
            </div>
          </div>
        </div>
      )}

      <BottomNav />
    </main>
  );
}
