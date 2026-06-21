"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Loader2, Package, RefreshCw, Shirt } from "lucide-react";
import BottomNav from "@/components/BottomNav";

interface ShipItem {
  listingId: string;
  transactionId: string;
  title: string;
  price: number;
  qty: number;
  total: number;
  paidAt: string;
  address: {
    name: string;
    street1: string;
    street2: string;
    city: string;
    state: string;
    zip: string;
  } | null;
  thumbnail: string | null;
}

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

function formatAddress(addr: ShipItem["address"]): string {
  if (!addr) return "";
  const parts = [addr.city, addr.state, addr.zip].filter(Boolean);
  return parts.join(", ");
}

export default function ShipPage() {
  const [items, setItems] = useState<ShipItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsConnect, setNeedsConnect] = useState(false);
  const [needsReconnect, setNeedsReconnect] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setError(null);
    setNeedsConnect(false);
    setNeedsReconnect(false);
    try {
      const res = await fetch("/api/ebay/ship");
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setNeedsConnect(!!data.connect);
        setNeedsReconnect(!!data.reconnect);
        setItems([]);
        return;
      }
      setItems(data.items ?? []);
    } catch {
      setError("Failed to load shipments");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen max-w-md mx-auto px-5 pt-6 pb-24">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/dashboard"><ArrowLeft className="w-5 h-5" /></Link>
        <div className="flex-1">
          <h1 className="text-xl font-medium">To ship</h1>
          {!loading && !error && (
            <p className="text-xs text-[var(--text-secondary)]">
              {items.length === 0
                ? "All caught up"
                : `${items.length} item${items.length !== 1 ? "s" : ""} awaiting shipment`}
            </p>
          )}
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="p-2 rounded-lg hover:bg-[var(--bg-page)] transition-colors"
        >
          {loading
            ? <Loader2 className="w-4 h-4 animate-spin text-[var(--text-secondary)]" />
            : <RefreshCw className="w-4 h-4 text-[var(--text-secondary)]" />
          }
        </button>
      </div>

      {error && (
        <div className="card p-3 mb-4 text-sm" style={{ color: "#B3261E" }}>
          {error}
          {needsConnect && (
            <a href="/api/ebay/connect" className="underline ml-2 font-medium">Connect eBay →</a>
          )}
          {needsReconnect && (
            <a href="/api/ebay/connect" className="underline ml-2 font-medium">Reconnect eBay →</a>
          )}
        </div>
      )}

      {loading && (
        <div className="card p-8 text-center">
          <Loader2 className="w-6 h-6 mx-auto mb-3 animate-spin" />
          <p className="text-sm text-[var(--text-secondary)]">Loading shipments...</p>
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="card p-10 text-center">
          <Package className="w-8 h-8 mx-auto mb-3 text-[var(--text-tertiary)]" />
          <p className="text-sm font-medium mb-1">All caught up!</p>
          <p className="text-xs text-[var(--text-secondary)]">No items awaiting shipment.</p>
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="flex flex-col gap-2">
          {items.map((item, i) => {
            const days = daysSince(item.paidAt);
            const ebayOrderUrl = `https://www.ebay.com/sh/ord/details?orderid=${item.listingId}-${item.transactionId}`;
            const isUrgent = days >= 3;

            return (
              <div key={i} className="card p-3 flex items-start gap-3">
                {item.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.thumbnail}
                    alt={item.title}
                    className="w-12 h-12 rounded-md object-cover flex-shrink-0"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-md bg-[var(--bg-page)] flex items-center justify-center flex-shrink-0">
                    <Shirt className="w-5 h-5 text-[var(--text-secondary)]" />
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{item.title || "Unknown item"}</p>

                  {item.address && (
                    <p className="text-xs text-[var(--text-secondary)] mt-0.5 truncate">
                      {item.address.name ? `${item.address.name} · ` : ""}
                      {formatAddress(item.address)}
                    </p>
                  )}

                  <div className="flex items-center gap-2 mt-1">
                    <span
                      className="text-[11px] font-medium px-1.5 py-0.5 rounded-full"
                      style={{
                        background: isUrgent ? "#FEF2F2" : "#F0FDF4",
                        color: isUrgent ? "#B91C1C" : "#15803D",
                      }}
                    >
                      {days === 0 ? "Paid today" : days === 1 ? "Paid yesterday" : `Paid ${days}d ago`}
                    </span>
                    <span className="text-xs text-[var(--text-secondary)]">${item.total.toFixed(2)}</span>
                  </div>
                </div>

                <a
                  href={ebayOrderUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center gap-1 text-xs font-medium text-[var(--brand-600)] hover:underline flex-shrink-0 mt-0.5"
                >
                  Ship
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            );
          })}
        </div>
      )}

      <BottomNav />
    </main>
  );
}
