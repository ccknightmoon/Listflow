"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Camera,
  Sparkles,
  Upload,
  FileText,
  Loader2,
  Check,
  Plus,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Undo2,
  X,
  GripVertical,
} from "lucide-react";

import { Condition, PriceSuggestion } from "@/lib/pricing";
import { uploadThumbnail } from "@/lib/storage";
import { apiFetch } from "@/lib/api";
import { AiResult, formatMeasurements } from "@/lib/ai-result";
import { matchStoreCategoryByKeyword, StoreCategoryLite } from "@/lib/store-category-match";
import { estimateShipping, type ShippingMode } from "@/lib/shipping";
import AIDisclaimer from "@/components/AIDisclaimer";
import { getListingReadiness } from "@/lib/listing-readiness";

const CONDITIONS: Condition[] = [
  "New with tags",
  "New without tags",
  "Excellent used",
  "Good - minor flaws",
  "Fair - notable flaws",
];

interface PhotoItem {
  id: string;
  data: string;
  mediaType: string;
  previewUrl: string;
  label?: "front" | "measure" | "flaw";
  uploadedUrl?: string;
}

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
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [photoUndo, setPhotoUndo] = useState<PhotoItem[] | null>(null);
  const [photoUndoLabel, setPhotoUndoLabel] = useState("");
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
  const draftUpdatedAt = useRef<string | null>(null);
  const [photoUploadWarning, setPhotoUploadWarning] = useState<string | null>(null);
  const [listStatus, setListStatus] = useState<"idle" | "listing" | "listed" | "error">("idle");
  const [showPublishReview, setShowPublishReview] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [missingAspectsWarning, setMissingAspectsWarning] = useState<string[] | null>(null);
  const [storeCategoryWarning, setStoreCategoryWarning] = useState<string | null>(null);
  // Public eBay item URL for the listing that was just published — lets the
  // "eBay wants these fields" warning link straight to the live listing
  // instead of leaving the seller to go find it themselves. Comes straight
  // from /api/ebay/list's existing `url` field (already computed there from
  // the same listingId), not rebuilt here.
  const [listedUrl, setListedUrl] = useState<string | null>(null);
  const [needsConnect, setNeedsConnect] = useState(false);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [isHeavy, setIsHeavy] = useState(false);
  const [shippingCost, setShippingCost] = useState("");
  const [shippingMode, setShippingMode] = useState<ShippingMode>("free");
  const [customPrice, setCustomPrice] = useState("");
  // Cost basis -- what the seller paid to acquire this item. Purely
  // manual (nothing in the app can infer it), optional, used only by the
  // Sales page's "true profit" figure once this item sells. See
  // supabase-migrations/017 and src/lib/profit.ts.
  const [cost, setCost] = useState("");
  const [brand, setBrand] = useState("");
  const [size, setSize] = useState("");
  const [color, setColor] = useState("");
  // Store category: same pattern as batch-upload/drafts[id] -- a free
  // keyword match against the seller's real Store Categories runs on every
  // analysis automatically, upgraded by an AI pass if Settings -> "Store
  // category suggestions" -> AI suggestions is on. See
  // src/lib/store-category-match.ts.
  const [storeCategories, setStoreCategories] = useState<StoreCategoryLite[]>([]);
  const [storeCategoryId, setStoreCategoryId] = useState<string | null>(null);
  const [storeCategoryName, setStoreCategoryName] = useState<string | null>(null);
  const [storeCategoryPickerOpen, setStoreCategoryPickerOpen] = useState(false);
  const [aiStoreCategorySuggestions, setAiStoreCategorySuggestions] = useState(false);
  const [photoEditorLayout, setPhotoEditorLayout] = useState<"carousel" | "grid">("carousel");
  const [suggestingStoreCategory, setSuggestingStoreCategory] = useState(false);
  const autosaveTimer = useRef<number | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        setAiStoreCategorySuggestions(!!data.aiStoreCategorySuggestions);
        setPhotoEditorLayout(data.photoEditorLayout === "grid" ? "grid" : "carousel");
        if (data.defaultShippingMode === "calculated") setShippingMode("calculated");
      })
      .catch(() => {});
    fetch("/api/ebay/store-categories")
      .then((r) => r.json())
      .then((data) => setStoreCategories(Array.isArray(data.categories) ? data.categories : []))
      .catch(() => {});
  }, []);

  const newListingSignature = JSON.stringify({
    photos: photos.map((photo) => ({ id: photo.id, uploadedUrl: photo.uploadedUrl, label: photo.label })),
    title, condition, flaws, customPrice, cost, brand, size, color,
    storeCategoryId, storeCategoryName, isHeavy, shippingCost, shippingMode,
    aiResult, result,
  });

  useEffect(() => {
    if (!savedDraftId || loading || listStatus === "listing") return;
    if (autosaveTimer.current !== null) window.clearTimeout(autosaveTimer.current);
    autosaveTimer.current = window.setTimeout(() => {
      void handleSaveDraft();
    }, 900);
    return () => {
      if (autosaveTimer.current !== null) window.clearTimeout(autosaveTimer.current);
    };
  }, [newListingSignature, savedDraftId, loading, listStatus]);

  async function requestStoreCategoryAi(item: {
    title: string | null;
    itemType?: string | null;
    brand: string | null;
    color: string | null;
    description?: string | null;
  }): Promise<StoreCategoryLite | null> {
    const data = await apiFetch<{ categoryId: string | null; categoryPath: string | null }>(
      "/api/ebay/store-categories/suggest",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: item.title,
          itemType: item.itemType,
          brand: item.brand,
          color: item.color,
          description: item.description,
        }),
      }
    );
    if (!data.categoryId) return null;
    return (
      storeCategories.find((c) => c.id === data.categoryId) ??
      (data.categoryPath ? { id: data.categoryId, name: data.categoryPath, path: data.categoryPath } : null)
    );
  }

  const fileInput = useRef<HTMLInputElement | null>(null);
  const draggedPhoto = useRef<number | null>(null);
  const photoEditorRef = useRef<HTMLDivElement | null>(null);
  const dragPointer = useRef<{ x: number; y: number } | null>(null);
  const dragScrollFrame = useRef<number | null>(null);

  async function handleFileChange(file: File | undefined) {
    if (!file) return;

    try {
      const { dataUrl, mediaType } = await resizeImage(file);
      const base64 = dataUrl.split(",")[1];

      setPhotos((prev) => [
        ...prev,
        {
          id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
          data: base64,
          mediaType,
          previewUrl: dataUrl,
          label: prev.length === 0 ? "front" : prev.length === 1 ? "measure" : prev.length === 2 ? "flaw" : undefined,
        },
      ]);
    } catch (err) {
      setError(`Could not process image: ${(err as Error).message}`);
    }
  }

  function rememberPhotoChange(label: string) {
      setPhotoUndo(photos.map((photo) => ({ ...photo })));
      setPhotoUndoLabel(label);
    }

  function removePhoto(index: number) {
      rememberPhotoChange("Photo removed");
      setPhotos((prev) => prev.filter((_, i) => i !== index));
    }

  function movePhoto(from: number, to: number) {
      if (to < 0 || to >= photos.length || from === to) return;
      rememberPhotoChange("Photo reordered");
      setPhotos((prev) => {
        const next = [...prev];
        const [photo] = next.splice(from, 1);
        next.splice(to, 0, photo);
        return next;
      });
    }

    function movePhotoToSlot(from: number, slot: number) {
      const insertionIndex = slot > from ? slot - 1 : slot;
      if (insertionIndex === from || insertionIndex < 0 || insertionIndex >= photos.length) return;
      rememberPhotoChange("Photo reordered");
      setPhotos((prev) => {
        const next = [...prev];
        const [photo] = next.splice(from, 1);
        next.splice(insertionIndex, 0, photo);
        return next;
      });
    }

    function movePhotoDuringDrag(slot: number) {
      const from = draggedPhoto.current;
      if (from == null) return;
      const to = slot > from ? slot - 1 : slot;
      if (to === from || to < 0 || to >= photos.length) return;
      setPhotos((prev) => {
        const next = [...prev];
        const [photo] = next.splice(from, 1);
        next.splice(to, 0, photo);
        return next;
      });
      draggedPhoto.current = to;
    }

    function movePhotoAtPointer(x: number, y: number) {
      const cards = Array.from(photoEditorRef.current?.querySelectorAll<HTMLElement>("[data-photo-index]") ?? []);
      if (!cards.length) return;
      const target = cards.find((card) => {
        const rect = card.getBoundingClientRect();
        return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
      }) ?? cards.reduce((closest, card) => {
        const rect = card.getBoundingClientRect();
        const closestRect = closest.getBoundingClientRect();
        const distance = Math.hypot(x - (rect.left + rect.width / 2), y - (rect.top + rect.height / 2));
        const closestDistance = Math.hypot(x - (closestRect.left + closestRect.width / 2), y - (closestRect.top + closestRect.height / 2));
        return distance < closestDistance ? card : closest;
      });
      const index = Number(target.dataset.photoIndex);
      const rect = target.getBoundingClientRect();
      const slot = photoEditorLayout === "grid"
        ? (x < rect.left + rect.width / 2 ? index : index + 1)
        : (x < rect.left + rect.width / 2 ? index : index + 1);
      movePhotoDuringDrag(slot);
    }

    function stopPhotoAutoScroll() {
      if (dragScrollFrame.current !== null) cancelAnimationFrame(dragScrollFrame.current);
      dragScrollFrame.current = null;
      dragPointer.current = null;
    }

    function runPhotoAutoScroll() {
      const pointer = dragPointer.current;
      const scroller = photoEditorRef.current;
      if (!pointer || !scroller || photoEditorLayout !== "carousel") {
        dragScrollFrame.current = null;
        return;
      }
      const rect = scroller.getBoundingClientRect();
      const edge = 72;
      const distance = pointer.x < rect.left + edge
        ? pointer.x - (rect.left + edge)
        : pointer.x > rect.right - edge
          ? pointer.x - (rect.right - edge)
          : 0;
      if (distance !== 0) {
        scroller.scrollLeft += Math.sign(distance) * Math.min(18, Math.max(3, Math.abs(distance) / 3));
        movePhotoAtPointer(pointer.x, pointer.y);
      }
      dragScrollFrame.current = requestAnimationFrame(runPhotoAutoScroll);
    }

    function startPhotoAutoScroll(x: number, y: number) {
      dragPointer.current = { x, y };
      if (dragScrollFrame.current === null) dragScrollFrame.current = requestAnimationFrame(runPhotoAutoScroll);
    }

  function undoPhotoChange() {
      if (!photoUndo) return;
      setPhotos(photoUndo);
      setPhotoUndo(null);
      setPhotoUndoLabel("");
    }

  function setPhotoLabel(index: number, label: PhotoItem["label"]) {
      setPhotos((prev) => prev.map((photo, i) => (i === index ? { ...photo, label } : photo)));
  }

  async function fetchPricing(pTitle: string, pBrand: string | undefined, pCondition: Condition, pImage?: string, pIsHeavy?: boolean, pItemType?: string, pSize?: string) {
    setPricingLoading(true);
    setResult(null);
    try {
      const data = await apiFetch<PriceSuggestion>("/api/pricing/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: pTitle, brand: pBrand, condition: pCondition, image: pImage, isHeavy: pIsHeavy, shippingMode, itemType: pItemType, size: pSize }),
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
    const images = photos.map((p) => ({
      data: p.data,
      mediaType: p.mediaType,
    }));

    if (images.length === 0) {
      fetchPricing(title, undefined, condition, photos.find((p) => p.label === "front")?.data ?? photos[0]?.data);
      return;
    }

    setLoading(true);
    const frontPhoto = photos.find((p) => p.label === "front")?.data ?? photos[0]?.data;

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

      // Store category: re-suggest fresh on every analysis, same as
      // brand/color/size above -- re-running Analyze is expected to
      // refresh the AI-derived fields, this is one of them.
      const keywordMatch =
        storeCategories.length > 0
          ? matchStoreCategoryByKeyword(
              { title: data.suggestedTitle, itemType: data.itemType, brand: data.brand },
              storeCategories
            )
          : null;
      setStoreCategoryId(keywordMatch?.id ?? null);
      setStoreCategoryName(keywordMatch?.path ?? null);
      if (aiStoreCategorySuggestions && storeCategories.length > 0) {
        setSuggestingStoreCategory(true);
        requestStoreCategoryAi({
          title: data.suggestedTitle,
          itemType: data.itemType,
          brand: data.brand,
          color: data.color,
          description: data.description,
        })
          .then((match) => {
            if (match) {
              setStoreCategoryId(match.id);
              setStoreCategoryName(match.path);
            }
          })
          .catch(() => {})
          .finally(() => setSuggestingStoreCategory(false));
      }

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
    // NOTE: this used to short-circuit with `if (savedDraftId) return
    // savedDraftId;` — meaning a second save (or the re-save that
    // handleListOnEbay does before listing) was a silent no-op that threw
    // away any edits made since the first save: re-running Analyze, adding
    // a photo, or fixing a typo after an initial save all got dropped, and
    // /api/ebay/list reads the draft straight from the database, so a
    // stale draft meant a stale live eBay listing. Now every call does a
    // real, full sync — POST once to create, PATCH every time after to
    // keep the stored draft caught up with the current on-screen state.
    setSaveStatus("saving");
    setPhotoUploadWarning(null);
    try {
      const uploadOutcomes = await Promise.all(
        photos.map(async (photo) => {
          if (photo.uploadedUrl) return photo.uploadedUrl;
          try {
            return await uploadThumbnail(photo.previewUrl);
          } catch (err) {
            console.error(`Photo upload failed (${photo.id}):`, (err as Error).message);
            return { failedId: photo.id };
          }
        })
      );
      const allPhotoUrls: string[] = [];
      const failedKeys: string[] = [];
      const uploadedById = new Map<string, string>();
      uploadOutcomes.forEach((outcome, i) => {
        if (typeof outcome === "string") {
          allPhotoUrls.push(outcome);
          uploadedById.set(photos[i].id, outcome);
        } else if (outcome) {
          failedKeys.push(photos[i].label ?? `photo ${i + 1}`);
        }
      });
      if (uploadedById.size > 0) {
        setPhotos((prev) => prev.map((photo) => {
          const uploadedUrl = uploadedById.get(photo.id);
          return uploadedUrl ? { ...photo, uploadedUrl } : photo;
        }));
      }
      if (failedKeys.length > 0) {
        setPhotoUploadWarning(
          `Saved, but ${failedKeys.length} photo${failedKeys.length > 1 ? "s" : ""} (${failedKeys.join(", ")}) failed to upload. Re-add ${failedKeys.length > 1 ? "them" : "it"} before listing.`
        );
      } else {
        setPhotoUploadWarning(null);
      }

      const { suggestedPrice, avgSold, activeRangeLow, activeRangeHigh, sellOdds } = result ?? {};
      const finalPrice = suggestedPrice ?? (customPrice ? Number(customPrice) : null);

      const payload = {
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
        // Send the complete ordered list every time. URLs are cached on each
        // local photo, so saving/listing again never uploads the same image.
        photoUrls: allPhotoUrls,
        thumbnailUrl: allPhotoUrls[0] ?? null,
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
        storeCategoryId,
        storeCategoryName,
        costBasis: cost ? Number(cost) : null,
        isHeavy,
        shippingMode,
        shippingCost: shippingMode === "buyer_pays" && shippingCost ? Number(shippingCost) : null,
      };

      let id = savedDraftId;
      if (id) {
        const data = await apiFetch<{ draft?: { updated_at?: string } }>(`/api/drafts/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, expectedUpdatedAt: draftUpdatedAt.current }),
        });
        draftUpdatedAt.current = data.draft?.updated_at ?? draftUpdatedAt.current;
      } else {
        const data = await apiFetch<{ draft?: { id?: string | null; updated_at?: string } }>("/api/drafts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        id = data.draft?.id ?? null;
        draftUpdatedAt.current = data.draft?.updated_at ?? null;
      }

      setSavedDraftId(id);
      setSaveStatus("saved");
      return id;
    } catch {
      setSaveStatus("error");
      return null;
    }
  }

  async function handleListOnEbay() {
    if (photoUploadWarning) {
      setListError("Some photos have not uploaded yet. Retry saving until all photos finish uploading before listing.");
      setListStatus("error");
      return;
    }
    const readiness = getListingReadiness({
      photoCount: photos.length,
      title,
      price: result?.suggestedPrice ?? (customPrice ? Number(customPrice) : null),
      condition,
      shippingMode,
    });
    if (!readiness.ready) {
      setListError(`Before listing: ${readiness.blockers.join(" • ")}`);
      setListStatus("error");
      return;
    }
    const finalPrice = result?.suggestedPrice ?? (customPrice ? Number(customPrice) : null);
    setShowPublishReview(true);
  }

  async function handlePublish() {
    const finalPrice = result?.suggestedPrice ?? (customPrice ? Number(customPrice) : null);
    setShowPublishReview(false);
    setListStatus("listing");
    setListError(null);
    setNeedsConnect(false);
    setNeedsReconnect(false);
    try {
      const draftId = await handleSaveDraft();
      if (!draftId) throw new Error("Could not save draft before listing");
      const data = await apiFetch<{ connect?: boolean; reconnect?: boolean; error?: string; missingRequiredAspects?: string[]; storeCategoryWarning?: string; url?: string | null }>("/api/ebay/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId, shippingMode, isHeavy, shippingCost: shippingMode === "buyer_pays" && shippingCost ? parseFloat(shippingCost) : undefined }),
      });
      if (data.connect) { setNeedsConnect(true); throw new Error(data.error ?? "Failed to list on eBay"); }
      if (data.reconnect) { setNeedsReconnect(true); throw new Error(data.error ?? "Failed to list on eBay"); }
      setListStatus("listed");
      const missingRequiredAspects = data.missingRequiredAspects ?? [];
      setMissingAspectsWarning(missingRequiredAspects.length > 0 ? missingRequiredAspects : null);
      setStoreCategoryWarning(data.storeCategoryWarning ?? null);
      setListedUrl(data.url ?? null);
      window.dispatchEvent(new Event("listflow:counts-changed"));
      // No auto-redirect here anymore — a seller doing several items in a
      // row in this single-item flow needs a way to stay put and start the
      // next one instead of being bounced to /store after every listing.
      // The success panel below offers both "List another item" (reset,
      // below) and "Go to Store" explicitly.
    } catch (err) {
      setListStatus("error");
      setListError((err as Error).message);
    }
  }

  async function handleSaveDraftAndRedirect() {
    const id = await handleSaveDraft();
    if (id) setTimeout(() => router.push("/drafts"), 1200);
  }

  // Clears every per-item field back to a blank form so a seller can go
  // straight into the next item after a successful listing, without
  // navigating away and losing the page (see handleListOnEbay above).
  // Deliberately does NOT touch storeCategories/aiStoreCategorySuggestions —
  // those are account-level settings fetched once on mount, not per-item.
  function resetForOtherItem() {
    setPhotos([]);
    if (fileInput.current) fileInput.current.value = "";
    setPhotoUndo(null);
    setPhotoUndoLabel("");
    setTitle("");
    setCondition("Excellent used");
    setFlaws("");
    setResult(null);
    setAiResult(null);
    setError(null);
    setSaveStatus("idle");
    setSavedDraftId(null);
    setPhotoUploadWarning(null);
    setListStatus("idle");
    setListError(null);
    setMissingAspectsWarning(null);
    setStoreCategoryWarning(null);
    setListedUrl(null);
    setNeedsConnect(false);
    setNeedsReconnect(false);
    setIsHeavy(false);
    setShippingCost("");
    setShippingMode("free");
    setCustomPrice("");
    setCost("");
    setBrand("");
    setSize("");
    setColor("");
    setStoreCategoryId(null);
    setStoreCategoryName(null);
    setStoreCategoryPickerOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <main className="min-h-screen max-w-md mx-auto px-5 pt-6 pb-24">
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/dashboard"
          className="w-[34px] h-[34px] rounded-[11px] flex items-center justify-center flex-none"
          style={{ background: "var(--glass)", border: "1px solid var(--glass-line)" }}
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <h1 className="text-xl font-medium">New listing</h1>
      </div>

      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-[var(--text-secondary)]">Photos ({photos.length})</p>
          <button type="button" className="btn text-xs py-1.5 px-2.5" onClick={() => fileInput.current?.click()}>
            <Plus className="w-3.5 h-3.5" /> Add photo
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              void handleFileChange(e.target.files?.[0]);
              e.currentTarget.value = "";
            }}
          />
        </div>
        {photos.length === 0 ? (
          <button type="button" onClick={() => fileInput.current?.click()} className="card border-dashed w-full py-8 flex flex-col items-center gap-2">
            <Camera className="w-6 h-6 text-accent" />
            <span className="text-sm text-[var(--text-secondary)]">Add your first photo</span>
          </button>
        ) : (
          <div
            ref={photoEditorRef}
            className={photoEditorLayout === "grid" ? "grid grid-cols-3 gap-3" : "flex gap-3 overflow-x-auto pb-2 snap-x"}
          >
            {photos.map((photo, index) => (
              <PhotoCard
                key={photo.id}
                photo={photo}
                index={index}
                count={photos.length}
                onRemove={() => removePhoto(index)}
                onMove={(to) => movePhoto(index, to)}
                onReorder={(from, to) => movePhoto(from, to)}
                onLabelChange={(label) => setPhotoLabel(index, label)}
                onDragStart={() => { rememberPhotoChange("Photo reordered"); draggedPhoto.current = index; }}
                onPreviewReorder={(x, y) => {
                  startPhotoAutoScroll(x, y);
                  movePhotoAtPointer(x, y);
                }}
                onDrop={(slot) => {
                  draggedPhoto.current = null;
                  stopPhotoAutoScroll();
                }}
              />
            ))}
          </div>
        )}
        {photoUndo && (
          <button type="button" onClick={undoPhotoChange} className="mt-1 text-xs flex items-center gap-1 text-[var(--accent)]">
            <Undo2 className="w-3.5 h-3.5" /> Undo {photoUndoLabel.toLowerCase()}
          </button>
        )}
      </div>

      <AIDisclaimer className="mb-4" />

      <div className="flex flex-col gap-3 mb-4">
        <div>
          <input
            className="input"
            maxLength={80}
            placeholder="Title (auto-filled by AI)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <p className="mt-1 text-right text-[11px] text-[var(--text-tertiary)]">{title.length}/80</p>
        </div>

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

        <div>
          <label className="text-xs text-[var(--text-secondary)] mb-1 block">Shipping</label>
          <select
            className="input w-full"
            value={shippingMode}
            onChange={(e) => {
              const mode = e.target.value as ShippingMode;
              setShippingMode(mode);
              setIsHeavy(mode === "buyer_pays");
              if (mode !== "buyer_pays") setShippingCost("");
            }}
          >
            <option value="free">Free shipping (you pay)</option>
            <option value="calculated">Calculated shipping (buyer pays based on location)</option>
            <option value="buyer_pays">Flat-rate shipping (legacy heavy-item option)</option>
          </select>
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
        <div className="card p-3 mb-4 text-sm" style={{ color: "var(--danger)" }}>
          {error}
        </div>
      )}

      {showPublishReview && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 p-4 sm:items-center">
          <div className="card w-full max-w-md p-4" role="dialog" aria-modal="true" aria-labelledby="publish-review-title">
            <div className="flex items-center justify-between mb-3">
              <h2 id="publish-review-title" className="text-lg font-medium">Review before publishing</h2>
              <button type="button" onClick={() => setShowPublishReview(false)} aria-label="Close publish review" className="p-1">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex gap-3 mb-4">
              {photos[0]?.previewUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photos[0].previewUrl} alt="" className="w-20 h-20 rounded-lg object-cover" />
              )}
              <div className="min-w-0">
                <p className="font-medium truncate">{title || "Untitled listing"}</p>
                <p className="text-sm text-[var(--text-secondary)]">{photos.length} photo{photos.length === 1 ? "" : "s"}</p>
                <p className="text-sm font-medium">${result?.suggestedPrice == null && !customPrice ? "No price" : (result?.suggestedPrice ?? Number(customPrice)).toFixed(2)}</p>
              </div>
            </div>
            <div className="rounded-lg p-3 mb-4 text-sm" style={{ background: "var(--glass)" }}>
              <p><strong>Condition:</strong> {condition || "Not set"}</p>
              <p><strong>Shipping:</strong> {shippingMode === "free" ? "Free shipping" : shippingMode === "calculated" ? "Calculated shipping" : `Buyer pays${shippingCost ? ` ($${Number(shippingCost).toFixed(2)})` : ""}`}</p>
              {cost && <p><strong>Cost basis:</strong> ${Number(cost).toFixed(2)}</p>}
              {missingAspectsWarning?.length ? <p className="mt-2" style={{ color: "var(--warning-border)" }}><strong>Warning:</strong> missing eBay specifics may be requested after publishing.</p> : null}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowPublishReview(false)} className="btn flex-1">Back to edit</button>
              <button type="button" onClick={() => void handlePublish()} disabled={listStatus === "listing"} className="btn btn-primary flex-1">
                {listStatus === "listing" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {listStatus === "listing" ? "Publishing..." : "Publish on eBay"}
              </button>
            </div>
          </div>
        </div>
      )}

      {aiResult && (
        <div className="card p-4 mb-4">
          <p className="text-xs text-[var(--text-secondary)] mb-2 flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5 text-accent" />
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
          {storeCategories.length > 0 && (
            <div className="relative mt-3 pt-3 border-t border-[var(--border)]">
              <p className="text-[11px] text-[var(--text-tertiary)] mb-1">
                Store category{suggestingStoreCategory ? " (getting AI suggestion...)" : ""}
              </p>
              <button
                type="button"
                onClick={() => setStoreCategoryPickerOpen((prev) => !prev)}
                className="tap text-xs font-semibold rounded-lg px-3 py-2 border w-full text-left truncate"
                style={
                  storeCategoryId
                    ? { background: "var(--accent-tint)", borderColor: "var(--accent)", color: "var(--accent)" }
                    : { background: "var(--glass)", borderColor: "var(--glass-line)", color: "var(--text-secondary)" }
                }
              >
                {storeCategoryName ?? "No store category — tap to pick"}
              </button>
              {storeCategoryPickerOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setStoreCategoryPickerOpen(false)} />
                  <div
                    className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto card p-1"
                    style={{ background: "var(--bg-surface)" }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setStoreCategoryId(null);
                        setStoreCategoryName(null);
                        setStoreCategoryPickerOpen(false);
                      }}
                      className="tap w-full text-left text-xs px-2 py-1.5 rounded"
                    >
                      — None —
                    </button>
                    {storeCategories.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setStoreCategoryId(c.id);
                          setStoreCategoryName(c.path);
                          setStoreCategoryPickerOpen(false);
                        }}
                        className="tap w-full text-left text-xs px-2 py-1.5 rounded truncate"
                        style={storeCategoryId === c.id ? { background: "var(--accent-tint)", color: "var(--accent)" } : undefined}
                      >
                        {c.path}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
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

              <div className="mb-3">
                <label className="text-xs text-[var(--text-secondary)] mb-1 block">
                  Cost (what you paid) — optional
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--text-secondary)]">$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={cost}
                    onChange={(e) => setCost(e.target.value)}
                    className="input w-full pl-6"
                  />
                </div>
              </div>

              {listError && (
                <p className="text-xs mb-2" style={{ color: "var(--danger)" }}>
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
                <p className="text-xs mb-2" style={{ color: "var(--danger)" }}>{photoUploadWarning}</p>
              )}
              {missingAspectsWarning && missingAspectsWarning.length > 0 && (
                <p className="text-xs mb-2" style={{ color: "var(--warning-border)" }}>
                  Listed, but eBay wants these fields for this category and the AI
                  couldn&apos;t tell: <strong>{missingAspectsWarning.join(", ")}</strong>.
                  {listedUrl && (
                    <>
                      {" "}
                      <a href={listedUrl} target="_blank" rel="noopener noreferrer" className="underline font-medium">
                        Open the listing on eBay to add them →
                      </a>
                    </>
                  )}
                </p>
              )}
              {storeCategoryWarning && (
                <p className="text-xs mb-2" style={{ color: "var(--warning-border)" }}>{storeCategoryWarning}</p>
              )}
              {listStatus === "listed" ? (
                <div className="flex gap-2">
                  <button className="btn flex-1" onClick={resetForOtherItem}>
                    <Sparkles className="w-4 h-4" />
                    List another item
                  </button>
                  <button className="btn btn-primary flex-1" onClick={() => router.push("/store")}>
                    <Check className="w-4 h-4" />
                    Done — go to Store
                  </button>
                </div>
              ) : (
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
                    disabled={listStatus === "listing"}
                  >
                    {listStatus === "listing" ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4" />
                    )}
                    {listStatus === "listing" ? "Listing..." : "List on eBay"}
                  </button>
                </div>
              )}
            </>
          ) : null}
        </div>
      )}
    </main>
  );
}

function PhotoCard({
  photo,
  index,
  count,
  onRemove,
  onMove,
  onReorder,
  onPreviewReorder,
  onLabelChange,
  onDragStart,
  onDrop,
}: {
  photo: PhotoItem;
  index: number;
  count: number;
  onRemove: () => void;
  onMove: (to: number) => void;
  onReorder: (from: number, to: number) => void;
  onPreviewReorder: (x: number, y: number) => void;
  onLabelChange: (label: PhotoItem["label"]) => void;
  onDragStart: () => void;
  onDrop: (slot: number) => void;
}) {
  const dragTimer = useRef<number | null>(null);
  const dragTarget = useRef<HTMLDivElement | null>(null);
  const startPoint = useRef<{ x: number; y: number } | null>(null);
  const dropIndex = useRef<number | null>(null);
  const [touchDragging, setTouchDragging] = useState(false);
  const [hoverSlot, setHoverSlot] = useState<number | null>(null);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    startPoint.current = { x: e.clientX, y: e.clientY };
    dragTarget.current = e.currentTarget;
    dropIndex.current = index;
    dragTimer.current = window.setTimeout(() => {
      setTouchDragging(true);
      dragTarget.current?.setPointerCapture(e.pointerId);
    }, 350);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (dragTimer.current !== null && startPoint.current) {
      const moved = Math.abs(e.clientX - startPoint.current.x) > 8 || Math.abs(e.clientY - startPoint.current.y) > 8;
      if (moved) {
        window.clearTimeout(dragTimer.current);
        dragTimer.current = null;
      }
    }
    if (!touchDragging) return;
    e.preventDefault();
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-photo-index]");
    if (target) {
      const targetIndex = Number(target.dataset.photoIndex);
      dropIndex.current = targetIndex;
      onPreviewReorder(e.clientX, e.clientY);
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (dragTimer.current !== null) window.clearTimeout(dragTimer.current);
    if (touchDragging && dropIndex.current !== null) onDrop(dropIndex.current);
    if (dragTarget.current?.hasPointerCapture(e.pointerId)) dragTarget.current.releasePointerCapture(e.pointerId);
    dragTimer.current = null;
    dragTarget.current = null;
    startPoint.current = null;
    dropIndex.current = null;
    setTouchDragging(false);
  }

  return (
    <div
      data-photo-index={index}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className={`card flex-none w-44 snap-start overflow-hidden relative${touchDragging ? " opacity-60 scale-95" : ""}`}
      style={{ touchAction: touchDragging ? "none" : "pan-x" }}
    >
      {hoverSlot === index && <div className="absolute left-0 top-0 bottom-0 w-1 rounded-full bg-[var(--accent)] z-10" />}
      <div className="aspect-square relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo.previewUrl} alt={photo.label ?? `Photo ${index + 1}`} className="absolute inset-0 w-full h-full object-cover" draggable={false} />
        <div
          role="button"
          tabIndex={0}
          aria-label={`Hold and drag photo ${index + 1} to reorder`}
          title="Hold and drag to reorder"
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/65 p-3 text-white cursor-grab touch-none"
          onPointerDown={(e) => { e.stopPropagation(); onDragStart(); onPointerDown(e); }}
          onPointerMove={(e) => { e.stopPropagation(); onPointerMove(e); }}
          onPointerUp={(e) => { e.stopPropagation(); onPointerUp(e); }}
          onPointerCancel={(e) => { e.stopPropagation(); onPointerUp(e); }}
        >
          <GripVertical className="w-5 h-5" />
        </div>
        <span className="absolute top-1 left-1 rounded bg-black/60 text-white text-[10px] px-1.5 py-0.5">
          {index + 1}
        </span>
        <button type="button" aria-label="Delete photo" onClick={onRemove} className="absolute top-1 right-1 rounded-full bg-white/90 p-1">
          <Trash2 className="w-3.5 h-3.5 text-red-600" />
        </button>
      </div>
      <div className="p-2">
        <select
          aria-label={`Label photo ${index + 1}`}
          className="input text-xs py-1 w-full"
          value={photo.label ?? ""}
          onChange={(e) => onLabelChange((e.target.value || undefined) as PhotoItem["label"])}
        >
          <option value="">No label</option>
          <option value="front">Front</option>
          <option value="measure">Measure</option>
          <option value="flaw">Flaw</option>
        </select>
        <div className="flex justify-between mt-2">
          <button type="button" disabled={index === 0} onClick={() => onMove(index - 1)} aria-label="Move photo left" className="p-1 disabled:opacity-30">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-[10px] text-[var(--text-tertiary)] self-center">drag to reorder</span>
          <button type="button" disabled={index === count - 1} onClick={() => onMove(index + 1)} aria-label="Move photo right" className="p-1 disabled:opacity-30">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
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
        background: highlight ? "color-mix(in srgb, var(--success) 14%, var(--bg-page))" : "var(--bg-page)",
      }}
    >
      <p
        className="text-[11px]"
        style={{ color: highlight ? "var(--success)" : "var(--text-secondary)" }}
      >
        {label}
      </p>
      <p
        className="text-sm font-medium"
        style={{ color: highlight ? "var(--success)" : "var(--text-primary)" }}
      >
        {value}
      </p>
    </div>
  );
}
