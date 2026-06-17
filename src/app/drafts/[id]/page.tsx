"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Shirt, Loader2, Check, Trash2, Upload } from "lucide-react";

const CONDITIONS = [
  "New with tags",
  "New without tags",
  "Excellent used",
  "Good - minor flaws",
  "Fair - notable flaws",
];

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
  sell_odds: string | null;
  thumbnail_url: string | null;
}

export default function DraftDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [brand, setBrand] = useState("");
  const [color, setColor] = useState("");
  const [size, setSize] = useState("");
  const [condition, setCondition] = useState("");
  const [flaws, setFlaws] = useState("");
  const [price, setPrice] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/drafts/${params.id}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Not found");
        const d: Draft = data.draft;
        setDraft(d);
        setTitle(d.title ?? "");
        setBrand(d.brand ?? "");
        setColor(d.color ?? "");
        setSize(d.size ?? "");
        setCondition(d.condition ?? "");
        setFlaws(d.flaws ?? "");
        setPrice(d.suggested_price != null ? String(d.suggested_price) : "");
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [params.id]);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch(`/api/drafts/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          brand,
          color,
          size,
          condition,
          flaws,
          suggestedPrice: price ? Number(price) : null,
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this draft?")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/drafts/${params.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      router.push("/drafts");
    } catch (err) {
      setError((err as Error).message);
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen max-w-md mx-auto px-5 pt-6">
        <div className="card p-8 text-center mt-8">
          <Loader2 className="w-6 h-6 mx-auto animate-spin" />
        </div>
      </main>
    );
  }

  if (error && !draft) {
    return (
      <main className="min-h-screen max-w-md mx-auto px-5 pt-6">
        <div className="card p-4 mt-8" style={{ color: "#B3261E" }}>{error}</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen max-w-md mx-auto px-5 pt-6 pb-32">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link href="/drafts">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-xl font-medium">Edit draft</h1>
        </div>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="p-2 rounded-lg hover:bg-[var(--bg-page)]"
        >
          {deleting ? (
            <Loader2 className="w-4 h-4 animate-spin" style={{ color: "#B3261E" }} />
          ) : (
            <Trash2 className="w-4 h-4" style={{ color: "#B3261E" }} />
          )}
        </button>
      </div>

      {error && (
        <div className="card p-3 mb-4 text-sm" style={{ color: "#B3261E" }}>{error}</div>
      )}

      {draft?.thumbnail_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={draft.thumbnail_url}
          alt={title}
          className="w-full aspect-square object-cover rounded-xl mb-4"
          style={{ maxHeight: 240, objectFit: "cover" }}
        />
      ) : (
        <div className="card flex items-center justify-center mb-4" style={{ height: 160 }}>
          <Shirt className="w-10 h-10 text-[var(--text-tertiary)]" />
        </div>
      )}

      {draft?.avg_sold != null && (
        <div className="card p-3 mb-4 flex gap-4 text-sm">
          <div>
            <p className="text-xs text-[var(--text-secondary)]">Avg sold</p>
            <p className="font-medium">${draft.avg_sold}</p>
          </div>
          {draft.sell_odds && (
            <div>
              <p className="text-xs text-[var(--text-secondary)]">Sell odds</p>
              <p className="font-medium" style={{ color: draft.sell_odds === "High" ? "#3B6D11" : undefined }}>
                {draft.sell_odds}
              </p>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-3 mb-6">
        <div>
          <label className="text-xs text-[var(--text-secondary)] mb-1 block">Title</label>
          <input className="input w-full" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-[var(--text-secondary)] mb-1 block">Brand</label>
            <input className="input w-full" value={brand} onChange={(e) => setBrand(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-[var(--text-secondary)] mb-1 block">Color</label>
            <input className="input w-full" value={color} onChange={(e) => setColor(e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-[var(--text-secondary)] mb-1 block">Size</label>
            <input className="input w-full" value={size} onChange={(e) => setSize(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-[var(--text-secondary)] mb-1 block">List price ($)</label>
            <input
              className="input w-full"
              type="number"
              min="0"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="text-xs text-[var(--text-secondary)] mb-1 block">Condition</label>
          <select className="input w-full" value={condition} onChange={(e) => setCondition(e.target.value)}>
            {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-[var(--text-secondary)] mb-1 block">Flaws</label>
          <textarea
            className="input w-full"
            rows={2}
            value={flaws}
            onChange={(e) => setFlaws(e.target.value)}
          />
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 px-5 pb-6 pt-3 max-w-md mx-auto"
        style={{ background: "var(--bg-surface)" }}>
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={saving || saved}
            className="btn flex-1"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : null}
            {saving ? "Saving..." : saved ? "Saved!" : "Save changes"}
          </button>
          <button className="btn btn-primary flex-1">
            <Upload className="w-4 h-4" />
            List on eBay
          </button>
        </div>
      </div>
    </main>
  );
}
