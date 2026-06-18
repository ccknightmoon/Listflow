"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, ExternalLink, Shirt, ChevronRight } from "lucide-react";
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

  const active = listings.filter((l) => l.status === "PUBLISHED");

  return (
    <main className="min-h-screen max-w-md mx-auto px-5 pt-6 pb-24">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/dashboard"><ArrowLeft className="w-5 h-5" /></Link>
        <h1 className="text-xl font-medium">Listed on eBay</h1>
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
          <p className="text-xs text-[var(--text-secondary)] mb-3">{active.length} active listing{active.length !== 1 ? "s" : ""}</p>
          <div className="flex flex-col gap-2">
            {active.map((l) => {
              const draftId = l.draftId ?? skuToDraftId(l.sku);
              return (
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
                    <p className="text-xs text-[var(--text-secondary)]">{l.price ? `$${l.price}` : "—"} · Active</p>
                  </div>
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
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <BottomNav />
    </main>
  );
}
