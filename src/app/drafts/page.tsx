"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Shirt, Loader2, Trash2, Upload, Search, X } from "lucide-react";
import BottomNav from "@/components/BottomNav";

interface Draft {
  id: string;
  title: string | null;
  suggested_price: number | null;
  sell_odds: string | null;
  condition: string | null;
  thumbnail_url: string | null;
  ebay_listing_id: string | null;
  created_at: string | null;
}

type ListStatus = "idle" | "listing" | "done";
type SortKey = "newest" | "oldest" | "price-desc" | "price-asc";

export default function DraftsPage() {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [listStatus, setListStatus] = useState<ListStatus>("idle");
  const [listProgress, setListProgress] = useState(0);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");

  useEffect(() => { loadDrafts(); }, []);

  async function loadDrafts() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/drafts");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load drafts");
      setDrafts((data.drafts ?? []).filter((d: Draft) => !d.ebay_listing_id));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function toggleSelect(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    const allFilteredSelected = filtered.every((d) => selected.has(d.id));
    if (allFilteredSelected) {
      setSelected((prev) => { const next = new Set(prev); filtered.forEach((d) => next.delete(d.id)); return next; });
    } else {
      setSelected((prev) => new Set([...prev, ...filtered.map((d) => d.id)]));
    }
  }


  async function handleDeleteSelected() {
    if (selected.size === 0) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/drafts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      if (!res.ok) throw new Error("Failed to delete");
      setDrafts((prev) => prev.filter((d) => !selected.has(d.id)));
      setSelected(new Set());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  async function handleListSelected() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setListStatus("listing");
    setListProgress(0);

    for (let i = 0; i < ids.length; i++) {
      try {
        const res = await fetch("/api/ebay/list", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draftId: ids[i] }),
        });
        if (!res.ok) {
          const data = await res.json();
          setError(`Item ${i + 1} failed: ${data.error ?? "Unknown error"}`);
        }
      } catch {
        setError(`Item ${i + 1} failed: network error`);
      }
      setListProgress(i + 1);
      if (i < ids.length - 1) await new Promise((r) => setTimeout(r, 1000));
    }

    setListStatus("done");
    setTimeout(() => {
      setListStatus("idle");
      setListProgress(0);
      setSelected(new Set());
    }, 2500);
  }

  const q = search.trim().toLowerCase();
  const filtered = [...(!q ? drafts : drafts.filter((d) =>
    (d.title ?? "").toLowerCase().includes(q)
  ))].sort((a, b) => {
    if (sort === "newest" || sort === "oldest") {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return sort === "newest" ? tb - ta : ta - tb;
    }
    const pa = a.suggested_price ?? 0;
    const pb = b.suggested_price ?? 0;
    return sort === "price-desc" ? pb - pa : pa - pb;
  });
  const allSelected = filtered.length > 0 && filtered.every((d) => selected.has(d.id));
  const hasSelection = selected.size > 0;


  return (
    <main className="min-h-screen max-w-md mx-auto px-5 pt-6 pb-24">
      <div className="flex items-center gap-3 mb-4">
        <Link href="/dashboard">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-xl font-medium">Drafts ({drafts.length})</h1>
      </div>

      {!loading && drafts.length > 0 && (
        <div className="flex flex-col gap-2 mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)] pointer-events-none" />
            <input
              type="search"
              placeholder="Search drafts..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full text-sm rounded-lg border border-[var(--border)] bg-white pl-9 pr-9 py-2 text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-600)]"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2">
                <X className="w-4 h-4 text-[var(--text-tertiary)]" />
              </button>
            )}
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="w-full text-sm rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-600)]"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="price-desc">Price: high to low</option>
            <option value="price-asc">Price: low to high</option>
          </select>
        </div>
      )}

      {error && (
        <div className="card p-3 mb-4 text-sm" style={{ color: "#B3261E" }}>{error}</div>
      )}

      {loading && (
        <div className="card p-8 text-center">
          <Loader2 className="w-6 h-6 mx-auto mb-3 animate-spin" />
          <p className="text-sm text-[var(--text-secondary)]">Loading drafts...</p>
        </div>
      )}

      {!loading && !error && drafts.length === 0 && (
        <div className="card p-8 text-center">
          <p className="text-sm text-[var(--text-secondary)]">
            No drafts yet. Save one from the new listing or batch upload screens.
          </p>
        </div>
      )}

      {!loading && drafts.length > 0 && (
        <>
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={toggleSelectAll}
              className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              {allSelected ? "Deselect all" : "Select all"}
            </button>
            {hasSelection && (
              <p className="text-xs text-[var(--text-secondary)]">{selected.size} selected</p>
            )}
          </div>

          {q && filtered.length === 0 && (
            <div className="card p-6 text-center mb-4">
              <p className="text-sm text-[var(--text-secondary)]">No drafts match &ldquo;{search.trim()}&rdquo;</p>
            </div>
          )}

          <div className="flex flex-col gap-2 mb-6">
            {filtered.map((d) => {
              const isSelected = selected.has(d.id);
              return (
                <div
                  key={d.id}
                  onClick={() => router.push(`/drafts/${d.id}`)}
                  className="card flex items-center gap-3 p-3 cursor-pointer active:opacity-80"
                  style={isSelected ? { borderColor: "#3B6D11" } : undefined}
                >
                  <div
                    onClick={(e) => toggleSelect(e, d.id)}
                    className="w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center"
                    style={{
                      borderColor: isSelected ? "#3B6D11" : "var(--text-tertiary)",
                      background: isSelected ? "#3B6D11" : "transparent",
                    }}
                  >
                    {isSelected && (
                      <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                        <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>

                  {d.thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={d.thumbnail_url}
                      alt={d.title ?? "Draft"}
                      className="w-10 h-10 rounded-md object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-md bg-[var(--bg-page)] flex items-center justify-center flex-shrink-0">
                      <Shirt className="w-5 h-5 text-[var(--text-secondary)]" />
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{d.title ?? "Untitled item"}</p>
                      {d.ebay_listing_id && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0"
                          style={{ background: "#E8F5E2", color: "#3B6D11" }}>
                          Live
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[var(--text-secondary)]">
                      {d.suggested_price != null ? `$${d.suggested_price}` : "No price"}
                      {d.condition ? ` · ${d.condition}` : ""}
                    </p>
                  </div>

                  <svg width="6" height="10" viewBox="0 0 6 10" fill="none" className="flex-shrink-0">
                    <path d="M1 1L5 5L1 9" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              );
            })}
          </div>
        </>
      )}

      {hasSelection && (
        <div
          className="fixed bottom-20 left-0 right-0 px-5 max-w-md mx-auto"
        >
          <div className="card p-3 flex gap-2 shadow-lg">
            <button
              onClick={handleDeleteSelected}
              disabled={deleting}
              className="btn flex-1"
              style={{ color: "#B3261E" }}
            >
              {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              {deleting ? "Deleting..." : `Delete (${selected.size})`}
            </button>
            <button
              onClick={handleListSelected}
              disabled={listStatus === "listing"}
              className="btn btn-primary flex-1"
            >
              {listStatus === "listing" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
              {listStatus === "listing"
                ? `Listing ${listProgress}/${selected.size}...`
                : listStatus === "done"
                ? "Listed!"
                : `List on eBay (${selected.size})`}
            </button>
          </div>
        </div>
      )}

      <BottomNav />
    </main>
  );
}
