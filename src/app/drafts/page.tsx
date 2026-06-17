"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Shirt, Loader2 } from "lucide-react";
import BottomNav from "@/components/BottomNav";

interface Draft {
  id: string;
  title: string | null;
  brand: string | null;
  color: string | null;
  size: string | null;
  condition: string | null;
  flaws: string | null;
  suggested_price: number | null;
  avg_sold: number | null;
  active_range_low: number | null;
  active_range_high: number | null;
  sell_odds: string | null;
  thumbnail_url: string | null;
  created_at: string;
}

export default function DraftsPage() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadDrafts() {
      try {
        const res = await fetch("/api/drafts");
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Failed to load drafts");
        }

        setDrafts(data.drafts ?? []);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    }

    loadDrafts();
  }, []);

  return (
    <main className="min-h-screen max-w-md mx-auto px-5 pt-6 pb-24">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/dashboard">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-xl font-medium">Drafts ({drafts.length})</h1>
      </div>

      {loading && (
        <div className="card p-8 text-center">
          <Loader2 className="w-6 h-6 mx-auto mb-3 animate-spin" />
          <p className="text-sm text-[var(--text-secondary)]">Loading drafts...</p>
        </div>
      )}

      {error && (
        <div className="card p-3 mb-4 text-sm" style={{ color: "#B3261E" }}>
          {error}
        </div>
      )}

      {!loading && !error && drafts.length === 0 && (
        <div className="card p-8 text-center">
          <p className="text-sm text-[var(--text-secondary)]">
            No drafts yet. Save one from the new listing or batch upload
            screens.
          </p>
        </div>
      )}

      {!loading && drafts.length > 0 && (
        <div className="flex flex-col gap-2 mb-6">
          {drafts.map((d) => (
            <div key={d.id} className="card flex items-center gap-3 p-3">
              {d.thumbnail_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={d.thumbnail_url}
                  alt={d.title ?? "Draft"}
                  className="w-9 h-9 rounded-md object-cover flex-shrink-0"
                />
              ) : (
                <div className="w-9 h-9 rounded-md bg-[var(--bg-page)] flex items-center justify-center flex-shrink-0">
                  <Shirt className="w-4 h-4 text-[var(--text-secondary)]" />
                </div>
              )}
              <div className="flex-1">
                <p className="text-sm font-medium">{d.title ?? "Untitled item"}</p>
                <p className="text-xs text-[var(--text-secondary)]">
                  {d.suggested_price != null ? `Suggested $${d.suggested_price}` : ""}
                  {d.sell_odds ? ` \u00b7 ${d.sell_odds} sell odds` : ""}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      <BottomNav />
    </main>
  );
}

