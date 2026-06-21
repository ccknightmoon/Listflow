"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, ExternalLink, Shirt, Trash2, Pencil, Search, X, ChevronRight, Check } from "lucide-react";
import BottomNav from "@/components/BottomNav";

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

interface StoreListing {
  listingId: string;
  title: string;
  price: number | null;
  thumbnail: string | null;
  sku: string | null;
  startTime: string | null;
  draftId?: string | null;
}

export default function StorePage() {
  const [listings, setListings] = useState<StoreListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [ebayLoading, setEbayLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsConnect, setNeedsConnect] = useState(false);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [deleting, setDeleting] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortKey>("newest");
  const [search, setSearch] = useState("");
  const [editingPrice, setEditingPrice] = useState<Map<string, string>>(new Map());
  const [savingPrice, setSavingPrice] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPrice, setBulkPrice] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkSuccessMsg, setBulkSuccessMsg] = useState("");

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    setEbayLoading(true);
    setError(null);

    // Phase 1: load Listflow items from Supabase — instant
    let supabaseListingIds = new Set<string>();
    try {
      const res = await fetch("/api/ebay/inventory");
      const data = await res.json();
      if (res.ok) {
        const items: StoreListing[] = (data.listings ?? []).map((l: {
          listingId: string; title: string; price: string | null;
          thumbnail: string | null; sku: string | null; startTime: string | null; draftId: string;
        }) => ({
          listingId: l.listingId,
          title: l.title,
          price: l.price != null ? parseFloat(l.price) : null,
          thumbnail: l.thumbnail,
          sku: l.sku,
          startTime: l.startTime,
          draftId: l.draftId,
        }));
        supabaseListingIds = new Set(items.map((i) => i.listingId));
        setListings(items);
      }
    } catch {
      // non-fatal — eBay load below may still work
    } finally {
      setLoading(false);
    }

    // Phase 2: load all eBay listings async — fills in items not created through Listflow
    try {
      const res = await fetch("/api/ebay/store");
      const data = await res.json();
      if (!res.ok) {
        setNeedsConnect(!!data.connect);
        setNeedsReconnect(!!data.reconnect);
        throw new Error(data.error || "Failed to load store");
      }
      const ebayListings: StoreListing[] = data.listings ?? [];
      const total: number = data.total ?? ebayListings.length;
      const allActiveIds = new Set(ebayListings.map((l) => l.listingId));
      const ebayItems: StoreListing[] = ebayListings
        .filter((l: StoreListing) => !supabaseListingIds.has(l.listingId))
        .map((l: StoreListing) => ({
          listingId: l.listingId,
          title: l.title,
          price: l.price,
          thumbnail: l.thumbnail,
          sku: l.sku,
          startTime: l.startTime,
          draftId: null,
        }));
      // Only filter out sold items when we have the complete eBay listing set
      // (skip if paginated response is incomplete to avoid false negatives)
      if (total <= ebayListings.length) {
        setListings((prev) => [
          ...prev.filter((l) => allActiveIds.has(l.listingId)),
          ...ebayItems,
        ]);
      } else {
        setListings((prev) => [...prev, ...ebayItems]);
      }
    } catch (err) {
      // Only show error if Supabase also returned nothing
      setListings((prev) => {
        if (prev.length === 0) setError((err as Error).message);
        return prev;
      });
    } finally {
      setEbayLoading(false);
    }
  }

  async function handleDelist(listing: StoreListing) {
    if (!confirm(`End listing "${listing.title}"? This will remove it from eBay.`)) return;
    setDeleting((prev) => new Set(prev).add(listing.listingId));
    try {
      const body = listing.draftId
        ? { draftId: listing.draftId }
        : { listingId: listing.listingId };
      const res = await fetch("/api/ebay/delist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        setListings((prev) => prev.filter((l) => l.listingId !== listing.listingId));
        window.dispatchEvent(new Event("listflow:counts-changed"));
      } else {
        setError(data.error ?? "Failed to delist");
      }
    } catch {
      setError("Network error");
    } finally {
      setDeleting((prev) => { const next = new Set(prev); next.delete(listing.listingId); return next; });
    }
  }

  async function handleUpdatePrice(listing: StoreListing) {
    const newPrice = editingPrice.get(listing.listingId);
    if (!newPrice) return;
    setSavingPrice((prev) => new Set(prev).add(listing.listingId));
    try {
      const res = await fetch("/api/ebay/update-price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId: listing.listingId, price: newPrice, draftId: listing.draftId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
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
        const res = await fetch("/api/ebay/update-price", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ listingId: l.listingId, price: bulkPrice, draftId: l.draftId }),
        });
        if (res.ok) {
          setListings((prev) => prev.map((x) =>
            x.listingId === l.listingId ? { ...x, price: parseFloat(bulkPrice) } : x
          ));
        } else failed++;
      } catch { failed++; }
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
  const filtered = !q ? listings : listings.filter((l) => {
    const sku = (l.sku ?? "").toLowerCase();
    if (q.length === 1) return sku === q;
    if (sku && (sku === q || sku.startsWith(q))) return true;
    const qWords = q.split(/\s+/);
    const titleWords = l.title.toLowerCase().split(/[\s\-\/,.()&]+/);
    return qWords.every((qw) => titleWords.some((tw) => tw.startsWith(qw)));
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sort === "newest" || sort === "oldest") {
      const ta = a.startTime ? new Date(a.startTime).getTime() : 0;
      const tb = b.startTime ? new Date(b.startTime).getTime() : 0;
      return sort === "newest" ? tb - ta : ta - tb;
    }
    const pa = a.price ?? 0;
    const pb = b.price ?? 0;
    return sort === "price-asc" ? pa - pb : pb - pa;
  });

  return (
    <main className="min-h-screen max-w-md mx-auto px-5 pt-6 pb-24">
      <div className="flex items-center gap-3 mb-4">
        <Link href="/dashboard">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-medium">
            {loading ? "Store" : `Store (${listings.length})`}
          </h1>
          {!loading && !error && (
            <p className="text-xs text-[var(--text-secondary)]">All active eBay listings</p>
          )}
        </div>
        {!loading && ebayLoading && (
          <Loader2 className="w-4 h-4 animate-spin text-[var(--text-tertiary)]" />
        )}
        {!loading && listings.length > 0 && (
          selectMode ? (
            <button onClick={() => { setSelectMode(false); setSelected(new Set()); setBulkPrice(""); }} className="text-sm text-[var(--text-secondary)]">Cancel</button>
          ) : (
            <button onClick={() => setSelectMode(true)} className="text-sm" style={{ color: "var(--brand-600)" }}>Select</button>
          )
        )}
      </div>

      {!loading && listings.length > 0 && (
        <div className="flex flex-col gap-2 mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)] pointer-events-none" />
            <input
              type="search"
              placeholder="Search by title..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full text-sm rounded-lg border border-[var(--border)] bg-white pl-9 pr-9 py-2 text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-600)]"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2"
              >
                <X className="w-4 h-4 text-[var(--text-tertiary)]" />
              </button>
            )}
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="w-full text-sm rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-600)]"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="price-asc">Price: low to high</option>
            <option value="price-desc">Price: high to low</option>
          </select>
          {q && (
            <p className="text-xs text-[var(--text-secondary)]">
              {sorted.length} result{sorted.length !== 1 ? "s" : ""} for &ldquo;{search.trim()}&rdquo;
            </p>
          )}
        </div>
      )}

      {error && (
        <div className="card p-3 mb-4 text-sm" style={{ color: "#B3261E" }}>
          {error}
          {needsConnect && <a href="/api/ebay/connect" className="underline ml-2 font-medium">Connect eBay →</a>}
          {needsReconnect && <a href="/api/ebay/connect" className="underline ml-2 font-medium">Reconnect eBay →</a>}
        </div>
      )}
      {bulkSuccessMsg && (
        <div className="card p-3 mb-4 text-sm" style={{ color: "#3B6D11" }}>{bulkSuccessMsg}</div>
      )}

      {loading && (
        <div className="card p-8 text-center">
          <Loader2 className="w-6 h-6 mx-auto mb-3 animate-spin" />
          <p className="text-sm text-[var(--text-secondary)]">Loading store...</p>
        </div>
      )}

      {!loading && !error && listings.length === 0 && !ebayLoading && (
        <div className="card p-8 text-center">
          <p className="text-sm text-[var(--text-secondary)]">No active eBay listings found.</p>
        </div>
      )}

      {!loading && listings.length > 0 && sorted.length === 0 && (
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
          {sorted.map((l) => (
            <div
              key={l.listingId}
              className={`card p-3 ${selectMode && selected.has(l.listingId) ? "ring-2 ring-[var(--brand-600)]" : ""}`}
              onClick={selectMode ? () => setSelected((prev) => { const next = new Set(prev); next.has(l.listingId) ? next.delete(l.listingId) : next.add(l.listingId); return next; }) : undefined}
              style={selectMode ? { cursor: "pointer" } : undefined}
            >
              <div className="flex items-center gap-3">
                {l.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={l.thumbnail}
                    alt={l.title}
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
                        className="w-20 text-xs border border-[var(--border)] rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-[var(--brand-600)]"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleUpdatePrice(l);
                          if (e.key === "Escape") setEditingPrice((prev) => { const next = new Map(prev); next.delete(l.listingId); return next; });
                        }}
                      />
                      <button onClick={() => handleUpdatePrice(l)} disabled={savingPrice.has(l.listingId)} className="text-green-600">
                        {savingPrice.has(l.listingId) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      </button>
                      <button onClick={() => setEditingPrice((prev) => { const next = new Map(prev); next.delete(l.listingId); return next; })} className="text-[var(--text-tertiary)]">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <p
                      className="text-xs text-[var(--text-secondary)] mt-0.5 cursor-pointer hover:text-[var(--brand-600)]"
                      onClick={() => setEditingPrice((prev) => new Map(prev).set(l.listingId, l.price != null ? l.price.toFixed(2) : ""))}
                    >
                      {l.price != null ? `$${l.price.toFixed(2)}` : "Tap to set price"}
                      {l.sku ? ` · SKU: ${l.sku}` : ""}
                      {l.startTime ? ` · Listed ${timeAgo(l.startTime)}` : ""}
                      <span className="ml-1 opacity-40 text-[10px]">edit</span>
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 mt-2 pt-2 border-t border-[var(--border)]">
                <a
                  href={`https://www.ebay.com/sh/edit-item/${l.listingId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex-1 justify-center py-1"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Edit on eBay
                </a>
                <div className="w-px h-4 bg-[var(--border)]" />
                <a
                  href={`https://www.ebay.com/itm/${l.listingId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex-1 justify-center py-1"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  View
                </a>
                {l.draftId && (
                  <>
                    <div className="w-px h-4 bg-[var(--border)]" />
                    <Link
                      href={`/drafts/${l.draftId}`}
                      className="flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex-1 justify-center py-1"
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
                  className="flex items-center gap-1 text-xs hover:text-red-600 flex-1 justify-center py-1 disabled:opacity-50"
                  style={{ color: deleting.has(l.listingId) ? undefined : "var(--text-secondary)" }}
                >
                  {deleting.has(l.listingId) ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5" />
                  )}
                  {deleting.has(l.listingId) ? "Ending..." : "Delist"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {selectMode && selected.size > 0 && (
        <div className="fixed bottom-20 left-0 right-0 max-w-md mx-auto px-5">
          <div className="card p-3 shadow-lg flex flex-col gap-2">
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
