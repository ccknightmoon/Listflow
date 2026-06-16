"use client";

import { useState, useRef } from "react";
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
} from "lucide-react";
import { getPriceSuggestion, Condition, PriceSuggestion } from "@/lib/pricing";

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
  error?: string;
}

type Step = "upload" | "grouping" | "review" | "analyzing" | "results";

const MAX_DIMENSION = 1024;
const THUMB_DIMENSION = 400;
const MAX_PHOTOS = 60;
const MAX_PHOTOS_PER_ITEM = 6;

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
  const [step, setStep] = useState<Step>("upload");
  const [photos, setPhotos] = useState<SlotImage[]>([]);
  const [groups, setGroups] = useState<number[][]>([]);
  const [results, setResults] = useState<AiResult[]>([]);
  const [retrying, setRetrying] = useState<Record<number, boolean>>({});
  const [error, setError] = useState<string | null>(null);
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

  async function handleGroupPhotos() {
    setError(null);
    setStep("grouping");

    try {
      const thumbnails = await Promise.all(
        photos.map(async (p) => {
          const { dataUrl, mediaType } = await resizeFromDataUrl(
            p.previewUrl,
            THUMB_DIMENSION,
            0.6
          );
          return { data: dataUrl.split(",")[1], mediaType };
        })
      );

      const res = await fetch("/api/group-photos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images: thumbnails }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Grouping failed");
      }

      setGroups(data.groups);
      setStep("review");
    } catch (err) {
      setError((err as Error).message);
      setStep("upload");
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

  function groupImagesForRequest(group: number[]) {
    return group.slice(0, MAX_PHOTOS_PER_ITEM).map((idx) => ({
      data: photos[idx].data,
      mediaType: photos[idx].mediaType,
    }));
  }

  async function handleAnalyzeBatch() {
    setError(null);
    setStep("analyzing");

    try {
      const res = await fetch("/api/analyze-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groups: groups.map((g) => ({ images: groupImagesForRequest(g) })),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Analysis failed");
      }

      setResults(data.results);
      setStep("results");
    } catch (err) {
      setError((err as Error).message);
      setStep("review");
    }
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

      setResults((prev) => {
        const next = [...prev];
        next[index] = data.results[0];
        return next;
      });
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
              Select all photos for this batch
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
            AI is grouping your photos by item...
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
                <p className="text-xs text-[var(--text-secondary)] mb-2">
                  Item {gIdx + 1} &middot; {group.length} photo
                  {group.length !== 1 ? "s" : ""}
                  {group.length > MAX_PHOTOS_PER_ITEM && (
                    <span style={{ color: "#B3261E" }}>
                      {" "}
                      (only first {MAX_PHOTOS_PER_ITEM} will be used)
                    </span>
                  )}
                </p>
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
                      className="relative cursor-grab"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photos[photoIdx].previewUrl}
                        alt={`Photo ${photoIdx + 1}`}
                        className="w-14 h-14 object-cover rounded-md"
                      />
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
          {results.map((result, i) => {
            const group = groups[i] ?? [];
            const thumb = group.length > 0 ? photos[group[0]].previewUrl : undefined;

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

            const suggestion: PriceSuggestion = getPriceSuggestion(
              result.condition,
              Boolean(result.flaws && result.flaws.trim().length > 0)
            );

            return (
              <div key={i} className="card p-4">
                <div className="flex gap-3 mb-3">
                  {thumb && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={thumb}
                      alt={result.suggestedTitle}
                      className="w-16 h-16 object-cover rounded-md flex-shrink-0"
                    />
                  )}
                  <div>
                    <p className="text-sm font-medium">{result.suggestedTitle}</p>
                    <p className="text-xs text-[var(--text-secondary)]">
                      {result.brand} &middot; {result.color} &middot; {result.size}
                    </p>
                  </div>
                </div>

                <p className="text-2xl font-medium mb-2">${suggestion.suggestedPrice}</p>

                <div className="grid grid-cols-3 gap-2 mb-3">
                  <MiniStat label="Avg sold" value={`$${suggestion.avgSold}`} />
                  <MiniStat
                    label="Active range"
                    value={`$${suggestion.activeRangeLow}-${suggestion.activeRangeHigh}`}
                  />
                  <MiniStat
                    label="Sell odds"
                    value={suggestion.sellOdds}
                    highlight={suggestion.sellOdds === "High"}
                  />
                </div>

                <div className="flex gap-2">
                  <button className="btn flex-1">
                    <FileText className="w-4 h-4" />
                    Save draft
                  </button>
                  <button className="btn btn-primary flex-1">
                    <Upload className="w-4 h-4" />
                    List on eBay
                  </button>
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
