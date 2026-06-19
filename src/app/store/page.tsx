"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, ExternalLink, Shirt } from "lucide-react";
import BottomNav from "@/components/BottomNav";

interface StoreListing {
  listingId: string;
  title: string;
  price: string;
  gallery: string;
  endTime: string;
  quantity: string;
  quantitySold: string;
}

function timeLeft(endTime: string): string {
  if (!endTime) return "";
  const diff = new Date(endTime).getTime() - Date.now();
  if (diff <= 0) return "Ended";
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  if (days > 0) return `${days}d ${hours}h left`;
  const mins = Math.floor((diff % 3600000) / 60000);
  if (hours > 0) return `${hours}h ${mins}m left`;
  return `${mins}m left`;
}

export default function StorePage() {
  const [listings, setListings] = useState<StoreListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { loadStore(); }, []);

  async function loadStore() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ebay/store");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load store");
      setListings(data.listings ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen max-w-md mx-auto px-5 pt-6 pb-24">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/dashboard">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-xl font-medium">
          {loading ? "Store" : `Store (${listings.length})`}
        </h1>
      </div>

      {error && (
        <div className="card p-3 mb-4 text-sm" style={{ color: "#B3261E" }}>{error}</div>
      )}

      {loading && (
        <div className="card p-8 text-center">
          <Loader2 className="w-6 h-6 mx-auto mb-3 animate-spin" />
          <p className="text-sm text-[var(--text-secondary)]">Loading eBay store...</p>
        </div>
      )}

      {!loading && !error && listings.length === 0 && (
        <div className="card p-8 text-center">
          <p className="text-sm text-[var(--text-secondary)]">No active listings on your eBay account.</p>
        </div>
      )}

      {!loading && listings.length > 0 && (
        <div className="flex flex-col gap-2">
          {listings.map((l) => (
            <a
              key={l.listingId}
              href={`https://www.ebay.com/itm/${l.listingId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="card flex items-center gap-3 p-3 active:opacity-80"
            >
              {l.gallery ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={l.gallery}
                  alt={l.title}
                  className="w-12 h-12 rounded-md object-cover flex-shrink-0"
                />
              ) : (
                <div className="w-12 h-12 rounded-md bg-[var(--bg-page)] flex items-center justify-center flex-shrink-0">
                  <Shirt className="w-6 h-6 text-[var(--text-secondary)]" />
                </div>
              )}

              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{l.title}</p>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                  {l.price ? `$${parseFloat(l.price).toFixed(2)}` : ""}
                  {l.endTime ? ` · ${timeLeft(l.endTime)}` : ""}
                </p>
                {l.quantitySold && l.quantitySold !== "0" && (
                  <p className="text-xs mt-0.5" style={{ color: "#3B6D11" }}>
                    {l.quantitySold} sold
                  </p>
                )}
              </div>

              <ExternalLink className="w-4 h-4 flex-shrink-0 text-[var(--text-tertiary)]" />
            </a>
          ))}
        </div>
      )}

      <BottomNav />
    </main>
  );
}
