"use client";

import { ListSkeleton } from "@/components/ui";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Loader2, Package, RefreshCw, Shirt } from "lucide-react";
import Toast from "@/components/Toast";
import { apiFetch } from "@/lib/api";
import { getPageCache, setPageCache } from "@/lib/page-cache";
import { usePullToRefresh } from "@/components/usePullToRefresh";

const SHIP_CACHE_KEY = "ship:items";

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
  // Instant repaint from this tab's last load, refreshed in the background.
  const [items, setItems] = useState<ShipItem[]>(() => getPageCache<ShipItem[]>(SHIP_CACHE_KEY) ?? []);
  const [loading, setLoading] = useState(() => getPageCache<ShipItem[]>(SHIP_CACHE_KEY) === undefined);
  const [error, setError] = useState<string | null>(null);
  // True during EVERY check with eBay (cached rows can show meanwhile, but
  // the list always reconciles with eBay on open / refresh / pull-down).
  const [checking, setChecking] = useState(true);
  const [needsConnect, setNeedsConnect] = useState(false);
  const [needsReconnect, setNeedsReconnect] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setChecking(true);
    if (getPageCache<ShipItem[]>(SHIP_CACHE_KEY) === undefined) setLoading(true);
    setError(null);
    setNeedsConnect(false);
    setNeedsReconnect(false);
    try {
      const data = await apiFetch<{ items?: ShipItem[]; error?: string; connect?: boolean; reconnect?: boolean }>("/api/ebay/ship");
      if (data.error) {
        setError(data.error);
        setNeedsConnect(!!data.connect);
        setNeedsReconnect(!!data.reconnect);
        setItems([]);
        return;
      }
      setItems(data.items ?? []);
      setPageCache(SHIP_CACHE_KEY, data.items ?? []);
    } catch {
      setError("Failed to load shipments");
    } finally {
      setLoading(false);
      setChecking(false);
    }
  }
  const pull = usePullToRefresh(load);

  return (
    <main className="relative min-h-screen max-w-md lg:max-w-[1360px] mx-auto px-5 lg:px-8 pt-6 lg:pt-8 pb-10 overflow-hidden" style={{ viewTransitionName: "ship-panel" }}>
      <div
        className="bloom d1 stagger"
        style={{ width: 240, height: 240, top: -70, left: -60, background: "var(--glow-danger)" }}
      />
      <div
        className="bloom d1 stagger"
        style={{ width: 200, height: 200, top: 10, right: -70, background: "var(--glow-primary)" }}
      />

      {pull > 0 && (
        <div className="flex justify-center -mt-2 mb-2" aria-hidden>
          <RefreshCw className="w-5 h-5" style={{ color: "var(--accent)", opacity: pull, transform: `rotate(${pull * 270}deg)` }} />
        </div>
      )}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/dashboard"
          className="w-[34px] h-[34px] rounded-[11px] flex items-center justify-center flex-none"
          style={{ background: "var(--glass)", border: "1px solid var(--glass-line)" }}
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-medium">To ship</h1>
          {checking && !loading ? (
            <p className="text-xs text-[var(--text-secondary)]">Checking with eBay…</p>
          ) : !loading && !error && (
            <p className="text-xs text-[var(--text-secondary)]">
              {items.length === 0
                ? "All caught up"
                : `${items.length} item${items.length !== 1 ? "s" : ""} awaiting shipment`}
            </p>
          )}
        </div>
        <button
          onClick={() => void load()}
          disabled={checking}
          aria-label="Check with eBay"
          title="Refresh — check with eBay"
          className="p-2 rounded-lg hover:bg-[var(--bg-page)] transition-colors"
        >
          {checking
            ? <Loader2 className="w-4 h-4 animate-spin text-[var(--text-secondary)]" />
            : <RefreshCw className="w-4 h-4 text-[var(--text-secondary)]" />
          }
        </button>
      </div>

      <Toast
        type="error"
        message={
          error ? (
            <>
              {error}
              {needsConnect && (
                <a href="/api/ebay/connect" className="underline ml-2 font-medium">Connect eBay →</a>
              )}
              {needsReconnect && (
                <a href="/api/ebay/connect" className="underline ml-2 font-medium">Reconnect eBay →</a>
              )}
            </>
          ) : null
        }
        onClose={() => setError(null)}
      />

      {loading && <ListSkeleton label="Loading shipments…" />}

      {!loading && !error && items.length === 0 && (
        <div className="card p-10 text-center">
          <Package className="w-8 h-8 mx-auto mb-3 text-[var(--text-tertiary)]" />
          <p className="text-sm font-medium mb-1">All caught up!</p>
          <p className="text-xs text-[var(--text-secondary)]">No items awaiting shipment.</p>
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="flex flex-col gap-2 lg:grid lg:grid-cols-2 xl:grid-cols-3 lg:gap-3 lg:items-start">
          {items.map((item, i) => {
            const days = daysSince(item.paidAt);
            const ebayOrderUrl = `https://www.ebay.com/sh/ord/details?orderid=${item.listingId}-${item.transactionId}`;
            const isUrgent = days >= 3;

            return (
              <div key={i} className={`card stagger p-3 flex items-start gap-3 ${i < 6 ? `d${i + 1}` : ""}`}>
                {item.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.thumbnail}
                    alt={item.title}
                    loading="lazy"
                    decoding="async"
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
                    <p className="text-xs text-[var(--text-secondary)] mt-0.5 truncate lg:whitespace-normal">
                      {item.address.name ? `${item.address.name} · ` : ""}
                      {formatAddress(item.address)}
                    </p>
                  )}

                  <div className="flex items-center gap-2 mt-1">
                    <span
                      className="text-[11px] font-medium px-1.5 py-0.5 rounded-full"
                      style={{
                        background: isUrgent
                          ? "color-mix(in srgb, var(--danger) 16%, var(--bg-surface))"
                          : "color-mix(in srgb, var(--success) 16%, var(--bg-surface))",
                        color: isUrgent ? "var(--danger)" : "var(--success)",
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
                  aria-label={`Ship ${item.title || "this order"} on eBay (opens in a new tab)`}
                  className="flex items-center gap-1 text-xs font-medium text-[var(--accent-soft)] hover:underline flex-shrink-0 mt-0.5 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] lg:px-2.5 lg:py-1.5 lg:bg-[var(--accent-tint)] lg:no-underline"
                >
                  Ship
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
