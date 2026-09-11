"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Shirt, Loader2, Trash2, Upload, Search, X, Copy } from "lucide-react";
import Toast from "@/components/Toast";
import { apiFetch } from "@/lib/api";
import { morphNavigate } from "@/lib/view-transition";
import { getPageCache, setPageCache } from "@/lib/page-cache";
import type { ShippingMode } from "@/lib/shipping";

// Drafts rarely changes shape between visits within one tab (add/remove a
// few items at most) — showing the last list instantly while a fresh fetch
// runs quietly beats reflashing the loading spinner every time you tap
// into this tab from BottomNav.
const DRAFTS_CACHE_KEY = "drafts:list";

// Server-paginated (see GET /api/drafts) -- a seller's draft backlog can
// run into the hundreds, and this page used to fetch every single one on
// every visit. 30 keeps each page small while still showing enough that
// "Select all" + bulk list stays useful for a normal batch-review session.
const PAGE_SIZE = 30;
const SEARCH_DEBOUNCE_MS = 300;

interface Draft {
  id: string;
  title: string | null;
  suggested_price: number | null;
  sell_odds: string | null;
  condition: string | null;
  thumbnail_url: string | null;
  created_at: string | null;
  is_heavy: boolean | null;
  shipping_cost: number | null;
  shipping_mode: ShippingMode | null;
  photo_urls: string[] | null;
}

type ListStatus = "idle" | "listing" | "done";

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (d === 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  return `${Math.floor(d / 30)}mo ago`;
}
type SortKey = "newest" | "oldest" | "price-desc" | "price-asc";
type DraftFilter = "all" | "ready" | "needs-photo" | "needs-price";

// Resolves whether an item is heavy / its shipping cost the same way for
// every id regardless of which page it was loaded on -- falls back to the
// pre-migration localStorage cache (see drafts/[id]) for a draft saved
// before is_heavy/shipping_cost were persisted server-side and never
// re-saved since. Used both for the current page's badges and for bulk
// "List on eBay", which can include ids selected on a page that isn't the
// one currently loaded.
function resolveIsHeavy(id: string, draft: Draft | undefined): boolean {
  if (draft?.is_heavy != null) return draft.is_heavy;
  try {
    return JSON.parse(localStorage.getItem(`heavy-${id}`) ?? "false");
  } catch {
    return false;
  }
}
function resolveShippingCost(id: string, draft: Draft | undefined): number | undefined {
  if (draft?.shipping_cost != null && draft.shipping_cost > 0) return draft.shipping_cost;
  const saved = localStorage.getItem(`shippingCost-${id}`);
  if (saved) {
    const n = parseFloat(saved);
    if (n > 0) return n;
  }
  return undefined;
}

export default function DraftsPage() {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Draft[]>(() => getPageCache<Draft[]>(DRAFTS_CACHE_KEY) ?? []);
  const [loading, setLoading] = useState(() => getPageCache<Draft[]>(DRAFTS_CACHE_KEY) === undefined);
  // Set on every re-fetch after the first (search/sort/filter/page change)
  // -- unlike `loading`, this never hides the current list; it just flags
  // the controls as busy so a fast double-click can't fire two requests.
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [listStatus, setListStatus] = useState<ListStatus>("idle");
  const [listProgress, setListProgress] = useState(0);
  const [needsEbayConnect, setNeedsEbayConnect] = useState(false);
  const [needsEbayReconnect, setNeedsEbayReconnect] = useState(false);
  const [heavyIds, setHeavyIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");
  const [filter, setFilter] = useState<DraftFilter>("all");
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(() => getPageCache<Draft[]>(DRAFTS_CACHE_KEY)?.length ?? 0);
  const [totalPages, setTotalPages] = useState(1);
  // Count of not-yet-priced drafts across the WHOLE backlog, not just the
  // current page/filter -- kept as its own lightweight query (pageSize=1,
  // so only the count comes back) so the warning banner below stays
  // accurate now that `drafts` only ever holds one page at a time.
  const [noPriceTotal, setNoPriceTotal] = useState(0);

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Accumulates every draft object this tab has fetched on any page this
  // session, keyed by id. `drafts` itself only ever holds the current
  // page's rows, so bulk actions (list, delete, the no-price confirm)
  // need this instead to resolve an id that was selected on a page that
  // isn't the one currently loaded -- otherwise a multi-page selection
  // would silently lose that item's title/shipping/price info.
  const draftsByIdRef = useRef<Record<string, Draft>>({});

  useEffect(() => {
    loadDrafts();
    loadNoPriceTotal();
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
    // Intentionally run once on mount only -- loadDrafts/loadNoPriceTotal
    // read `page`/`search`/`sort`/`filter` via their own default-argument
    // fallbacks, but every place those change already calls loadDrafts
    // directly with explicit overrides (see handleSearchChange etc.),
    // so re-running this effect on every state change would double-fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Keeps the cache in sync with every change to `drafts` — the initial
  // load below, and the later mutations (delete, the post-bulk-list
  // refresh) — without needing a cache write at each individual call site.
  useEffect(() => { setPageCache(DRAFTS_CACHE_KEY, drafts); }, [drafts]);

  async function loadNoPriceTotal() {
    try {
      const data = await apiFetch<{ total?: number }>("/api/drafts?filter=needs-price&page=1&pageSize=1");
      setNoPriceTotal(data.total ?? 0);
    } catch {
      // Non-critical -- the banner just stays at its last known count.
      // The main list load below already surfaces real errors.
    }
  }

  async function loadDrafts(overrides?: { page?: number; search?: string; sort?: SortKey; filter?: DraftFilter }) {
    const targetPage = overrides?.page ?? page;
    const targetSearch = overrides?.search ?? search;
    const targetSort = overrides?.sort ?? sort;
    const targetFilter = overrides?.filter ?? filter;

    // No setLoading(true) here (matches the original behavior this
    // replaces): the initial state above already reflects whether we had
    // a cached list to show, and flashing back to the full spinner on
    // every search keystroke or page click would be jarring. `refreshing`
    // covers "a fetch is in flight" for the controls instead.
    setError(null);
    setRefreshing(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(targetPage));
      params.set("pageSize", String(PAGE_SIZE));
      if (targetSearch.trim()) params.set("search", targetSearch.trim());
      params.set("sort", targetSort);
      params.set("filter", targetFilter);

      const data = await apiFetch<{
        drafts?: Draft[];
        total?: number;
        page?: number;
        totalPages?: number;
        error?: string;
      }>(`/api/drafts?${params.toString()}`);

      const loaded = data.drafts ?? [];
      const effectiveTotalPages = data.totalPages ?? 1;
      const effectivePage = data.page ?? targetPage;

      // A page that's gone stale (the last item on it was just deleted, or
      // a filter change shrank the result set below the page you were on)
      // comes back empty even though earlier pages still have rows --
      // rather than show a confusing blank list, drop back to the last
      // real page once.
      if (loaded.length === 0 && effectivePage > 1 && effectiveTotalPages < effectivePage) {
        return loadDrafts({ page: effectiveTotalPages, search: targetSearch, sort: targetSort, filter: targetFilter });
      }

      setDrafts(loaded);
      setPage(effectivePage);
      setTotal(data.total ?? loaded.length);
      setTotalPages(effectiveTotalPages);

      for (const d of loaded) draftsByIdRef.current[d.id] = d;

      // Prefer the draft's own saved is_heavy/shipping_cost (now persisted
      // by every save path -- new-listing, batch-upload, and drafts/[id])
      // over localStorage, which only ever got set by opening this exact
      // draft in drafts/[id] specifically -- a heavy item saved elsewhere
      // used to silently list here as non-heavy since heavyIds only ever
      // came from localStorage before. Still falls back to localStorage for
      // any draft saved before this migration that hasn't been re-saved yet.
      setHeavyIds(new Set(loaded.filter((d) => resolveIsHeavy(d.id, d)).map((d) => d.id)));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  function handleSearchChange(value: string) {
    setSearch(value);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      loadDrafts({ page: 1, search: value });
    }, SEARCH_DEBOUNCE_MS);
  }
  function handleSearchClear() {
    setSearch("");
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    loadDrafts({ page: 1, search: "" });
  }
  function handleSortChange(value: SortKey) {
    setSort(value);
    loadDrafts({ page: 1, sort: value });
  }
  function handleFilterChange(value: DraftFilter) {
    setFilter(value);
    loadDrafts({ page: 1, filter: value });
  }
  function goToPage(p: number) {
    if (p < 1 || p > totalPages || p === page || refreshing) return;
    loadDrafts({ page: p });
  }

  // Spins off a fresh draft with this row's details but no photos/SKU/
  // listing ID (see the duplicate route's own comment), then goes straight
  // into it for editing — for listing near-identical items (same shirt in
  // another size, more of the same lot) without redoing the full
  // AI-analysis flow from scratch each time.
  async function handleDuplicate(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    setDuplicatingId(id);
    setError(null);
    try {
      const data = await apiFetch<{ draft?: { id?: string }; error?: string }>(`/api/drafts/${id}/duplicate`, {
        method: "POST",
      });
      if (data.error || !data.draft?.id) throw new Error(data.error ?? "Could not duplicate this draft");
      router.push(`/drafts/${data.draft.id}`);
    } catch (err) {
      setError((err as Error).message);
      setDuplicatingId(null);
    }
  }

  function toggleSelect(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  // Selects/deselects only the rows on the CURRENT page -- selections on
  // other pages (tracked in the `selected` Set, which is never reset by a
  // page change) are left exactly as they were.
  function toggleSelectAll() {
    const allOnPageSelected = drafts.every((d) => selected.has(d.id));
    if (allOnPageSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        drafts.forEach((d) => next.delete(d.id));
        return next;
      });
    } else {
      setSelected((prev) => new Set([...prev, ...drafts.map((d) => d.id)]));
    }
  }


  async function handleDeleteSelected() {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    setDeleting(true);
    try {
      const data = await apiFetch<{ error?: string }>("/api/drafts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (data.error) throw new Error(data.error);
      for (const id of ids) delete draftsByIdRef.current[id];
      setSelected(new Set());
      await loadDrafts();
      loadNoPriceTotal();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  async function handleListSelected() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;

    // Cross-page safe: every selectable id was rendered on some page at
    // some point, so it's guaranteed to be in draftsByIdRef even if that
    // page isn't the one currently loaded into `drafts`.
    const noPriceCount = ids.filter((id) => !draftsByIdRef.current[id]?.suggested_price).length;
    if (noPriceCount > 0) {
      if (!confirm(`${noPriceCount} item${noPriceCount !== 1 ? "s" : ""} have no price set. List anyway?`)) return;
    }

    setListStatus("listing");
    setListProgress(0);
    // Track every failure individually — previously each new failure
    // overwrote the last, so only the final item's error survived even
    // though several items could fail independently in the same batch.
    const failures: { title: string; error: string }[] = [];
    let successCount = 0;
    let doneCount = 0;

    // A couple of listings at a time instead of strictly one at a time with
    // an artificial 1s pause between each — same LISTING_CONCURRENCY=2
    // pattern already proven out in batch-upload's own bulk-listing flow
    // (handleListAllOnEbay), which hits this exact same /api/ebay/list
    // endpoint. A single listing is already several sequential eBay calls
    // internally (SKU cleanup, upsert, offer create/update, publish), so 2
    // concurrent listings roughly doubles real throughput without stacking
    // too much simultaneous load on eBay's Trading/Inventory APIs.
    const LISTING_CONCURRENCY = 2;
    let cursor = 0;

    async function worker() {
      while (cursor < ids.length) {
        const i = cursor++;
        const id = ids[i];
        const draftInfo = draftsByIdRef.current[id];
        const draftTitle = draftInfo?.title ?? `Item ${i + 1}`;
        const isHeavyItem = resolveIsHeavy(id, draftInfo);
        try {
          const data = await apiFetch<{ connect?: boolean; reconnect?: boolean; error?: string }>("/api/ebay/list", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              draftId: id,
              shippingMode: draftInfo?.shipping_mode ?? (isHeavyItem ? "buyer_pays" : "free"),
              isHeavy: isHeavyItem,
              shippingCost: resolveShippingCost(id, draftInfo),
            }),
          });
          if (data.error) {
            if (data.connect) setNeedsEbayConnect(true);
            if (data.reconnect) setNeedsEbayReconnect(true);
            failures.push({ title: draftTitle, error: data.error ?? "Unknown error" });
          } else {
            successCount++;
          }
        } catch {
          failures.push({ title: draftTitle, error: "Network error" });
        }
        doneCount++;
        setListProgress(doneCount);
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(LISTING_CONCURRENCY, ids.length) }, () => worker())
    );

    // "Listed!" now only ever means every selected item actually listed —
    // a batch with any failures shows exactly which items failed and why,
    // instead of a blanket success message.
    if (failures.length > 0) {
      const summary = failures.length === ids.length
        ? `All ${failures.length} item${failures.length !== 1 ? "s" : ""} failed to list.`
        : `${successCount} listed, ${failures.length} failed.`;
      const detail = failures.slice(0, 5).map((f) => `"${f.title}": ${f.error}`).join("  •  ");
      setError(`${summary} ${detail}${failures.length > 5 ? ` (+${failures.length - 5} more)` : ""}`);
    } else {
      setError(null);
    }

    setListStatus("done");
    window.dispatchEvent(new Event("listflow:counts-changed"));
    await loadDrafts();
    loadNoPriceTotal();
    setTimeout(() => {
      setListStatus("idle");
      setListProgress(0);
      // Only clear the selection when every item listed — on any failure,
      // the whole selection (including any items that did succeed) stays
      // put so the failures are still visible for a retry, matching the
      // list's original behavior.
      if (failures.length === 0) {
        setSelected(new Set());
      }
      if (successCount > 0 && failures.length === 0) router.push("/store");
    }, failures.length > 0 ? 4000 : 1500);
  }

  const allSelected = drafts.length > 0 && drafts.every((d) => selected.has(d.id));
  const hasSelection = selected.size > 0;


  return (
    <main className="relative min-h-screen max-w-md mx-auto px-5 pt-6 pb-24 overflow-hidden" style={{ viewTransitionName: "drafts-panel" }}>
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
        <h1 className="text-xl font-medium">Drafts ({total})</h1>
      </div>

      {!loading && (drafts.length > 0 || search || filter !== "all") && (
        <div className="flex items-center gap-2 mb-4">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)] pointer-events-none" />
            <input
              type="search"
              placeholder="Search drafts..."
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-full text-sm rounded-xl border pl-9 pr-9 py-2 text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              style={{ background: "var(--glass)", borderColor: "var(--glass-line)", backdropFilter: "blur(10px)" }}
            />
            {search && (
              <button onClick={handleSearchClear} className="tap absolute right-3 top-1/2 -translate-y-1/2">
                <X className="w-4 h-4 text-[var(--text-tertiary)]" />
              </button>
            )}
          </div>
          <select
            value={sort}
            onChange={(e) => handleSortChange(e.target.value as SortKey)}
            className="shrink-0 w-[108px] text-sm rounded-xl border px-2 py-2 text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            style={{ background: "var(--glass)", borderColor: "var(--glass-line)", backdropFilter: "blur(10px)" }}
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="price-desc">Price: high to low</option>
            <option value="price-asc">Price: low to high</option>
          </select>
          <select
            value={filter}
            onChange={(e) => handleFilterChange(e.target.value as DraftFilter)}
            className="shrink-0 w-[112px] text-sm rounded-xl border px-2 py-2 text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            style={{ background: "var(--glass)", borderColor: "var(--glass-line)", backdropFilter: "blur(10px)" }}
          >
            <option value="all">All drafts</option>
            <option value="ready">Ready to list</option>
            <option value="needs-photo">Needs photos</option>
            <option value="needs-price">Needs price</option>
          </select>
        </div>
      )}

      <Toast
        type="error"
        message={
          error ? (
            <>
              {error}
              {needsEbayConnect && <a href="/api/ebay/connect" className="underline ml-2 font-medium">Connect eBay →</a>}
              {needsEbayReconnect && <a href="/api/ebay/connect" className="underline ml-2 font-medium">Reconnect eBay →</a>}
            </>
          ) : null
        }
        onClose={() => setError(null)}
      />

      {loading && (
        <div className="card p-8 text-center">
          <Loader2 className="w-6 h-6 mx-auto mb-3 animate-spin" />
          <p className="text-sm text-[var(--text-secondary)]">Loading drafts...</p>
        </div>
      )}

      {!loading && noPriceTotal > 0 && (
        <div className="card p-3 mb-4 flex items-center gap-2 text-sm" style={{ borderColor: "var(--warning-border)", background: "var(--warning-bg)" }}>
          <span className="text-base">⚠️</span>
          <p style={{ color: "var(--text-primary)" }}>
            {noPriceTotal} draft{noPriceTotal !== 1 ? "s" : ""} have no price — set one before listing.
          </p>
        </div>
      )}

      {!loading && !error && drafts.length === 0 && !search && filter === "all" && (
        <div className="card p-8 text-center">
          <p className="text-sm text-[var(--text-secondary)]">
            No drafts yet. Save one from the new listing or batch upload screens.
          </p>
        </div>
      )}

      {!loading && drafts.length === 0 && (search || filter !== "all") && (
        <div className="card p-6 text-center mb-4">
          <p className="text-sm text-[var(--text-secondary)]">
            {search ? <>No drafts match &ldquo;{search.trim()}&rdquo;</> : "No drafts match this filter."}
          </p>
        </div>
      )}

      {!loading && drafts.length > 0 && (
        <>
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={toggleSelectAll}
              className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              {allSelected ? "Deselect page" : "Select page"}
            </button>
            {hasSelection && (
              <p className="text-xs text-[var(--text-secondary)]">{selected.size} selected</p>
            )}
          </div>

          <div className="flex flex-col gap-2 mb-4">
            {drafts.map((d, rowIndex) => {
              const isSelected = selected.has(d.id);
              const isHeavy = heavyIds.has(d.id);
              return (
                <div
                  key={d.id}
                  onClick={(e) => {
                    // Only the clicked row carries the shared transition
                    // name — every row can't hold it statically, since a
                    // view-transition-name must be unique on screen at once.
                    (e.currentTarget as HTMLElement).style.viewTransitionName = "draft-detail";
                    morphNavigate(router, `/drafts/${d.id}`);
                  }}
                  className={`card stagger p-3 flex items-center gap-3 cursor-pointer active:scale-[.98] ${rowIndex < 6 ? `d${rowIndex + 1}` : ""}`}
                  style={{
                    borderColor: isSelected ? "var(--accent)" : undefined,
                    background: isSelected ? "var(--accent-tint)" : undefined,
                    transitionTimingFunction: "var(--spring)",
                  }}
                >
                  <div
                    onClick={(e) => toggleSelect(e, d.id)}
                    className="w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center"
                    style={{
                      borderColor: isSelected ? "var(--accent)" : "var(--text-tertiary)",
                      background: isSelected ? "var(--accent)" : "transparent",
                    }}
                  >
                    {isSelected && (
                      <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                        <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>

                  {d.thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={d.thumbnail_url}
                      alt={d.title ?? "Draft"}
                      loading="lazy"
                      decoding="async"
                      className="w-10 h-10 rounded-md object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-md bg-[var(--bg-page)] flex items-center justify-center flex-shrink-0">
                      <Shirt className="w-5 h-5 text-[var(--text-secondary)]" />
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{d.title ?? "Untitled item"}</p>
                      {isHeavy && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 font-medium" style={{ background: "var(--glass-strong)", color: "var(--text-secondary)" }}>Heavy</span>
                      )}
                    </div>
                    <p className="text-xs mt-0.5" style={{ color: d.suggested_price == null ? "var(--warning-border)" : "var(--text-secondary)" }}>
                      {d.suggested_price != null ? `$${d.suggested_price}` : "No price set"}
                      {d.condition ? ` · ${d.condition}` : ""}
                      {d.created_at ? ` · ${timeAgo(d.created_at)}` : ""}
                    </p>
                  </div>

                  <button
                    onClick={(e) => handleDuplicate(e, d.id)}
                    disabled={duplicatingId === d.id}
                    title="Duplicate this item"
                    className="tap p-1.5 rounded-lg flex-shrink-0 hover:bg-[var(--bg-page)]"
                  >
                    {duplicatingId === d.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: "var(--text-tertiary)" }} />
                    ) : (
                      <Copy className="w-3.5 h-3.5" style={{ color: "var(--text-tertiary)" }} />
                    )}
                  </button>

                  <svg width="6" height="10" viewBox="0 0 6 10" fill="none" className="flex-shrink-0">
                    <path d="M1 1L5 5L1 9" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mb-6 text-sm">
              <button
                onClick={() => goToPage(page - 1)}
                disabled={page <= 1 || refreshing}
                className="tap px-3 py-1.5 rounded-lg disabled:opacity-40"
                style={{ background: "var(--glass)", border: "1px solid var(--glass-line)" }}
              >
                Previous
              </button>
              <span className="text-[var(--text-secondary)]">
                {refreshing ? <Loader2 className="w-3.5 h-3.5 inline animate-spin" /> : `Page ${page} of ${totalPages}`}
              </span>
              <button
                onClick={() => goToPage(page + 1)}
                disabled={page >= totalPages || refreshing}
                className="tap px-3 py-1.5 rounded-lg disabled:opacity-40"
                style={{ background: "var(--glass)", border: "1px solid var(--glass-line)" }}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}

      {hasSelection && (
        <div
          className="fixed bottom-4 left-0 right-0 px-5 max-w-md mx-auto"
        >
          <div className="card p-3 flex gap-2">
            <button
              onClick={handleDeleteSelected}
              disabled={deleting}
              className="btn flex-1"
              style={{ color: "var(--danger)" }}
            >
              {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              {deleting ? "Deleting..." : `Delete (${selected.size})`}
            </button>
            <button
              onClick={handleListSelected}
              disabled={listStatus === "listing"}
              className="btn btn-primary flex-1"
            >
              {listStatus === "listing" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
              {listStatus === "listing"
                ? `Listing ${listProgress}/${selected.size}...`
                : listStatus === "done"
                ? "Listed!"
                : `List on eBay (${selected.size})`}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
