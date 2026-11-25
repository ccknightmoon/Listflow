"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, Shirt } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { ListSkeleton } from "@/components/ui";
import { getPageCache, setPageCache } from "@/lib/page-cache";
import { useInventoryEmbed } from "@/components/inventory/InventoryEmbed";

// Inventory → Sold: what sold on eBay in the last 90 days, newest first.
// Money detail (fees, profit, payouts) stays on the Sales page; this is
// the item view so every item has a place in Inventory.
interface SoldItem { listingId: string; title: string; total: number; qty: number; soldAt: string; thumbnail: string | null }
const CACHE_KEY = "inventory:sold";
const DAYS = 90;

export default function SoldView() {
  const embed = useInventoryEmbed();
  const [items, setItems] = useState<SoldItem[] | null>(() => getPageCache<SoldItem[]>(CACHE_KEY) ?? null);
  const [error, setError] = useState<{ message: string; connect?: boolean; reconnect?: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ sales?: SoldItem[]; error?: string; connect?: boolean; reconnect?: boolean }>(`/api/ebay/sales?days=${DAYS}`)
      .then((r) => {
        if (cancelled) return;
        if (r.error) { setError({ message: r.error, connect: r.connect, reconnect: r.reconnect }); return; }
        const list = [...(r.sales ?? [])].sort((a, b) => Date.parse(b.soldAt) - Date.parse(a.soldAt));
        setItems(list);
        setPageCache(CACHE_KEY, list);
      })
      .catch((e) => { if (!cancelled) setError({ message: (e as Error).message }); });
    return () => { cancelled = true; };
  }, []);

  return (
    <main className="relative min-h-screen max-w-md lg:max-w-[1360px] mx-auto px-5 lg:px-8 pt-6 lg:pt-8 pb-8">
      {embed?.header}
      {error && (
        <div className="card p-4 text-sm mb-4" role="alert">
          {error.message}
          {(error.connect || error.reconnect) && <a href="/api/ebay/connect" className="underline ml-2 font-medium">{error.connect ? "Connect eBay →" : "Reconnect eBay →"}</a>}
        </div>
      )}
      {!items && !error && <ListSkeleton label="Loading sales…" />}
      {items && (
        <p className="text-sm text-[var(--text-secondary)] mb-3">
          {items.length} sold in the last {DAYS} days · <Link href="/sales" className="underline" style={{ color: "var(--accent)" }}>Money & profit on Sales</Link>
        </p>
      )}
      {items && items.length === 0 && <div className="card p-4 text-sm">Nothing sold in the last {DAYS} days yet.</div>}
      <ul className="flex flex-col gap-2 lg:grid lg:grid-cols-2 lg:gap-3">
        {items?.map((i, n) => (
          <li key={`${i.listingId}-${i.soldAt}-${n}`} className="card p-3 flex gap-3 items-center">
            {i.thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element -- eBay thumbnail
              <img src={i.thumbnail} alt="" className="w-14 h-14 rounded-lg object-cover shrink-0" />
            ) : (
              <div className="w-14 h-14 rounded-lg shrink-0 flex items-center justify-center" style={{ background: "var(--glass)" }}><Shirt className="w-5 h-5 text-[var(--text-tertiary)]" /></div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">{i.title}</p>
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                <span className="font-medium" style={{ color: "var(--success, var(--accent))" }}>Sold</span>
                {" · "}{formatMoney(i.total)}{i.qty > 1 ? ` (${i.qty})` : ""}
                {" · "}{new Date(i.soldAt).toLocaleDateString([], { month: "short", day: "numeric" })}
              </p>
            </div>
            {i.listingId && (
              <a href={`https://www.ebay.com/itm/${i.listingId}`} target="_blank" rel="noreferrer" className="btn text-xs" aria-label="View on eBay"><ExternalLink className="w-3.5 h-3.5" /></a>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
