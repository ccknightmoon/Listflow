"use client";

import { useState, useRef, useEffect } from "react";
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
  Images,
  ListChecks,
  ArrowUpToLine,
  Scissors,
  AlertTriangle,
} from "lucide-react";
import { getPriceSuggestion, Condition, PriceSuggestion } from "@/lib/pricing";
import { uploadThumbnail } from "@/lib/storage";
import { apiFetch } from "@/lib/api";
import { AiResult as BaseAiResult, formatMeasurements } from "@/lib/ai-result";
import { matchStoreCategoryByKeyword, StoreCategoryLite } from "@/lib/store-category-match";
import { estimateIsHeavy, estimateShipping, type ShippingMode } from "@/lib/shipping";
import AIDisclaimer from "@/components/AIDisclaimer";
import { useAiUsageWarning } from "@/lib/use-ai-usage-warning";
import { getListingReadiness } from "@/lib/listing-readiness";

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
  // Set on the placeholder rows handleAnalyzeBatch fills `results` with
  // before an item has actually been analyzed, so its card can show a
  // live "still analyzing" state instead of blank fields the instant the
  // results screen appears.
  pending?: boolean;
}

interface Thumbnail {
  data: string;
  mediaType: string;
}

type Step = "upload" | "grouping" | "review" | "results";
type SaveStatus = "idle" | "saving" | "saved" | "auto" | "error";
// "auto" marks an item that has a real draft row in the database but
// hasn't been explicitly confirmed by the seller yet — see the
// auto-save effect below handleSaveDraft. It behaves like "idle" for
// every "still needs a save" computation (it is not locked/disabled,
// it still counts toward "unsaved"), and only the explicit "saved"
// value locks the review fields.

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
// Was 100 -- too tight for the app's own "list 40 items in a session"
// goal once you do the math: 40 items x even a modest 3 real photos each
// is 120, past the old cap before a seller could even finish uploading.
// The item-divider marker photos (see buildGroupsFromMarkers/
// buildGroupsFromManualDividers above) make this worse, not better -- a
// marker adds one more photo per item on top of the real ones. Raised to
// 200 (40 items x up to 5 photos each, comfortable headroom past
// MAX_PHOTOS_PER_ITEM below). Nothing downstream needed to change to
// support this: grouping/analysis/save/listing were already chunked or
// concurrency-pooled rather than looping the whole batch in one shot --
// see LARGE_BATCH_NOTICE_THRESHOLD below for the one real user-facing
// consequence of a bigger batch (it takes longer, not that it breaks).
const MAX_PHOTOS = 200;
const MAX_PHOTOS_PER_ITEM = 6;
const GROUPING_CHUNK_SIZE = 15;
// Past this many photos, AI grouping alone needs 5+ sequential chunks
// (see DELAY_BETWEEN_CHUNKS_MS below) even before analysis starts -- long
// enough that a seller deserves a heads-up before they tap "Group photos"
// and watch a progress bar for a while, instead of just finding out.
// Manual/auto-detected dividers skip AI grouping entirely regardless of
// batch size, so this is purely about setting expectations, never a
// block.
const LARGE_BATCH_NOTICE_THRESHOLD = 60;
// Was 1500ms — purely a defensive buffer against OpenAI's per-minute
// rate limit between grouping chunks. The server already detects a real
// 429 and backs off on its own (RATE_LIMIT_DELAY_MS in
// /api/group-photos), so this only needs to be a light pace-setter, not
// a second safety net — a big batch (60-100 photos, 4-6 chunks) used to
// lose 6-9 extra seconds here for no benefit on a run that never got
// rate-limited.
const DELAY_BETWEEN_CHUNKS_MS = 300;

// Kept in sync with AI_USAGE_LIMIT_MESSAGE in src/lib/ai-usage.ts. Used
// only to recognize a cap-triggered item failure in handleAnalyzeBatch
// below (so one clear banner can summarize a batch that ran into the cap,
// instead of the same message just repeating on every affected item's
// card) -- not imported directly from ai-usage.ts so this client bundle
// doesn't pull in that file's server-only Supabase service-role client.
const AI_CAP_MESSAGE = "You've reached this month's AI usage limit. It resets on the 1st.";

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

// Builds groups from photo indices the seller explicitly tapped as "this
// is my SKU/number photo -- end this item here" on the upload screen.
// Same exclusion rule as buildGroupsFromMarkers below: the tapped photo is
// treated as a throwaway marker (a card, tag, or bag shot with the item's
// number on it), not real item content, so it's left out of the group it
// closes -- the seller never has to remember to delete it before listing.
function buildGroupsFromManualDividers(dividerIndices: Set<number>, totalPhotos: number): number[][] {
  const sorted = Array.from(dividerIndices).sort((a, b) => a - b);
  const groups: number[][] = [];
  let start = 0;
  for (const d of sorted) {
    if (d < start || d >= totalPhotos) continue;
    if (d > start) {
      groups.push(Array.from({ length: d - start }, (_, k) => start + k));
    }
    start = d + 1;
  }
  if (start < totalPhotos) {
    groups.push(Array.from({ length: totalPhotos - start }, (_, k) => start + k));
  }
  return groups;
}

// Builds groups from AI-detected number-marker photos (Settings -> "Batch
// upload: item dividers" -> On). The marker photo itself is a throwaway
// (a card/tag/bag shot, not the item), so unlike a manual divider it is
// EXCLUDED from the group it closes rather than kept as that item's last
// photo -- see /api/detect-item-dividers. Also returns which group (by
// index into the returned array) each marker's code belongs to, so the
// caller can pre-fill that item's SKU field.
function buildGroupsFromMarkers(
  markers: { index: number; code: string }[],
  totalPhotos: number
): { groups: number[][]; skuByGroupIndex: Record<number, string> } {
  const sorted = [...markers].sort((a, b) => a.index - b.index);
  const groups: number[][] = [];
  const skuByGroupIndex: Record<number, string> = {};
  let start = 0;
  for (const marker of sorted) {
    const d = marker.index;
    if (d < start || d >= totalPhotos) continue;
    if (d > start) {
      groups.push(Array.from({ length: d - start }, (_, k) => start + k));
      skuByGroupIndex[groups.length - 1] = marker.code;
    }
    start = d + 1;
  }
  if (start < totalPhotos) {
    groups.push(Array.from({ length: totalPhotos - start }, (_, k) => start + k));
  }
  return { groups, skuByGroupIndex };
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
  const [saveErrors, setSaveErrors] = useState<Record<number, string>>({});
  const [photoUploadWarnings, setPhotoUploadWarnings] = useState<Record<number, string>>({});
  const [savingAll, setSavingAll] = useState(false);
  const [draftIds, setDraftIds] = useState<Record<number, string>>({});
  const [listStatus, setListStatus] = useState<Record<number, "idle" | "saving" | "listing" | "listed" | "error">>({});
  const [listErrors, setListErrors] = useState<Record<number, string>>({});
  const [listMissingAspects, setListMissingAspects] = useState<Record<number, string[]>>({});
  const [listStoreCategoryWarnings, setListStoreCategoryWarnings] = useState<Record<number, string>>({});
  // Public eBay item URL per listed item, straight from /api/ebay/list's
  // existing `url` field — lets the "eBay wants these fields" warning below
  // link directly to that specific listing instead of leaving the seller to
  // go find it themselves. Same pattern as new-listing/page.tsx.
  const [listedUrls, setListedUrls] = useState<Record<number, string>>({});
  const [needsEbayConnect, setNeedsEbayConnect] = useState(false);
  const [needsEbayReconnect, setNeedsEbayReconnect] = useState(false);
  const [customPrices, setCustomPrices] = useState<Record<number, string>>({});
  // cost_basis per item -- what the seller paid, optional (migration 017, src/lib/profit.ts)
  const [costs, setCosts] = useState<Record<number, string>>({});
  const [customSkus, setCustomSkus] = useState<Record<number, string>>({});
  const [heavyItems, setHeavyItems] = useState<Record<number, boolean>>({});
  const [shippingCosts, setShippingCosts] = useState<Record<number, string>>({});
  const [shippingModes, setShippingModes] = useState<Record<number, ShippingMode>>({});
  const [defaultShippingMode, setDefaultShippingMode] = useState<ShippingMode>("free");
  const [listingAll, setListingAll] = useState(false);
  const [listingAllProgress, setListingAllProgress] = useState<{ done: number; total: number } | null>(null);
  const [analyzingProgress, setAnalyzingProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [groupingProgress, setGroupingProgress] = useState<string>("");
  // Photo indices the seller tapped as "this is my SKU/number photo" on
  // the upload screen (Scissors button on each thumbnail) -- excluded from
  // the listing photos, same as an AI-detected marker. Any non-empty set
  // here always wins over both AI grouping paths in handleGroupPhotos --
  // it's the most explicit signal available, costs nothing, and can't be
  // wrong the way an AI guess can.
  const [manualDividers, setManualDividers] = useState<Set<number>>(new Set());
  // Settings -> "Batch upload: item dividers" -> On. Fetched once on
  // mount; see /api/detect-item-dividers and buildGroupsFromMarkers above.
  const [autoDetectDividers, setAutoDetectDividers] = useState(false);
  // Settings -> "Store category suggestions" -> AI suggestions. Fetched
  // once on mount, same as autoDetectDividers above. The free keyword
  // match (matchStoreCategoryByKeyword) always runs regardless of this --
  // it only gates the extra per-item AI call. See
  // /api/ebay/store-categories/suggest.
  const [aiStoreCategorySuggestions, setAiStoreCategorySuggestions] = useState(false);
  // The seller's real eBay Store Category list, fetched once on mount from
  // /api/ebay/store-categories -- empty if eBay isn't connected yet or the
  // seller hasn't set up any Store Categories, in which case the picker
  // simply doesn't render (nothing to suggest or choose from).
  const [storeCategories, setStoreCategories] = useState<StoreCategoryLite[]>([]);
  // Per-item store category choice, keyed by item index. undefined = not
  // suggested/picked yet; null = explicitly "no category". Seeded by the
  // free keyword match right after analysis, upgraded by the AI pass if
  // that setting is on and it finds a match, and always overridable by
  // hand via the chip next to each item's SKU field below.
  const [storeCategoryChoice, setStoreCategoryChoice] = useState<Record<number, StoreCategoryLite | null>>({});
  // Which item's store-category dropdown is currently open (at most one at
  // a time), or null if none.
  const [storeCategoryPickerOpen, setStoreCategoryPickerOpen] = useState<number | null>(null);
  // Bulk-edit selection on the results screen — lets a seller set condition
  // or heavy-item shipping across many items at once instead of one row at
  // a time, the single most-requested gap found in the "list 40 a day"
  // workflow audit. Only items that haven't been saved/listed yet are
  // selectable, matching every per-item control's own disabled={saveStatus[i] === "saved"}
  // rule below — editing a value that's already locked in on eBay would be
  // silently meaningless.
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [bulkCondition, setBulkCondition] = useState<Condition>(CONDITIONS[2]);
  const [bulkHeavy, setBulkHeavy] = useState(false);
  const [bulkShippingCost, setBulkShippingCost] = useState("");
  // Bulk store category -- holds the picked category's id (a <select>
  // needs a string value); resolved back to the real StoreCategoryLite
  // object from `storeCategories` at apply time. "" means "— None —".
  const [bulkStoreCategoryId, setBulkStoreCategoryId] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false); // bulk-edit panel accordion — starts collapsed per mock, opened manually
  const fileInput = useRef<HTMLInputElement | null>(null);
  // Indices the auto-save effect (below handleSaveDraft) has already
  // persisted, so it never re-saves an item just because `results`
  // changed again for an unrelated reason (a pricing lookup landing).
  const autoSavedForIndex = useRef<Set<number>>(new Set());
  const autoSavingForIndex = useRef<Set<number>>(new Set());
  // Supabase Storage URL each photo slot has already uploaded to, keyed by
  // photo index (not group/item index -- a photo's own data never changes
  // once picked, only which item it belongs to). handleSaveDraft now runs
  // repeatedly per item -- once silently right after analysis, again on an
  // explicit "Save draft", again inside handleListOnEbay's internal
  // re-save -- and before this cache existed every one of those re-ran the
  // full photo upload for the whole group. Across a real batch that meant
  // the same unchanged photos crossing the network 2-3x each for nothing.
  const uploadedPhotoUrls = useRef<Record<number, string>>({});

  // "Add a photo to this item" during review — lets someone patch in a
  // shot they missed on the first upload without starting the whole
  // batch over. One shared hidden input; addPhotoTargetGroup remembers
  // which group's "+" tile was tapped so the picker's result lands there.
  const addPhotoInput = useRef<HTMLInputElement | null>(null);
  const [addPhotoTargetGroup, setAddPhotoTargetGroup] = useState<number | null>(null);

  // A one-slot undo for the review screen's delete buttons (a whole item
  // or a single photo) — snapshot the groups layout right before the
  // destructive edit so an accidental tap has a way back. Only ever
  // holds the most recent removal; a second delete just replaces it.
  const [undoGroups, setUndoGroups] = useState<number[][] | null>(null);
  const [undoLabel, setUndoLabel] = useState("");

  // This page doesn't render <BottomNav />, which is where the same
  // 75%-of-cap warning normally lives -- show it directly here instead,
  // since this is exactly where AI calls actually happen. See
  // src/lib/use-ai-usage-warning.ts.
  const { showWarning: showUsageWarning, message: usageWarningMessage } = useAiUsageWarning();

  // Checked once on load (not blocking anything) so a seller who isn't
  // connected to eBay finds out before spending an hour uploading/
  // reviewing a batch, not after clicking "List on eBay" on item 30 --
  // that discovery used to only happen at listing time, and reconnecting
  // then is a full-page OAuth redirect that loses all of this page's
  // in-memory review state. null = still checking, so the banner below
  // stays hidden rather than flashing a false "not connected" on load.
  const [ebayConnected, setEbayConnected] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        setAutoDetectDividers(!!data.autoDetectItemDividers);
        setAiStoreCategorySuggestions(!!data.aiStoreCategorySuggestions);
        if (data.defaultShippingMode === "calculated") setDefaultShippingMode("calculated");
      })
      .catch(() => {});
    fetch("/api/ebay/store-categories")
      .then((r) => r.json())
      .then((data) => setStoreCategories(Array.isArray(data.categories) ? data.categories : []))
      .catch(() => {});
    fetch("/api/ebay/connection-status")
      .then((r) => r.json())
      .then((data) => setEbayConnected(!!data.connected))
      .catch(() => {}); // Unknown on failure -- stays null, banner stays hidden rather than guessing.
  }, []);

  // Toggles photoIndex as the SKU/number photo that ends the current item
  // on the upload screen. Any non-empty manualDividers set makes
  // handleGroupPhotos skip AI grouping entirely, and every tapped photo is
  // excluded from its item's listing photos -- see
  // buildGroupsFromManualDividers above.
  function toggleDivider(photoIndex: number) {
    setManualDividers((prev) => {
      const next = new Set(prev);
      if (next.has(photoIndex)) next.delete(photoIndex);
      else next.add(photoIndex);
      return next;
    });
  }

  async function handleFilesSelected(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setManualDividers(new Set());

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

  // Adds photos straight into an existing group during review — for a
  // shot that got left off the camera roll selection or just missed on
  // the first pass. Appended to `photos` rather than replacing it like
  // handleFilesSelected above, since the rest of the batch is already
  // grouped and must stay put.
  async function handleAddPhotosToGroup(gIdx: number, files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);

    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) {
      setError(`This batch is already at the ${MAX_PHOTOS}-photo limit.`);
      return;
    }
    const fileArray = Array.from(files).slice(0, room);

    try {
      const startIndex = photos.length;
      const resized = await Promise.all(
        fileArray.map(async (file) => {
          const { dataUrl, mediaType } = await resizeImage(file);
          return { data: dataUrl.split(",")[1], mediaType, previewUrl: dataUrl };
        })
      );
      const newIndices = resized.map((_, k) => startIndex + k);
      setPhotos((prev) => [...prev, ...resized]);
      setGroups((prev) => {
        const next = prev.map((g) => [...g]);
        next[gIdx] = [...next[gIdx], ...newIndices];
        return next;
      });
    } catch (err) {
      setError(`Could not add photo: ${(err as Error).message}`);
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

  async function handleRetryFailedListings() {
    const failedIndices = results
      .map((r, i) => ({ r, i }))
      .filter(({ r, i }) => !r.error && !r.pending && listStatus[i] === "error")
      .map(({ i }) => i);
    if (failedIndices.length === 0) return;
    setListingAll(true);
    setListingAllProgress({ done: 0, total: failedIndices.length });
    let cursor = 0;
    let done = 0;
    let retrySuccessCount = 0;
    async function worker() {
      while (cursor < failedIndices.length) {
        const index = failedIndices[cursor++];
        const succeeded = await handleListOnEbay(index);
        if (succeeded) retrySuccessCount++;
        done++;
        setListingAllProgress({ done, total: failedIndices.length });
      }
    }
    const concurrency = 2;
    await Promise.all(Array.from({ length: Math.min(concurrency, failedIndices.length) }, () => worker()));
    setListingAll(false);
    setListingAllProgress(null);
    const remainingFailures = failedIndices.length - retrySuccessCount;
    if (remainingFailures === 0) {
      setError(null);
    } else {
      setError(
        `${retrySuccessCount} failed listing${retrySuccessCount === 1 ? "" : "s"} recovered. ` +
        `${remainingFailures} still failed and can be retried below.`
      );
    }
  }

  async function handleSaveAllDrafts() {
    setSavingAll(true);
    const indices = results
      .map((_, i) => i)
      .filter((i) => !results[i].error && !results[i].pending && saveStatus[i] !== "saved");

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

    // Manual dividers are the most explicit signal available -- if the
    // seller tapped any, skip AI grouping entirely (free, instant, and
    // can't be mis-grouped) instead of the two AI-based paths below. Each
    // tapped photo is excluded from its item's listing photos, same as an
    // AI-detected marker -- see buildGroupsFromManualDividers.
    if (manualDividers.size > 0) {
      const finalGroups = buildGroupsFromManualDividers(manualDividers, photos.length);
      setManualDividers(new Set());
      setGroups(finalGroups);
      setStep("review");
      return;
    }

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

      if (autoDetectDividers) {
        // Settings -> "Batch upload: item dividers" -> On. Each chunk is
        // an independent per-photo classification (unlike the
        // similarity-grouping chunks below, no group can straddle a
        // chunk boundary), so chunks are safe to run concurrently instead
        // of strictly one after another.
        const chunks: { start: number; images: Thumbnail[] }[] = [];
        for (let start = 0; start < totalPhotos; start += GROUPING_CHUNK_SIZE) {
          chunks.push({ start, images: thumbnails.slice(start, start + GROUPING_CHUNK_SIZE) });
        }

        const DIVIDER_DETECT_CONCURRENCY = 3;
        const chunkMarkers: { index: number; code: string }[][] = new Array(chunks.length);
        let detectCursor = 0;
        async function detectWorker() {
          while (detectCursor < chunks.length) {
            const c = detectCursor++;
            const chunk = chunks[c];
            const data = await apiFetch<{ markers?: { index: number; code: string }[]; error?: string }>(
              "/api/detect-item-dividers",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ images: chunk.images }),
              }
            );
            if (!data.markers) throw new Error(data.error || "Divider detection failed");
            chunkMarkers[c] = data.markers.map((m) => ({ index: m.index + chunk.start, code: m.code }));
          }
        }
        await Promise.all(
          Array.from({ length: Math.min(DIVIDER_DETECT_CONCURRENCY, chunks.length) }, () => detectWorker())
        );

        const markers = chunkMarkers.flat();

        if (markers.length > 0) {
          const { groups: finalMarkerGroups, skuByGroupIndex } = buildGroupsFromMarkers(markers, totalPhotos);
          setGroups(finalMarkerGroups);
          if (Object.keys(skuByGroupIndex).length > 0) {
            setCustomSkus((prev) => ({ ...prev, ...skuByGroupIndex }));
          }
          setStep("review");
          return;
        }
        // Setting is on but this batch had no marker photos -- fall
        // through to AI-similarity grouping below instead of leaving the
        // seller with nothing.
      }

      const finalGroups: number[][] = [];
      let pending: number[] = [];
      let cursor = 0;
      // Large batches take several sequential AI calls (see the chunking
      // below) with a deliberate pause between each to stay under OpenAI's
      // rate limit — that's real wait time, not wasted time, but it reads
      // as "stuck" without a number moving. Report actual photos organized
      // so far instead of an opaque "part N" so progress is always visible.
      const showProgress = totalPhotos > GROUPING_CHUNK_SIZE;

      while (cursor < totalPhotos) {
        if (showProgress) {
          setGroupingProgress(`Grouping photos — ${cursor} of ${totalPhotos} organized...`);
        }

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

        if (showProgress) {
          setGroupingProgress(`Grouping photos — ${Math.min(cursor, totalPhotos)} of ${totalPhotos} organized...`);
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
    setUndoGroups(groups.map((g) => [...g]));
    setUndoLabel("Photo removed");
    setGroups((prev) => {
      const next = prev.map((g) => [...g]);
      next[fromGroup] = next[fromGroup].filter((i) => i !== photoIndex);
      return next.filter((g) => g.length > 0);
    });
  }

  function removeGroup(gIdx: number) {
    setUndoGroups(groups.map((g) => [...g]));
    setUndoLabel("Item removed");
    setGroups((prev) => prev.filter((_, i) => i !== gIdx));
  }

  // Restores the groups layout exactly as it was right before the last
  // delete (see removePhoto/removeGroup above) — a full snapshot rather
  // than trying to re-insert one photo at one index, since deleting the
  // last photo in a group also drops that whole group and shifts every
  // index after it.
  function handleUndoRemove() {
    if (!undoGroups) return;
    setGroups(undoGroups);
    setUndoGroups(null);
    setUndoLabel("");
  }

  // Fixes the AI's most common mistake in one tap instead of moving every
  // photo across the boundary individually: when a single item's photos
  // got split into two adjacent groups, this folds gIdx's photos into the
  // group right before it and drops the now-empty group.
  function mergeGroupUp(gIdx: number) {
    if (gIdx <= 0) return;
    setGroups((prev) => {
      const next = prev.map((g) => [...g]);
      next[gIdx - 1] = [...next[gIdx - 1], ...next[gIdx]];
      next.splice(gIdx, 1);
      return next;
    });
  }

  // The opposite mistake: the AI merged two different items into one
  // group. Splits everything from this photo onward into a brand new
  // group inserted right after the current one, instead of requiring
  // each photo to be moved out individually.
  function splitGroupAt(gIdx: number, photoIndex: number) {
    setGroups((prev) => {
      const next = prev.map((g) => [...g]);
      const group = next[gIdx];
      const pos = group.indexOf(photoIndex);
      if (pos <= 0) return prev; // already the start of this item — nothing to split off
      const tail = group.slice(pos);
      next[gIdx] = group.slice(0, pos);
      next.splice(gIdx + 1, 0, tail);
      return next;
    });
  }

  function groupImagesForRequest(group: number[]) {
    return group.slice(0, MAX_PHOTOS_PER_ITEM).map((idx) => ({
      data: photos[idx].data,
      mediaType: photos[idx].mediaType,
    }));
  }

  // Free, synchronous, no network call -- see matchStoreCategoryByKeyword.
  // Only fills items that don't already have a choice (undefined), so it
  // never clobbers a manual pick or an AI suggestion that landed first.
  function keywordSuggestAll(allResults: AiResult[]) {
    if (storeCategories.length === 0) return;
    setStoreCategoryChoice((prev) => {
      const next = { ...prev };
      allResults.forEach((r, i) => {
        if (r.error || r.pending) return;
        if (next[i] !== undefined) return;
        next[i] = matchStoreCategoryByKeyword(
          { title: r.suggestedTitle, itemType: r.itemType, brand: r.brand },
          storeCategories
        );
      });
      return next;
    });
  }

  // One AI store-category call for a single item. Throws on failure
  // (including an AI-cap 429, whose message equals AI_CAP_MESSAGE) so
  // callers can decide how to handle that -- a bulk pass wants to notice a
  // cap hit once for the whole batch, a single retry can just swallow it.
  async function requestStoreCategoryAi(result: AiResult): Promise<StoreCategoryLite | null> {
    const data = await apiFetch<{ categoryId: string | null; categoryPath: string | null }>(
      "/api/ebay/store-categories/suggest",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: result.suggestedTitle,
          itemType: result.itemType,
          brand: result.brand,
          color: result.color,
          description: result.description,
        }),
      }
    );
    if (!data.categoryId) return null;
    return (
      storeCategories.find((c) => c.id === data.categoryId) ??
      (data.categoryPath ? { id: data.categoryId, name: data.categoryPath, path: data.categoryPath } : null)
    );
  }

  // Bulk AI pass across a freshly-analyzed batch, gated by Settings ->
  // "Store category suggestions" -> AI suggestions. Runs AFTER
  // keywordSuggestAll so every item already has at least the free
  // suggestion (or null) as a fallback if the AI call fails or finds
  // nothing. Same bounded worker-pool pattern as ANALYSIS_CONCURRENCY /
  // PRICING_CONCURRENCY above -- this is still an OpenAI call per item, no
  // reason to fire up to 200 of them at once.
  const STORE_CATEGORY_AI_CONCURRENCY = 3;
  async function aiSuggestStoreCategoriesForAll(allResults: AiResult[]) {
    if (!aiStoreCategorySuggestions || storeCategories.length === 0) return;
    const queue = allResults
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => !r.error && !r.pending);
    let cursor = 0;
    let cappedHit = false;
    async function worker() {
      while (cursor < queue.length) {
        const { r, i } = queue[cursor++];
        try {
          const match = await requestStoreCategoryAi(r);
          if (match) setStoreCategoryChoice((prev) => ({ ...prev, [i]: match }));
        } catch (err) {
          if ((err as Error).message === AI_CAP_MESSAGE) cappedHit = true;
          // Otherwise leave whatever the free keyword match already set.
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(STORE_CATEGORY_AI_CONCURRENCY, queue.length) }, () => worker())
    );
    if (cappedHit) {
      setError((prev) =>
        prev ??
        "You've reached this month's AI usage limit -- some items only got the free keyword-based store category suggestion instead of AI's. You can still pick manually, or retry once it resets."
      );
    }
  }

  async function handleAnalyzeBatch() {
    setError(null);
    setAnalyzingProgress({ done: 0, total: groups.length });

    const allResults: AiResult[] = new Array(groups.length);

    // Put every item on screen right away, each as a placeholder "still
    // analyzing" card, instead of blocking the whole screen behind one
    // spinner until the slowest item in the batch finishes. Items are
    // analyzed ANALYSIS_CONCURRENCY at a time below, so the first few are
    // usually done well before the last — no reason to make the user
    // wait to start reviewing/editing them.
    const pendingResult: AiResult = {
      itemType: "",
      brand: "",
      color: "",
      size: "",
      condition: "Good - minor flaws",
      flaws: "",
      suggestedTitle: "",
      pending: true,
    };
    setResults(groups.map(() => ({ ...pendingResult })));
    setStep("results");
    setUndoGroups(null);

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

      const result: AiResult = !data.results
        ? { itemType: "", brand: "", color: "", size: "", condition: "Good - minor flaws", flaws: "", suggestedTitle: "", error: data.error || "Analysis failed" }
        : data.results[0];
      allResults[i] = result;

      // Reveal this item the moment it's done rather than waiting for the
      // whole batch — the results screen is already up (see above), so
      // this just swaps that one item's placeholder card for the real one.
      setResults((prev) => {
        const next = [...prev];
        next[i] = result;
        return next;
      });

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

      // One clear banner instead of the same "usage limit" message just
      // repeating on every affected item's card -- a seller scanning a
      // 40-item results screen could easily miss that they're all the
      // same cause. Per-item Retry buttons (rendered below for any item
      // with .error set) still work once the cap resets.
      const cappedCount = allResults.filter((r) => r.error === AI_CAP_MESSAGE).length;
      if (cappedCount > 0) {
        setError(
          `You've reached this month's AI usage limit -- ${cappedCount} item${cappedCount !== 1 ? "s" : ""} below couldn't be analyzed. It resets on the 1st; retry them (or this whole batch) once it does.`
        );
      }

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
      keywordSuggestAll(allResults);
      fetchPricingForAll(allResults);
      void aiSuggestStoreCategoriesForAll(allResults);
    } catch (err) {
      // Each item already catches and records its own failure inside
      // analyzeOne, so this only fires for something unexpected outside
      // that — leave whatever's already on screen (a mix of finished and
      // still-pending items) as it is rather than yanking the user back
      // to the grouping screen and losing that progress.
      setError((err as Error).message);
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
          shippingMode: shippingModes[i] ?? defaultShippingMode,
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
      .filter(({ result }) => !result.error && !result.pending);

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
      body: JSON.stringify({ title: result.suggestedTitle, brand: result.brand, condition: result.condition, image, itemType: result.itemType, size: result.size, shippingMode: shippingModes[index] ?? defaultShippingMode }),
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
      setStoreCategoryChoice((prev) => ({
        ...prev,
        [index]: matchStoreCategoryByKeyword(
          { title: retryResult.suggestedTitle, itemType: retryResult.itemType, brand: retryResult.brand },
          storeCategories
        ),
      }));
      if (aiStoreCategorySuggestions) {
        requestStoreCategoryAi(retryResult)
          .then((match) => {
            if (match) setStoreCategoryChoice((prev) => ({ ...prev, [index]: match }));
          })
          .catch(() => {});
      }
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
          shippingMode: shippingModes[index] ?? defaultShippingMode,
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

  // `silent` is set by the auto-save effect below: it persists the item
  // the instant its AI analysis lands, without flipping saveStatus to the
  // "saving"/"saved" states the explicit Save button and the disabled={}
  // field locks key off. That keeps every field editable exactly as
  // before an explicit save, while guaranteeing there's already a real
  // draft row (with photos uploaded) in the database if the seller gets
  // distracted, navigates away, or loses their connection before ever
  // touching "Save draft".
  async function handleSaveDraft(index: number, opts?: { silent?: boolean }): Promise<string | null> {
    // NOTE: this used to short-circuit with `if (draftIds[index]) return
    // draftIds[index];`, and handleListOnEbay only ever called this when
    // no draft existed yet — so editing a row in the results table (title,
    // condition, brand, color, size, flaws are all editable above) after
    // "Save all drafts" had already run meant the edit never reached the
    // database at all, and /api/ebay/list reads the draft straight from
    // there. Now every call does a real, full sync — POST once to create,
    // PATCH every time after — and handleListOnEbay always calls this
    // first so a listing attempt is always built from what's on screen.
    const silent = opts?.silent ?? false;
    if (!silent) {
      setSaveStatus((prev) => ({ ...prev, [index]: "saving" }));
    }

    try {
      const result = results[index];
      const group = groups[index] ?? [];
      const existingId = draftIds[index];

      const hasRealPricing = result.pricing && !result.pricing.noData;
      const suggestion: PriceSuggestion =
        (hasRealPricing ? result.pricing : null) ??
        getPriceSuggestion(result.condition, Boolean(result.flaws && result.flaws.trim().length > 0), heavyItems[index] ?? estimateIsHeavy(result.itemType, result.material), result.itemType, result.size, shippingModes[index] ?? defaultShippingMode);
      const finalPrice = hasRealPricing
        ? suggestion.suggestedPrice
        : customPrices[index] ? Number(customPrices[index]) : suggestion.suggestedPrice;

      // Upload each photo in the group that hasn't already been uploaded
      // (see uploadedPhotoUrls above); first becomes the thumbnail. Only
      // overwrite photoUrls/thumbnailUrl on a re-save if something actually
      // uploaded (or was cached) this time — an empty result shouldn't wipe
      // out photos a previous save already stored. Each photo's upload is
      // independent of the others, so they run concurrently instead of one
      // at a time — with up to MAX_PHOTOS_PER_ITEM (6) photos per item
      // across a 40-item batch, sequential uploads used to mean hundreds of
      // Supabase Storage round trips, and now that handleSaveDraft can run
      // several times per item (auto-save, explicit save, list-on-eBay's
      // internal re-save), the cache is what keeps that from multiplying.
      // Promise.all preserves the group's original order in its results
      // regardless of which upload finishes first, so photoUrls[0] is
      // still reliably the group's first/front photo.
      const uploadOutcomes = await Promise.all(
        group.map(async (photoIdx) => {
          const cachedUrl = uploadedPhotoUrls.current[photoIdx];
          if (cachedUrl) return cachedUrl;
          const dataUrl = photos[photoIdx]?.previewUrl;
          if (!dataUrl) return null;
          try {
            const url = await uploadThumbnail(dataUrl);
            uploadedPhotoUrls.current[photoIdx] = url;
            return url;
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
      } else {
        setPhotoUploadWarnings((prev) => {
          const next = { ...prev };
          delete next[index];
          return next;
        });
      }
      const thumbnailUrl = photoUrls[0] ?? null;

      const payload = {
        title: result.suggestedTitle,
        brand: result.brand,
        color: result.color,
        size: result.size,
        condition: result.condition,
        flaws: result.flaws,
        customSku: customSkus[index] || undefined,
        suggestedPrice: finalPrice,
        costBasis: costs[index] ? Number(costs[index]) : null,
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
        storeCategoryId: storeCategoryChoice[index]?.id ?? null,
        storeCategoryName: storeCategoryChoice[index]?.path ?? null,
        isHeavy: shippingModes[index] === "buyer_pays",
        shippingMode: shippingModes[index] ?? defaultShippingMode,
        shippingCost: (shippingModes[index] ?? defaultShippingMode) === "buyer_pays" && shippingCosts[index] ? Number(shippingCosts[index]) : null,
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
      setSaveErrors((prev) => {
        const next = { ...prev };
        delete next[index];
        return next;
      });
      setDraftIds((prev) => ({ ...prev, [index]: id }));
      setSaveStatus((prev) => {
        // Never downgrade an explicit confirmation: if the seller has
        // already hit "Save draft" (or "List on eBay") by the time a
        // silent auto-save from an earlier moment resolves, leave the
        // confirmed "saved" status alone instead of reverting it to "auto".
        if (!silent) return { ...prev, [index]: "saved" };
        return prev[index] === "saved" ? prev : { ...prev, [index]: "auto" };
      });
      return id;
    } catch (err) {
      setSaveErrors((prev) => ({ ...prev, [index]: (err as Error).message || "Failed to save draft" }));
      setSaveStatus((prev) => {
        if (silent && prev[index] === "saved") return prev;
        return { ...prev, [index]: "error" };
      });
      return null;
    }
  }

  // Auto-save each item the moment its AI analysis finishes, instead of
  // only ever persisting on an explicit "Save draft"/"Save all"/"List on
  // eBay" click. A batch upload can be a dozen-plus items each waiting on
  // a slow AI call — if the seller gets distracted, hits "Home", or their
  // connection drops before they've reviewed anything, everything the AI
  // already produced (and every photo) used to exist only in this page's
  // React state and vanish with it. autoSavedForIndex tracks which items
  // this effect has already persisted so it fires exactly once per item —
  // `results` changes again shortly after (pricing lookups patch each
  // entry in place), and that shouldn't trigger a second, redundant save.
  // handleSaveDraft's `silent: true` here is what keeps this invisible:
  // no "saving" spinner, and — critically — it does NOT set saveStatus to
  // "saved", so the disabled={} locks on every field below (keyed off
  // saveStatus === "saved", not off draftIds) stay off until the seller
  // actually reviews and explicitly saves. This only ever creates/updates
  // the draft row; it never lists anything on eBay.
  useEffect(() => {
    results.forEach((r, i) => {
      if (r.pending || r.error) return;
      if (autoSavedForIndex.current.has(i) || autoSavingForIndex.current.has(i)) return;
      autoSavingForIndex.current.add(i);
      void handleSaveDraft(i, { silent: true }).then((draftId) => {
        autoSavingForIndex.current.delete(i);
        if (draftId) {
          autoSavedForIndex.current.add(i);
        } else {
          window.setTimeout(() => {
            if (!autoSavedForIndex.current.has(i)) {
              setResults((current) => [...current]);
            }
          }, 3000);
        }
      });
    });
    // Deliberately keyed only on `results`: handleSaveDraft reads
    // groups/heavyItems/customPrices/customSkus/draftIds via this render's
    // own closure, which is exactly the freshly-analyzed data we want
    // saved, not a snapshot frozen at some earlier dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results]);

  async function handleListOnEbay(index: number): Promise<boolean> {
    if (photoUploadWarnings[index]) {
      setListStatus((prev) => ({ ...prev, [index]: "error" }));
      setListErrors((prev) => ({
        ...prev,
        [index]: "Some photos have not uploaded yet. Retry saving until all photos finish uploading before listing.",
      }));
      return false;
    }
    const result = results[index];
    const group = groups[index] ?? [];
    const suggestedPrice = result.pricing && !result.pricing.noData
      ? result.pricing.suggestedPrice
      : getPriceSuggestion(
          result.condition,
          Boolean(result.flaws && result.flaws.trim().length > 0),
          heavyItems[index] ?? estimateIsHeavy(result.itemType, result.material),
          result.itemType,
          result.size,
          shippingModes[index] ?? defaultShippingMode
        ).suggestedPrice;
    const readiness = getListingReadiness({
      photoCount: group.length,
      title: result.suggestedTitle,
      price: customPrices[index] ? Number(customPrices[index]) : suggestedPrice,
      condition: result.condition,
      shippingMode: shippingModes[index] ?? defaultShippingMode,
    });
    if (!readiness.ready) {
      setListStatus((prev) => ({ ...prev, [index]: "error" }));
      setListErrors((prev) => ({ ...prev, [index]: `Before listing: ${readiness.blockers.join(" • ")}` }));
      return false;
    }
    setListStatus((prev) => ({ ...prev, [index]: "saving" }));
    const id = await handleSaveDraft(index);
    if (!id) {
      setListStatus((prev) => ({ ...prev, [index]: "error" }));
      setListErrors((prev) => ({ ...prev, [index]: "Failed to save draft" }));
      return false;
    }

    setListStatus((prev) => ({ ...prev, [index]: "listing" }));
    try {
      const data = await apiFetch<{ connect?: boolean; reconnect?: boolean; error?: string; missingRequiredAspects?: string[]; storeCategoryWarning?: string; url?: string | null }>("/api/ebay/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: id, shippingMode: shippingModes[index] ?? defaultShippingMode, isHeavy: (shippingModes[index] ?? defaultShippingMode) === "buyer_pays", shippingCost: (shippingModes[index] ?? defaultShippingMode) === "buyer_pays" && shippingCosts[index] ? parseFloat(shippingCosts[index]) : undefined }),
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
      if (data.url) {
        setListedUrls((prev) => ({ ...prev, [index]: data.url as string }));
      }
      if (data.storeCategoryWarning) {
        setListStoreCategoryWarnings((prev) => ({ ...prev, [index]: data.storeCategoryWarning as string }));
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
      .filter((i) => !results[i].error && !results[i].pending && listStatus[i] !== "listed");

    if (indices.length === 0) return;
    if (!window.confirm(`List ${indices.length} item${indices.length === 1 ? "" : "s"} on eBay now?`)) return;

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
    const failedCount = indices.length - successCount;
    if (failedCount > 0) {
      setError(
        successCount > 0
          ? `${successCount} item${successCount === 1 ? "" : "s"} listed. ${failedCount} failed and can be retried below.`
          : `None of the ${failedCount} selected items listed. Review the errors and retry below.`
      );
    } else if (successCount > 0) {
      setTimeout(() => router.push("/store"), 1500);
    }
  }

  // Items still open for bulk editing -- once a draft is saved (draftIds[i]
  // set), every per-item field below locks with disabled={saveStatus[i] === "saved"},
  // so bulk-applying a new value to an already-saved item would silently
  // do nothing. Errored items are excluded too; they have no editable
  // fields to apply to until retried.
  function getSelectableIndices(): number[] {
    return results
      .map((_, i) => i)
      .filter((i) => !results[i].error && !results[i].pending && saveStatus[i] !== "saved");
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

  function applyBulkStoreCategory() {
    const targets = getSelectableIndices().filter((i) => selected[i]);
    if (targets.length === 0) return;
    const chosen = storeCategories.find((c) => c.id === bulkStoreCategoryId) ?? null;
    setStoreCategoryChoice((prev) => {
      const next = { ...prev };
      targets.forEach((i) => {
        next[i] = chosen;
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
        <div className="card p-3 mb-4 text-sm" style={{ color: "var(--danger)" }}>
          {error}
        </div>
      )}

      {showUsageWarning && (
        <div
          className="card p-3 mb-4 text-sm flex items-center gap-2"
          style={{ background: "var(--warning-bg)", borderColor: "var(--warning-border)" }}
        >
          <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: "var(--danger)" }} />
          <span>{usageWarningMessage}</span>
        </div>
      )}

      {ebayConnected === false && (
        <div
          className="card p-3 mb-4 text-sm flex items-center gap-2"
          style={{ background: "var(--warning-bg)", borderColor: "var(--warning-border)" }}
        >
          <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: "var(--danger)" }} />
          <span>
            eBay isn&apos;t connected. You can still upload and review items, but reconnect before
            listing them, or they&apos;ll only be saved as drafts.{" "}
            <a href="/api/ebay/connect" className="underline font-medium">Connect eBay →</a>
          </span>
        </div>
      )}

      {step === "upload" && (
        <>
          {photos.length === 0 && (
            <div className="card p-4 mb-4 stagger d1">
              <p
                className="text-xs font-semibold uppercase tracking-wide mb-3"
                style={{ color: "var(--text-tertiary)" }}
              >
                How batch upload works
              </p>
              <div className="flex flex-col gap-3">
                {[
                  {
                    icon: Images,
                    label: "Select every photo for this batch",
                    desc: "Upload in order: front of item 1, its other shots, then front of item 2, and so on.",
                  },
                  {
                    icon: Sparkles,
                    label: "AI groups your photos into items",
                    desc: "Each item's photos get bundled together automatically, then drafted with a title, price, and details.",
                  },
                  {
                    icon: ListChecks,
                    label: "Review, tweak, and list",
                    desc: "Fix any mis-grouped photos, adjust the details, then save everything as drafts or list it all at once.",
                  },
                ].map((s, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: "color-mix(in srgb, var(--accent) 14%, var(--bg-surface))" }}
                    >
                      <s.icon className="w-4 h-4" style={{ color: "var(--accent)" }} />
                    </div>
                    <div className="flex-1 pt-0.5">
                      <p className="text-sm font-medium">{s.label}</p>
                      <p className="text-xs mt-0.5 leading-relaxed" style={{ color: "var(--text-tertiary)" }}>
                        {s.desc}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

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
              {photos.length > LARGE_BATCH_NOTICE_THRESHOLD && manualDividers.size === 0 && (
                <p className="text-xs mb-2" style={{ color: "var(--text-tertiary)" }}>
                  Large batch — AI grouping will take a few minutes across
                  several rounds. Tapping dividers instead (below) skips
                  that wait entirely.
                </p>
              )}
              <p className="text-xs text-[var(--text-tertiary)] mb-2">
                Optional: tap <Scissors className="inline w-3 h-3 -mt-0.5" /> on
                your item&apos;s SKU/number photo (a card, tag, or bag shot with
                the number on it) to mark the end of that item — this skips
                AI grouping for this batch, and the marked photo is left
                out of the listing so it never gets posted by accident.
              </p>
              {manualDividers.size > 0 && (
                <p className="text-xs mb-2" style={{ color: "var(--accent)" }}>
                  {manualDividers.size + 1} item{manualDividers.size > 0 ? "s" : ""} marked
                </p>
              )}
              <div className="grid grid-cols-4 gap-2 mb-4">
                {photos.map((p, i) => {
                  const isDivider = manualDividers.has(i);
                  return (
                    <div key={i} className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={p.previewUrl}
                        alt={`Photo ${i + 1}`}
                        loading="lazy"
                        decoding="async"
                        className="aspect-square object-cover rounded-md"
                        style={isDivider ? { outline: "2px solid var(--accent)", outlineOffset: 2 } : undefined}
                      />
                      <button
                        type="button"
                        onClick={() => toggleDivider(i)}
                        className="absolute bottom-1 right-1 w-6 h-6 rounded-full flex items-center justify-center"
                        style={{
                          background: isDivider ? "var(--accent)" : "color-mix(in srgb, black 55%, transparent)",
                          color: "white",
                        }}
                        aria-label={isDivider ? "Unmark as SKU/number photo" : "Mark as this item's SKU/number photo"}
                      >
                        <Scissors className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
              <button onClick={handleGroupPhotos} className="btn btn-primary w-full">
                <Sparkles className="w-4 h-4" />
                {manualDividers.size > 0 ? "Split into items" : "Group photos into items"}
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
            different group, or use the arrows under a photo to nudge it
            into the previous/next item. If the AI split one item into two
            groups, tap <ArrowUpToLine className="inline w-3 h-3 -mt-0.5" /> on
            the second group to merge them. If it merged two items
            together, tap <Scissors className="inline w-3 h-3 -mt-0.5" /> on
            the photo where the second item starts to split them apart.
            Only the first {MAX_PHOTOS_PER_ITEM} photos per item will be
            used for analysis, in the order shown.
          </p>

          {undoGroups && (
            <div className="card p-3 mb-4 flex items-center justify-between gap-3">
              <p className="text-sm">{undoLabel}</p>
              <div className="flex items-center gap-3 flex-shrink-0">
                <button
                  type="button"
                  onClick={handleUndoRemove}
                  className="text-sm font-semibold"
                  style={{ color: "var(--accent)" }}
                >
                  Undo
                </button>
                <button
                  type="button"
                  onClick={() => setUndoGroups(null)}
                  aria-label="Dismiss"
                  className="tap p-0.5"
                >
                  <X className="w-3.5 h-3.5" style={{ color: "var(--text-tertiary)" }} />
                </button>
              </div>
            </div>
          )}

          <input
            ref={addPhotoInput}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = e.target.files;
              const gIdx = addPhotoTargetGroup;
              if (gIdx !== null) handleAddPhotosToGroup(gIdx, files);
              e.target.value = "";
            }}
          />

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
                      <span style={{ color: "var(--danger)" }}>
                        {" "}
                        (only first {MAX_PHOTOS_PER_ITEM} will be used)
                      </span>
                    )}
                  </p>
                  <div className="flex items-center gap-1">
                    {gIdx > 0 && (
                      <button
                        onClick={() => mergeGroupUp(gIdx)}
                        className="tap p-1 rounded hover:bg-[var(--bg-page)]"
                        title={`Merge into Item ${gIdx} — use if the AI split one item into two groups`}
                      >
                        <ArrowUpToLine className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
                      </button>
                    )}
                    <button
                      onClick={() => removeGroup(gIdx)}
                      className="tap p-1 rounded hover:bg-[var(--bg-page)]"
                      title="Delete group"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
                    </button>
                  </div>
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
                            loading="lazy"
                            decoding="async"
                            className="w-14 h-14 object-cover rounded-md"
                          />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              removePhoto(photoIdx, gIdx);
                            }}
                            className="tap absolute -top-1.5 -left-1.5 w-4 h-4 rounded-full flex items-center justify-center"
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
                            className="tap w-5 h-5 rounded flex items-center justify-center disabled:opacity-25"
                            style={{ background: "var(--glass)", border: "1px solid var(--glass-line)" }}
                          >
                            <ChevronLeft className="w-3 h-3" style={{ color: "var(--text-secondary)" }} />
                          </button>
                          <button
                            type="button"
                            onClick={() => splitGroupAt(gIdx, photoIdx)}
                            disabled={posInGroup === 0}
                            title={posInGroup === 0 ? "Already the start of this item" : "Split into a new item starting here"}
                            className="tap w-5 h-5 rounded flex items-center justify-center disabled:opacity-25"
                            style={{ background: "var(--glass)", border: "1px solid var(--glass-line)" }}
                          >
                            <Scissors className="w-3 h-3" style={{ color: "var(--text-secondary)" }} />
                          </button>
                          <button
                            type="button"
                            onClick={() => movePhotoLater(photoIdx, gIdx)}
                            disabled={isLastOverall}
                            title={posInGroup === group.length - 1 ? "Move to next item" : "Move later"}
                            className="tap w-5 h-5 rounded flex items-center justify-center disabled:opacity-25"
                            style={{ background: "var(--glass)", border: "1px solid var(--glass-line)" }}
                          >
                            <ChevronRight className="w-3 h-3" style={{ color: "var(--text-secondary)" }} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => {
                      setAddPhotoTargetGroup(gIdx);
                      addPhotoInput.current?.click();
                    }}
                    className="tap w-14 h-14 rounded-md flex items-center justify-center flex-shrink-0"
                    style={{ border: "1px dashed var(--glass-line)", background: "var(--glass)" }}
                    title="Add a photo to this item"
                  >
                    <Plus className="w-4 h-4" style={{ color: "var(--text-tertiary)" }} />
                  </button>
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

      {step === "results" && (
        <div className="flex flex-col gap-4">
          <AIDisclaimer />
          {results.length > 1 && (
            <>
              <p className="text-xs font-semibold stagger d1" style={{ color: "var(--text-tertiary)" }}>
                {analyzingProgress && analyzingProgress.done < analyzingProgress.total
                  ? `Analyzing — ${analyzingProgress.done}/${analyzingProgress.total} ready so far`
                  : `${results.length} items ready · tap one to jump to it`}
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
                        <img src={thumb} alt={`Item ${i + 1}`} loading="lazy" decoding="async" className="w-full h-full object-cover" />
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
                      {r.pending && (
                        <span
                          className="absolute inset-0 flex items-center justify-center"
                          style={{ background: "rgba(0,0,0,0.45)" }}
                        >
                          <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
                        </span>
                      )}
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
            const unsaved = results.filter((r, i) => !r.error && !r.pending && saveStatus[i] !== "saved").length;
            const allSaved = results.every((r, i) => r.error || saveStatus[i] === "saved");
            const unlistedCount = results.filter((r, i) => !r.error && !r.pending && listStatus[i] !== "listed").length;
            const allListed = results.filter((r) => !r.error).length > 0 && results.every((r, i) => r.error || listStatus[i] === "listed");
            const failedCount = results.filter((r) => r.error).length;
            const failedListingCount = results.filter((r, i) => !r.error && listStatus[i] === "error").length;
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
                {failedListingCount > 0 && (
                  <button
                    onClick={() => void handleRetryFailedListings()}
                    disabled={listingAll}
                    className="btn w-full"
                  >
                    {listingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCw className="w-4 h-4" />}
                    {listingAll ? "Retrying listings..." : `Retry failed listings (${failedListingCount})`}
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
                      {storeCategories.length > 0 && (
                        <div className="flex items-center gap-2">
                          <select
                            className="input flex-1 text-xs"
                            value={bulkStoreCategoryId}
                            onChange={(e) => setBulkStoreCategoryId(e.target.value)}
                          >
                            <option value="">— None —</option>
                            {storeCategories.map((c) => (
                              <option key={c.id} value={c.id}>{c.path}</option>
                            ))}
                          </select>
                          <button onClick={applyBulkStoreCategory} className="btn text-xs px-3 py-1.5 whitespace-nowrap">
                            Set category
                          </button>
                        </div>
                      )}
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

            if (result.pending) {
              return (
                <div key={i} id={`result-item-${i}`} className="card overflow-hidden">
                  {groupPhotos.length > 0 && (
                    <div className="flex gap-2 overflow-x-auto px-4 pt-4 pb-2 snap-x snap-mandatory">
                      {groupPhotos.map((url, pi) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={pi}
                          src={url}
                          alt={`Photo ${pi + 1}`}
                          loading="lazy"
                          decoding="async"
                          className="h-36 w-36 object-cover rounded-lg flex-shrink-0 snap-start opacity-60"
                        />
                      ))}
                    </div>
                  )}
                  <div className="px-4 pb-4 flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Analyzing item {i + 1}...
                  </div>
                </div>
              );
            }

            if (result.error) {
              return (
                <div key={i} id={`result-item-${i}`} className="card p-4">
                  <p className="text-sm font-medium mb-1">Item {i + 1}</p>
                  <p className="text-sm mb-3" style={{ color: "var(--danger)" }}>
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
                result.size,
                shippingModes[i] ?? defaultShippingMode
              );
            const pricingAttempted = Boolean(result.pricing);
            const pricingReady = Boolean(livePricing);
            const pricingNoData = pricingAttempted && !livePricing;
            const readiness = getListingReadiness({
              photoCount: group.length,
              title: result.suggestedTitle,
              price: customPrices[i] ? Number(customPrices[i]) : suggestion.suggestedPrice,
              condition: result.condition,
              shippingMode: shippingModes[i] ?? defaultShippingMode,
            });

            return (
              <div key={i} id={`result-item-${i}`} className="card overflow-hidden">
                {saveStatus[i] !== "saved" && (
                  <div className="flex items-center gap-2 px-4 pt-3">
                    <button
                      onClick={() => toggleSelected(i)}
                      className="flex items-center gap-2 text-xs text-[var(--text-tertiary)] flex-1"
                    >
                      {selected[i] ? (
                        <CheckSquare className="w-4 h-4 text-[var(--accent)]" />
                      ) : (
                        <Square className="w-4 h-4" />
                      )}
                      Item {i + 1}
                    </button>
                    {status === "auto" && (
                      // Auto-saved in the background right after analysis
                      // (see the effect above handleListOnEbay) — reassures
                      // the seller this item is already safe to walk away
                      // from, without implying they've reviewed and
                      // confirmed it the way an explicit "Save draft" does.
                      <span
                        className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full"
                        style={{ background: "var(--glass)", color: "var(--text-tertiary)" }}
                        title="Saved as a draft in the background — click Save draft to confirm your edits"
                      >
                        <Check className="w-3 h-3" />
                        Backed up
                      </span>
                    )}
                  </div>
                )}
                {/* Show the full group so every photo is easy to review and edit. */}
                {groupPhotos.length > 0 && (
                  <div className="grid grid-cols-3 gap-2 px-4 pt-4 pb-2">
                    {groupPhotos.map((url, pi) => (
                      <div key={pi} className="relative aspect-square">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={url}
                          alt={`Photo ${pi + 1}`}
                          loading="lazy"
                          decoding="async"
                          className="w-full h-full object-cover rounded-lg"
                        />
                        <div className="absolute bottom-1 left-1 right-1 flex justify-between">
                          <button
                            type="button"
                            aria-label="Move photo earlier"
                            disabled={pi === 0}
                            onClick={() => movePhotoEarlier(group[pi], i)}
                            className="rounded-full bg-black/60 p-1 text-white disabled:opacity-30"
                          >
                            <ChevronLeft className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label="Delete photo"
                            disabled={group.length <= 1}
                            onClick={() => removePhoto(group[pi], i)}
                            className="rounded-full bg-black/60 p-1 text-white disabled:opacity-30"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label="Move photo later"
                            disabled={pi === group.length - 1}
                            onClick={() => movePhotoLater(group[pi], i)}
                            className="rounded-full bg-black/60 p-1 text-white disabled:opacity-30"
                          >
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        setAddPhotoTargetGroup(i);
                        addPhotoInput.current?.click();
                      }}
                      className="aspect-square rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-1 text-xs text-[var(--text-secondary)]"
                    >
                      <Plus className="w-5 h-5" />
                      Add photo
                    </button>
                  </div>
                )}
                <div className="px-4 pb-4">
                  <div
                    className="mb-2 rounded-lg px-2.5 py-2 text-xs"
                    style={{
                      background: readiness.ready ? "var(--accent-tint)" : "var(--warning-bg)",
                      color: readiness.ready ? "var(--accent)" : "var(--warning-border)",
                    }}
                  >
                    <strong>{readiness.ready ? "Ready to list" : "Needs review"}</strong>
                    {!readiness.ready && <span className="ml-1">· {readiness.blockers.join(" · ")}</span>}
                  </div>
                  <div className="mb-3 mt-2">
                    <input
                      className="input w-full text-sm font-medium mb-1"
                      value={result.suggestedTitle}
                      disabled={saveStatus[i] === "saved"}
                      onChange={(e) => {
                        const val = e.target.value;
                        setResults((prev) => prev.map((r, j) => j === i ? { ...r, suggestedTitle: val } : r));
                      }}
                    />
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      <select
                        className="tap text-xs font-semibold rounded-full px-3 py-1.5 border appearance-none"
                        style={{ background: "var(--glass)", borderColor: "var(--glass-line)", color: "var(--text-primary)" }}
                        value={result.condition}
                        disabled={saveStatus[i] === "saved"}
                        onChange={(e) => {
                          const val = e.target.value as Condition;
                          setResults((prev) => prev.map((r, j) => j === i ? { ...r, condition: val } : r));
                        }}
                      >
                        {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <select
                        className="tap text-xs font-semibold rounded-full px-3 py-1.5 border"
                        style={{ background: "var(--glass)", borderColor: "var(--glass-line)", color: "var(--text-secondary)" }}
                        value={shippingModes[i] ?? defaultShippingMode}
                        disabled={saveStatus[i] === "saved"}
                        onChange={(e) => {
                          const mode = e.target.value as ShippingMode;
                          setShippingModes((prev) => ({ ...prev, [i]: mode }));
                          setHeavyItems((prev) => ({ ...prev, [i]: mode === "buyer_pays" }));
                          if (mode !== "buyer_pays") setShippingCosts((prev) => { const n = { ...prev }; delete n[i]; return n; });
                        }}
                      >
                        <option value="free">Free shipping</option>
                        <option value="calculated">Calculated shipping</option>
                        <option value="buyer_pays">Flat-rate shipping</option>
                      </select>
                      {(shippingModes[i] ?? defaultShippingMode) === "buyer_pays" && (
                        <div className="relative">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs" style={{ color: "var(--text-tertiary)" }}>$</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="Shipping"
                            value={shippingCosts[i] ?? ""}
                            disabled={saveStatus[i] === "saved"}
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
                          disabled={saveStatus[i] === "saved"}
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
                          disabled={saveStatus[i] === "saved"}
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
                          disabled={saveStatus[i] === "saved"}
                          onChange={(e) => {
                            const val = e.target.value;
                            setResults((prev) => prev.map((r, j) => j === i ? { ...r, size: val } : r));
                          }}
                        />
                      </div>
                    </div>
                    <div className="mt-2">
                      <p className="text-[10px] text-[var(--text-tertiary)] mb-0.5">SKU (optional — alphanumeric only)</p>
                      <input
                        className="input text-xs w-full"
                        placeholder="e.g. HDSHIRT001"
                        value={customSkus[i] ?? ""}
                        disabled={saveStatus[i] === "saved"}
                        onChange={(e) => {
                          const val = e.target.value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 50);
                          setCustomSkus((prev) => ({ ...prev, [i]: val }));
                        }}
                      />
                    </div>
                    {storeCategories.length > 0 && (
                      <div className="mt-2 relative">
                        <p className="text-[10px] text-[var(--text-tertiary)] mb-0.5">Store category</p>
                        <button
                          type="button"
                          disabled={saveStatus[i] === "saved"}
                          onClick={() => setStoreCategoryPickerOpen((prev) => (prev === i ? null : i))}
                          className="tap text-xs font-semibold rounded-lg px-3 py-1.5 border w-full text-left truncate"
                          style={
                            storeCategoryChoice[i]
                              ? { background: "var(--accent-tint)", borderColor: "var(--accent)", color: "var(--accent)" }
                              : { background: "var(--glass)", borderColor: "var(--glass-line)", color: "var(--text-secondary)" }
                          }
                        >
                          {storeCategoryChoice[i]?.path ?? "No store category — tap to pick"}
                        </button>
                        {storeCategoryPickerOpen === i && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={() => setStoreCategoryPickerOpen(null)} />
                            <div
                              className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto card p-1"
                              style={{ background: "var(--bg-surface)" }}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setStoreCategoryChoice((prev) => ({ ...prev, [i]: null }));
                                  setStoreCategoryPickerOpen(null);
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
                                    setStoreCategoryChoice((prev) => ({ ...prev, [i]: c }));
                                    setStoreCategoryPickerOpen(null);
                                  }}
                                  className="tap w-full text-left text-xs px-2 py-1.5 rounded truncate"
                                  style={
                                    storeCategoryChoice[i]?.id === c.id
                                      ? { background: "var(--accent-tint)", color: "var(--accent)" }
                                      : undefined
                                  }
                                >
                                  {c.path}
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                    <textarea
                      className="input w-full text-xs mt-1"
                      rows={2}
                      placeholder="Flaws (e.g. small stain on sleeve)"
                      value={result.flaws}
                      disabled={saveStatus[i] === "saved"}
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
                        value={costs[i] ?? ""}
                        onChange={(e) => setCosts((prev) => ({ ...prev, [i]: e.target.value }))}
                        className="input w-full pl-6"
                      />
                    </div>
                  </div>

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
                    <p className="text-xs mb-2" style={{ color: "var(--danger)" }}>
                      {saveErrors[i] || "Could not save draft. Try again."}
                    </p>
                  )}
                  {photoUploadWarnings[i] && (
                    <div className="text-xs mb-2 flex items-center gap-2" style={{ color: "var(--danger)" }}>
                      {photoUploadWarnings[i]}
                      <button
                        type="button"
                        className="underline font-medium whitespace-nowrap"
                        onClick={() => void handleSaveDraft(i)}
                        disabled={status === "saving" || listingAll}
                      >
                        Retry uploads
                      </button>
                    </div>
                  )}
                  {listStatus[i] === "error" && listErrors[i] && (
                    <p className="text-xs mb-2" style={{ color: "var(--danger)" }}>
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
                    <p className="text-xs mb-2" style={{ color: "var(--warning-border)" }}>
                      Listed, but eBay wants these fields for this category and the AI
                      couldn&apos;t tell: <strong>{listMissingAspects[i].join(", ")}</strong>.
                      {listedUrls[i] && (
                        <>
                          {" "}
                          <a href={listedUrls[i]} target="_blank" rel="noopener noreferrer" className="underline font-medium">
                            Open the listing on eBay to add them →
                          </a>
                        </>
                      )}
                    </p>
                  )}
                  {listStatus[i] === "listed" && listStoreCategoryWarnings[i] && (
                    <p className="text-xs mb-2" style={{ color: "var(--warning-border)" }}>{listStoreCategoryWarnings[i]}</p>
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
                        <Check className="w-4 h-4" style={{ color: "var(--success)" }} />
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
      style={{ background: highlight ? "color-mix(in srgb, var(--success) 14%, var(--bg-page))" : "var(--bg-page)" }}
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
