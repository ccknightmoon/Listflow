"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, ExternalLink, Shirt, Trash2, Pencil } from "lucide-react";
import BottomNav from "@/components/BottomNav";

interface StoreListing {
  listingId: string;
  title: string;
  price: number | null;
  thumbnail: string | null;
  sku: string | null;
}

export default function StorePage() {
  const [listings, setListings] = useState<StoreListing[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Set<string>>(new Set());

  useEffect(() => { loadStore(); }, []);

  async function loadStore() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ebay/store");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load store");
      setListings(data.listings ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelist(listingId: string, title: string) {
    if (!confirm(`End listing "${title}"? This will remove it from eBay.`)) return;
    setDeleting((prev) => new Set(prev).add(listingId));
    try {
      const res = await fetch("/api/ebay/delist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId }),
      });
      const data = await res.json();
      if (res.ok) {
        setListings((prev) => prev.filter((l) => l.listingId !== listingId));
        setTotal((t) => t - 1);
      } else {
        setError(data.error ?? "Failed to delist");
      }
    } catch {
      setError("Network error");
    } finally {
      setDeleting((prev) => { const next = new Set(prev); next.delete(listingId); return next; });
    }
  }

  return (
    <main className="min-h-screen max-w-md mx-auto px-5 pt-6 pb-24">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/dashboard">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-xl font-medium">
            {loading ? "Store" : `Store (${listings.length}${total > listings.length ? ` of ${total}` : ""})`}
          </h1>
          {!loading && !error && (
            <p className="text-xs text-[var(--text-secondary)]">All active eBay listings</p>
          )}
        </div>
      </div>

      {error && (
        <div className="card p-3 mb-4 text-sm" style={{ color: "#B3261E" }}>{error}</div>
      )}

      {loading && (
        <div className="card p-8 text-center">
          <Loader2 className="w-6 h-6 mx-auto mb-3 animate-spin" />
          <p className="text-sm text-[var(--text-secondary)]">Loading store...</p>
        </div>
      )}

      {!loading && !error && listings.length === 0 && (
        <div className="card p-8 text-center">
          <p className="text-sm text-[var(--text-secondary)]">No active eBay listings found.</p>
        </div>
      )}

      {!loading && listings.length > 0 && (
        <div className="flex flex-col gap-2">
          {listings.map((l) => (
            <div key={l.listingId} className="card p-3">
              <div className="flex items-center gap-3">
                {/* Thumbnail */}
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

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{l.title}</p>
                  <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                    {l.price != null ? `$${l.price.toFixed(2)}` : "—"}
                    {l.sku ? ` · SKU: ${l.sku}` : ""}
                  </p>
                  <p className="text-xs text-[var(--text-tertiary)] mt-0.5">#{l.listingId}</p>
                </div>
              </div>

              {/* Actions */}
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
                <div className="w-px h-4 bg-[var(--border)]" />
                <button
                  onClick={() => handleDelist(l.listingId, l.title)}
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

      <BottomNav />
    </main>
  );
}
