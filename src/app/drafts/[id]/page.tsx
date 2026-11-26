"use client";

import { rememberDeleted } from "@/lib/deleted-drafts";
import CurrencyInput from "@/components/CurrencyInput";
import PriceFloorFields from "@/components/PriceFloorFields";
import DraftExtrasFields from "@/components/DraftExtrasFields";
import StoreIntroHint from "@/components/StoreIntroHint";
import { checkPriceAndFloor, moneyText } from "@/lib/offer-floor";
import Sheet from "@/components/Sheet";
import PhotoDropZone from "@/components/PhotoDropZone";
import CompsPanel from "@/components/CompsPanel";
import SpecificsEditor from "@/components/SpecificsEditor";
import { sanitizeStoredSpecifics, type StoredSpecificsShape } from "@/lib/item-specifics";
import { useIsDesktop } from "@/lib/use-is-desktop";
import PhotoViewer from "@/components/PhotoViewer";
import { Z } from "@/lib/z-layers";
import { EditorSkeleton } from "@/components/ui";
import { confirmAction } from "@/lib/confirm";
import { formatMoney } from "@/lib/format";
import { use, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, Check, Trash2, Upload, ExternalLink, Sparkles, BadgeCheck, Camera, X, RefreshCw, Copy, ChevronLeft, ChevronRight, GripVertical, ShieldCheck, CalendarClock } from "lucide-react";
import { estimateShipping, type ShippingMode } from "@/lib/shipping";
import { apiFetch } from "@/lib/api";
import { uploadThumbnail } from "@/lib/storage";
import { AiResult } from "@/lib/ai-result";
import { matchStoreCategoryByKeyword, StoreCategoryLite } from "@/lib/store-category-match";
import AIDisclaimer from "@/components/AIDisclaimer";
import FinishOnEbaySheet from "@/components/FinishOnEbaySheet";
import { FINISH_SCHEDULE_DAYS, FEE_NOTE, hasSeenFinishExplainer, markFinishExplainerSeen } from "@/lib/finish-on-ebay";
import { getListingReadiness } from "@/lib/listing-readiness";

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
  /** Migration 035; absent before it is applied. */
  best_offer_floor?: number | string | null;
  cost_basis: number | null;
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
  item_specifics?: unknown;
  ebay_listing_id: string | null;
  store_category_id: string | null;
  store_category_name: string | null;
  is_heavy: boolean | null;
  shipping_cost: number | null;
  shipping_mode: ShippingMode | null;
  updated_at: string;
}

export default function DraftDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const isDesktop = useIsDesktop();
  // eBay item specifics (drafts.item_specifics) + required ones still empty.
  const [specifics, setSpecifics] = useState<StoredSpecificsShape | null>(null);
  const [missingSpecifics, setMissingSpecifics] = useState<string[]>([]);
  const specificsTouched = useRef(false);
  const [categoryIssues, setCategoryIssues] = useState<string[]>([]);
  const { id } = use(params);
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const draftUpdatedAt = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [listing, setListing] = useState(false);
  // "Check with eBay": VerifyAddFixedPriceItem only -- validates the listing
  // and shows the fees without listing anything.
  const [checking, setChecking] = useState(false);
  // Two-way sync (src/lib/ebay-sync.ts): the live listing's fingerprint when
  // this editor opened, sent back with "Update on eBay" so changes made in
  // the eBay app meanwhile are never overwritten silently.
  const ebayBaseHash = useRef<string | null>(null);
  const [ebaySync, setEbaySync] = useState<null | "updated" | "conflict" | "ended">(null);
  const [checkResult, setCheckResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [showPublishReview, setShowPublishReview] = useState(false);
  const [listingUrl, setListingUrl] = useState<string | null>(null);
  const [justListed, setJustListed] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [needsConnect, setNeedsConnect] = useState(false);
  const [reanalyzePhotos, setReanalyzePhotos] = useState<Array<{ data: string; mediaType: string; previewUrl: string }>>([]);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [isHeavy, setIsHeavy] = useState(false);
  const [shippingCost, setShippingCost] = useState("");
  const [shippingMode, setShippingMode] = useState<ShippingMode>("calculated");
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [photoEditorLayout, setPhotoEditorLayout] = useState<"carousel" | "grid">("carousel");
  const photoScrollerRef = useRef<HTMLDivElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  // The fixed bottom action bar grows (listed link, warnings, two rows of
  // buttons); its real height pads the page so it never covers the photos
  // or the last fields (it used to be a fixed pb-32).
  const [bottomBarH, setBottomBarH] = useState(140);
  const bottomBarObserver = useRef<ResizeObserver | null>(null);
  const bottomBarRef = useCallback((el: HTMLDivElement | null) => {
    bottomBarObserver.current?.disconnect();
    bottomBarObserver.current = null;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setBottomBarH(Math.ceil(el.getBoundingClientRect().height)));
    ro.observe(el);
    bottomBarObserver.current = ro;
  }, []);
  const [photoUndo, setPhotoUndo] = useState<string[] | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);
  const [zoomedPhoto, setZoomedPhoto] = useState<string | null>(null);
  const [refreshingPrice, setRefreshingPrice] = useState(false);
  const [missingAspectsWarning, setMissingAspectsWarning] = useState<string[] | null>(null);
  const [storeCategoryWarning, setStoreCategoryWarning] = useState<string | null>(null);
  // Store category: the seller's real eBay Store Categories, fetched once
  // on mount (empty if eBay isn't connected or none are set up, in which
  // case the picker below just doesn't render). storeCategoryId/Name are
  // this draft's current choice -- seeded once by the free keyword match
  // (and the AI pass too, if Settings -> "Store category suggestions" has
  // AI suggestions on) the first time this draft loads with no category
  // already set, and always overridable by hand via the chip below. See
  // src/lib/store-category-match.ts and
  // src/app/api/ebay/store-categories/suggest/route.ts.
  const [storeCategories, setStoreCategories] = useState<StoreCategoryLite[]>([]);
  const [storeCategoryId, setStoreCategoryId] = useState<string | null>(null);
  const [storeCategoryName, setStoreCategoryName] = useState<string | null>(null);
  const [storeCategoryPickerOpen, setStoreCategoryPickerOpen] = useState(false);
  const [aiStoreCategorySuggestions, setAiStoreCategorySuggestions] = useState(false);
  const [suggestingStoreCategory, setSuggestingStoreCategory] = useState(false);
  const autoSuggestedStoreCategoryRef = useRef(false);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const photoDragTimer = useRef<number | null>(null);
  const photoDragIdx = useRef<number | null>(null);
  const photoDropIdx = useRef<number | null>(null);
  const photoDragTarget = useRef<HTMLElement | null>(null);
  const photoPointerId = useRef<number | null>(null);
  const activePhotoDrag = useRef(false);
  const photoDragOriginal = useRef<string[] | null>(null);
  const photoDragWorking = useRef<string[]>([]);
  const photoRefs = useRef<(HTMLDivElement | null)[]>([]);
  const photoAutoScrollFrame = useRef<number | null>(null);
  const photoPointer = useRef<{ x: number; y: number } | null>(null);

  const [title, setTitle] = useState("");
  const [brand, setBrand] = useState("");
  const [color, setColor] = useState("");
  const [size, setSize] = useState("");
  const [condition, setCondition] = useState("");
  const [flaws, setFlaws] = useState("");
  const [price, setPrice] = useState("");
  // Best Offer floor ("" = no offers).
  const [floor, setFloor] = useState("");
  const priceCheck = checkPriceAndFloor(price, floor);
  const [cost, setCost] = useState(""); // cost_basis (migration 017, src/lib/profit.ts)
  // Bin + auto-offer opt-in (migrations 041/042); undefined = column not there yet.
  const [extras, setExtras] = useState<{ bin: string | null | undefined; optIn: boolean | undefined } | null>(null);
  const [customSku, setCustomSku] = useState("");
  const initialCustomSku = useRef<string | null>(null);
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
  const draftLoadedRef = useRef(false);
  const autosaveTimer = useRef<number | null>(null);
  const draftSaveQueue = useRef(Promise.resolve());

  useEffect(() => {
    async function load() {
      // Convert null or the string "null" (from old AI responses) to empty string
      const str = (v: string | null | undefined) => (v == null || v === "null" ? "" : v);
      try {
        const data = await apiFetch<{ draft: Draft; error?: string }>(`/api/drafts/${id}`);
        const d: Draft = data.draft;
        setDraft(d);
        draftUpdatedAt.current = d.updated_at;
        setPhotoUrls(d.photo_urls ?? []);
        // Priority: an unsynced local choice (localStorage, pre-dates the
        // is_heavy/shipping_cost columns and could still hold an edit that
        // hasn't made it to the draft row yet) beats the draft's own saved
        // value, which beats an AI-estimated default. Once this page's own
        // Save/List path runs again below, the DB value becomes current and
        // the localStorage copy is cleared, so this fallback chain is only
        // ever needed for a draft not yet touched under the new behavior.
        const savedHeavy = localStorage.getItem(`heavy-${id}`);
        const savedShippingCost = localStorage.getItem(`shippingCost-${id}`);
        localStorage.removeItem(`shippingMode-${id}`); // pre-calculated-only leftover
        if (savedHeavy) {
          setIsHeavy(JSON.parse(savedHeavy));
        } else if (d.is_heavy != null) {
          setIsHeavy(d.is_heavy);
        } else {
          // No explicit choice saved yet — auto-fill from the AI-detected
          // item type/size/material instead of defaulting to "not heavy"
          // blindly, and auto-fill an actual estimated dollar cost too.
          const shipEstimate = estimateShipping(d.item_type, d.size, d.material);
          setIsHeavy(shipEstimate.isHeavy);
          if (!savedShippingCost && shipEstimate.isHeavy) {
            setShippingCost(String(shipEstimate.cost));
          }
        }
        if (savedShippingCost) {
          setShippingCost(savedShippingCost);
        } else if (d.shipping_cost != null) {
          setShippingCost(String(d.shipping_cost));
        }
        // Calculated shipping only (Nov 15, 2026): older drafts saved as
        // "free"/"buyer_pays" are shown -- and published -- as calculated.
        setShippingMode("calculated");
        setTitle(str(d.title));
        setBrand(str(d.brand));
        setColor(str(d.color));
        setSize(str(d.size));
        setCondition(str(d.condition));
        setFlaws(str(d.flaws));
        setPrice(d.suggested_price != null ? String(d.suggested_price) : "");
        setFloor(d.best_offer_floor != null && d.best_offer_floor !== "" ? moneyText(Number(d.best_offer_floor)) : "");
        setCost(d.cost_basis != null ? String(d.cost_basis) : "");
        setExtras({
          bin: "bin_location" in d ? ((d.bin_location as string | null) ?? null) : undefined,
          optIn: "auto_offer_opt_in" in d ? !!d.auto_offer_opt_in : undefined,
        });
        const loadedSku = str(d.custom_sku).trim();
        initialCustomSku.current = loadedSku || null;
        setCustomSku(loadedSku);
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
        setSpecifics(sanitizeStoredSpecifics(d.item_specifics));
        setStoreCategoryId(d.store_category_id ?? null);
        setStoreCategoryName(d.store_category_name ?? null);
        if (d.ebay_listing_id) {
          setListingUrl(`https://www.ebay.com/itm/${d.ebay_listing_id}`);
          // Re-read the live listing in the background (eBay-app edits).
          void syncWithEbay(false);
        }
        draftLoadedRef.current = true;
      } catch (err) {

        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per draft; syncWithEbay only reads stable refs/setters
  }, [id]);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        setAiStoreCategorySuggestions(!!data.aiStoreCategorySuggestions);
        setPhotoEditorLayout(data.photoEditorLayout === "grid" ? "grid" : "carousel");
      })
      .catch(() => {});
    fetch("/api/ebay/store-categories")
      .then((r) => r.json())
      .then((data) => setStoreCategories(Array.isArray(data.categories) ? data.categories : []))
      .catch(() => {});
  }, []);

  const formSignature = JSON.stringify({
    title, brand, color, size, condition, flaws, price, floor, cost, customSku,
    itemType, style, material, theme, sleeveLength, neckline, fit, pattern,
    description, vintage, character, characterFamily, yearManufactured, season,
    storeCategoryId, storeCategoryName, shippingMode, isHeavy, shippingCost,
  });

  useEffect(() => {
    if (!draftLoadedRef.current || loading || listing || saving || reanalyzing) return;
    if (autosaveTimer.current !== null) window.clearTimeout(autosaveTimer.current);
    autosaveTimer.current = window.setTimeout(() => {
      void saveDraft().then(() => {
        setSaved(true);
        window.setTimeout(() => setSaved(false), 2000);
      }).catch((err) => {
        setError((err as Error).message);
      });
    }, 800);
    return () => {
      if (autosaveTimer.current !== null) window.clearTimeout(autosaveTimer.current);
    };
  }, [formSignature, loading, listing, saving, reanalyzing]);

  async function requestStoreCategoryAi(d: {
    title: string | null;
    item_type: string | null;
    brand: string | null;
    color: string | null;
    description: string | null;
  }): Promise<StoreCategoryLite | null> {
    const data = await apiFetch<{ categoryId: string | null; categoryPath: string | null }>(
      "/api/ebay/store-categories/suggest",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: d.title,
          itemType: d.item_type,
          brand: d.brand,
          color: d.color,
          description: d.description,
        }),
      }
    );
    if (!data.categoryId) return null;
    return (
      storeCategories.find((c) => c.id === data.categoryId) ??
      (data.categoryPath ? { id: data.categoryId, name: data.categoryPath, path: data.categoryPath } : null)
    );
  }

  // Seeds a store category suggestion the first time this draft loads with
  // none already set -- once per page visit (autoSuggestedStoreCategoryRef
  // guards against re-firing if the seller deliberately clears it via the
  // picker below). Free keyword match runs unconditionally; the AI pass
  // only runs if Settings -> "Store category suggestions" -> AI
  // suggestions is on, and only upgrades the choice if it finds a match.
  useEffect(() => {
    if (autoSuggestedStoreCategoryRef.current) return;
    if (!draft || storeCategories.length === 0) return;
    if (draft.store_category_id) return;
    autoSuggestedStoreCategoryRef.current = true;

    const keywordMatch = matchStoreCategoryByKeyword(
      { title: draft.title, itemType: draft.item_type, brand: draft.brand },
      storeCategories
    );
    if (keywordMatch) {
      setStoreCategoryId(keywordMatch.id);
      setStoreCategoryName(keywordMatch.path);
    }

    if (aiStoreCategorySuggestions) {
      setSuggestingStoreCategory(true);
      requestStoreCategoryAi(draft)
        .then((aiMatch) => {
          if (aiMatch) {
            setStoreCategoryId(aiMatch.id);
            setStoreCategoryName(aiMatch.path);
          }
        })
        .catch(() => {})
        .finally(() => setSuggestingStoreCategory(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, storeCategories, aiStoreCategorySuggestions]);

  async function handleSuggest() {
    setSuggesting(true);
    setError(null);
    try {
      const data = await apiFetch<{ error?: string; item_type?: string; style?: string; material?: string; theme?: string; sleeve_length?: string; neckline?: string; fit?: string; pattern?: string; description?: string; vintage?: string; character?: string; character_family?: string; year_manufactured?: string; season?: string }>("/api/ai/suggest-specifics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, brand, color, size, condition, flaws }),
      });
      const ok = (v: unknown): v is string => typeof v === "string" && v !== "null" && v.length > 0;
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

  function getDraftPayload() {
    const normalizedSku = customSku.trim() || null;
    const payload: Record<string, unknown> = {
      title, brand, color, size, condition, flaws,
      costBasis: cost ? Number(cost) : null,
      itemType, style, material, theme,
      sleeveLength, neckline, fit, pattern, description,
      vintage, character, characterFamily, yearManufactured, season,
      storeCategoryId, storeCategoryName,
      shippingMode,
      isHeavy: shippingMode === "buyer_pays",
      shippingCost: shippingMode === "buyer_pays" && shippingCost ? Number(shippingCost) : null,
    };
    // Invalid price/floor isn't saved -- the inline error shows instead.
    // A blank price still saves as "no price" (same as before).
    if (!priceCheck.priceError) payload.suggestedPrice = priceCheck.price;
    else if (!price.trim()) payload.suggestedPrice = null;
    if (priceCheck.ok) payload.bestOfferFloor = priceCheck.floor;
    if (normalizedSku !== initialCustomSku.current) payload.customSku = normalizedSku;
    if (specificsTouched.current && specifics) payload.itemSpecifics = specifics;
    return payload;
  }

  async function saveDraft(extra: Record<string, unknown> = {}) {
    const payload = getDraftPayload();
    const save = draftSaveQueue.current.catch(() => undefined).then(async () => {
      const response = await apiFetch<{ draft?: Draft }>(`/api/drafts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, ...extra, expectedUpdatedAt: draftUpdatedAt.current }),
      });
      if (response.draft?.updated_at) {
        draftUpdatedAt.current = response.draft.updated_at;
        setDraft((current) => current ? { ...current, updated_at: response.draft!.updated_at } : current);
      }
      initialCustomSku.current = customSku.trim() || null;
    });
    draftSaveQueue.current = save.then(() => undefined, () => undefined);
    await save;
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      await saveDraft();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleList() {
    const readiness = getListingReadiness({
      photoCount: photoUrls.length,
      title,
      price: priceCheck.price,
      bestOfferFloor: floor,
      condition,
      shippingMode,
      missingRequiredSpecifics: missingSpecifics,
      categoryNeedsReview: specifics?.categoryNeedsReview,
      categoryIssues,
    });
    if (!readiness.ready) {
      setError(`Before listing: ${readiness.blockers.join(" • ")}`);
      return;
    }
    setShowPublishReview(true);
  }

  async function syncWithEbay(useEbay: boolean) {
    try {
      const r = await apiFetch<{ status?: string; hash?: string }>("/api/ebay/item/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: id, useEbay }),
      });
      if (r.hash) ebayBaseHash.current = r.hash;
      if (r.status === "updated") {
        // eBay had newer details and nothing was changed here: reload them.
        window.location.reload();
        return;
      }
      setEbaySync(r.status === "conflict" ? "conflict" : r.status === "ended" ? "ended" : null);
    } catch {
      // Offline / eBay hiccup: editing still works; the update re-checks.
    }
  }

  // "Finish on eBay": a real eBay listing scheduled 21 days out, so it shows
  // in the eBay app under Selling → Scheduled, where it can be finished and
  // started with "List it now". Fee wording per eBay's US fees page (Nov 2026).
  // First time: the explainer sheet (why Scheduled, not the eBay Drafts
  // tab). After that: a short confirm.
  const [finishExplainerOpen, setFinishExplainerOpen] = useState(false);
  async function handleFinishOnEbay(fromExplainer = false) {
    if (!fromExplainer && !hasSeenFinishExplainer()) { setFinishExplainerOpen(true); return; }
    if (fromExplainer) {
      markFinishExplainerSeen();
      setFinishExplainerOpen(false);
    } else {
      const ok = await confirmAction({
        title: "Finish this on eBay?",
        message: `It goes to the eBay app under Selling → Scheduled (live in 3 weeks unless you tap "List it now" there). ${FEE_NOTE}`,
        confirmLabel: "Send to the eBay app",
      });
      if (!ok) return;
    }
    setListing(true);
    setError(null);
    try {
      await saveDraft();
      const data = await apiFetch<{ success?: boolean; error?: string; listingId?: string; url?: string; scheduledFor?: string; connect?: boolean; reconnect?: boolean }>("/api/ebay/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: id, customSku: customSku || undefined, scheduleDays: FINISH_SCHEDULE_DAYS }),
      });
      if (data.connect) { setNeedsConnect(true); throw new Error(data.error ?? "Connect eBay first"); }
      if (data.reconnect) { setNeedsReconnect(true); throw new Error(data.error ?? "Reconnect eBay"); }
      if (!data.success || !data.listingId) throw new Error(data.error ?? "eBay didn't schedule it");
      await saveDraft({ ebayListingId: String(data.listingId) });
      setListingUrl(data.url ?? null);
      setCheckResult({ ok: true, text: `Scheduled on eBay${data.scheduledFor ? ` for ${new Date(data.scheduledFor).toLocaleDateString([], { month: "short", day: "numeric" })}` : ""}. Finish it in the eBay app (Selling → Scheduled) or here.` });
      window.dispatchEvent(new Event("listflow:counts-changed"));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setListing(false);
    }
  }

  async function handleCheckWithEbay() {
    if (!priceCheck.ok) {
      setCheckResult({ ok: false, text: priceCheck.priceError ?? `Offer floor: ${priceCheck.floorError}` });
      return;
    }
    setChecking(true);
    setCheckResult(null);
    try {
      await saveDraft();
      const res = await fetch("/api/ebay/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: id, customSku: customSku || undefined, verifyOnly: true }),
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string; feesTotal?: number | null; warnings?: string[]; missingRequiredAspects?: string[]; connect?: boolean; reconnect?: boolean };
      if (data.connect) setNeedsConnect(true);
      if (data.reconnect) setNeedsReconnect(true);
      if (data.success) {
        const fee = typeof data.feesTotal === "number" ? ` eBay's listing fee estimate: ${data.feesTotal === 0 ? "$0.00" : `$${data.feesTotal.toFixed(2)}`}.` : "";
        const extra = [
          data.missingRequiredAspects?.length ? `Still empty (recommended): ${data.missingRequiredAspects.join(", ")}.` : "",
          data.warnings?.length ? `eBay notes: ${data.warnings.join(" · ")}` : "",
        ].filter(Boolean).join(" ");
        setCheckResult({ ok: true, text: `eBay accepted this listing — nothing was listed.${fee} ${extra}`.trim() });
      } else {
        setCheckResult({ ok: false, text: data.error ?? "eBay didn't accept this listing." });
      }
    } catch (err) {
      setCheckResult({ ok: false, text: (err as Error).message });
    } finally {
      setChecking(false);
    }
  }

  async function handlePublish(forceOverwrite = false) {
    setListing(true);
    setShowPublishReview(false);
    setError(null);
    try {
      // Auto-save current form values first so the listing API uses the latest data.
      // The listing call reads the draft back from the database, so if this
      // save silently failed, it would previously go on to list whatever
      // stale data was already there with no warning at all.
      await saveDraft();

      const data = await apiFetch<{ connect?: boolean; reconnect?: boolean; conflict?: boolean; error?: string; missingRequiredAspects?: string[]; url?: string; listingId?: string; storeCategoryWarning?: string }>("/api/ebay/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: id,
          customSku: customSku || undefined,
          shippingMode,
          isHeavy: shippingMode === "buyer_pays",
          shippingCost: shippingMode === "buyer_pays" && shippingCost ? parseFloat(shippingCost) : undefined,
          // This is the one call site that should be allowed to change an
          // already-live listing (Trading API: revised in place, same item
          // number) -- the button reads "Update on eBay"
          // once `listingUrl` is set (see its label below), so the request
          // makes that same true/false explicit to the server's idempotent-
          // publish guard instead of leaving it to infer intent.
          allowRelist: Boolean(listingUrl),
          baseHash: ebayBaseHash.current ?? undefined,
          force: forceOverwrite || undefined,
        }),
      });
      if (data.conflict) {
        setListing(false);
        if (await confirmAction({
          title: "This listing was changed on eBay",
          message: "Someone (maybe you, in the eBay app) edited it after you opened it here. Update anyway and replace eBay's version with this one?",
          confirmLabel: "Replace eBay's version",
          destructive: true,
        })) return handlePublish(true);
        setEbaySync("conflict");
        return;
      }
      if (data.connect) { setNeedsConnect(true); throw new Error(data.error ?? "Failed to list"); }
      if (data.reconnect) { setNeedsReconnect(true); throw new Error(data.error ?? "Failed to list"); }
      // Save all form values + ebay_listing_id together so nothing gets wiped
      if (data.listingId) {
        await saveDraft({ ebayListingId: String(data.listingId) });
      }
      setListingUrl(data.url ?? null);
      setJustListed(true);
      setMissingAspectsWarning(data.missingRequiredAspects && data.missingRequiredAspects.length > 0 ? data.missingRequiredAspects : null);
      setStoreCategoryWarning(data.storeCategoryWarning ?? null);
      localStorage.removeItem(`heavy-${id}`);
      localStorage.removeItem(`shippingCost-${id}`);
      localStorage.removeItem(`shippingMode-${id}`);
      window.dispatchEvent(new Event("listflow:counts-changed"));
      setTimeout(() => router.push("/inventory?status=live"), 1500);
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
      const data = await apiFetch<AiResult>("/api/analyze-item", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images: reanalyzePhotos.map((p) => ({ data: p.data, mediaType: p.mediaType })) }),
      });
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

      // Merge the photos Sel retook specifically to fix this draft into the
      // listing's own photos instead of discarding them once the AI has
      // read them -- previously these were sent to analyze-item purely to
      // refresh text fields and then thrown away, which is surprising: a
      // seller who retakes a flaw/measurement shot expects it to become a
      // real listing photo, not vanish with no indication why.
      const uploadedUrls = (
        await Promise.all(
          reanalyzePhotos.map(async (p) => {
            try {
              return await uploadThumbnail(p.previewUrl);
            } catch {
              return null;
            }

          })
        )
      ).filter((u): u is string => !!u);
      if (uploadedUrls.length > 0) {
        const nextPhotoUrls = [...photoUrls, ...uploadedUrls];
        setPhotoUrls(nextPhotoUrls);
        await apiFetch(`/api/drafts/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            photoUrls: nextPhotoUrls,
            ...(photoUrls.length === 0 ? { thumbnailUrl: nextPhotoUrls[0] } : {}),
          }),
        });
      }
      setReanalyzePhotos([]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setReanalyzing(false);
    }
  }

  async function savePhotoUrls(next: string[], previous: string[]) {
    setPhotoUndo(previous);
    setPhotoUrls(next);
    setDraft((prev) => prev ? { ...prev, photo_urls: next, thumbnail_url: next[0] ?? null } : prev);
    try {
      await apiFetch(`/api/drafts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoUrls: next, thumbnailUrl: next[0] ?? null }),
      });
    } catch (err) {
      setPhotoUrls(previous);
      setDraft((prev) => prev ? { ...prev, photo_urls: previous, thumbnail_url: previous[0] ?? null } : prev);
      throw err;
    }
  }

  async function handleUndoPhotoChange() {
    if (!photoUndo) return;
    const previous = photoUrls;
    try {
      await savePhotoUrls(photoUndo, previous);
      setPhotoUndo(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Drag-and-drop / paste / multi-select on computers: add each in turn.
  async function handleAddListingPhotos(files: File[]) {
    for (const f of files) await handleAddListingPhoto(f);
  }

  async function handleAddListingPhoto(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Could not read photo"));
        reader.readAsDataURL(file);
      });
      const url = await uploadThumbnail(dataUrl);
      await savePhotoUrls([...photoUrls, url], photoUrls);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleDeleteListingPhoto(index: number) {
    const next = photoUrls.filter((_, i) => i !== index);
    try {
      await savePhotoUrls(next, photoUrls);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function moveListingPhoto(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= photoUrls.length) return;
    const next = [...photoUrls];
    [next[index], next[target]] = [next[target], next[index]];
    try {
      await savePhotoUrls(next, photoUrls);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleRefreshPrice() {
    setRefreshingPrice(true);
    setError(null);
    try {
      const data = await apiFetch<{ error?: string; noData?: boolean; suggestedPrice?: number; avgSold?: number; activeRangeLow?: number; activeRangeHigh?: number; sellOdds?: string }>("/api/pricing/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, brand, condition, isHeavy, itemType, size }),
      });
      if (!data.noData) {
        if (data.suggestedPrice) setPrice(String(data.suggestedPrice));
        setDraft((prev) => prev ? {
          ...prev,
          avg_sold: data.avgSold ?? prev.avg_sold,
          active_range_low: data.activeRangeLow ?? prev.active_range_low,
          active_range_high: data.activeRangeHigh ?? prev.active_range_high,
          sell_odds: data.sellOdds ?? prev.sell_odds,
        } : prev);
        await apiFetch(`/api/drafts/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...getDraftPayload(),
            suggestedPrice: data.suggestedPrice ?? (price ? Number(price) : null),
            // A new price at/below the saved floor: keep the floor as saved
            // (the inline error asks to fix it before listing).
            ...(checkPriceAndFloor(data.suggestedPrice ?? price, floor).ok ? {} : { bestOfferFloor: undefined }),
            storeCategoryId, storeCategoryName,
            avgSold: data.avgSold ?? null,
            activeRangeLow: data.activeRangeLow ?? null,
            activeRangeHigh: data.activeRangeHigh ?? null,
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
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pointerStart.current = { x: e.clientX, y: e.clientY };
    photoDragIdx.current = idx;
    photoDragOriginal.current = [...photoUrls];
    photoDragWorking.current = [...photoUrls];
    photoDropIdx.current = null;
    photoDragTarget.current = e.currentTarget as HTMLElement;
    photoPointerId.current = e.pointerId;
    activePhotoDrag.current = false;
    photoDragTimer.current = window.setTimeout(() => {
      photoDragTimer.current = null;
      activePhotoDrag.current = true;
      setDragIdx(idx);
      photoDragTarget.current?.setPointerCapture(photoPointerId.current as number);
    }, 350);
  }

  function updatePhotoAtPointer(x: number, y: number) {
    const cards = photoRefs.current.filter((card): card is HTMLDivElement => card !== null);
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
    const targetIndex = Number(target.dataset.photoIndex);
    const rect = target.getBoundingClientRect();
    const slot = x < rect.left + rect.width / 2 ? targetIndex : targetIndex + 1;
    const from = photoDragIdx.current;
    if (from === null) return;
    const insertionIndex = slot > from ? slot - 1 : slot;
    if (insertionIndex === from) {
      setDropIdx(insertionIndex);
      return;
    }
    const next = [...photoDragWorking.current];
    const [item] = next.splice(from, 1);
    next.splice(insertionIndex, 0, item);
    photoDragWorking.current = next;
    photoDragIdx.current = insertionIndex;
    setPhotoUrls(next);
    setDraft((prev) => prev ? { ...prev, photo_urls: next, thumbnail_url: next[0] ?? null } : prev);
    setDropIdx(insertionIndex);
  }

  function stopPhotoAutoScroll() {
    if (photoAutoScrollFrame.current !== null) cancelAnimationFrame(photoAutoScrollFrame.current);
    photoAutoScrollFrame.current = null;
    photoPointer.current = null;
  }

  function runPhotoAutoScroll() {
    const pointer = photoPointer.current;
    const scroller = photoScrollerRef.current;
    if (!pointer || !scroller || photoEditorLayout !== "carousel") {
      photoAutoScrollFrame.current = null;
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
      updatePhotoAtPointer(pointer.x, pointer.y);
    }
    photoAutoScrollFrame.current = requestAnimationFrame(runPhotoAutoScroll);
  }

  function onPhotoPMove(e: React.PointerEvent) {
    if (photoDragTimer.current && pointerStart.current) {
      const moved = Math.abs(e.clientX - pointerStart.current.x) > 8 || Math.abs(e.clientY - pointerStart.current.y) > 8;
      if (moved) {
        clearTimeout(photoDragTimer.current);
        photoDragTimer.current = null;
        // A mouse can't press-and-hold-then-drag naturally: moving with the
        // button down starts the reorder right away (a plain click still
        // opens the photo).
        if (e.pointerType === "mouse" && photoDragIdx.current !== null) {
          activePhotoDrag.current = true;
          setDragIdx(photoDragIdx.current);
          photoDragTarget.current?.setPointerCapture(e.pointerId);
        }
      }
    }
    if (photoDragIdx.current === null || !activePhotoDrag.current) return;
    e.preventDefault();
    photoPointer.current = { x: e.clientX, y: e.clientY };
    if (photoAutoScrollFrame.current === null) photoAutoScrollFrame.current = requestAnimationFrame(runPhotoAutoScroll);
    updatePhotoAtPointer(e.clientX, e.clientY);
  }

  function onPhotoPUp(e: React.PointerEvent, url: string) {
    if (photoDragTimer.current) {
      clearTimeout(photoDragTimer.current);
      photoDragTimer.current = null;
    }
    const start = pointerStart.current;
    const moved = start && (Math.abs(e.clientX - start.x) > 8 || Math.abs(e.clientY - start.y) > 8);
    const original = photoDragOriginal.current;
    const finalOrder = photoDragWorking.current;
    const wasDragging = activePhotoDrag.current;
    photoDragIdx.current = null;
    photoDropIdx.current = null;

    if (wasDragging && original && JSON.stringify(finalOrder) !== JSON.stringify(original)) {
        void savePhotoUrls(finalOrder, original).catch((err) => {
          setError((err as Error).message);
        });
    } else if (!moved && !wasDragging) {
      setZoomedPhoto(url);
    }
    stopPhotoAutoScroll();

    if (photoPointerId.current !== null && photoDragTarget.current?.hasPointerCapture(photoPointerId.current)) {
      photoDragTarget.current.releasePointerCapture(photoPointerId.current);
    }
    setDragIdx(null);
    setDropIdx(null);
    pointerStart.current = null;
    photoDragTarget.current = null;
    photoPointerId.current = null;
    activePhotoDrag.current = false;
    photoDragOriginal.current = null;
    photoDragWorking.current = [];
  }

  async function handleDelete() {
    if (!(await confirmAction({ title: "Delete this draft?", message: "It moves to Inventory → Draft → Recently deleted for 7 days (you can restore it there), then it's removed with its photos for good. If the recycle bin isn't switched on yet, it's deleted right away.", confirmLabel: "Delete", destructive: true }))) return;
    setDeleting(true);
    try {
      await apiFetch(`/api/drafts/${id}`, { method: "DELETE" });
      rememberDeleted([id]); // no saved copy on this device can show it again
      router.push("/inventory?status=draft");
    } catch (err) {
      setError((err as Error).message);
      setDeleting(false);
    }
  }

  // Spins off a fresh draft with this one's details (title, brand,
  // condition, all the eBay item-specifics fields) but no photos/SKU/
  // listing ID — see the duplicate route's own comment for why. Useful for
  // listing near-identical items (same shirt in another size, more of the
  // same lot) without redoing the whole AI-analysis flow each time.
  async function handleDuplicate() {
    setDuplicating(true);
    setError(null);
    try {
      const data = await apiFetch<{ draft?: { id?: string }; error?: string }>(`/api/drafts/${id}/duplicate`, {
        method: "POST",
      });
      if (data.error || !data.draft?.id) throw new Error(data.error ?? "Could not duplicate this draft");
      router.push(`/drafts/${data.draft.id}`);
    } catch (err) {
      setError((err as Error).message);
      setDuplicating(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen max-w-md lg:max-w-[1360px] mx-auto px-5 lg:px-8 pt-6 lg:pt-8" style={{ viewTransitionName: "draft-detail" }}>
        <Link href="/inventory?status=draft" className="inline-flex mb-4">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <EditorSkeleton />
      </main>
    );
  }

  if (error && !draft) {
    return (
      <main className="min-h-screen max-w-md lg:max-w-[1360px] mx-auto px-5 lg:px-8 pt-6 lg:pt-8" style={{ viewTransitionName: "draft-detail" }}>
        <Link href="/inventory?status=draft" className="inline-flex mb-4">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="card p-4" style={{ color: "var(--danger)" }}>{error}</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen max-w-md lg:max-w-[1360px] mx-auto px-5 lg:px-8 pt-6 lg:pt-8" style={{ viewTransitionName: "draft-detail", paddingBottom: `calc(${bottomBarH}px + var(--tray-offset, 0px) + 28px)`, ["--editor-bar-h" as string]: `${bottomBarH}px` }}>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link href={draft?.ebay_listing_id ? "/inventory?status=live" : "/inventory?status=draft"}>
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-xl font-medium">Edit draft</h1>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleDuplicate}
            disabled={duplicating}
            title="Duplicate this item — start a new draft with the same details"
            className="p-2 rounded-lg hover:bg-[var(--bg-page)]"
          >
            {duplicating ? (
              <Loader2 className="w-4 h-4 animate-spin" style={{ color: "var(--text-secondary)" }} />
            ) : (
              <Copy className="w-4 h-4" style={{ color: "var(--text-secondary)" }} />
            )}
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="p-2 rounded-lg hover:bg-[var(--bg-page)]"
          >
            {deleting ? (
              <Loader2 className="w-4 h-4 animate-spin" style={{ color: "var(--danger)" }} />
            ) : (
              <Trash2 className="w-4 h-4" style={{ color: "var(--danger)" }} />
            )}
          </button>
        </div>
      </div>

      {error && (
        <div className="card p-3 mb-4 text-sm" style={{ color: "var(--danger)" }}>
          {error}
          {needsConnect && (
            <a href="/api/ebay/connect" className="underline ml-2 font-medium">Connect eBay →</a>
          )}
          {needsReconnect && (
            <a href="/api/ebay/connect" className="underline ml-2 font-medium">Reconnect eBay →</a>
          )}
        </div>
      )}

      {missingAspectsWarning && missingAspectsWarning.length > 0 && (
        <div className="card p-3 mb-4 text-sm" style={{ borderColor: "var(--warning-border)", background: "var(--warning-bg)", color: "var(--warning-border)" }}>
          Listed, but eBay lists these as required for this category and the
          AI couldn&apos;t determine them: <strong>{missingAspectsWarning.join(", ")}</strong>.{" "}
          {listingUrl ? (
            <a href={listingUrl} target="_blank" rel="noopener noreferrer" className="underline font-medium">
              Open the listing on eBay to add them →
            </a>
          ) : (
            "Consider editing the listing on eBay to fill them in for better search placement."
          )}
        </div>
      )}

      {ebaySync === "conflict" && (
        <div className="card p-3 mb-4 text-sm" role="alert" style={{ borderColor: "var(--warning-border)", background: "var(--warning-bg)", color: "var(--warning-border)" }}>
          This listing was changed on eBay, and this draft also has changes that aren&apos;t on eBay yet.
          <div className="flex gap-2 mt-2">
            <button type="button" className="btn text-xs py-1.5 px-2.5" onClick={() => void syncWithEbay(true)}>Use eBay&apos;s version</button>
            <button type="button" className="btn text-xs py-1.5 px-2.5" onClick={() => setEbaySync(null)}>Keep mine (Update on eBay to send it)</button>
          </div>
        </div>
      )}
      {ebaySync === "ended" && (
        <div className="card p-3 mb-4 text-sm" role="status">This listing has ended on eBay. Relist it from the Listings page.</div>
      )}

      {checkResult && (
        <div className="card p-3 mb-4 text-sm" role="status" style={checkResult.ok ? { borderColor: "var(--success)" } : { borderColor: "var(--warning-border)", background: "var(--warning-bg)", color: "var(--warning-border)" }}>
          {checkResult.text}
        </div>
      )}

      {storeCategoryWarning && (
        <div className="card p-3 mb-4 text-sm" style={{ borderColor: "var(--warning-border)", background: "var(--warning-bg)", color: "var(--warning-border)" }}>
          {storeCategoryWarning}
        </div>
      )}

      {/* Tap a photo: full-screen viewer over all of this draft's photos. */}
      <PhotoViewer
        photos={photoUrls.length ? photoUrls : zoomedPhoto ? [zoomedPhoto] : []}
        index={zoomedPhoto ? Math.max(0, photoUrls.indexOf(zoomedPhoto)) : null}
        onClose={() => setZoomedPhoto(null)}
        alt={title || "Photo"}
      />

      <Sheet
        open={showPublishReview}
        onClose={() => setShowPublishReview(false)}
        title={listingUrl ? "Review relist/update" : "Review before publishing"}
        footer={
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowPublishReview(false)} className="btn flex-1">Back to edit</button>
              <button type="button" onClick={() => void handlePublish()} disabled={listing} className="btn btn-primary flex-1">
                {listing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {listing ? "Saving..." : listingUrl ? "Save and relist on eBay" : "Publish on eBay"}
              </button>
            </div>
        }
      >
            <div className="flex gap-3 mb-4">
              {photoUrls[0] && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photoUrls[0]} alt="" className="w-20 h-20 rounded-lg object-cover" />
              )}
              <div className="min-w-0">
                <p className="font-medium truncate">{title || "Untitled listing"}</p>
                <p className="text-sm text-[var(--text-secondary)]">{photoUrls.length} photo{photoUrls.length === 1 ? "" : "s"}</p>
                <p className="text-sm font-medium">{price ? formatMoney(Number(price)) : "No price"}</p>
              </div>
            </div>
            <div className="rounded-lg p-3 mb-4 text-sm" style={{ background: "var(--glass)" }}>
              <p><strong>Condition:</strong> {condition || "Not set"}</p>
              <p><strong>Shipping:</strong> Calculated (buyer pays by location)</p>
              {cost && <p><strong>Cost basis:</strong> {formatMoney(Number(cost))}</p>}
              {missingAspectsWarning?.length ? <p className="mt-2" style={{ color: "var(--warning-border)" }}><strong>Warning:</strong> missing eBay specifics may be requested after publishing.</p> : null}
            </div>
      </Sheet>

      {/* Desktop (lg): photos + re-analyze on the left (sticky), the form on the right. */}
      <div className="lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-8 lg:items-start">
      <PhotoDropZone className="lg:sticky lg:top-6 lg:max-h-[calc(100vh_-_var(--editor-bar-h,140px)_-_var(--tray-offset,0px)_-_56px)] lg:overflow-y-auto" onFiles={(files) => void handleAddListingPhotos(files)} disabled={photoUrls.length >= 24}>
      {photoUrls.length > 0 ? (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-[var(--text-secondary)]">Photos · <span className="lg:hidden">swipe to see all</span><span className="hidden lg:inline">scroll to see all · drop or paste photos to add</span></p>
            {photoUndo && (
              <button
                type="button"
                onClick={() => void handleUndoPhotoChange()}
                className="btn text-xs py-1.5 px-2.5"
              >
                Undo photo change
              </button>
            )}
          </div>
          <div
            ref={photoScrollerRef}
            className={photoEditorLayout === "grid"
              ? "grid grid-cols-3 gap-2 pb-2"
              : "flex gap-2 overflow-x-auto overscroll-x-contain pb-2 -mx-5 px-5 snap-x snap-mandatory"}
          >
          {photoUrls.map((url, i) => (
            <div
              key={url}
              data-photo-index={i}
              ref={(el) => { photoRefs.current[i] = el; }}
              className={`relative ${photoEditorLayout === "carousel" ? "flex-shrink-0 snap-start" : ""} rounded-xl overflow-hidden cursor-grab select-none transition-all${dragIdx === i ? " opacity-50 scale-95 cursor-grabbing" : ""}${dropIdx === i && dragIdx !== i ? " ring-2 ring-[var(--accent)]" : ""}`}
              style={{ width: photoEditorLayout === "carousel" ? 184 : "100%", aspectRatio: "1", touchAction: dragIdx === i ? "none" : photoEditorLayout === "carousel" ? "pan-x" : "none" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" draggable={false} />
              <div
                role="button"
                tabIndex={0}
                aria-label={`Hold and drag photo ${i + 1} to reorder`}
                title="Hold and drag to reorder"
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/65 p-3 text-white cursor-grab touch-none"
                onPointerDown={(e) => { e.stopPropagation(); onPhotoPDown(e, i); }}
                onPointerMove={(e) => { e.stopPropagation(); onPhotoPMove(e); }}
                onPointerUp={(e) => { e.stopPropagation(); onPhotoPUp(e, url); }}
                onPointerCancel={(e) => { e.stopPropagation(); onPhotoPUp(e, url); }}
              >
                <GripVertical className="w-5 h-5" />
              </div>
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
              {dropIdx === i && dragIdx !== i && (
                <div className="absolute left-0 top-0 bottom-0 w-1 rounded-full bg-[var(--accent)]" />
              )}
              <button
                type="button"
                aria-label={`Delete photo ${i + 1}`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); void handleDeleteListingPhoto(i); }}
                className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              <div className="absolute bottom-1 left-1 right-1 flex justify-between">
                <button
                  type="button"
                  aria-label="Move photo earlier"
                  disabled={i === 0}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); void moveListingPhoto(i, -1); }}
                  className="rounded-full bg-black/60 p-1 text-white disabled:opacity-30"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Move photo later"
                  disabled={i === photoUrls.length - 1}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); void moveListingPhoto(i, 1); }}
                  className="rounded-full bg-black/60 p-1 text-white disabled:opacity-30"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
          {dropIdx === photoUrls.length && dragIdx !== null && (
            <div className="flex-shrink-0 w-1 rounded-full bg-[var(--accent)]" style={{ height: 184 }} />
          )}
          <button
            type="button"
            onClick={() => photoInputRef.current?.click()}
            className="flex-shrink-0 rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-1 text-xs text-[var(--text-secondary)]"
            style={{ width: 184, height: 184 }}
          >
            <Upload className="w-5 h-5" />
            Add photo
          </button>
          <input ref={photoInputRef} type="file" accept="image/*" multiple={isDesktop} className="hidden" onChange={(e) => { void handleAddListingPhotos(Array.from(e.target.files ?? [])); e.currentTarget.value = ""; }} />
          </div>
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
        <div className="mb-4">
          {photoUndo && (
            <div className="flex justify-end mb-2">
              <button
                type="button"
                onClick={() => void handleUndoPhotoChange()}
                className="btn text-xs py-1.5 px-2.5"
              >
                Undo photo change
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={() => photoInputRef.current?.click()}
            className="card w-full flex flex-col items-center justify-center gap-2 text-sm text-[var(--text-secondary)]"
            style={{ height: 160 }}
          >
            <Upload className="w-6 h-6" />
            Add your first photo
          </button>
          <input ref={photoInputRef} type="file" accept="image/*" multiple={isDesktop} className="hidden" onChange={(e) => { void handleAddListingPhotos(Array.from(e.target.files ?? [])); e.currentTarget.value = ""; }} />
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
            <label tabIndex={0} role="button" aria-label="Add a photo to re-analyze" onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.querySelector("input")?.click(); } }} className="w-16 h-16 rounded-lg border-2 border-dashed border-[var(--border)] flex flex-col items-center justify-center cursor-pointer hover:border-[var(--accent)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
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
      </PhotoDropZone>

      <div className="min-w-0">

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
                <p className="font-medium" style={{ color: draft.sell_odds === "High" ? "var(--success)" : undefined }}>
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

      <AIDisclaimer className="mb-3" />

      <div className="flex flex-col gap-3 mb-4">
        <div>
          <label className="text-xs text-[var(--text-secondary)] mb-1 block">Title</label>
          <input className="input w-full" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} />
          <p className="mt-1 text-right text-[11px] text-[var(--text-tertiary)]">{title.length}/80</p>
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
        </div>
        <PriceFloorFields
          idPrefix="draft"
          price={price}
          floor={floor}
          onPriceChange={setPrice}
          onFloorChange={setFloor}
        />
        <CompsPanel draftId={id} title={title} brand={brand} size={size} condition={condition} onUsePrice={(p) => setPrice(String(p))} />
        <div>
          <label className="text-xs text-[var(--text-secondary)] mb-1 block">Cost (what you paid, optional)</label>
          <CurrencyInput value={cost} onChange={setCost} placeholder="0.00" aria-label="What you paid" />
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
        {extras && <DraftExtrasFields key={id} draftId={id} bin={extras.bin} autoOfferOptIn={extras.optIn} />}
        {storeCategories.length > 0 && (
          <div className="relative">
            <label className="text-xs text-[var(--text-secondary)] mb-1 block">
              Store category{suggestingStoreCategory ? " (getting AI suggestion...)" : ""}
            </label>
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
        <div>
          <label className="text-xs text-[var(--text-secondary)] mb-1 block">Condition</label>
          <select className="input w-full" value={condition} onChange={(e) => setCondition(e.target.value)}>
            {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="py-1">
          <label className="text-xs text-[var(--text-secondary)] mb-1 block">Shipping</label>
          <p className="input w-full bg-transparent">
            Calculated shipping — buyer pays the real rate for their location
          </p>
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

      <SpecificsEditor
        aspects={specifics?.aspects ?? {}}
        // A category saved before paths were recorded isn't trusted (it may be
        // the old wrong pick): re-pick from the title, same as publishing does.
        categoryId={specifics?.categoryPath ? specifics.categoryId ?? null : null}
        categoryPath={specifics?.categoryPath ?? null}
        categoryNeedsReview={specifics?.categoryNeedsReview}
        issues={categoryIssues}
        onCategoryChange={(r) => {
          specificsTouched.current = true;
          setSpecifics((prev) => ({ categoryId: r.categoryId, categoryPath: r.categoryPath, categoryNeedsReview: false, aspects: r.aspects, measurements: prev?.measurements ?? [] }));
          setMissingSpecifics(r.missingRequired);
          setCategoryIssues(r.issues);
        }}
        title={title}
        itemType={itemType}
        onMeta={(m) => setMissingSpecifics([...new Set([...m.missingRequired, ...m.invalid.map((x) => x.name)])])}
        onChange={(aspects, meta) => {
          specificsTouched.current = true;
          setSpecifics((prev) => ({ ...prev, categoryId: meta.categoryId ?? prev?.categoryId ?? null, aspects, measurements: prev?.measurements ?? [] }));
          setMissingSpecifics(meta.missingRequired);
        }}
      />

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
            <StoreIntroHint className="mt-1" />
          </div>
        </div>
      </div>

      </div>
      </div>

      <div ref={bottomBarRef} className="content-bar fixed left-0 right-0 px-5 pt-3 max-w-md mx-auto lg:rounded-2xl lg:pb-3"
        style={{
          // Sits above the progress tray when it's showing; padded for the iPhone home indicator.
          bottom: "var(--tray-offset, 0px)",
          paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))",
          background: "var(--bg-surface)",
          zIndex: Z.sticky,
        }}>
        <div className="flex flex-col gap-2">
          {listingUrl && (
            <div className="flex gap-2">
              <a
                href={listingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn flex-1 flex items-center justify-center gap-2 text-sm"
                style={{ color: "var(--success)" }}
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
            {listingUrl ? (
              <button onClick={handleList} disabled={listing} className="btn btn-primary flex-1">
                {listing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {listing ? "Updating..." : "Update on eBay"}
              </button>
            ) : (
              // Main hand-off: finish it in the eBay app (scheduled listing).
              <button type="button" onClick={() => void handleFinishOnEbay()} disabled={checking || listing} className="btn btn-primary flex-1">
                {listing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarClock className="w-4 h-4" />}
                {listing ? "Sending to eBay..." : "Finish on eBay"}
              </button>
            )}
          </div>
          {!listingUrl && (
            <div className="flex gap-2">
              <button type="button" onClick={handleList} disabled={checking || listing} className="btn flex-1 text-xs py-2">
                <Upload className="w-3.5 h-3.5" /> List now instead
              </button>
              <button type="button" onClick={() => void handleCheckWithEbay()} disabled={checking || listing} className="btn flex-1 text-xs py-2">
                {checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                {checking ? "Checking..." : "Check with eBay"}
              </button>
            </div>
          )}
        </div>
      </div>
      <FinishOnEbaySheet open={finishExplainerOpen} busy={listing} onClose={() => setFinishExplainerOpen(false)} onConfirm={() => void handleFinishOnEbay(true)} />
    </main>
  );
}
