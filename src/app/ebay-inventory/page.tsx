"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, ExternalLink, Shirt, ChevronRight, Trash2, CheckCircle2, Circle } from "lucide-react";
import BottomNav from "@/components/BottomNav";

interface Listing {
  draftId?: string;
  sku: string;
  status: string;
  listingId?: string;
  price?: string | null;
  title: string;
  thumbnail: string | null;
}

function skuToDraftId(sku: string): string | null {
  const hex = sku.startsWith("listflow") ? sku.slice(8) : null;
  if (!hex || hex.length !== 32) return null;
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

export default function EbayInventoryPage() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [delistingId, setDelistingId] = useState<string | null>(null);

  // Multi-select state
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDelisting, setBulkDelisting] = useState(false);

  useEffect(() => { loadInventory(); }, []);

  async function loadInventory() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ebay/inventory");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load inventory");
      setListings(data.listings ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelist(draftId: string) {
    if (!confirm("End this eBay listing? The draft will be kept so you can relist later.")) return;
    setDelistingId(draftId);
    setError(null);
    try {
      const res = await fetch("/api/ebay/delist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delist");
      setListings((prev) => prev.filter((l) => l.draftId !== draftId));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDelistingId(null);
    }
  }

  function toggleSelect(draftId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(draftId)) next.delete(draftId);
      else next.add(draftId);
      return next;
    });
  }

  function selectAll() {
    const allIds = active.map((l) => l.draftId ?? skuToDraftId(l.sku)).filter((id): id is string => Boolean(id));
    setSelected(new Set(allIds));
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
  }

  async function handleBulkDelist() {
    const ids = [...selected];
    if (!confirm(`End ${ids.length} listing${ids.length !== 1 ? "s" : ""}? Drafts will be kept.`)) return;
    setBulkDelisting(true);
    setError(null);
    for (const draftId of ids) {
      try {
        await fetch("/api/ebay/delist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draftId }),
        });
        setListings((prev) => prev.filter((l) => l.draftId !== draftId));
        setSelected((prev) => { const next = new Set(prev); next.delete(draftId); return next; });
      } catch {
        // continue with remaining items
      }
    }
    setBulkDelisting(false);
    exitSelectMode();
  }

  const active = listings.filter((l) => l.status === "PUBLISHED");
  const allSelected = active.length > 0 && active.every((l) => {
    const id = l.draftId ?? skuToDraftId(l.sku);
    return id ? selected.has(id) : false;
  });

  return (
    <main className="min-h-screen max-w-md mx-auto px-5 pt-6 pb-24">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          {!selectMode && <Link href="/dashboard"><ArrowLeft className="w-5 h-5" /></Link>}
          <h1 className="text-xl font-medium">
            {selectMode ? `${selected.size} selected` : "Listed on eBay"}
          </h1>
        </div>
        {!loading && active.length > 0 && (
          selectMode ? (
            <button onClick={exitSelectMode} className="text-sm text-[var(--text-secondary)]">
              Cancel
            </button>
          ) : (
            <button onClick={() => setSelectMode(true)} className="text-sm" style={{ color: "var(--accent)" }}>
              Select
            </button>
          )
        )}
      </div>

      {error && (
        <div className="card p-3 mb-4 text-sm" style={{ color: "#B3261E" }}>
          {error.includes("not connected") ? (
            <>eBay not connected. <a href="/api/ebay/connect" className="underline">Connect now →</a></>
          ) : error}
        </div>
      )}

      {loading && (
        <div className="card p-8 text-center">
          <Loader2 className="w-6 h-6 mx-auto animate-spin" />
        </div>
      )}

      {!loading && !error && active.length === 0 && (
        <div className="card p-8 text-center">
          <p className="text-sm text-[var(--text-secondary)]">No active listings yet. Open a draft and tap &ldquo;List on eBay&rdquo; to publish.</p>
        </div>
      )}

      {!loading && active.length > 0 && (
        <>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-[var(--text-secondary)]">{active.length} active listing{active.length !== 1 ? "s" : ""}</p>
            {selectMode && (
              <button onClick={allSelected ? exitSelectMode : selectAll} className="text-xs" style={{ color: "var(--accent)" }}>
                {allSelected ? "Deselect all" : "Select all"}
              </button>
            )}
          </div>

          <div className="flex flex-col gap-2">
            {active.map((l) => {
              const draftId = l.draftId ?? skuToDraftId(l.sku);
              const isDelisting = delistingId === draftId;
              const isSelected = draftId ? selected.has(draftId) : false;

              return (
                <div
                  key={l.sku}
                  className={`card flex items-center gap-3 p-3 transition-colors ${
                    selectMode && isSelected ? "ring-2 ring-[var(--accent)]" : ""
                  }`}
                  onClick={() => selectMode && draftId && toggleSelect(draftId)}
                  style={selectMode ? { cursor: "pointer" } : undefined}
                >
                  {selectMode ? (
                    <div className="flex-shrink-0">
                      {isSelected
                        ? <CheckCircle2 className="w-6 h-6" style={{ color: "var(--accent)" }} />
                        : <Circle className="w-6 h-6 text-[var(--text-tertiary)]" />
                      }
                    </div>
                  ) : null}

                  {l.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={l.thumbnail} alt={l.title} className="w-10 h-10 rounded-md object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-10 h-10 rounded-md bg-[var(--bg-page)] flex items-center justify-center flex-shrink-0">
                      <Shirt className="w-5 h-5 text-[var(--text-secondary)]" />
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{l.title}</p>
                    <p className="text-xs text-[var(--text-secondary)]">{l.price ? `$${l.price}` : "—"} · Active</p>
                  </div>

                  {!selectMode && (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {l.listingId && (
                        <a href={`https://www.ebay.com/itm/${l.listingId}`} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="w-4 h-4 text-[var(--text-tertiary)]" />
                        </a>
                      )}
                      {draftId && (
                        <Link href={`/drafts/${draftId}`}>
                          <ChevronRight className="w-4 h-4 text-[var(--text-tertiary)]" />
                        </Link>
                      )}
                      {draftId && (
                        <button
                          onClick={() => handleDelist(draftId)}
                          disabled={isDelisting}
                          className="p-1 rounded hover:bg-[var(--bg-page)]"
                          title="End listing"
                        >
                          {isDelisting
                            ? <Loader2 className="w-4 h-4 animate-spin text-[var(--text-tertiary)]" />
                            : <Trash2 className="w-4 h-4" style={{ color: "#B3261E" }} />
                          }
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Bulk delete action bar */}
      {selectMode && selected.size > 0 && (
        <div className="fixed bottom-20 left-0 right-0 max-w-md mx-auto px-5">
          <button
            onClick={handleBulkDelist}
            disabled={bulkDelisting}
            className="w-full btn flex items-center justify-center gap-2 py-3"
            style={{ background: "#B3261E", color: "#fff" }}
          >
            {bulkDelisting
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Ending listings...</>
              : <><Trash2 className="w-4 h-4" /> End {selected.size} listing{selected.size !== 1 ? "s" : ""}</>
            }
          </button>
        </div>
      )}

      <BottomNav />
    </main>
  );
}
