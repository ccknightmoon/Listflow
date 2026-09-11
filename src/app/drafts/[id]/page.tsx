"use client";

import { use, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Shirt, Loader2, Check, Trash2, Upload, ExternalLink, Sparkles, BadgeCheck, Camera, X, RefreshCw, Copy, ChevronLeft, ChevronRight } from "lucide-react";
import { estimateShipping, type ShippingMode } from "@/lib/shipping";
import { apiFetch } from "@/lib/api";
import { uploadThumbnail } from "@/lib/storage";
import { AiResult } from "@/lib/ai-result";
import { matchStoreCategoryByKeyword, StoreCategoryLite } from "@/lib/store-category-match";
import AIDisclaimer from "@/components/AIDisclaimer";

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
  ebay_listing_id: string | null;
  store_category_id: string | null;
  store_category_name: string | null;
  is_heavy: boolean | null;
  shipping_cost: number | null;
  shipping_mode: ShippingMode | null;
}

export default function DraftDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
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
  const [shippingCost, setShippingCost] = useState("");
  const [shippingMode, setShippingMode] = useState<ShippingMode>("free");
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const [photoUndo, setPhotoUndo] = useState<string[] | null>(null);
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

  const [title, setTitle] = useState("");
  const [brand, setBrand] = useState("");
  const [color, setColor] = useState("");
  const [size, setSize] = useState("");
  const [condition, setCondition] = useState("");
  const [flaws, setFlaws] = useState("");
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState(""); // cost_basis (migration 017, src/lib/profit.ts)
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
        const data = await apiFetch<{ draft: Draft; error?: string }>(`/api/drafts/${id}`);
        const d: Draft = data.draft;
        setDraft(d);
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
        const savedShippingMode = localStorage.getItem(`shippingMode-${id}`);
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
        setShippingMode(savedShippingMode === "calculated" || savedShippingMode === "buyer_pays" || savedShippingMode === "free"
          ? savedShippingMode
          : d.shipping_mode === "calculated" || d.shipping_mode === "buyer_pays" ? d.shipping_mode : (d.is_heavy ? "buyer_pays" : "free"));
        setTitle(str(d.title));
        setBrand(str(d.brand));
        setColor(str(d.color));
        setSize(str(d.size));
        setCondition(str(d.condition));
        setFlaws(str(d.flaws));
        setPrice(d.suggested_price != null ? String(d.suggested_price) : "");
        setCost(d.cost_basis != null ? String(d.cost_basis) : "");
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
        setStoreCategoryId(d.store_category_id ?? null);
        setStoreCategoryName(d.store_category_name ?? null);
        if (d.ebay_listing_id) setListingUrl(`https://www.ebay.com/itm/${d.ebay_listing_id}`);
      } catch (err) {

        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => setAiStoreCategorySuggestions(!!data.aiStoreCategorySuggestions))
      .catch(() => {});
    fetch("/api/ebay/store-categories")
      .then((r) => r.json())
      .then((data) => setStoreCategories(Array.isArray(data.categories) ? data.categories : []))
      .catch(() => {});
  }, []);

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

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      await apiFetch(`/api/drafts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title, brand, color, size, condition, flaws,
          suggestedPrice: price ? Number(price) : null,
          costBasis: cost ? Number(cost) : null,
          customSku, itemType, style, material, theme,
          sleeveLength, neckline, fit, pattern, description,
          vintage, character, characterFamily, yearManufactured, season,
          storeCategoryId, storeCategoryName,
          shippingMode, isHeavy: shippingMode === "buyer_pays", shippingCost: shippingMode === "buyer_pays" && shippingCost ? Number(shippingCost) : null,
        }),
      });
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
      // Auto-save current form values first so the listing API uses the latest data.
      // The listing call reads the draft back from the database, so if this
      // save silently failed, it would previously go on to list whatever
      // stale data was already there with no warning at all.
      await apiFetch(`/api/drafts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title, brand, color, size, condition, flaws,
          suggestedPrice: price ? Number(price) : null,
          costBasis: cost ? Number(cost) : null,
          customSku, itemType, style, material, theme,
          sleeveLength, neckline, fit, pattern, description,
          vintage, character, characterFamily, yearManufactured, season,
          storeCategoryId, storeCategoryName,
          shippingMode, isHeavy: shippingMode === "buyer_pays", shippingCost: shippingMode === "buyer_pays" && shippingCost ? Number(shippingCost) : null,
        }),
      });

      const data = await apiFetch<{ connect?: boolean; reconnect?: boolean; error?: string; missingRequiredAspects?: string[]; url?: string; listingId?: string; storeCategoryWarning?: string }>("/api/ebay/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: id, customSku: customSku || undefined, shippingMode, isHeavy: shippingMode === "buyer_pays", shippingCost: shippingMode === "buyer_pays" && shippingCost ? parseFloat(shippingCost) : undefined }),
      });
      if (data.connect) { setNeedsConnect(true); throw new Error(data.error ?? "Failed to list"); }
      if (data.reconnect) { setNeedsReconnect(true); throw new Error(data.error ?? "Failed to list"); }
      // Save all form values + ebay_listing_id together so nothing gets wiped
      if (data.listingId) {
        await apiFetch(`/api/drafts/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title, brand, color, size, condition, flaws,
            suggestedPrice: price ? Number(price) : null,
            costBasis: cost ? Number(cost) : null,
            customSku, itemType, style, material, theme,
            sleeveLength, neckline, fit, pattern, description,
            storeCategoryId, storeCategoryName,
            ebayListingId: String(data.listingId),
          }),
        });
      }
      setListingUrl(data.url ?? null);
      setJustListed(true);
      setMissingAspectsWarning(data.missingRequiredAspects && data.missingRequiredAspects.length > 0 ? data.missingRequiredAspects : null);
      setStoreCategoryWarning(data.storeCategoryWarning ?? null);
      localStorage.removeItem(`heavy-${id}`);
      localStorage.removeItem(`shippingCost-${id}`);
      localStorage.removeItem(`shippingMode-${id}`);
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
    await apiFetch(`/api/drafts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photoUrls: next, thumbnailUrl: next[0] ?? null }),
    });
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
            title, brand, color, size, condition, flaws,
            suggestedPrice: data.suggestedPrice ?? (price ? Number(price) : null),
            costBasis: cost ? Number(cost) : null,
            customSku, itemType, style, material, theme,
            sleeveLength, neckline, fit, pattern, description,
            vintage, character, characterFamily, yearManufactured, season,
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

  function onPhotoPDown(e: React.PointerEvent) {
    pointerStart.current = { x: e.clientX, y: e.clientY };
  }

  function onPhotoPUp(e: React.PointerEvent, url: string) {
    const start = pointerStart.current;
    const moved = start && (Math.abs(e.clientX - start.x) > 8 || Math.abs(e.clientY - start.y) > 8);
    // Let the horizontal scroller handle swipes. Only a stationary tap opens
    // the larger preview, so browsing photos never accidentally activates it.
    if (!moved) setZoomedPhoto(url);
    pointerStart.current = null;
  }

  async function handleDelete() {
    if (!confirm("Delete this draft?")) return;
    setDeleting(true);
    try {
      await apiFetch(`/api/drafts/${id}`, { method: "DELETE" });
      router.push("/drafts");
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
      <main className="min-h-screen max-w-md mx-auto px-5 pt-6" style={{ viewTransitionName: "draft-detail" }}>
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
      <main className="min-h-screen max-w-md mx-auto px-5 pt-6" style={{ viewTransitionName: "draft-detail" }}>
        <Link href="/drafts" className="inline-flex mb-4">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="card p-4" style={{ color: "var(--danger)" }}>{error}</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen max-w-md mx-auto px-5 pt-6 pb-32" style={{ viewTransitionName: "draft-detail" }}>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link href={draft?.ebay_listing_id ? "/store" : "/drafts"}>
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

      {storeCategoryWarning && (
        <div className="card p-3 mb-4 text-sm" style={{ borderColor: "var(--warning-border)", background: "var(--warning-bg)", color: "var(--warning-border)" }}>
          {storeCategoryWarning}
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
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-[var(--text-secondary)]">Photos · swipe to see all</p>
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
          <div className="flex gap-2 overflow-x-auto overscroll-x-contain pb-2 -mx-5 px-5 snap-x snap-mandatory">
          {photoUrls.map((url, i) => (
            <div
              key={i}
              className="relative flex-shrink-0 rounded-xl overflow-hidden cursor-pointer select-none snap-start"
              style={{ width: 184, height: 184, touchAction: "pan-x" }}
              onPointerDown={onPhotoPDown}
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
          <button
            type="button"
            onClick={() => photoInputRef.current?.click()}
            className="flex-shrink-0 rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-1 text-xs text-[var(--text-secondary)]"
            style={{ width: 184, height: 184 }}
          >
            <Upload className="w-5 h-5" />
            Add photo
          </button>
          <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { void handleAddListingPhoto(e.target.files?.[0]); e.currentTarget.value = ""; }} />
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
          <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { void handleAddListingPhoto(e.target.files?.[0]); e.currentTarget.value = ""; }} />
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
            <label className="w-16 h-16 rounded-lg border-2 border-dashed border-[var(--border)] flex flex-col items-center justify-center cursor-pointer hover:border-[var(--accent)] transition-colors">
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
              min="0.99"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="text-xs text-[var(--text-secondary)] mb-1 block">Cost (what you paid, optional)</label>
          <input
            className="input w-full"
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
          />
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
          <select
            className="input w-full"
            value={shippingMode}
            onChange={(e) => {
              const mode = e.target.value as ShippingMode;
              setShippingMode(mode);
              setIsHeavy(mode === "buyer_pays");
              localStorage.setItem(`shippingMode-${id}`, mode);
              if (mode !== "buyer_pays") {
                setShippingCost("");
                localStorage.removeItem(`shippingCost-${id}`);
              }
            }}
          >
            <option value="free">Free shipping (you pay)</option>
            <option value="calculated">Calculated shipping (buyer pays based on location)</option>
            <option value="buyer_pays">Flat-rate shipping (legacy heavy-item option)</option>
          </select>
          {shippingMode === "buyer_pays" && (
            <div className="flex items-center gap-1 ml-1">
              <span className="text-sm text-[var(--text-secondary)]">— shipping $</span>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={shippingCost}
                onChange={(e) => { setShippingCost(e.target.value); localStorage.setItem(`shippingCost-${id}`, e.target.value); }}
                className="input w-20 text-sm py-0.5 px-1.5"
              />
            </div>
          )}
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
