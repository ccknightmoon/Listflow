"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Shirt, Loader2, Check, Trash2, Upload, ExternalLink, Sparkles, BadgeCheck } from "lucide-react";

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
  photo_urls: string[] | null;
  custom_sku: string | null;
  item_type: string | null;
  style: string | null;
  material: string | null;
  theme: string | null;
  sleeve_length: string | null;
  neckline: string | null;
  fit: string | null;
  pattern: string | null;
  description: string | null;
  ebay_listing_id: string | null;
}

export default function DraftDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [listing, setListing] = useState(false);
  const [listingUrl, setListingUrl] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [brand, setBrand] = useState("");
  const [color, setColor] = useState("");
  const [size, setSize] = useState("");
  const [condition, setCondition] = useState("");
  const [flaws, setFlaws] = useState("");
  const [price, setPrice] = useState("");
  const [customSku, setCustomSku] = useState("");
  const [itemType, setItemType] = useState("");
  const [style, setStyle] = useState("");
  const [material, setMaterial] = useState("");
  const [theme, setTheme] = useState("");
  const [sleevLength, setSleevLength] = useState("");
  const [neckline, setNeckline] = useState("");
  const [fit, setFit] = useState("");
  const [pattern, setPattern] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    async function load() {
      // Convert null or the string "null" (from old AI responses) to empty string
      const str = (v: string | null | undefined) => (v == null || v === "null" ? "" : v);
      try {
        const res = await fetch(`/api/drafts/${params.id}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Not found");
        const d: Draft = data.draft;
        setDraft(d);
        setTitle(str(d.title));
        setBrand(str(d.brand));
        setColor(str(d.color));
        setSize(str(d.size));
        setCondition(str(d.condition));
        setFlaws(str(d.flaws));
        setPrice(d.suggested_price != null ? String(d.suggested_price) : "");
        setCustomSku(str(d.custom_sku));
        setItemType(str(d.item_type));
        setStyle(str(d.style));
        setMaterial(str(d.material));
        setTheme(str(d.theme));
        setSleevLength(str(d.sleeve_length));
        setNeckline(str(d.neckline));
        setFit(str(d.fit));
        setPattern(str(d.pattern));
        setDescription(str(d.description));
        if (d.ebay_listing_id) setListingUrl(`https://www.ebay.com/itm/${d.ebay_listing_id}`);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [params.id]);

  async function handleSuggest() {
    setSuggesting(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/suggest-specifics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, brand, color, size, condition, flaws }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "AI suggestion failed");
      const ok = (v: unknown) => v && v !== "null";
      if (ok(data.item_type)) setItemType(data.item_type);
      if (ok(data.style)) setStyle(data.style);
      if (ok(data.material)) setMaterial(data.material);
      if (ok(data.theme)) setTheme(data.theme);
      if (ok(data.sleeve_length)) setSleevLength(data.sleeve_length);
      if (ok(data.neckline)) setNeckline(data.neckline);
      if (ok(data.fit)) setFit(data.fit);
      if (ok(data.pattern)) setPattern(data.pattern);
      if (ok(data.description)) setDescription(data.description);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSuggesting(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch(`/api/drafts/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title, brand, color, size, condition, flaws,
          suggestedPrice: price ? Number(price) : null,
          customSku, itemType, style, material, theme,
          sleevLength, neckline, fit, pattern, description,
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

  async function handleList() {
    setListing(true);
    setError(null);
    try {
      // Auto-save current form values first so the listing API uses the latest data
      await fetch(`/api/drafts/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title, brand, color, size, condition, flaws,
          suggestedPrice: price ? Number(price) : null,
          customSku, itemType, style, material, theme,
          sleevLength, neckline, fit, pattern, description,
        }),
      });

      const res = await fetch("/api/ebay/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: params.id, customSku: customSku || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to list");
      setListingUrl(data.url);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setListing(false);
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

      {draft?.photo_urls && draft.photo_urls.length > 0 ? (
        <div className="flex gap-2 overflow-x-auto -mx-5 px-5 mb-4 snap-x snap-mandatory">
          {draft.photo_urls.map((url, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={url}
              alt={`Photo ${i + 1}`}
              className="h-52 w-52 object-cover rounded-xl flex-shrink-0 snap-start"
            />
          ))}
        </div>
      ) : draft?.thumbnail_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={draft.thumbnail_url}
          alt={title}
          className="w-full object-cover rounded-xl mb-4"
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

      <div className="flex flex-col gap-3 mb-4">
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
          <label className="text-xs text-[var(--text-secondary)] mb-1 block">SKU (optional — alphanumeric only)</label>
          <input
            className="input w-full"
            placeholder="e.g. HDSHIRT001"
            value={customSku}
            onChange={(e) => setCustomSku(e.target.value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 50))}
          />
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

      {/* AI Suggest Section */}
      <div className="card p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-medium">eBay Item Specifics</p>
            <p className="text-xs text-[var(--text-secondary)]">More specifics = better eBay search ranking</p>
          </div>
          <button
            onClick={handleSuggest}
            disabled={suggesting}
            className="btn btn-primary flex items-center gap-1.5 text-sm px-3 py-1.5"
          >
            {suggesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {suggesting ? "Thinking..." : "AI Suggest"}
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Type</label>
              <input className="input w-full" placeholder="T-Shirt, Hoodie, Jacket..." value={itemType} onChange={(e) => setItemType(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Style</label>
              <input className="input w-full" placeholder="Pullover, Zip-Up..." value={style} onChange={(e) => setStyle(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Material</label>
              <input className="input w-full" placeholder="Cotton, Denim..." value={material} onChange={(e) => setMaterial(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Theme</label>
              <input className="input w-full" placeholder="Vintage, Band Tee..." value={theme} onChange={(e) => setTheme(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Sleeve Length</label>
              <input className="input w-full" placeholder="Short Sleeve..." value={sleevLength} onChange={(e) => setSleevLength(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Neckline</label>
              <input className="input w-full" placeholder="Crew Neck, V-Neck..." value={neckline} onChange={(e) => setNeckline(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Fit</label>
              <input className="input w-full" placeholder="Regular, Slim..." value={fit} onChange={(e) => setFit(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Pattern</label>
              <input className="input w-full" placeholder="Solid, Graphic..." value={pattern} onChange={(e) => setPattern(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-xs text-[var(--text-secondary)] mb-1 block">Description</label>
            <textarea
              className="input w-full"
              rows={4}
              placeholder="eBay listing description..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 px-5 pb-6 pt-3 max-w-md mx-auto"
        style={{ background: "var(--bg-surface)" }}>
        <div className="flex flex-col gap-2">
          {listingUrl && (
            <a
              href={listingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn w-full flex items-center justify-center gap-2 text-sm"
              style={{ color: "#3B6D11" }}
            >
              <BadgeCheck className="w-4 h-4" />
              Live on eBay — tap to view
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={saving || saved} className="btn flex-1">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : null}
              {saving ? "Saving..." : saved ? "Saved!" : "Save changes"}
            </button>
            <button onClick={handleList} disabled={listing} className="btn btn-primary flex-1">
              {listing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {listing ? "Listing..." : listingUrl ? "Relist on eBay" : "List on eBay"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
