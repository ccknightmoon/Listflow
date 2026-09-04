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
  CheckSquare,
  Square,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { getPriceSuggestion, Condition, PriceSuggestion } from "@/lib/pricing";
import { uploadThumbnail } from "@/lib/storage";
import { apiFetch } from "@/lib/api";
import { AiResult as BaseAiResult, formatMeasurements } from "@/lib/ai-result";
import { estimateIsHeavy, estimateShipping } from "@/lib/shipping";
import AIDisclaimer from "@/components/AIDisclaimer";

interface SlotImage {
  data: string;
  mediaType: string;
  previewUrl: string;
}

// batch-upload additionally tracks a live pricing suggestion and a
// per-item error string on top of the shared AI analysis fields.
interface AiResult extends BaseAiResult {
  pricing?: PriceSuggestion;
  error?: string;
}

interface Thumbnail {
  data: string;
  mediaType: string;
}

type Step = "upload" | "grouping" | "review" | "analyzing" | "results";
type SaveStatus = "idle" | "saving" | "saved" | "error";

const CONDITIONS: Condition[] = [
  "New with tags",
  "New without tags",
  "Excellent used",
  "Good - minor flaws",
  "Fair - notable flaws",
];

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
  const [photoUploadWarnings, setPhotoUploadWarnings] = useState<Record<number, string>>({});
  const [savingAll, setSavingAll] = useState(false);
  const [draftIds, setDraftIds] = useState<Record<number, string>>({});
  const [listStatus, setListStatus] = useState<Record<number, "idle" | "saving" | "listing" | "listed" | "error">>({});
  const [listErrors, setListErrors] = useState<Record<number, string>>({});
  const [listMissingAspects, setListMissingAspects] = useState<Record<number, string[]>>({});
  const [needsEbayConnect, setNeedsEbayConnect] = useState(false);
  const [needsEbayReconnect, setNeedsEbayReconnect] = useState(false);
  const [customPrices, setCustomPrices] = useState<Record<number, string>>({});
  const [heavyItems, setHeavyItems] = useState<Record<number, boolean>>({});
  const [shippingCosts, setShippingCosts] = useState<Record<number, string>>({});
  const [listingAll, setListingAll] = useState(false);
  const [listingAllProgress, setListingAllProgress] = useState<{ done: number; total: number } | null>(null);
  const [analyzingProgress, setAnalyzingProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [groupingProgress, setGroupingProgress] = useState<string>("");
  // Bulk-edit selection on the results screen — lets a seller set condition
  // or heavy-item shipping across many items at once instead of one row at
  // a time, the single most-requested gap found in the "list 40 a day"
  // workflow audit. Only items that haven't been saved/listed yet are
  // selectable, matching every per-item control's own disabled={!!draftIds[i]}
  // rule below — editing a value that's already locked in on eBay would be
  // silently meaningless.
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [bulkCondition, setBulkCondition] = useState<Condition>(CONDITIONS[2]);
  const [bulkHeavy, setBulkHeavy] = useState(false);
  const [bulkShippingCost, setBulkShippingCost] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false); // bulk-edit panel accordion — starts collapsed per mock, opened manually
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

    // Each item's save is just Supabase writes (a few photo uploads + one
    // drafts insert/update) — no eBay calls, so this can run at a higher
    // concurrency than the eBay-touching bulk actions below without
    // stressing anything but Supabase, which handles far more parallel
    // load than that. Used to save one item at a time; for a 40-item
    // batch that was 40 full round trips back-to-back before "Save all
    // drafts" ever finished.
    const SAVE_CONCURRENCY = 5;
    let successCount = 0;
    let cursor = 0;
    async function worker() {
      while (cursor < indices.length) {
        const i = indices[cursor++];
        const id = await handleSaveDraft(i);
        if (id) successCount++;
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(SAVE_CONCURRENCY, indices.length) }, () => worker())
    );
    setSavingAll(false);
    if (successCount > 0) setTimeout(() => router.push("/drafts"), 1200);
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

        const data = await apiFetch<{ groups?: number[][]; error?: string }>("/api/group-photos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ images: chunkImages }),
        });

        if (!data.groups) {
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

  // Drag-and-drop (movePhoto above) only works with a mouse, so it's
  // effectively unusable on a phone — which is how this app is actually
  // used day to day. These give the same two corrections (fix a photo the
  // AI put in the wrong item, fix which photo comes first) as plain
  // buttons: tapping the edge of a group's photo strip spills the photo
  // into the neighboring group instead of doing nothing.
  function reorderWithinGroup(photoIndex: number, gIdx: number, direction: -1 | 1) {
    setGroups((prev) => {
      const next = prev.map((g) => [...g]);
      const group = next[gIdx];
      const pos = group.indexOf(photoIndex);
      const swapWith = pos + direction;
      if (pos === -1 || swapWith < 0 || swapWith >= group.length) return prev;
      [group[pos], group[swapWith]] = [group[swapWith], group[pos]];
      return next;
    });
  }

  function movePhotoEarlier(photoIndex: number, gIdx: number) {
    const pos = groups[gIdx].indexOf(photoIndex);
    if (pos > 0) {
      reorderWithinGroup(photoIndex, gIdx, -1);
    } else if (gIdx > 0) {
      movePhoto(photoIndex, gIdx, gIdx - 1);
    }
  }

  function movePhotoLater(photoIndex: number, gIdx: number) {
    const group = groups[gIdx];
    const pos = group.indexOf(photoIndex);
    if (pos < group.length - 1) {
      reorderWithinGroup(photoIndex, gIdx, 1);
    } else if (gIdx < groups.length - 1) {
      movePhoto(photoIndex, gIdx, gIdx + 1);
    }
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
    setAnalyzingProgress({ done: 0, total: groups.length });

    const allResults: AiResult[] = new Array(groups.length);

    // A few items analyzed at once instead of strictly one at a time — the
    // same bounded worker-pool pattern already used for pricing lookups
    // below (see PRICING_CONCURRENCY) and for bulk eBay listing. Kept
    // conservative rather than "as many as possible": the real ceiling here
    // is OpenAI's per-minute token budget on the account, not network
    // throughput, and analyze-batch's own retry/backoff
    // (src/app/api/analyze-batch/route.ts) still catches anything that
    // slips past this. Side benefit over the old sequential loop: one
    // item's network hiccup no longer aborts the whole batch — each item
    // now fails on its own instead of taking every other item down with it.
    const ANALYSIS_CONCURRENCY = 3;
    let doneCount = 0;

    async function analyzeOne(i: number) {
      let data: { results?: AiResult[]; error?: string };
      try {
        data = await apiFetch<{ results?: AiResult[]; error?: string }>("/api/analyze-batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            groups: [{ images: groupImagesForRequest(groups[i]) }],
          }),
        });
      } catch (error) {
        data = { error: error instanceof Error ? error.message : "Analysis failed" };
      }

      allResults[i] = !data.results
        ? { itemType: "", brand: "", color: "", size: "", condition: "Good - minor flaws", flaws: "", suggestedTitle: "", error: data.error || "Analysis failed" }
        : data.results[0];

      doneCount++;
      setAnalyzingProgress({ done: doneCount, total: groups.length });
    }

    try {
      let cursor = 0;
      async function worker() {
        while (cursor < groups.length) {
          const i = cursor++;
          await analyzeOne(i);
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(ANALYSIS_CONCURRENCY, groups.length) }, () => worker())
      );

      setResults(allResults);
      setStep("results");
      // Auto-fill shipping tier AND an actual estimated dollar cost per item
      // from the AI-detected item type/size/material instead of leaving
      // every item on the manual default.
      setHeavyItems((prev) => {
        const next = { ...prev };
        allResults.forEach((r, i) => {
          if (!r.error) next[i] = estimateShipping(r.itemType, r.size, r.material).isHeavy;
        });
        return next;
      });
      setShippingCosts((prev) => {
        const next = { ...prev };
        allResults.forEach((r, i) => {
          if (!r.error) {
            const est = estimateShipping(r.itemType, r.size, r.material);
            if (est.isHeavy) next[i] = String(est.cost);
          }
        });
        return next;
      });
      fetchPricingForAll(allResults);
    } catch (err) {
      setError((err as Error).message);
      setStep("review");
    } finally {
      setAnalyzingProgress(null);
    }
  }

  // Pricing lookups hit eBay's Browse API (and its own app-token endpoint)
  // per item. Firing all of them at once for a large batch — unlike the
  // deliberately sequential, rate-limit-aware AI analysis pass — risked
  // bursting well past what eBay's Browse API tolerates. Cap how many run
  // concurrently instead.
  const PRICING_CONCURRENCY = 3;

  async function fetchOnePricing(result: AiResult, i: number) {
    const firstPhotoIdx = (groups[i] ?? [])[0];
    const image = firstPhotoIdx !== undefined ? photos[firstPhotoIdx]?.data : undefined;
    try {
      const pricing = await apiFetch<PriceSuggestion>("/api/pricing/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: result.suggestedTitle,
          brand: result.brand,
          condition: result.condition,
          image,
          isHeavy: heavyItems[i] ?? estimateIsHeavy(result.itemType, result.material),
          itemType: result.itemType,
          size: result.size,
        }),
      }).catch(() => null);
      if (!pricing) return;
      setResults((prev) => {
        const next = [...prev];
        next[i] = { ...next[i], pricing };
        return next;
      });
    } catch {
      // leave pricing unset — the UI already falls back to the mock estimate
    }
  }

  async function fetchPricingForAll(allResults: AiResult[]) {
    const queue = allResults
      .map((result, i) => ({ result, i }))
      .filter(({ result }) => !result.error);

    let cursor = 0;
    async function worker() {
      while (cursor < queue.length) {
        const { result, i } = queue[cursor++];
        await fetchOnePricing(result, i);
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(PRICING_CONCURRENCY, queue.length) }, () => worker())
    );
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
    apiFetch<PriceSuggestion>("/api/pricing/suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: result.suggestedTitle, brand: result.brand, condition: result.condition, image, itemType: result.itemType, size: result.size }),
    })
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
      const data = await apiFetch<{ results?: AiResult[]; error?: string }>("/api/analyze-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groups: [{ images: groupImagesForRequest(group) }],
        }),
      });

      if (!data.results) {
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
      apiFetch<PriceSuggestion>("/api/pricing/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: retryResult.suggestedTitle,
          brand: retryResult.brand,
          condition: retryResult.condition,
          image: retryImage,
          itemType: retryResult.itemType,
          size: retryResult.size,
        }),
      })
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

  async function handleSaveDraft(index: number): Promise<string | null> {
    // NOTE: this used to short-circuit with `if (draftIds[index]) return
    // draftIds[index];`, and handleListOnEbay only ever called this when
    // no draft existed yet — so editing a row in the results table (title,
    // condition, brand, color, size, flaws are all editable above) after
    // "Save all drafts" had already run meant the edit never reached the
    // database at all, and /api/ebay/list reads the draft straight from
    // there. Now every call does a real, full sync — POST once to create,
    // PATCH every time after — and handleListOnEbay always calls this
    // first so a listing attempt is always built from what's on screen.
    setSaveStatus((prev) => ({ ...prev, [index]: "saving" }));

    try {
      const result = results[index];
      const group = groups[index] ?? [];
      const existingId = draftIds[index];

      const hasRealPricing = result.pricing && !result.pricing.noData;
      const suggestion: PriceSuggestion =
        (hasRealPricing ? result.pricing : null) ??
        getPriceSuggestion(result.condition, Boolean(result.flaws && result.flaws.trim().length > 0), heavyItems[index] ?? estimateIsHeavy(result.itemType, result.material), result.itemType, result.size);
      const finalPrice = hasRealPricing
        ? suggestion.suggestedPrice
        : customPrices[index] ? Number(customPrices[index]) : suggestion.suggestedPrice;

      // Upload all photos in the group; first becomes the thumbnail. Only
      // overwrite photoUrls/thumbnailUrl on a re-save if something actually
      // uploaded this time — an empty result shouldn't wipe out photos a
      // previous save already stored. Each photo's upload is independent of
      // the others, so they run concurrently instead of one at a time —
      // with up to MAX_PHOTOS_PER_ITEM (6) photos per item across a
      // 40-item batch, this used to mean hundreds of sequential Supabase
      // Storage round trips. Promise.all preserves the group's original
      // order in its results regardless of which upload finishes first, so
      // photoUrls[0] is still reliably the group's first/front photo.
      const uploadOutcomes = await Promise.all(
        group.map(async (photoIdx) => {
          const dataUrl = photos[photoIdx]?.previewUrl;
          if (!dataUrl) return null;
          try {
            return await uploadThumbnail(dataUrl);
          } catch (err) {
            console.error("Photo upload failed:", (err as Error).message);
            return undefined; // distinguish "no photo at this slot" from "upload failed"
          }
        })
      );
      const photoUrls = uploadOutcomes.filter((u): u is string => typeof u === "string");
      const failedCount = uploadOutcomes.filter((u) => u === undefined).length;
      if (failedCount > 0) {
        setPhotoUploadWarnings((prev) => ({
          ...prev,
          [index]: `Saved, but ${failedCount} photo${failedCount > 1 ? "s" : ""} failed to upload.`,
        }));
      }
      const thumbnailUrl = photoUrls[0] ?? null;

      const payload = {
        title: result.suggestedTitle,
        brand: result.brand,
        color: result.color,
        size: result.size,
        condition: result.condition,
        flaws: result.flaws,
        suggestedPrice: finalPrice,
        avgSold: hasRealPricing ? suggestion.avgSold : null,
        activeRangeLow: hasRealPricing ? suggestion.activeRangeLow : null,
        activeRangeHigh: hasRealPricing ? suggestion.activeRangeHigh : null,
        sellOdds: hasRealPricing ? suggestion.sellOdds : null,
        ...(photoUrls.length > 0 ? { thumbnailUrl, photoUrls } : {}),
        itemType: result.itemType ?? null,
        style: result.style ?? null,
        material: result.material ?? null,
        sleeveLength: result.sleeveLength ?? null,
        neckline: result.neckline ?? null,
        fit: result.fit ?? null,
        pattern: result.pattern ?? null,
        description: (() => {
          const measLine = formatMeasurements(result);
          if (measLine && result.description) return `${measLine}\n\n${result.description}`;
          if (measLine) return measLine;
          return result.description ?? null;
        })(),
        vintage: result.vintage ?? null,
        theme: result.theme ?? null,
        character: result.character ?? null,
        characterFamily: result.characterFamily ?? null,
        yearManufactured: result.yearManufactured ?? null,
        season: result.season ?? null,
      };

      let id: string = existingId ?? "";
      if (id) {
        await apiFetch(`/api/drafts/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        const data = await apiFetch<{ draft?: { id?: string } }>("/api/drafts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        id = data.draft?.id ?? "";
      }

      if (!id) throw new Error("Failed to save draft");
      setDraftIds((prev) => ({ ...prev, [index]: id }));
      setSaveStatus((prev) => ({ ...prev, [index]: "saved" }));
      return id;
    } catch {
      setSaveStatus((prev) => ({ ...prev, [index]: "error" }));
      return null;
    }
  }

  async function handleListOnEbay(index: number): Promise<boolean> {
    setListStatus((prev) => ({ ...prev, [index]: "saving" }));
    const id = await handleSaveDraft(index);
    if (!id) {
      setListStatus((prev) => ({ ...prev, [index]: "error" }));
      setListErrors((prev) => ({ ...prev, [index]: "Failed to save draft" }));
      return false;
    }

    setListStatus((prev) => ({ ...prev, [index]: "listing" }));
    try {
      const data = await apiFetch<{ connect?: boolean; reconnect?: boolean; error?: string; missingRequiredAspects?: string[] }>("/api/ebay/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: id, isHeavy: heavyItems[index] ?? false, shippingCost: shippingCosts[index] ? parseFloat(shippingCosts[index]) : undefined }),
      });
      if (data.connect) { setNeedsEbayConnect(true); throw new Error(data.error ?? "Listing failed"); }
      if (data.reconnect) { setNeedsEbayReconnect(true); throw new Error(data.error ?? "Listing failed"); }
      setListStatus((prev) => ({ ...prev, [index]: "listed" }));
      const missingRequiredAspects = data.missingRequiredAspects ?? [];
      if (missingRequiredAspects.length > 0) {
        setListMissingAspects((prev) => ({
          ...prev,
          [index]: [...missingRequiredAspects],
        }));
      }
      window.dispatchEvent(new Event("listflow:counts-changed"));
      return true;
    } catch (err) {
      setListStatus((prev) => ({ ...prev, [index]: "error" }));
      setListErrors((prev) => ({ ...prev, [index]: (err as Error).message }));
      return false;
    }
  }

  async function handleListAllOnEbay() {
    const indices = results
      .map((_, i) => i)
      .filter((i) => !results[i].error && listStatus[i] !== "listed");

    setListingAll(true);
    setListingAllProgress({ done: 0, total: indices.length });

    // A couple of listings at a time instead of strictly one at a time.
    // Kept lower than ANALYSIS_CONCURRENCY above: a single listing is
    // already several sequential eBay calls internally (SKU cleanup,
    // upsert, offer create/update, publish, best-effort category revise),
    // so 2 concurrent listings roughly doubles real throughput without
    // stacking too much simultaneous load on eBay's Trading/Inventory APIs.
    const LISTING_CONCURRENCY = 2;
    let successCount = 0;
    let doneCount = 0;
    let cursor = 0;

    async function worker() {
      while (cursor < indices.length) {
        const n = cursor++;
        const ok = await handleListOnEbay(indices[n]);
        if (ok) successCount++;
        doneCount++;
        setListingAllProgress({ done: doneCount, total: indices.length });
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(LISTING_CONCURRENCY, indices.length) }, () => worker())
    );

    setListingAll(false);
    setListingAllProgress(null);
    if (successCount > 0) setTimeout(() => router.push("/store"), 1500);
  }

  // Items still open for bulk editing -- once a draft is saved (draftIds[i]
  // set), every per-item field below locks with disabled={!!draftIds[i]},
  // so bulk-applying a new value to an already-saved item would silently
  // do nothing. Errored items are excluded too; they have no editable
  // fields to apply to until retried.
  function getSelectableIndices(): number[] {
    return results
      .map((_, i) => i)
      .filter((i) => !results[i].error && !draftIds[i]);
  }

  function toggleSelected(i: number) {
    setSelected((prev) => ({ ...prev, [i]: !prev[i] }));
  }

  function toggleSelectAll() {
    const selectable = getSelectableIndices();
    const allSelected = selectable.length > 0 && selectable.every((i) => selected[i]);
    setSelected((prev) => {
      const next = { ...prev };
      selectable.forEach((i) => {
        next[i] = !allSelected;
      });
      return next;
    });
  }

  function applyBulkCondition() {
    const targets = getSelectableIndices().filter((i) => selected[i]);
    if (targets.length === 0) return;
    const targetSet = new Set(targets);
    setResults((prev) => prev.map((r, i) => (targetSet.has(i) ? { ...r, condition: bulkCondition } : r)));
  }

  function applyBulkShipping() {
    const targets = getSelectableIndices().filter((i) => selected[i]);
    if (targets.length === 0) return;
    setHeavyItems((prev) => {
      const next = { ...prev };
      targets.forEach((i) => {
        next[i] = bulkHeavy;
      });
      return next;
    });
    setShippingCosts((prev) => {
      const next = { ...prev };
      targets.forEach((i) => {
        if (bulkHeavy && bulkShippingCost) next[i] = bulkShippingCost;
        else delete next[i];
      });
      return next;
    });
  }

  return (
    <main className="relative min-h-screen max-w-md mx-auto px-5 pt-6 pb-24 overflow-hidden" style={{ viewTransitionName: "batch-panel" }}>
      <div
        className="bloom d1 stagger"
        style={{ width: 240, height: 240, top: -70, left: -60, background: "var(--glow-primary)" }}
      />
      <div
        className="bloom d1 stagger"
        style={{ width: 200, height: 200, top: 10, right: -70, background: "var(--glow-secondary)" }}
      />

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
            Fix any mistakes before analyzing: drag a photo into a
            different group (or use the arrows under a photo — they move
            it into the previous/next item at either end of a group).
            Only the first {MAX_PHOTOS_PER_ITEM} photos per item will be
            used for analysis, in the order shown.
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
                  {group.map((photoIdx, posInGroup) => {
                    const isFirstOverall = gIdx === 0 && posInGroup === 0;
                    const isLastOverall = gIdx === groups.length - 1 && posInGroup === group.length - 1;
                    return (
                      <div key={photoIdx} className="flex flex-col items-center gap-1">
                        <div
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
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              removePhoto(photoIdx, gIdx);
                            }}
                            className="absolute -top-1.5 -left-1.5 w-4 h-4 rounded-full flex items-center justify-center"
                            style={{ background: "var(--bg-surface)", border: "1px solid var(--glass-line)" }}
                          >
                            <X className="w-2.5 h-2.5" style={{ color: "var(--text-secondary)" }} />
                          </button>
                          <GripVertical
                            className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-white rounded-full p-0.5"
                            style={{ color: "var(--text-tertiary)" }}
                          />
                        </div>
                        {/* Tap-to-move controls — drag-and-drop above needs a mouse and
                            doesn't work on a phone. At either end of a group these spill
                            the photo into the previous/next item instead of just reordering,
                            so a mis-grouped photo can be fixed with a tap. */}
                        <div className="flex items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => movePhotoEarlier(photoIdx, gIdx)}
                            disabled={isFirstOverall}
                            title={posInGroup === 0 ? "Move to previous item" : "Move earlier"}
                            className="w-5 h-5 rounded flex items-center justify-center disabled:opacity-25"
                            style={{ background: "var(--glass)", border: "1px solid var(--glass-line)" }}
                          >
                            <ChevronLeft className="w-3 h-3" style={{ color: "var(--text-secondary)" }} />
                          </button>
                          <button
                            type="button"
                            onClick={() => movePhotoLater(photoIdx, gIdx)}
                            disabled={isLastOverall}
                            title={posInGroup === group.length - 1 ? "Move to next item" : "Move later"}
                            className="w-5 h-5 rounded flex items-center justify-center disabled:opacity-25"
                            style={{ background: "var(--glass)", border: "1px solid var(--glass-line)" }}
                          >
                            <ChevronRight className="w-3 h-3" style={{ color: "var(--text-secondary)" }} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
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
            {analyzingProgress
              ? `Analyzing ${analyzingProgress.done}/${analyzingProgress.total} items...`
              : `Analyzing ${groups.length} item${groups.length !== 1 ? "s" : ""}...`}
          </p>
        </div>
      )}

      {step === "results" && (
        <div className="flex flex-col gap-4">
          <AIDisclaimer />
          {results.length > 1 && (
            <>
              <p className="text-xs font-semibold stagger d1" style={{ color: "var(--text-tertiary)" }}>
                {results.length} items ready &middot; tap one to jump to it
              </p>
              <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 stagger d1">
                {results.map((r, i) => {
                  const group = groups[i] ?? [];
                  const thumb = group.map((idx) => photos[idx]?.previewUrl).find(Boolean);
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() =>
                        document.getElementById(`result-item-${i}`)?.scrollIntoView({ behavior: "smooth", block: "start" })
                      }
                      className="relative flex-shrink-0 w-14 h-14 rounded-xl overflow-hidden active:scale-90"
                      style={{ border: "1px solid var(--glass-line)", transition: "transform .2s var(--spring)" }}
                    >
                      {thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumb} alt={`Item ${i + 1}`} className="w-full h-full object-cover" />
                      ) : (
                        <div
                          className="w-full h-full flex items-center justify-center text-[10px] font-medium"
                          style={{ background: "var(--glass)", color: "var(--text-tertiary)" }}
                        >
                          #{i + 1}
                        </div>
                      )}
                      <span
                        className="absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-bold text-white"
                        style={{ background: "rgba(0,0,0,0.55)" }}
                      >
                        {i + 1}
                      </span>
                      {r.error && (
                        <span
                          className="absolute inset-x-0 bottom-0 text-[8px] font-bold text-center text-white py-0.5"
                          style={{ background: "var(--danger)" }}
                        >
                          !
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}
          {(() => {
            const unsaved = results.filter((r, i) => !r.error && (saveStatus[i] ?? "idle") === "idle").length;
            const allSaved = results.every((r, i) => r.error || saveStatus[i] === "saved");
            const unlistedCount = results.filter((r, i) => !r.error && listStatus[i] !== "listed").length;
            const allListed = results.filter((r) => !r.error).length > 0 && results.every((r, i) => r.error || listStatus[i] === "listed");
            const failedCount = results.filter((r) => r.error).length;
            const anyRetrying = Object.values(retrying).some(Boolean);
            return (
              <div className="flex flex-col gap-2">
                <button
                  onClick={handleListAllOnEbay}
                  disabled={listingAll || savingAll || unlistedCount === 0}
                  className="btn btn-primary w-full"
                >
                  {listingAll ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : allListed ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <Upload className="w-4 h-4" />
                  )}
                  {listingAll && listingAllProgress
                    ? `Listing ${listingAllProgress.done}/${listingAllProgress.total}...`
                    : allListed
                    ? "All listed on eBay!"
                    : `List all on eBay (${unlistedCount})`}
                </button>
                <button
                  onClick={handleSaveAllDrafts}
                  disabled={savingAll || listingAll || allSaved || unsaved === 0}
                  className="btn w-full"
                >
                  {savingAll ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : allSaved ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <FileText className="w-4 h-4" />
                  )}
                  {allSaved ? "All saved as drafts" : savingAll ? "Saving..." : `Save all as drafts (${unsaved})`}
                </button>
                {failedCount > 0 && (
                  <button
                    onClick={handleRetryAllFailed}
                    disabled={anyRetrying}
                    className="btn w-full"
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
          {(() => {
            const selectable = getSelectableIndices();
            if (selectable.length === 0) return null;
            const selectedCount = selectable.filter((i) => selected[i]).length;
            const allSelected = selectedCount > 0 && selectedCount === selectable.length;
            const panelOpen = selectedCount > 0 && bulkOpen;
            return (
              <div className="card p-3 flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <button
                    onClick={toggleSelectAll}
                    className="flex items-center gap-2 text-sm font-medium flex-1 min-w-0"
                  >
                    {allSelected ? (
                      <CheckSquare className="w-4 h-4 text-[var(--accent)] flex-shrink-0" />
                    ) : (
                      <Square className="w-4 h-4 text-[var(--text-tertiary)] flex-shrink-0" />
                    )}
                    <span className="truncate">
                      {selectedCount > 0 ? `${selectedCount} selected` : `Select items to bulk-edit (${selectable.length})`}
                    </span>
                  </button>
                  {selectedCount > 0 && (
                    <button
                      onClick={() => setBulkOpen((v) => !v)}
                      aria-label={panelOpen ? "Collapse bulk edit" : "Expand bulk edit"}
                      className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ color: "var(--text-tertiary)" }}
                    >
                      <ChevronDown
                        className="w-4 h-4"
                        style={{ transition: "transform .25s var(--spring)", transform: panelOpen ? "rotate(180deg)" : "none" }}
                      />
                    </button>
                  )}
                </div>
                <div className="accordion" style={{ gridTemplateRows: panelOpen ? "1fr" : "0fr" }}>
                  <div className="min-h-0 overflow-hidden">
                    <div className="flex flex-col gap-2 pt-2 mt-1 border-t border-[var(--border)]">
                      <div className="flex items-center gap-2">
                        <select
                          className="input flex-1 text-xs"
                          value={bulkCondition}
                          onChange={(e) => setBulkCondition(e.target.value as Condition)}
                        >
                          {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <button onClick={applyBulkCondition} className="btn text-xs px-3 py-1.5 whitespace-nowrap">
                          Set condition
                        </button>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <input
                          type="checkbox"
                          id="bulk-heavy"
                          checked={bulkHeavy}
                          onChange={(e) => setBulkHeavy(e.target.checked)}
                          className="w-4 h-4 rounded accent-[var(--accent)]"
                        />
                        <label htmlFor="bulk-heavy" className="text-xs text-[var(--text-secondary)] cursor-pointer">
                          Heavy item
                        </label>
                        {bulkHeavy && (
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-[var(--text-secondary)]">— shipping $</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="0.00"
                              value={bulkShippingCost}
                              onChange={(e) => setBulkShippingCost(e.target.value)}
                              className="input w-16 text-xs py-0.5 px-1.5"
                            />
                          </div>
                        )}
                        <button onClick={applyBulkShipping} className="btn text-xs px-3 py-1.5 whitespace-nowrap ml-auto">
                          Set shipping
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
          {results.map((result, i) => {
            const group = groups[i] ?? [];
            const groupPhotos = group.map((idx) => photos[idx]?.previewUrl).filter(Boolean) as string[];
            const status = saveStatus[i] ?? "idle";

            if (result.error) {
              return (
                <div key={i} id={`result-item-${i}`} className="card p-4">
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
                Boolean(result.flaws && result.flaws.trim().length > 0),
                heavyItems[i] ?? estimateIsHeavy(result.itemType, result.material),
                result.itemType,
                result.size
              );
            const pricingAttempted = Boolean(result.pricing);
            const pricingReady = Boolean(livePricing);
            const pricingNoData = pricingAttempted && !livePricing;

            return (
              <div key={i} id={`result-item-${i}`} className="card overflow-hidden">
                {!draftIds[i] && (
                  <button
                    onClick={() => toggleSelected(i)}
                    className="flex items-center gap-2 px-4 pt-3 text-xs text-[var(--text-tertiary)] w-full"
                  >
                    {selected[i] ? (
                      <CheckSquare className="w-4 h-4 text-[var(--accent)]" />
                    ) : (
                      <Square className="w-4 h-4" />
                    )}
                    Item {i + 1}
                  </button>
                )}
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
                    <input
                      className="input w-full text-sm font-medium mb-1"
                      value={result.suggestedTitle}
                      disabled={!!draftIds[i]}
                      onChange={(e) => {
                        const val = e.target.value;
                        setResults((prev) => prev.map((r, j) => j === i ? { ...r, suggestedTitle: val } : r));
                      }}
                    />
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      <select
                        className="text-xs font-semibold rounded-full px-3 py-1.5 border appearance-none"
                        style={{ background: "var(--glass)", borderColor: "var(--glass-line)", color: "var(--text-primary)" }}
                        value={result.condition}
                        disabled={!!draftIds[i]}
                        onChange={(e) => {
                          const val = e.target.value as Condition;
                          setResults((prev) => prev.map((r, j) => j === i ? { ...r, condition: val } : r));
                        }}
                      >
                        {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <button
                        type="button"
                        onClick={() => {
                          const next = !(heavyItems[i] ?? false);
                          setHeavyItems((prev) => ({ ...prev, [i]: next }));
                          if (!next) setShippingCosts((prev) => { const n = { ...prev }; delete n[i]; return n; });
                        }}
                        disabled={!!draftIds[i]}
                        className="text-xs font-semibold rounded-full px-3 py-1.5 border"
                        style={
                          heavyItems[i]
                            ? { background: "var(--accent-tint)", borderColor: "var(--accent)", color: "var(--accent)" }
                            : { background: "var(--glass)", borderColor: "var(--glass-line)", color: "var(--text-secondary)" }
                        }
                      >
                        {heavyItems[i] ? "Heavy item" : "Not heavy"}
                      </button>
                      {(heavyItems[i] ?? false) && (
                        <div className="relative">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs" style={{ color: "var(--text-tertiary)" }}>$</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="Shipping"
                            value={shippingCosts[i] ?? ""}
                            disabled={!!draftIds[i]}
                            onChange={(e) => setShippingCosts((prev) => ({ ...prev, [i]: e.target.value }))}
                            className="input w-24 text-xs py-1.5 pl-5 pr-2 rounded-full"
                          />
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-1 mt-2">
                      <div>
                        <p className="text-[10px] text-[var(--text-tertiary)] mb-0.5">Brand</p>
                        <input
                          className="input text-xs w-full"
                          placeholder="Brand"
                          value={result.brand}
                          disabled={!!draftIds[i]}
                          onChange={(e) => {
                            const val = e.target.value;
                            setResults((prev) => prev.map((r, j) => j === i ? { ...r, brand: val } : r));
                          }}
                        />
                      </div>
                      <div>
                        <p className="text-[10px] text-[var(--text-tertiary)] mb-0.5">Color</p>
                        <input
                          className="input text-xs w-full"
                          placeholder="Color"
                          value={result.color}
                          disabled={!!draftIds[i]}
                          onChange={(e) => {
                            const val = e.target.value;
                            setResults((prev) => prev.map((r, j) => j === i ? { ...r, color: val } : r));
                          }}
                        />
                      </div>
                      <div>
                        <p className="text-[10px] text-[var(--text-tertiary)] mb-0.5">Size</p>
                        <input
                          className="input text-xs w-full"
                          placeholder="Size"
                          value={result.size}
                          disabled={!!draftIds[i]}
                          onChange={(e) => {
                            const val = e.target.value;
                            setResults((prev) => prev.map((r, j) => j === i ? { ...r, size: val } : r));
                          }}
                        />
                      </div>
                    </div>
                    <textarea
                      className="input w-full text-xs mt-1"
                      rows={2}
                      placeholder="Flaws (e.g. small stain on sleeve)"
                      value={result.flaws}
                      disabled={!!draftIds[i]}
                      onChange={(e) => {
                        const val = e.target.value;
                        setResults((prev) => prev.map((r, j) => j === i ? { ...r, flaws: val } : r));
                      }}
                    />
                  </div>

                  <div className="flex items-baseline gap-2 mb-2 flex-wrap">
                    <p className="text-2xl font-medium">${suggestion.suggestedPrice}</p>
                    {suggestion.floorPrice != null && (
                      <p className="text-xs text-[var(--text-tertiary)]">
                        floor ${suggestion.floorPrice}
                      </p>
                    )}
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
                          className="flex items-center gap-1 text-xs text-accent ml-1"
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

                  {pricingNoData && (
                    <div className="relative mb-3">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--text-secondary)]">$</span>
                      <input
                        type="number"
                        min="0.99"
                        step="0.01"
                        placeholder="Set your price"
                        value={customPrices[i] ?? ""}
                        onChange={(e) => setCustomPrices((prev) => ({ ...prev, [i]: e.target.value }))}
                        className="input w-full pl-6"
                      />
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <MiniStat label="Active median" value={pricingReady ? `$${suggestion.avgSold}` : "—"} />
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
                  {photoUploadWarnings[i] && (
                    <p className="text-xs mb-2" style={{ color: "#B3261E" }}>
                      {photoUploadWarnings[i]}
                    </p>
                  )}
                  {listStatus[i] === "error" && listErrors[i] && (
                    <p className="text-xs mb-2" style={{ color: "#B3261E" }}>
                      {listErrors[i]}
                      {needsEbayConnect && (
                        <a href="/api/ebay/connect" className="underline ml-2 font-medium">Connect eBay →</a>
                      )}
                      {needsEbayReconnect && (
                        <a href="/api/ebay/connect" className="underline ml-2 font-medium">Reconnect eBay →</a>
                      )}
                    </p>
                  )}
                  {listStatus[i] === "listed" && listMissingAspects[i]?.length > 0 && (
                    <p className="text-xs mb-2" style={{ color: "#92400E" }}>
                      Listed, but eBay wants these fields for this category and the AI
                      couldn&apos;t tell: <strong>{listMissingAspects[i].join(", ")}</strong>.
                    </p>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={() => handleSaveDraft(i)}
                      disabled={status === "saving" || status === "saved" || listingAll}
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
                    <button
                      onClick={() => handleListOnEbay(i)}
                      disabled={listStatus[i] === "saving" || listStatus[i] === "listing" || listStatus[i] === "listed" || listingAll}
                      className="btn btn-primary flex-1"
                    >
                      {(listStatus[i] === "saving" || listStatus[i] === "listing") ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : listStatus[i] === "listed" ? (
                        <Check className="w-4 h-4" />
                      ) : (
                        <Upload className="w-4 h-4" />
                      )}
                      {listStatus[i] === "saving" ? "Saving..." : listStatus[i] === "listing" ? "Listing..." : listStatus[i] === "listed" ? "Listed!" : "List on eBay"}
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

