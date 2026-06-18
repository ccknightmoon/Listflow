"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, ExternalLink, Upload, Shirt } from "lucide-react";
import BottomNav from "@/components/BottomNav";

interface Listing {
  offerId: string | null;
  sku: string;
  status: string;
  listingId?: string;
  price?: string;
  title: string;
  thumbnail: string | null;
}

export default function EbayInventoryPage() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState<string | null>(null);

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

  async function handlePublish(sku: string, offerId: string) {
    setPublishing(sku);
    try {
      const res = await fetch("/api/ebay/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offerId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to publish");
      await loadInventory();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPublishing(null);
    }
  }

  const active = listings.filter((l) => l.status === "PUBLISHED");
  const drafts = listings.filter((l) => l.status !== "PUBLISHED");

  return (
    <main className="min-h-screen max-w-md mx-auto px-5 pt-6 pb-24">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/dashboard"><ArrowLeft className="w-5 h-5" /></Link>
        <h1 className="text-xl font-medium">eBay Inventory</h1>
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

      {!loading && !error && listings.length === 0 && (
        <div className="card p-8 text-center">
          <p className="text-sm text-[var(--text-secondary)]">No listings yet. Save a draft to eBay or list an item to see it here.</p>
        </div>
      )}

      {!loading && active.length > 0 && (
        <>
          <h2 className="text-sm font-medium text-[var(--text-secondary)] mb-2">Active ({active.length})</h2>
          <div className="flex flex-col gap-2 mb-6">
            {active.map((l) => (
              <div key={l.offerId} className="card flex items-center gap-3 p-3">
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
                  <p className="text-xs text-[var(--text-secondary)]">${l.price} · Active</p>
                </div>
                {l.listingId && (
                  <a href={`https://www.ebay.com/itm/${l.listingId}`} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="w-4 h-4 text-[var(--text-tertiary)]" />
                  </a>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {!loading && drafts.length > 0 && (
        <>
          <h2 className="text-sm font-medium text-[var(--text-secondary)] mb-2">eBay Drafts ({drafts.length})</h2>
          <div className="flex flex-col gap-2">
            {drafts.map((l) => (
              <div key={l.sku} className="card flex items-center gap-3 p-3">
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
                  <p className="text-xs text-[var(--text-secondary)]">{l.price ? `$${l.price}` : "No price"} · {l.status === "NO_OFFER" ? "No offer" : "Draft"}</p>
                </div>
                {l.offerId ? (
                  <button
                    onClick={() => handlePublish(l.sku, l.offerId)}
                    disabled={publishing === l.sku}
                    className="btn btn-primary text-xs px-3 py-1 flex items-center gap-1"
                  >
                    {publishing === l.sku ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                    {publishing === l.sku ? "Publishing..." : "Go Live"}
                  </button>
                ) : (
                  <span className="text-xs text-[var(--text-tertiary)] px-3">No offer</span>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <BottomNav />
    </main>
  );
}
