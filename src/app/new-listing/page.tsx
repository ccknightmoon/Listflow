"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Camera,
  Ruler,
  ZoomIn,
  Sparkles,
  Upload,
  FileText,
  Loader2,
  Check,
} from "lucide-react";

import { Condition, PriceSuggestion } from "@/lib/pricing";
import { uploadThumbnail } from "@/lib/storage";
import { apiFetch } from "@/lib/api";
import { AiResult, formatMeasurements } from "@/lib/ai-result";
import { estimateShipping } from "@/lib/shipping";
import AIDisclaimer from "@/components/AIDisclaimer";

const CONDITIONS: Condition[] = [
  "New with tags",
  "New without tags",
  "Excellent used",
  "Good - minor flaws",
  "Fair - notable flaws",
];

interface SlotImage {
  data: string;
  mediaType: string;
  previewUrl: string;
}

const SLOTS = [
  { key: "front", label: "Front", icon: Camera },
  { key: "measure", label: "Measure", icon: Ruler },
  { key: "flaw", label: "Flaw", icon: ZoomIn },
] as const;

const MAX_DIMENSION = 1568;

function resizeImage(file: File): Promise<{ dataUrl: string; mediaType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;

        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
          if (width > height) {
            height = Math.round((height * MAX_DIMENSION) / width);
            width = MAX_DIMENSION;
          } else {
            width = Math.round((width * MAX_DIMENSION) / height);
            height = MAX_DIMENSION;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Could not get canvas context"));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        resolve({ dataUrl, mediaType: "image/jpeg" });
      };
      img.onerror = () => reject(new Error("Could not load image"));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

export default function NewListingPage() {
  const router = useRouter();
  const [photos, setPhotos] = useState<Record<string, SlotImage>>({});
  const [title, setTitle] = useState("");
  const [condition, setCondition] = useState<Condition>("Excellent used");
  const [flaws, setFlaws] = useState("");
  const [result, setResult] = useState<PriceSuggestion | null>(null);
  const [aiResult, setAiResult] = useState<AiResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [pricingLoading, setPricingLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [savedDraftId, setSavedDraftId] = useState<string | null>(null);
  const [photoUploadWarning, setPhotoUploadWarning] = useState<string | null>(null);
  const [listStatus, setListStatus] = useState<"idle" | "listing" | "listed" | "error">("idle");
  const [listError, setListError] = useState<string | null>(null);
  const [missingAspectsWarning, setMissingAspectsWarning] = useState<string[] | null>(null);
  const [needsConnect, setNeedsConnect] = useState(false);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [isHeavy, setIsHeavy] = useState(false);
  const [shippingCost, setShippingCost] = useState("");
  const [customPrice, setCustomPrice] = useState("");
  const [brand, setBrand] = useState("");
  const [size, setSize] = useState("");
  const [color, setColor] = useState("");

  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  async function handleFileChange(slotKey: string, file: File | undefined) {
    if (!file) return;

    try {
      const { dataUrl, mediaType } = await resizeImage(file);
      const base64 = dataUrl.split(",")[1];

      setPhotos((prev) => ({
        ...prev,
        [slotKey]: { data: base64, mediaType, previewUrl: dataUrl },
      }));
    } catch (err) {
      setError(`Could not process image: ${(err as Error).message}`);
    }
  }

  async function fetchPricing(pTitle: string, pBrand: string | undefined, pCondition: Condition, pImage?: string, pIsHeavy?: boolean, pItemType?: string, pSize?: string) {
    setPricingLoading(true);
    setResult(null);
    try {
      const data = await apiFetch<PriceSuggestion>("/api/pricing/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: pTitle, brand: pBrand, condition: pCondition, image: pImage, isHeavy: pIsHeavy, itemType: pItemType, size: pSize }),
      });
      setResult(data as PriceSuggestion);
    } catch {
      setResult({ noData: true } as PriceSuggestion);
    } finally {
      setPricingLoading(false);
    }
  }

  async function handleAnalyze() {
    setError(null);
    const images = Object.values(photos).map((p) => ({
      data: p.data,
      mediaType: p.mediaType,
    }));

    if (images.length === 0) {
      fetchPricing(title, undefined, condition, photos["front"]?.data);
      return;
    }

    setLoading(true);
    const frontPhoto = photos["front"]?.data ?? photos[Object.keys(photos)[0]]?.data;

    try {
      // Run AI analysis and pricing in parallel — pricing uses the image for visual search
      // so it doesn't need to wait for the AI title. This first pricing call
      // still uses whatever title happens to be on screen (usually empty on
      // a first analysis), so it's treated as a best-effort first pass below.
      const [data] = await Promise.all([
        apiFetch<AiResult>("/api/analyze-item", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ images }),
        }),
        fetchPricing(title, undefined, condition, frontPhoto),
      ]);

      // Prepend measurements before storing in state so description is correct on first render
      const measLine = formatMeasurements(data);
      if (measLine && data.description) {
        data.description = `${measLine}\n\n${data.description}`;
      } else if (measLine) {
        data.description = measLine;
      }
      setAiResult(data);
      setTitle(data.suggestedTitle ?? title);
      setCondition(data.condition ?? condition);
      setFlaws(data.flaws ?? flaws);
      setBrand(data.brand ?? "");
      setSize(data.size ?? "");
      setColor(data.color ?? "");
      // Auto-fill shipping tier AND an actual estimated cost from the
      // AI-detected item type/size/material instead of leaving both blank —
      // still fully overridable below.
      const shipEstimate = estimateShipping(data.itemType, data.size, data.material);
      setIsHeavy(shipEstimate.isHeavy);
      setShippingCost(shipEstimate.isHeavy ? String(shipEstimate.cost) : "");

      // The first pricing call above almost always ran with an empty title
      // (the AI hadn't determined it yet). Now that we actually know the
      // real title and brand, re-run pricing with the real data instead of
      // silently keeping whatever the empty-title call returned.
      fetchPricing(data.suggestedTitle ?? title, data.brand, data.condition ?? condition, frontPhoto, shipEstimate.isHeavy, data.itemType, data.size);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveDraft(): Promise<string | null> {
    if (savedDraftId) return savedDraftId;
    setSaveStatus("saving");
    setPhotoUploadWarning(null);
    try {
      const allPhotoUrls: string[] = [];
      const failedKeys: string[] = [];
      let thumbnailUrl: string | null = null;
      for (const key of ["front", "measure", "flaw"]) {
        const preview = photos[key]?.previewUrl;
        if (!preview) continue;
        try {
          const url = await uploadThumbnail(preview);
          allPhotoUrls.push(url);
          if (key === "front" || !thumbnailUrl) thumbnailUrl = url;
        } catch (err) {
          console.error(`Photo upload failed (${key}):`, (err as Error).message);
          failedKeys.push(key);
        }
      }
      if (failedKeys.length > 0) {
        setPhotoUploadWarning(
          `Saved, but ${failedKeys.length} photo${failedKeys.length > 1 ? "s" : ""} (${failedKeys.join(", ")}) failed to upload. Re-add ${failedKeys.length > 1 ? "them" : "it"} before listing.`
        );
      }

      const { suggestedPrice, avgSold, activeRangeLow, activeRangeHigh, sellOdds } = result ?? {};
      const finalPrice = suggestedPrice ?? (customPrice ? Number(customPrice) : null);

      const data = await apiFetch<{ draft?: { id?: string | null } }>("/api/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          brand: brand || aiResult?.brand || null,
          color: color || aiResult?.color || null,
          size: size || aiResult?.size || null,
          condition,
          flaws,
          suggestedPrice: finalPrice,
          avgSold: avgSold ?? null,
          activeRangeLow: activeRangeLow ?? null,
          activeRangeHigh: activeRangeHigh ?? null,
          sellOdds: sellOdds ?? null,
          thumbnailUrl,
          photoUrls: allPhotoUrls.length > 0 ? allPhotoUrls : null,
          itemType: aiResult?.itemType ?? null,
          style: aiResult?.style ?? null,
          material: aiResult?.material ?? null,
          sleeveLength: aiResult?.sleeveLength ?? null,
          neckline: aiResult?.neckline ?? null,
          fit: aiResult?.fit ?? null,
          pattern: aiResult?.pattern ?? null,
          description: aiResult?.description ?? null,
          vintage: aiResult?.vintage ?? null,
          theme: aiResult?.theme ?? null,
          character: aiResult?.character ?? null,
          characterFamily: aiResult?.characterFamily ?? null,
          yearManufactured: aiResult?.yearManufactured ?? null,
          season: aiResult?.season ?? null,
        }),
      });

      const id = data.draft?.id ?? null;
      setSavedDraftId(id);
      setSaveStatus("saved");
      return id;
    } catch {
      setSaveStatus("error");
      return null;
    }
  }

  async function handleListOnEbay() {
    setListStatus("listing");
    setListError(null);
    setNeedsConnect(false);
    setNeedsReconnect(false);
    try {
      const existingId = savedDraftId;
      const draftId = await handleSaveDraft();
      if (!draftId) throw new Error("Could not save draft before listing");
      if (existingId) {
        const { suggestedPrice } = result ?? {};
        const finalPrice = suggestedPrice ?? (customPrice ? Number(customPrice) : null);
        await apiFetch(`/api/drafts/${draftId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, brand: brand || aiResult?.brand || null, size: size || aiResult?.size || null, color: color || aiResult?.color || null, condition, flaws, suggestedPrice: finalPrice }),
        });
      }
      const data = await apiFetch<{ connect?: boolean; reconnect?: boolean; error?: string; missingRequiredAspects?: string[] }>("/api/ebay/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId, isHeavy, shippingCost: shippingCost ? parseFloat(shippingCost) : undefined }),
      });
      if (data.connect) { setNeedsConnect(true); throw new Error(data.error ?? "Failed to list on eBay"); }
      if (data.reconnect) { setNeedsReconnect(true); throw new Error(data.error ?? "Failed to list on eBay"); }
      setListStatus("listed");
      const missingRequiredAspects = data.missingRequiredAspects ?? [];
      setMissingAspectsWarning(missingRequiredAspects.length > 0 ? missingRequiredAspects : null);
      window.dispatchEvent(new Event("listflow:counts-changed"));
      setTimeout(() => router.push("/store"), 1500);
    } catch (err) {
      setListStatus("error");
      setListError((err as Error).message);
    }
  }

  async function handleSaveDraftAndRedirect() {
    const id = await handleSaveDraft();
    if (id) setTimeout(() => router.push("/drafts"), 1200);
  }

  return (
    <main className="min-h-screen max-w-md mx-auto px-5 pt-6 pb-24">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/dashboard">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-xl font-medium">New listing</h1>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-4">
        {SLOTS.map(({ key, label, icon: Icon }) => (
          <PhotoSlot
            key={key}
            icon={Icon}
            label={label}
            image={photos[key]}
            onClick={() => fileInputs.current[key]?.click()}
            inputRef={(el) => (fileInputs.current[key] = el)}
            onFileChange={(file) => handleFileChange(key, file)}
          />
        ))}
      </div>

      <AIDisclaimer className="mb-4" />

      <div className="flex flex-col gap-3 mb-4">
        <input
          className="input"
          placeholder="Title (auto-filled by AI)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        <select
          className="input"
          value={condition}
          onChange={(e) => setCondition(e.target.value as Condition)}
        >
          {CONDITIONS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-2 py-1">
          <input
            type="checkbox"
            id="heavy"
            checked={isHeavy}
            onChange={(e) => { setIsHeavy(e.target.checked); if (!e.target.checked) setShippingCost(""); }}
            className="w-4 h-4 rounded accent-[var(--brand-600)]"
          />
          <label htmlFor="heavy" className="text-sm text-[var(--text-primary)] cursor-pointer">
            Heavy item
          </label>
          {isHeavy && (
            <div className="flex items-center gap-1 ml-1">
              <span className="text-sm text-[var(--text-secondary)]">— shipping $</span>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={shippingCost}
                onChange={(e) => setShippingCost(e.target.value)}
                className="input w-20 text-sm py-0.5 px-1.5"
              />
            </div>
          )}
        </div>

        <textarea
          className="input"
          rows={2}
          placeholder="Flaw notes (e.g. small stain on left cuff)"
          value={flaws}
          onChange={(e) => setFlaws(e.target.value)}
        />
      </div>

      <button
        onClick={handleAnalyze}
        disabled={loading}
        className="btn btn-primary w-full mb-4"
      >
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Sparkles className="w-4 h-4" />
        )}
        {loading ? "Analyzing photos..." : "Analyze & price"}
      </button>

      {error && (
        <div className="card p-3 mb-4 text-sm" style={{ color: "#B3261E" }}>
          {error}
        </div>
      )}

      {aiResult && (
        <div className="card p-4 mb-4">
          <p className="text-xs text-[var(--text-secondary)] mb-2 flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5 text-brand-600" />
            AI detected
          </p>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <DetectedField label="Item type" value={aiResult.itemType} />
            <div>
              <p className="text-[11px] text-[var(--text-tertiary)]">Brand</p>
              <input
                className="input w-full text-sm py-0.5 px-1.5 mt-0.5"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="Brand"
              />
            </div>
            <div>
              <p className="text-[11px] text-[var(--text-tertiary)]">Color</p>
              <input
                className="input w-full text-sm py-0.5 px-1.5 mt-0.5"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="Color"
              />
            </div>
            <div>
              <p className="text-[11px] text-[var(--text-tertiary)]">Size</p>
              <input
                className="input w-full text-sm py-0.5 px-1.5 mt-0.5"
                value={size}
                onChange={(e) => setSize(e.target.value)}
                placeholder="Size"
              />
            </div>
            {aiResult.material && <DetectedField label="Material" value={aiResult.material} />}
            {aiResult.style && <DetectedField label="Style" value={aiResult.style} />}
            {aiResult.pattern && <DetectedField label="Pattern" value={aiResult.pattern} />}
            {aiResult.sleeveLength && <DetectedField label="Sleeve" value={aiResult.sleeveLength} />}
            {aiResult.vintage === "Yes" && <DetectedField label="Vintage" value="Yes" />}
            {aiResult.theme && <DetectedField label="Theme" value={aiResult.theme} />}
            {aiResult.pitToPit && <DetectedField label="Pit to pit" value={aiResult.pitToPit} />}
            {aiResult.length && <DetectedField label="Length" value={aiResult.length} />}
            {aiResult.waist && <DetectedField label="Waist" value={aiResult.waist} />}
            {aiResult.inseam && <DetectedField label="Inseam" value={aiResult.inseam} />}
          </div>
          {aiResult.description && (
            <p className="text-xs text-[var(--text-secondary)] mt-3 pt-3 border-t border-[var(--border)] leading-relaxed">
              {aiResult.description}
            </p>
          )}
        </div>
      )}

      {(pricingLoading || result) && (
        <div className="card p-4">
          <p className="text-xs text-[var(--text-secondary)] mb-1">
            Suggested listing price
          </p>

          {pricingLoading ? (
            <div className="flex items-center gap-2 py-4">
              <Loader2 className="w-5 h-5 animate-spin text-[var(--text-secondary)]" />
              <p className="text-sm text-[var(--text-secondary)]">Fetching live prices from eBay...</p>
            </div>
          ) : result ? (
            <>
              {result.noData ? (
                <div className="py-2 mb-3">
                  <p className="text-sm text-[var(--text-secondary)] mb-2">No eBay comps found. Set your own price:</p>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--text-secondary)]">$</span>
                    <input
                      type="number"
                      min="0.99"
                      step="0.01"
                      placeholder="0.00"
                      value={customPrice}
                      onChange={(e) => setCustomPrice(e.target.value)}
                      className="input w-full pl-6"
                    />
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-baseline gap-2 mb-1">
                    <p className="text-2xl font-medium">${result.suggestedPrice}</p>
                    {result.floorPrice != null && (
                      <p className="text-xs text-[var(--text-tertiary)]">
                        don&apos;t accept offers below <span className="font-medium">${result.floorPrice}</span>
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <MiniStat label="Active median" value={`$${result.avgSold}`} />
                    <MiniStat
                      label="Active range"
                      value={`$${result.activeRangeLow}–${result.activeRangeHigh}`}
                    />
                    <MiniStat
                      label="Sell odds"
                      value={result.sellOdds}
                      highlight={result.sellOdds === "High"}
                    />
                  </div>

                  <p className="text-xs text-[var(--text-tertiary)] mb-3">
                    Based on {result.comparableActiveCount} active eBay listings — list price includes est. shipping and eBay fees
                  </p>
                </>
              )}

              {listError && (
                <p className="text-xs mb-2" style={{ color: "#B3261E" }}>
                  {listError}
                  {needsConnect && (
                    <a href="/api/ebay/connect" className="underline ml-2 font-medium">Connect eBay →</a>
                  )}
                  {needsReconnect && (
                    <a href="/api/ebay/connect" className="underline ml-2 font-medium">Reconnect eBay →</a>
                  )}
                </p>
              )}
              {photoUploadWarning && (
                <p className="text-xs mb-2" style={{ color: "#B3261E" }}>{photoUploadWarning}</p>
              )}
              {missingAspectsWarning && missingAspectsWarning.length > 0 && (
                <p className="text-xs mb-2" style={{ color: "#92400E" }}>
                  Listed, but eBay wants these fields for this category and the AI
                  couldn&apos;t tell: <strong>{missingAspectsWarning.join(", ")}</strong>.
                </p>
              )}
              <div className="flex gap-2">
                <button
                  className="btn flex-1"
                  onClick={handleSaveDraftAndRedirect}
                  disabled={saveStatus === "saving" || saveStatus === "saved" || listStatus === "listing"}
                >
                  {saveStatus === "saving" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : saveStatus === "saved" ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <FileText className="w-4 h-4" />
                  )}
                  {saveStatus === "saved" ? "Saved!" : saveStatus === "saving" ? "Saving..." : "Save draft"}
                </button>
                <button
                  className="btn btn-primary flex-1"
                  onClick={handleListOnEbay}
                  disabled={listStatus === "listing" || listStatus === "listed"}
                >
                  {listStatus === "listing" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : listStatus === "listed" ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <Upload className="w-4 h-4" />
                  )}
                  {listStatus === "listed" ? "Listed!" : listStatus === "listing" ? "Listing..." : "List on eBay"}
                </button>
              </div>
            </>
          ) : null}
        </div>
      )}
    </main>
  );
}

function PhotoSlot({
  icon: Icon,
  label,
  image,
  onClick,
  inputRef,
  onFileChange,
}: {
  icon: React.ElementType;
  label: string;
  image?: SlotImage;
  onClick: () => void;
  inputRef: (el: HTMLInputElement | null) => void;
  onFileChange: (file: File | undefined) => void;
}) {
  return (
    <div
      onClick={onClick}
      className="card border-dashed flex flex-col items-center justify-center gap-1 aspect-square cursor-pointer overflow-hidden relative"
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => onFileChange(e.target.files?.[0])}
      />
      {image ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.previewUrl}
            alt={label}
            className="absolute inset-0 w-full h-full object-cover"
          />
          <div className="absolute top-1 right-1 bg-white rounded-full p-0.5">
            <Check className="w-3 h-3" style={{ color: "#3B6D11" }} />
          </div>
        </>
      ) : (
        <>
          <Icon className="w-5 h-5 text-[var(--text-secondary)]" />
          <span className="text-[10px] text-[var(--text-secondary)]">{label}</span>
        </>
      )}
    </div>
  );
}

function DetectedField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] text-[var(--text-tertiary)]">{label}</p>
      <p className="font-medium">{value || "—"}</p>
    </div>
  );
}

function MiniStat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className="rounded-md p-2 text-center"
      style={{
        background: highlight ? "#EAF3DE" : "var(--bg-page)",
      }}
    >
      <p
        className="text-[11px]"
        style={{ color: highlight ? "#3B6D11" : "var(--text-secondary)" }}
      >
        {label}
      </p>
      <p
        className="text-sm font-medium"
        style={{ color: highlight ? "#3B6D11" : "var(--text-primary)" }}
      >
        {value}
      </p>
    </div>
  );
}
