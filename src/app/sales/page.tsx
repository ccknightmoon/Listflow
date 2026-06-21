"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Loader2, Shirt, TrendingUp } from "lucide-react";
import BottomNav from "@/components/BottomNav";

type DayRange = 7 | 30 | 90;

interface Sale {
  listingId: string;
  title: string;
  price: number;
  qty: number;
  total: number;
  soldAt: string;
  thumbnail: string | null;
}

export default function SalesPage() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<DayRange>(30);

  useEffect(() => { load(days); }, [days]);

  async function load(d: DayRange) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ebay/sales?days=${d}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      if (data.error) throw new Error(data.error);
      setSales(data.sales ?? []);
      setTotalRevenue(data.totalRevenue ?? 0);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen max-w-md mx-auto px-5 pt-6 pb-24">
      <div className="flex items-center gap-3 mb-4">
        <Link href="/dashboard"><ArrowLeft className="w-5 h-5" /></Link>
        <div className="flex-1">
          <h1 className="text-xl font-medium">Sales history</h1>
          {!loading && !error && (
            <p className="text-xs text-[var(--text-secondary)]">{sales.length} sale{sales.length !== 1 ? "s" : ""} in last {days} days</p>
          )}
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        {([7, 30, 90] as DayRange[]).map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`flex-1 text-sm py-1.5 rounded-lg border transition-colors ${
              days === d
                ? "border-[var(--brand-600)] text-[var(--brand-600)] font-medium"
                : "border-[var(--border)] text-[var(--text-secondary)]"
            }`}
          >
            {d}d
          </button>
        ))}
      </div>

      {!loading && !error && sales.length > 0 && (
        <div className="card p-4 mb-4 flex items-center gap-3">
          <TrendingUp className="w-5 h-5 text-green-600 flex-shrink-0" />
          <div>
            <p className="text-xs text-[var(--text-secondary)]">
              {sales.length} item{sales.length !== 1 ? "s" : ""} sold
            </p>
            <p className="text-xl font-medium">${totalRevenue.toFixed(2)}</p>
          </div>
        </div>
      )}

      {error && (
        <div className="card p-3 mb-4 text-sm" style={{ color: "#B3261E" }}>{error}</div>
      )}

      {loading && (
        <div className="card p-8 text-center">
          <Loader2 className="w-6 h-6 mx-auto mb-3 animate-spin" />
          <p className="text-sm text-[var(--text-secondary)]">Loading sales...</p>
        </div>
      )}

      {!loading && !error && sales.length === 0 && (
        <div className="card p-8 text-center">
          <p className="text-sm text-[var(--text-secondary)]">No sales in the last {days} days.</p>
        </div>
      )}

      {!loading && sales.length > 0 && (
        <div className="flex flex-col gap-2">
          {sales.map((s, i) => (
            <div key={i} className="card p-3 flex items-center gap-3">
              {s.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.thumbnail} alt={s.title} className="w-12 h-12 rounded-md object-cover flex-shrink-0" />
              ) : (
                <div className="w-12 h-12 rounded-md bg-[var(--bg-page)] flex items-center justify-center flex-shrink-0">
                  <Shirt className="w-5 h-5 text-[var(--text-secondary)]" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{s.title || "Unknown item"}</p>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                  {s.soldAt ? new Date(s.soldAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""}
                  {s.qty > 1 ? ` · Qty ${s.qty}` : ""}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                <p className="text-sm font-medium text-green-600">${s.total.toFixed(2)}</p>
                <a
                  href={`https://www.ebay.com/itm/${s.listingId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center gap-0.5 text-[10px] text-[var(--text-tertiary)] hover:text-[var(--brand-600)]"
                >
                  <ExternalLink className="w-3 h-3" />
                  eBay
                </a>
              </div>
            </div>
          ))}
        </div>
      )}

      <BottomNav />
    </main>
  );
}
