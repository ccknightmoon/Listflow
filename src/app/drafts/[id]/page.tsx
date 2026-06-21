"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Shirt, Loader2, Check, Trash2, Upload, ExternalLink, Sparkles, BadgeCheck, Camera, X, RefreshCw } from "lucide-react";

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
  active_range_low: number | null;
  active_range_high: number | null;
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
  vintage: string | null;
  character: string | null;
  character_family: string | null;
  year_manufactured: string | null;
  season: string | null;
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
  const [justListed, setJustListed] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [needsConnect, setNeedsConnect] = useState(false);
  const [reanalyzePhotos, setReanalyzePhotos] = useState<Array<{ data: string; mediaType: string; previewUrl: string }>>([]);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [isHeavy, setIsHeavy] = useState(false);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);
  const [zoomedPhoto, setZoomedPhoto] = useState<string | null>(null);
  const [refreshingPrice, setRefreshingPrice] = useState(false);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const dragIdxRef = useRef<number | null>(null);
  const photoRefs = useRef<(HTMLDivElement | null)[]>([]);

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
  const [sleeveLength, setSleeveLength] = useState("");
  const [neckline, setNeckline] = useState("");
  const [fit, setFit] = useState("");
  const [pattern, setPattern] = useState("");
  const [description, setDescription] = useState("");
  const [vintage, setVintage] = useState("");
  const [character, setCharacter] = useState("");
  const [characterFamily, setCharacterFamily] = useState("");
  const [yearManufactured, setYearManufactured] = useState("");
  const [season, setSeason] = useState("");

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
        setPhotoUrls(d.photo_urls ?? []);
        const savedHeavy = localStorage.getItem(`heavy-${params.id}`);
        if (savedHeavy) setIsHeavy(JSON.parse(savedHeavy));
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
        setSleeveLength(str(d.sleeve_length));
        setNeckline(str(d.neckline));
        setFit(str(d.fit));
        setPattern(str(d.pattern));
        setDescription(str(d.description));
        setVintage(str(d.vintage));
        setCharacter(str(d.character));
        setCharacterFamily(str(d.character_family));
        setYearManufactured(str(d.year_manufactured));
        setSeason(str(d.season));
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
      if (ok(data.sleeve_length)) setSleeveLength(data.sleeve_length);
      if (ok(data.neckline)) setNeckline(data.neckline);
      if (ok(data.fit)) setFit(data.fit);
      if (ok(data.pattern)) setPattern(data.pattern);
      if (ok(data.description)) setDescription(data.description);
      if (ok(data.vintage)) setVintage(data.vintage);
      if (ok(data.character)) setCharacter(data.character);
      if (ok(data.character_family)) setCharacterFamily(data.character_family);
      if (ok(data.year_manufactured)) setYearManufactured(data.year_manufactured);
      if (ok(data.season)) setSeason(data.season);
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
          sleeveLength, neckline, fit, pattern, description,
          vintage, character, characterFamily, yearManufactured, season,
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
    const priceNum = price ? Number(price) : null;
    if (!priceNum) {
      if (!confirm("No price set. Continue listing anyway?")) return;
    } else if (priceNum >= 200) {
      if (!confirm(`List at $${priceNum.toFixed(2)}? Make sure that's the right price.`)) return;
    }
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
          sleeveLength, neckline, fit, pattern, description,
          vintage, character, characterFamily, yearManufactured, season,
        }),
      });

      const res = await fetch("/api/ebay/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: params.id, customSku: customSku || undefined, isHeavy }),
      });
      const data = await res.json();
      if (data.connect) { setNeedsConnect(true); throw new Error(data.error); }
      if (data.reconnect) { setNeedsReconnect(true); throw new Error(data.error); }
      if (!res.ok) throw new Error(data.error || "Failed to list");
      // Save all form values + ebay_listing_id together so nothing gets wiped
      if (data.listingId) {
        await fetch(`/api/drafts/${params.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title, brand, color, size, condition, flaws,
            suggestedPrice: price ? Number(price) : null,
            customSku, itemType, style, material, theme,
            sleeveLength, neckline, fit, pattern, description,
            ebayListingId: String(data.listingId),
          }),
        });
      }
      setListingUrl(data.url);
      setJustListed(true);
      localStorage.removeItem(`heavy-${params.id}`);
      window.dispatchEvent(new Event("listflow:counts-changed"));
      setTimeout(() => router.push("/store"), 1500);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setListing(false);
    }
  }

  async function handleAddReanalyzePhoto(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      const mediaType = file.type || "image/jpeg";
      const b64 = dataUrl.split(",")[1];
      setReanalyzePhotos((prev) => [...prev.slice(0, 2), { data: b64, mediaType, previewUrl: dataUrl }]);
    };
    reader.readAsDataURL(file);
  }

  async function handleReanalyze() {
    if (reanalyzePhotos.length === 0) return;
    setReanalyzing(true);
    setError(null);
    try {
      const res = await fetch("/api/analyze-item", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images: reanalyzePhotos.map((p) => ({ data: p.data, mediaType: p.mediaType })) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Analysis failed");
      if (data.suggestedTitle) setTitle(data.suggestedTitle);
      if (data.brand) setBrand(data.brand);
      if (data.color) setColor(data.color);
      if (data.size) setSize(data.size);
      if (data.condition) setCondition(data.condition);
      if (data.flaws) setFlaws(data.flaws);
      if (data.itemType) setItemType(data.itemType);
      if (data.style) setStyle(data.style);
      if (data.material) setMaterial(data.material);
      if (data.pattern) setPattern(data.pattern);
      if (data.description) setDescription(data.description);
      setReanalyzePhotos([]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setReanalyzing(false);
    }
  }

  async function handleRefreshPrice() {
    setRefreshingPrice(true);
    setError(null);
    try {
      const res = await fetch("/api/pricing/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, brand, condition }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Pricing failed");
      if (!data.noData) {
        if (data.suggestedPrice) setPrice(String(data.suggestedPrice));
        setDraft((prev) => prev ? { ...prev, avg_sold: data.avgSold ?? prev.avg_sold, sell_odds: data.sellOdds ?? prev.sell_odds } : prev);
        await fetch(`/api/drafts/${params.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title, brand, color, size, condition, flaws,
            suggestedPrice: data.suggestedPrice ?? (price ? Number(price) : null),
            customSku, itemType, style, material, theme,
            sleeveLength, neckline, fit, pattern, description,
            vintage, character, characterFamily, yearManufactured, season,
            avgSold: data.avgSold ?? null,
            sellOdds: data.sellOdds ?? null,
          }),
        });
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRefreshingPrice(false);
    }
  }

  function onPhotoPDown(e: React.PointerEvent, idx: number) {
    pointerStart.current = { x: e.clientX, y: e.clientY };
    dragIdxRef.current = idx;
    setDragIdx(idx);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPhotoPMove(e: React.PointerEvent) {
    if (dragIdxRef.current === null) return;
    e.preventDefault();
    for (let i = 0; i < photoRefs.current.length; i++) {
      const el = photoRefs.current[i];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX <= rect.right) {
        setDropIdx(i);
        return;
      }
    }
  }

  async function onPhotoPUp(e: React.PointerEvent, url: string) {
    const start = pointerStart.current;
    const moved = start && (Math.abs(e.clientX - start.x) > 8 || Math.abs(e.clientY - start.y) > 8);
    const currentDrag = dragIdxRef.current;
    dragIdxRef.current = null;

    if (!moved) {
      setZoomedPhoto(url);
    } else if (currentDrag !== null && dropIdx !== null && currentDrag !== dropIdx) {
      const next = [...photoUrls];
      const [item] = next.splice(currentDrag, 1);
      next.splice(dropIdx, 0, item);
      setPhotoUrls(next);
      await fetch(`/api/drafts/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoUrls: next, thumbnailUrl: next[0] }),
      });
    }

    setDragIdx(null);
    setDropIdx(null);
    pointerStart.current = null;
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
        <Link href="/drafts" className="inline-flex mb-4">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="card p-8 text-center">
          <Loader2 className="w-6 h-6 mx-auto animate-spin" />
        </div>
      </main>
    );
  }

  if (error && !draft) {
    return (
      <main className="min-h-screen max-w-md mx-auto px-5 pt-6">
        <Link href="/drafts" className="inline-flex mb-4">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="card p-4" style={{ color: "#B3261E" }}>{error}</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen max-w-md mx-auto px-5 pt-6 pb-32">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link href={draft?.ebay_listing_id ? "/store" : "/drafts"}>
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

      {zoomedPhoto && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
          onClick={() => setZoomedPhoto(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoomedPhoto} alt="" className="max-w-full max-h-full object-contain" draggable={false} />
          <button
            onClick={() => setZoomedPhoto(null)}
            className="absolute top-4 right-4 p-2 text-white bg-black/40 rounded-full"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
      )}

      {photoUrls.length > 0 ? (
        <div className="flex gap-2 overflow-x-auto -mx-5 px-5 mb-4">
          {photoUrls.map((url, i) => (
            <div
              key={i}
              ref={(el) => { photoRefs.current[i] = el; }}
              className={`relative flex-shrink-0 rounded-xl overflow-hidden cursor-grab select-none transition-all${dragIdx === i ? " opacity-40 scale-95" : ""}${dropIdx === i && dragIdx !== i ? " ring-2 ring-[var(--brand-600)]" : ""}`}
              style={{ width: 208, height: 208, touchAction: "none" }}
              onPointerDown={(e) => onPhotoPDown(e, i)}
              onPointerMove={onPhotoPMove}
              onPointerUp={(e) => onPhotoPUp(e, url)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" draggable={false} />
              {photoUrls.length > 1 && (
                <div className="absolute bottom-1 right-1 bg-black/50 rounded-full px-1.5 py-0.5">
                  <span className="text-white text-[10px]">{i + 1}/{photoUrls.length}</span>
                </div>
              )}
              {i === 0 && photoUrls.length > 1 && (
                <div className="absolute top-1 left-1 bg-black/50 rounded px-1.5 py-0.5">
                  <span className="text-white text-[10px]">Main</span>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : draft?.thumbnail_url ? (
        <div className="w-full mb-4 cursor-zoom-in" onClick={() => setZoomedPhoto(draft!.thumbnail_url!)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={draft.thumbnail_url}
            alt={title}
            className="w-full object-cover rounded-xl"
            style={{ maxHeight: 240, objectFit: "cover" }}
          />
        </div>
      ) : (
        <div className="card flex items-center justify-center mb-4" style={{ height: 160 }}>
          <Shirt className="w-10 h-10 text-[var(--text-tertiary)]" />
        </div>
      )}

      {/* Re-analyze with new photos */}
      <div className="card p-3 mb-4">
        <p className="text-xs text-[var(--text-secondary)] mb-2 flex items-center gap-1">
          <Sparkles className="w-3.5 h-3.5" /> Re-analyze with new photos
        </p>
        <div className="flex gap-2 mb-2">
          {reanalyzePhotos.map((p, i) => (
            <div key={i} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.previewUrl} alt="" className="w-16 h-16 rounded-lg object-cover" />
              <button
                onClick={() => setReanalyzePhotos((prev) => prev.filter((_, j) => j !== i))}
                className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-white border border-[var(--border)] flex items-center justify-center"
              >
                <X className="w-2.5 h-2.5 text-[var(--text-secondary)]" />
              </button>
            </div>
          ))}
          {reanalyzePhotos.length < 3 && (
            <label className="w-16 h-16 rounded-lg border-2 border-dashed border-[var(--border)] flex flex-col items-center justify-center cursor-pointer hover:border-[var(--brand-600)] transition-colors">
              <Camera className="w-5 h-5 text-[var(--text-tertiary)]" />
              <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleAddReanalyzePhoto(e.target.files[0])} />
            </label>
          )}
        </div>
        <button
          onClick={handleReanalyze}
          disabled={reanalyzePhotos.length === 0 || reanalyzing}
          className="btn w-full text-sm"
        >
          {reanalyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {reanalyzing ? "Analyzing..." : "Re-analyze"}
        </button>
      </div>

      {draft?.avg_sold == null && title && (
        <button
          onClick={handleRefreshPrice}
          disabled={refreshingPrice}
          className="card p-3 mb-4 w-full flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          {refreshingPrice
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <RefreshCw className="w-3.5 h-3.5" />
          }
          {refreshingPrice ? "Getting pricing..." : "Get pricing estimate"}
        </button>
      )}

      {draft?.avg_sold != null && (
        <div className="card p-3 mb-4 flex items-center gap-4 text-sm">
          <div className="flex gap-4 flex-1">
            <div>
              <p className="text-xs text-[var(--text-secondary)]">Avg sold</p>
              <p className="font-medium">${draft.avg_sold}</p>
            </div>
            {draft.active_range_low != null && draft.active_range_high != null && (
              <div>
                <p className="text-xs text-[var(--text-secondary)]">Active range</p>
                <p className="font-medium">${draft.active_range_low}–${draft.active_range_high}</p>
              </div>
            )}
            {draft.sell_odds && (
              <div>
                <p className="text-xs text-[var(--text-secondary)]">Sell odds</p>
                <p className="font-medium" style={{ color: draft.sell_odds === "High" ? "#3B6D11" : undefined }}>
                  {draft.sell_odds}
                </p>
              </div>
            )}
          </div>
          <button
            onClick={handleRefreshPrice}
            disabled={refreshingPrice}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-page)] transition-colors"
            title="Refresh pricing"
          >
            {refreshingPrice
              ? <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--text-secondary)]" />
              : <RefreshCw className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
            }
          </button>
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
        <div className="flex items-center gap-2 py-1">
          <input
            type="checkbox"
            id="heavy"
            checked={isHeavy}
            onChange={(e) => {
              setIsHeavy(e.target.checked);
              localStorage.setItem(`heavy-${params.id}`, JSON.stringify(e.target.checked));
            }}
            className="w-4 h-4 rounded accent-[var(--brand-600)]"
          />
          <label htmlFor="heavy" className="text-sm text-[var(--text-primary)] cursor-pointer">
            Heavy item — uses heavy shipping rate
          </label>
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
              <input className="input w-full" placeholder="Short Sleeve..." value={sleeveLength} onChange={(e) => setSleeveLength(e.target.value)} />
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Vintage</label>
              <select className="input w-full" value={vintage} onChange={(e) => setVintage(e.target.value)}>
                <option value="">—</option>
                <option value="Yes">Yes</option>
                <option value="No">No</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Year Manufactured</label>
              <select className="input w-full" value={yearManufactured} onChange={(e) => setYearManufactured(e.target.value)}>
                <option value="">—</option>
                <option>Pre-1960</option>
                <option>1960-1969</option>
                <option>1970-1979</option>
                <option>1980-1989</option>
                <option>1990-1999</option>
                <option>2000-2009</option>
                <option>2010-2019</option>
                <option>2020-2029</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Character</label>
              <input className="input w-full" placeholder="Mickey Mouse, Stitch..." value={character} onChange={(e) => setCharacter(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Character Family</label>
              <input className="input w-full" placeholder="Disney, Marvel..." value={characterFamily} onChange={(e) => setCharacterFamily(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-xs text-[var(--text-secondary)] mb-1 block">Season</label>
            <select className="input w-full" value={season} onChange={(e) => setSeason(e.target.value)}>
              <option value="">—</option>
              <option>All Seasons</option>
              <option>Fall</option>
              <option>Spring</option>
              <option>Summer</option>
              <option>Winter</option>
            </select>
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
            <div className="flex gap-2">
              <a
                href={listingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn flex-1 flex items-center justify-center gap-2 text-sm"
                style={{ color: "#3B6D11" }}
              >
                <BadgeCheck className="w-4 h-4" />
                {justListed ? "Listed! Returning to store…" : "Live on eBay — tap to view"}
                {!justListed && <ExternalLink className="w-3 h-3" />}
              </a>
            </div>
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
