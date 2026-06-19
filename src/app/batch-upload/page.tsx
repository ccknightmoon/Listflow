"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  CloudUpload,
  Loader2,
  Sparkles,
  Plus,
  FileText,
  Upload,
  GripVertical,
  RotateCw,
  Check,
  X,
  Trash2,
} from "lucide-react";
import { getPriceSuggestion, Condition, PriceSuggestion } from "@/lib/pricing";
import { uploadThumbnail } from "@/lib/storage";

interface SlotImage {
  data: string;
  mediaType: string;
  previewUrl: string;
}

interface AiResult {
  itemType: string;
  brand: string;
  color: string;
  size: string;
  condition: Condition;
  flaws: string;
  suggestedTitle: string;
  pricing?: PriceSuggestion;
  error?: string;
}

interface Thumbnail {
  data: string;
  mediaType: string;
}

type Step = "upload" | "grouping" | "review" | "analyzing" | "results";
type SaveStatus = "idle" | "saving" | "saved" | "error";

const MAX_DIMENSION = 1024;
const THUMB_DIMENSION = 256;
const THUMB_QUALITY = 0.5;
const MAX_PHOTOS = 100;
const MAX_PHOTOS_PER_ITEM = 6;
const GROUPING_CHUNK_SIZE = 15;
const DELAY_BETWEEN_CHUNKS_MS = 1500;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resizeFromDataUrl(
  dataUrl: string,
  maxDim: number,
  quality: number
): Promise<{ dataUrl: string; mediaType: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;

      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
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
      resolve({ dataUrl: canvas.toDataURL("image/jpeg", quality), mediaType: "image/jpeg" });
    };
    img.onerror = () => reject(new Error("Could not load image"));
    img.src = dataUrl;
  });
}

function resizeImage(file: File): Promise<{ dataUrl: string; mediaType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const result = await resizeFromDataUrl(reader.result as string, MAX_DIMENSION, 0.75);
        resolve(result);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

export default function BatchUploadPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("upload");
  const [photos, setPhotos] = useState<SlotImage[]>([]);
  const [groups, setGroups] = useState<number[][]>([]);
  const [results, setResults] = useState<AiResult[]>([]);
  const [retrying, setRetrying] = useState<Record<number, boolean>>({});
  const [retryingPricing, setRetryingPricing] = useState<Record<number, boolean>>({});
  const [saveStatus, setSaveStatus] = useState<Record<number, SaveStatus>>({});
  const [savingAll, setSavingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groupingProgress, setGroupingProgress] = useState<string>("");
  const fileInput = useRef<HTMLInputElement | null>(null);

  async function handleFilesSelected(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);

    const fileArray = Array.from(files).slice(0, MAX_PHOTOS);

    try {
      const resized = await Promise.all(
        fileArray.map(async (file) => {
          const { dataUrl, mediaType } = await resizeImage(file);
          return { data: dataUrl.split(",")[1], mediaType, previewUrl: dataUrl };
        })
      );
      setPhotos(resized);
    } catch (err) {
      setError(`Could not process photos: ${(err as Error).message}`);
    }
  }

  async function handleRetryAllFailed() {
    const failedIndices = results
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r.error)
      .map(({ i }) => i);

    for (const i of failedIndices) {
      await handleRetry(i);
    }
  }

  async function handleSaveAllDrafts() {
    setSavingAll(true);
    const indices = results
      .map((_, i) => i)
      .filter((i) => !results[i].error && (saveStatus[i] ?? "idle") === "idle");

    for (const i of indices) {
      await handleSaveDraft(i);
    }
    setSavingAll(false);
    // Brief pause so user sees "All saved", then go to Drafts
    setTimeout(() => router.push("/drafts"), 1200);
  }

  async function handleGroupPhotos() {
    setError(null);
    setStep("grouping");

    try {
      const thumbnails: Thumbnail[] = await Promise.all(
        photos.map(async (p) => {
          const { dataUrl, mediaType } = await resizeFromDataUrl(
            p.previewUrl,
            THUMB_DIMENSION,
            THUMB_QUALITY
          );
          return { data: dataUrl.split(",")[1], mediaType };
        })
      );

      const totalPhotos = thumbnails.length;
      const finalGroups: number[][] = [];
      let pending: number[] = [];
      let cursor = 0;
      let chunkNum = 0;

      while (cursor < totalPhotos) {
        chunkNum += 1;
        setGroupingProgress(`Grouping photos (part ${chunkNum})...`);

        const take = Math.max(GROUPING_CHUNK_SIZE - pending.length, 1);
        const newIndices: number[] = [];
        for (let i = cursor; i < Math.min(cursor + take, totalPhotos); i++) {
          newIndices.push(i);
        }

        const chunkGlobalIndices = [...pending, ...newIndices];
        const chunkImages = chunkGlobalIndices.map((gi) => thumbnails[gi]);

        const res = await fetch("/api/group-photos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ images: chunkImages }),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Grouping failed");
        }

        const remapped: number[][] = data.groups.map((g: number[]) =>
          g.map((localIdx: number) => chunkGlobalIndices[localIdx])
        );

        cursor += newIndices.length;
        const isLastChunk = cursor >= totalPhotos;

        if (isLastChunk) {
          finalGroups.push(...remapped);
          pending = [];
        } else {
          finalGroups.push(...remapped.slice(0, -1));
          pending = remapped[remapped.length - 1] ?? [];
        }

        if (!isLastChunk) {
          await delay(DELAY_BETWEEN_CHUNKS_MS);
        }
      }

      setGroups(finalGroups);
      setStep("review");
    } catch (err) {
      setError((err as Error).message);
      setStep("upload");
    } finally {
      setGroupingProgress("");
    }
  }

  function movePhoto(photoIndex: number, fromGroup: number, toGroup: number) {
    if (fromGroup === toGroup) return;

    setGroups((prev) => {
      const next = prev.map((g) => [...g]);
      next[fromGroup] = next[fromGroup].filter((i) => i !== photoIndex);
      next[toGroup] = [...next[toGroup], photoIndex];
      return next.filter((g) => g.length > 0);
    });
  }

  function addNewGroup() {
    setGroups((prev) => [...prev, []]);
  }

  function removePhoto(photoIndex: number, fromGroup: number) {
    setGroups((prev) => {
      const next = prev.map((g) => [...g]);
      next[fromGroup] = next[fromGroup].filter((i) => i !== photoIndex);
      return next.filter((g) => g.length > 0);
    });
  }

  function removeGroup(gIdx: number) {
    setGroups((prev) => prev.filter((_, i) => i !== gIdx));
  }

  function groupImagesForRequest(group: number[]) {
    return group.slice(0, MAX_PHOTOS_PER_ITEM).map((idx) => ({
      data: photos[idx].data,
      mediaType: photos[idx].mediaType,
    }));
  }

  async function handleAnalyzeBatch() {
    setError(null);
    setStep("analyzing");

    const allResults: AiResult[] = [];

    try {
      for (let i = 0; i < groups.length; i++) {
        const res = await fetch("/api/analyze-batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            groups: [{ images: groupImagesForRequest(groups[i]) }],
          }),
        });

        let data: { results?: AiResult[]; error?: string };
        try {
          data = await res.json();
        } catch {
          data = { error: `Server error (${res.status})` };
        }

        if (!res.ok || !data.results) {
          allResults.push({ itemType: "", brand: "", color: "", size: "", condition: "Good - minor flaws", flaws: "", suggestedTitle: "", error: data.error || "Analysis failed" });
        } else {
          allResults.push(data.results[0]);
        }

        if (i < groups.length - 1) {
          await delay(1000);
        }
      }

      setResults(allResults);
      setStep("results");
      fetchPricingForAll(allResults);
    } catch (err) {
      setError((err as Error).message);
      setStep("review");
    }
  }

  function fetchPricingForAll(allResults: AiResult[]) {
    allResults.forEach((result, i) => {
      if (result.error) return;
      const firstPhotoIdx = (groups[i] ?? [])[0];
      const image = firstPhotoIdx !== undefined ? photos[firstPhotoIdx]?.data : undefined;
      fetch("/api/pricing/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: result.suggestedTitle,
          brand: result.brand,
          condition: result.condition,
          image,
        }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((pricing: PriceSuggestion | null) => {
          if (!pricing) return;
          setResults((prev) => {
            const next = [...prev];
            next[i] = { ...next[i], pricing };
            return next;
          });
        })
        .catch(() => {});
    });
  }

  function handleRetryPricing(index: number) {
    setRetryingPricing((prev) => ({ ...prev, [index]: true }));
    setResults((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], pricing: undefined };
      return next;
    });
    const result = results[index];
    const firstPhotoIdx = (groups[index] ?? [])[0];
    const image = firstPhotoIdx !== undefined ? photos[firstPhotoIdx]?.data : undefined;
    fetch("/api/pricing/suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: result.suggestedTitle, brand: result.brand, condition: result.condition, image }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((pricing: PriceSuggestion | null) => {
        setResults((prev) => {
          const next = [...prev];
          next[index] = {
            ...next[index],
            pricing: pricing ?? { noData: true, suggestedPrice: 0, avgSold: 0, activeRangeLow: 0, activeRangeHigh: 0, sellOdds: "Low", comparableSoldCount: 0, comparableActiveCount: 0 },
          };
          return next;
        });
      })
      .catch(() => {
        setResults((prev) => {
          const next = [...prev];
          next[index] = {
            ...next[index],
            pricing: { noData: true, suggestedPrice: 0, avgSold: 0, activeRangeLow: 0, activeRangeHigh: 0, sellOdds: "Low", comparableSoldCount: 0, comparableActiveCount: 0 },
          };
          return next;
        });
      })
      .finally(() => setRetryingPricing((prev) => ({ ...prev, [index]: false })));
  }

  async function handleRetry(index: number) {
    setRetrying((prev) => ({ ...prev, [index]: true }));

    try {
      const group = groups[index] ?? [];
      const res = await fetch("/api/analyze-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groups: [{ images: groupImagesForRequest(group) }],
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Retry failed");
      }

      const retryResult: AiResult = data.results[0];
      setResults((prev) => {
        const next = [...prev];
        next[index] = retryResult;
        return next;
      });
      const retryPhotoIdx = (groups[index] ?? [])[0];
      const retryImage = retryPhotoIdx !== undefined ? photos[retryPhotoIdx]?.data : undefined;
      fetch("/api/pricing/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: retryResult.suggestedTitle,
          brand: retryResult.brand,
          condition: retryResult.condition,
          image: retryImage,
        }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((pricing: PriceSuggestion | null) => {
          if (!pricing) return;
          setResults((prev) => {
            const next = [...prev];
            next[index] = { ...next[index], pricing };
            return next;
          });
        })
        .catch(() => {});
    } catch (err) {
      setResults((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], error: (err as Error).message };
        return next;
      });
    } finally {
      setRetrying((prev) => ({ ...prev, [index]: false }));
    }
  }

  async function handleSaveDraft(index: number) {
    setSaveStatus((prev) => ({ ...prev, [index]: "saving" }));

    try {
      const result = results[index];
      const group = groups[index] ?? [];

      const suggestion: PriceSuggestion =
        result.pricing ??
        getPriceSuggestion(result.condition, Boolean(result.flaws && result.flaws.trim().length > 0));

      // Upload all photos in the group; first becomes the thumbnail
      const photoUrls: string[] = [];
      for (const photoIdx of group) {
        const dataUrl = photos[photoIdx]?.previewUrl;
        if (dataUrl) {
          try {
            const url = await uploadThumbnail(dataUrl);
            photoUrls.push(url);
          } catch (err) {
            console.error("Photo upload failed:", (err as Error).message);
          }
        }
      }
      const thumbnailUrl = photoUrls[0] ?? null;

      const res = await fetch("/api/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: result.suggestedTitle,
          brand: result.brand,
          color: result.color,
          size: result.size,
          condition: result.condition,
          flaws: result.flaws,
          suggestedPrice: suggestion.suggestedPrice,
          avgSold: suggestion.avgSold,
          activeRangeLow: suggestion.activeRangeLow,
          activeRangeHigh: suggestion.activeRangeHigh,
          sellOdds: suggestion.sellOdds,
          thumbnailUrl,
          photoUrls: photoUrls.length > 0 ? photoUrls : null,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to save draft");
      }

      setSaveStatus((prev) => ({ ...prev, [index]: "saved" }));
    } catch {
      setSaveStatus((prev) => ({ ...prev, [index]: "error" }));
    }
  }

  return (
    <main className="min-h-screen max-w-md mx-auto px-5 pt-6 pb-24">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/dashboard">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-xl font-medium">Batch upload</h1>
      </div>

      {error && (
        <div className="card p-3 mb-4 text-sm" style={{ color: "#B3261E" }}>
          {error}
        </div>
      )}

      {step === "upload" && (
        <>
          <div
            onClick={() => fileInput.current?.click()}
            className="card border-dashed text-center py-10 mb-4 cursor-pointer"
          >
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => handleFilesSelected(e.target.files)}
            />
            <CloudUpload className="w-7 h-7 mx-auto text-[var(--text-secondary)] mb-2" />
            <p className="text-sm text-[var(--text-secondary)]">
              Select all photos for this batch (up to {MAX_PHOTOS})
              <br />
              Upload in order: front of item 1, its other shots, then front
              of item 2, and so on
            </p>
          </div>

          {photos.length > 0 && (
            <>
              <p className="text-sm text-[var(--text-secondary)] mb-2">
                {photos.length} photo{photos.length !== 1 ? "s" : ""} selected
              </p>
              <div className="grid grid-cols-4 gap-2 mb-4">
                {photos.map((p, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={i}
                    src={p.previewUrl}
                    alt={`Photo ${i + 1}`}
                    className="aspect-square object-cover rounded-md"
                  />
                ))}
              </div>
              <button onClick={handleGroupPhotos} className="btn btn-primary w-full">
                <Sparkles className="w-4 h-4" />
                Group photos into items
              </button>
            </>
          )}
        </>
      )}

      {step === "grouping" && (
        <div className="card p-8 text-center">
          <Loader2 className="w-6 h-6 mx-auto mb-3 animate-spin" />
          <p className="text-sm text-[var(--text-secondary)]">
            {groupingProgress || "AI is grouping your photos by item..."}
          </p>
        </div>
      )}

      {step === "review" && (
        <>
          <p className="text-sm text-[var(--text-secondary)] mb-4">
            Drag a photo into a different group to fix any mistakes. Only
            the first {MAX_PHOTOS_PER_ITEM} photos per item will be used
            for analysis.
          </p>
          <div className="flex flex-col gap-4 mb-4">
            {groups.map((group, gIdx) => (
              <div
                key={gIdx}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const data = e.dataTransfer.getData("text/plain");
                  if (!data) return;
                  const { photoIndex, fromGroup } = JSON.parse(data);
                  movePhoto(photoIndex, fromGroup, gIdx);
                }}
                className="card p-3"
              >
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-[var(--text-secondary)]">
                    Item {gIdx + 1} &middot; {group.length} photo
                    {group.length !== 1 ? "s" : ""}
                    {group.length > MAX_PHOTOS_PER_ITEM && (
                      <span style={{ color: "#B3261E" }}>
                        {" "}
                        (only first {MAX_PHOTOS_PER_ITEM} will be used)
                      </span>
                    )}
                  </p>
                  <button
                    onClick={() => removeGroup(gIdx)}
                    className="p-1 rounded hover:bg-[var(--bg-page)]"
                    title="Delete group"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
                  </button>
                </div>
                <div className="flex flex-wrap gap-2 min-h-[64px]">
                  {group.map((photoIdx) => (
                    <div
                      key={photoIdx}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(
                          "text/plain",
                          JSON.stringify({ photoIndex: photoIdx, fromGroup: gIdx })
                        );
                      }}
                      className="relative cursor-grab group/photo"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photos[photoIdx].previewUrl}
                        alt={`Photo ${photoIdx + 1}`}
                        className="w-14 h-14 object-cover rounded-md"
                      />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removePhoto(photoIdx, gIdx);
                        }}
                        className="absolute -top-1.5 -left-1.5 w-4 h-4 bg-white border border-gray-200 rounded-full flex items-center justify-center opacity-0 group-hover/photo:opacity-100 transition-opacity"
                      >
                        <X className="w-2.5 h-2.5 text-gray-600" />
                      </button>
                      <GripVertical
                        className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-white rounded-full p-0.5"
                        style={{ color: "var(--text-tertiary)" }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <button onClick={addNewGroup} className="btn w-full mb-4">
            <Plus className="w-4 h-4" />
            Add empty group
          </button>

          <button onClick={handleAnalyzeBatch} className="btn btn-primary w-full">
            <Sparkles className="w-4 h-4" />
            Analyze & price all items
          </button>
        </>
      )}

      {step === "analyzing" && (
        <div className="card p-8 text-center">
          <Loader2 className="w-6 h-6 mx-auto mb-3 animate-spin" />
          <p className="text-sm text-[var(--text-secondary)]">
            Analyzing {groups.length} item{groups.length !== 1 ? "s" : ""}...
          </p>
        </div>
      )}

      {step === "results" && (
        <div className="flex flex-col gap-4">
          {(() => {
            const unsaved = results.filter((r, i) => !r.error && (saveStatus[i] ?? "idle") === "idle").length;
            const allSaved = results.every((r, i) => r.error || saveStatus[i] === "saved");
            const failedCount = results.filter((r) => r.error).length;
            const anyRetrying = Object.values(retrying).some(Boolean);
            return (
              <div className="flex gap-2">
                <button
                  onClick={handleSaveAllDrafts}
                  disabled={savingAll || allSaved || unsaved === 0}
                  className="btn btn-primary flex-1"
                >
                  {savingAll ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : allSaved ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <FileText className="w-4 h-4" />
                  )}
                  {allSaved ? "All saved" : savingAll ? "Saving..." : `Save all (${unsaved})`}
                </button>
                {failedCount > 0 && (
                  <button
                    onClick={handleRetryAllFailed}
                    disabled={anyRetrying}
                    className="btn flex-1"
                  >
                    {anyRetrying ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <RotateCw className="w-4 h-4" />
                    )}
                    {anyRetrying ? "Retrying..." : `Retry failed (${failedCount})`}
                  </button>
                )}
              </div>
            );
          })()}
          {results.map((result, i) => {
            const group = groups[i] ?? [];
            const groupPhotos = group.map((idx) => photos[idx]?.previewUrl).filter(Boolean) as string[];
            const status = saveStatus[i] ?? "idle";

            if (result.error) {
              return (
                <div key={i} className="card p-4">
                  <p className="text-sm font-medium mb-1">Item {i + 1}</p>
                  <p className="text-sm mb-3" style={{ color: "#B3261E" }}>
                    {result.error}
                  </p>
                  <button
                    onClick={() => handleRetry(i)}
                    disabled={retrying[i]}
                    className="btn w-full"
                  >
                    {retrying[i] ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <RotateCw className="w-4 h-4" />
                    )}
                    {retrying[i] ? "Retrying..." : "Retry this item"}
                  </button>
                </div>
              );
            }

            const livePricing = result.pricing && !result.pricing.noData ? result.pricing : null;
            const suggestion: PriceSuggestion =
              livePricing ??
              getPriceSuggestion(
                result.condition,
                Boolean(result.flaws && result.flaws.trim().length > 0)
              );
            const pricingAttempted = Boolean(result.pricing);
            const pricingReady = Boolean(livePricing);
            const pricingNoData = pricingAttempted && !livePricing;

            return (
              <div key={i} className="card overflow-hidden">
                {/* Scrollable photo strip — swipe to see all photos in this group */}
                {groupPhotos.length > 0 && (
                  <div className="flex gap-2 overflow-x-auto px-4 pt-4 pb-2 snap-x snap-mandatory">
                    {groupPhotos.map((url, pi) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={pi}
                        src={url}
                        alt={`Photo ${pi + 1}`}
                        className="h-36 w-36 object-cover rounded-lg flex-shrink-0 snap-start"
                      />
                    ))}
                  </div>
                )}
                <div className="px-4 pb-4">
                  <div className="mb-3 mt-2">
                    <p className="text-sm font-medium">{result.suggestedTitle}</p>
                    <p className="text-xs text-[var(--text-secondary)]">
                      {result.brand} &middot; {result.color} &middot; {result.size}
                    </p>
                  </div>

                  <div className="flex items-baseline gap-2 mb-2">
                    <p className="text-2xl font-medium">${suggestion.suggestedPrice}</p>
                    {!pricingAttempted && (
                      <p className="text-xs text-[var(--text-tertiary)] flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        fetching live prices...
                      </p>
                    )}
                    {pricingNoData && (
                      <>
                        <p className="text-xs text-[var(--text-tertiary)]">est.</p>
                        <button
                          onClick={() => handleRetryPricing(i)}
                          disabled={retryingPricing[i]}
                          className="flex items-center gap-1 text-xs text-brand-600 ml-1"
                        >
                          {retryingPricing[i] ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <RotateCw className="w-3 h-3" />
                          )}
                          {retryingPricing[i] ? "Fetching..." : "Retry price"}
                        </button>
                      </>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <MiniStat label="Market price" value={pricingReady ? `$${suggestion.avgSold}` : "—"} />
                    <MiniStat
                      label="Active range"
                      value={pricingReady ? `$${suggestion.activeRangeLow}–${suggestion.activeRangeHigh}` : "—"}
                    />
                    <MiniStat
                      label="Sell odds"
                      value={suggestion.sellOdds}
                      highlight={suggestion.sellOdds === "High"}
                    />
                  </div>

                  {status === "error" && (
                    <p className="text-xs mb-2" style={{ color: "#B3261E" }}>
                      Could not save draft. Try again.
                    </p>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={() => handleSaveDraft(i)}
                      disabled={status === "saving" || status === "saved"}
                      className="btn flex-1"
                    >
                      {status === "saving" ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : status === "saved" ? (
                        <Check className="w-4 h-4" style={{ color: "#3B6D11" }} />
                      ) : (
                        <FileText className="w-4 h-4" />
                      )}
                      {status === "saved" ? "Saved" : status === "saving" ? "Saving..." : "Save draft"}
                    </button>
                    <button className="btn btn-primary flex-1">
                      <Upload className="w-4 h-4" />
                      List on eBay
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
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
      style={{ background: highlight ? "#EAF3DE" : "var(--bg-page)" }}
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

