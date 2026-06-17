"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Shirt, Loader2, Trash2, Upload } from "lucide-react";
import BottomNav from "@/components/BottomNav";

interface Draft {
  id: string;
  title: string | null;
  suggested_price: number | null;
  sell_odds: string | null;
  thumbnail_url: string | null;
}

type ListStatus = "idle" | "listing" | "done";

export default function DraftsPage() {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [listStatus, setListStatus] = useState<ListStatus>("idle");
  const [listProgress, setListProgress] = useState(0);

  useEffect(() => { loadDrafts(); }, []);

  async function loadDrafts() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/drafts");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load drafts");
      setDrafts(data.drafts ?? []);
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
    setSelected(selected.size === drafts.length ? new Set() : new Set(drafts.map((d) => d.id)));
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
      // eBay listing will be wired here — placeholder for now
      await new Promise((r) => setTimeout(r, 600));
      setListProgress(i + 1);
    }

    setListStatus("done");
    setTimeout(() => {
      setListStatus("idle");
      setListProgress(0);
      setSelected(new Set());
    }, 2500);
  }

  const allSelected = drafts.length > 0 && selected.size === drafts.length;
  const hasSelection = selected.size > 0;

  return (
    <main className="min-h-screen max-w-md mx-auto px-5 pt-6 pb-24">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/dashboard">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-xl font-medium">Drafts ({drafts.length})</h1>
      </div>

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

          <div className="flex flex-col gap-2 mb-6">
            {drafts.map((d) => {
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
                    <p className="text-sm font-medium truncate">{d.title ?? "Untitled item"}</p>
                    <p className="text-xs text-[var(--text-secondary)]">
                      {d.suggested_price != null ? `Suggested $${d.suggested_price}` : ""}
                      {d.sell_odds ? ` · ${d.sell_odds} sell odds` : ""}
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
