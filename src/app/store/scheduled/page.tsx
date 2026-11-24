"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CalendarClock, ChevronRight, ExternalLink, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatMoney } from "@/lib/format";

interface Scheduled { listingId: string; title: string; price: number | null; thumbnail: string | null; startTime: string | null; draftId: string | null }

// Scheduled listings on eBay: finish them here (Edit in Listflow) or in the
// eBay app (Selling → Scheduled, then "List it now").
export default function ScheduledPage() {
  const [items, setItems] = useState<Scheduled[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ items?: Scheduled[]; error?: string }>("/api/ebay/scheduled")
      .then((r) => (r.error ? setError(r.error) : setItems(r.items ?? [])))
      .catch((e) => setError((e as Error).message));
  }, []);

  return (
    <main className="min-h-screen max-w-md lg:max-w-3xl mx-auto px-5 pt-6 pb-28">
      <div className="flex items-center gap-2 mb-4">
        <Link href="/store" aria-label="Back to listings" className="p-2 -ml-2"><ArrowLeft className="w-5 h-5" /></Link>
        <h1 className="text-xl font-medium">Scheduled on eBay</h1>
      </div>
      <p className="text-xs mb-4" style={{ color: "var(--text-tertiary)" }}>
        Listings waiting to go live. Finish one here, or in the eBay app under Selling → Scheduled (&quot;List it now&quot; starts it right away).
      </p>
      {error && <div className="card p-4 text-sm" role="alert">{error}</div>}
      {!items && !error && <Loader2 className="w-5 h-5 animate-spin" />}
      {items && items.length === 0 && <div className="card p-4 text-sm">Nothing scheduled right now.</div>}
      <ul className="flex flex-col gap-2">
        {items?.map((i) => (
          <li key={i.listingId} className="card p-3 flex gap-3 items-center">
            {i.thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element -- eBay thumbnail
              <img src={i.thumbnail} alt="" className="w-14 h-14 rounded-lg object-cover shrink-0" />
            ) : <div className="w-14 h-14 rounded-lg shrink-0" style={{ background: "var(--glass)" }} />}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">{i.title}</p>
              <p className="text-xs flex items-center gap-1" style={{ color: "var(--text-secondary)" }}>
                <CalendarClock className="w-3.5 h-3.5" />
                {i.startTime ? `Goes live ${new Date(i.startTime).toLocaleDateString([], { month: "short", day: "numeric" })}` : "Scheduled"}
                {i.price != null ? ` · ${formatMoney(i.price)}` : ""}
              </p>
            </div>
            <a href={`https://www.ebay.com/itm/${i.listingId}`} target="_blank" rel="noreferrer" className="btn text-xs" aria-label="View on eBay"><ExternalLink className="w-3.5 h-3.5" /></a>
            <Link href={i.draftId ? `/drafts/${i.draftId}` : `/store/edit/${i.listingId}`} className="btn text-xs">Finish <ChevronRight className="w-3.5 h-3.5" /></Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
