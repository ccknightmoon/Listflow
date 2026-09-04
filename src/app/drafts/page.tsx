"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Shirt, Loader2, Trash2, Upload, Search, X } from "lucide-react";
import Toast from "@/components/Toast";
import { apiFetch } from "@/lib/api";
import { morphNavigate } from "@/lib/view-transition";

interface Draft {
  id: string;
  title: string | null;
  suggested_price: number | null;
  sell_odds: string | null;
  condition: string | null;
  thumbnail_url: string | null;
  created_at: string | null;
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

export default function DraftsPage() {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [listStatus, setListStatus] = useState<ListStatus>("idle");
  const [listProgress, setListProgress] = useState(0);
  const [needsEbayConnect, setNeedsEbayConnect] = useState(false);
  const [needsEbayReconnect, setNeedsEbayReconnect] = useState(false);
  const [heavyIds, setHeavyIds] = useState<Set<string>>(new Set());
  const [shippingCostMap, setShippingCostMap] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");

  useEffect(() => { loadDrafts(); }, []);

  async function loadDrafts() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ drafts?: Array<Draft & { ebay_listing_id?: string | null }>; error?: string }>("/api/drafts");
      const loaded = (data.drafts ?? []).filter((d) => !d.ebay_listing_id) as Draft[];
      setDrafts(loaded);
      setHeavyIds(new Set(loaded.filter((d) => JSON.parse(localStorage.getItem(`heavy-${d.id}`) ?? "false")).map((d) => d.id)));
      const costMap: Record<string, number> = {};
      for (const d of loaded) {
        const saved = localStorage.getItem(`shippingCost-${d.id}`);
        if (saved) { const n = parseFloat(saved); if (n > 0) costMap[d.id] = n; }
      }
      setShippingCostMap(costMap);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
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

  function toggleSelectAll() {
    const allFilteredSelected = filtered.every((d) => selected.has(d.id));
    if (allFilteredSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        filtered.forEach((d) => next.delete(d.id));
        return next;
      });
    } else {
      setSelected((prev) => new Set([...prev, ...filtered.map((d) => d.id)]));
    }
  }


  async function handleDeleteSelected() {
    if (selected.size === 0) return;
    setDeleting(true);
    try {
      const data = await apiFetch<{ error?: string }>("/api/drafts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      if (data.error) throw new Error(data.error);
      setDrafts((prev) => prev.filter((d) => !selected.has(d.id)));
      setSelected(new Set());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  async function handleListSelected() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;

    const noPriceCount = drafts.filter((d) => ids.includes(d.id) && !d.suggested_price).length;
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

    for (let i = 0; i < ids.length; i++) {
      const draftTitle = drafts.find((d) => d.id === ids[i])?.title ?? `Item ${i + 1}`;
      try {
        const data = await apiFetch<{ connect?: boolean; reconnect?: boolean; error?: string }>("/api/ebay/list", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draftId: ids[i], isHeavy: heavyIds.has(ids[i]), shippingCost: shippingCostMap[ids[i]] }),
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
      setListProgress(i + 1);
      if (i < ids.length - 1) await new Promise((r) => setTimeout(r, 1000));
    }

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
    setTimeout(() => {
      setListStatus("idle");
      setListProgress(0);
      // Only clear the selection for items that actually listed, so failed
      // items stay selected and visible for a retry instead of vanishing
      // from the user's view of "what still needs attention."
      if (failures.length === 0) {
        setSelected(new Set());
      }
      if (successCount > 0 && failures.length === 0) router.push("/store");
    }, failures.length > 0 ? 4000 : 1500);
  }

  const q = search.trim().toLowerCase();

  // Recomputed from scratch on every render before this (every selection
  // toggle, every save, every keystroke in search) — memoized since drafts
  // can run into the hundreds for an active reseller.
  const filtered = useMemo(() => {
    const base = !q ? drafts : drafts.filter((d) => (d.title ?? "").toLowerCase().includes(q));
    return [...base].sort((a, b) => {
      if (sort === "newest" || sort === "oldest") {
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
        return sort === "newest" ? tb - ta : ta - tb;
      }
      const pa = a.suggested_price ?? 0;
      const pb = b.suggested_price ?? 0;
      return sort === "price-desc" ? pb - pa : pa - pb;
    });
  }, [drafts, q, sort]);

  const noPriceDrafts = useMemo(() => drafts.filter((d) => !d.suggested_price), [drafts]);
  const allSelected = filtered.length > 0 && filtered.every((d) => selected.has(d.id));
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
        <h1 className="text-xl font-medium">Drafts ({q ? `${filtered.length}/` : ""}{drafts.length})</h1>
      </div>

      {!loading && drafts.length > 0 && (
        <div className="flex items-center gap-2 mb-4">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)] pointer-events-none" />
            <input
              type="search"
              placeholder="Search drafts..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full text-sm rounded-xl border pl-9 pr-9 py-2 text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              style={{ background: "var(--glass)", borderColor: "var(--glass-line)", backdropFilter: "blur(10px)" }}
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2">
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
            <option value="price-desc">Price: high to low</option>
            <option value="price-asc">Price: low to high</option>
          </select>
        </div>
      )}

      {error && (
        <div className="mb-4">
          <Toast
            type="error"
            message={
              <>
                {error}
                {needsEbayConnect && <a href="/api/ebay/connect" className="underline ml-2 font-medium">Connect eBay →</a>}
                {needsEbayReconnect && <a href="/api/ebay/connect" className="underline ml-2 font-medium">Reconnect eBay →</a>}
              </>
            }
            onClose={() => setError(null)}
          />
        </div>
      )}

      {loading && (
        <div className="card p-8 text-center">
          <Loader2 className="w-6 h-6 mx-auto mb-3 animate-spin" />
          <p className="text-sm text-[var(--text-secondary)]">Loading drafts...</p>
        </div>
      )}

      {!loading && noPriceDrafts.length > 0 && (
        <div className="card p-3 mb-4 flex items-center gap-2 text-sm" style={{ borderColor: "var(--warning-border)", background: "var(--warning-bg)" }}>
          <span className="text-base">⚠️</span>
          <p style={{ color: "var(--text-primary)" }}>
            {noPriceDrafts.length} draft{noPriceDrafts.length !== 1 ? "s" : ""} have no price — set one before listing.
          </p>
        </div>
      )}

      {!loading && !error && drafts.length === 0 && (
        <div className="card p-8 text-center">
          <p className="text-sm text-[var(--text-secondary)]">
            No drafts yet. Save one from the new listing or batch upload screens.
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
              {allSelected ? "Deselect all" : "Select all"}
            </button>
            {hasSelection && (
              <p className="text-xs text-[var(--text-secondary)]">{selected.size} selected</p>
            )}
          </div>

          {q && filtered.length === 0 && (
            <div className="card p-6 text-center mb-4">
              <p className="text-sm text-[var(--text-secondary)]">No drafts match &ldquo;{search.trim()}&rdquo;</p>
            </div>
          )}

          <div className="flex flex-col gap-2 mb-6">
            {filtered.map((d, rowIndex) => {
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

                  <svg width="6" height="10" viewBox="0 0 6 10" fill="none" className="flex-shrink-0">
                    <path d="M1 1L5 5L1 9" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              );
            })}
          </div>
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
