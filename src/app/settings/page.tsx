"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createBrowserClient } from "@supabase/ssr";
import {
  ArrowLeft,
  Check,
  Loader2,
  PackageCheck,
  Gift,
  Sun,
  Moon,
  MonitorSmartphone,
  LogOut,
  Store,
  Truck,
  Palette,
  UserCircle,
  Trash2,
  FileText,
  ScanLine,
  Sparkles,
  Tags,
  DollarSign,
  Mail,
} from "lucide-react";
import { getStoredTheme, setStoredTheme, type Theme } from "@/lib/theme";
import { ACCENT_PRESETS, getStoredAccent, setStoredAccent, type AccentColor } from "@/lib/accent";
import { EBAY_STANDARD_FEE_PERCENT } from "@/lib/ebay-fees";

type DefaultShippingMode = "free" | "calculated";

// Converts between the server's stored UTC hour (app_settings.
// notification_email_hour_utc, an integer 0-23) and an <input type="time">
// value in the browser's own local timezone. Rounds to the nearest UTC
// hour rather than truncating, since a half/quarter-hour-offset timezone
// (e.g. India, Nepal) can't be represented exactly by a whole-hour column
// -- see the state comment above where these are used.
function utcHourToLocalTimeString(hourUtc: number): string {
  const d = new Date();
  d.setUTCHours(hourUtc, 0, 0, 0);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function localTimeStringToUtcHour(time: string): number {
  const [h, m] = time.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m || 0, 0, 0);
  const utcMinutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  return Math.round(utcMinutes / 60) % 24;
}

interface EbayPolicy {
  id: string;
  name: string;
}

export default function SettingsPage() {
  const [mode, setMode] = useState<DefaultShippingMode | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Store description footer — appended automatically to every listing's
  // description at publish time (never shown/stored on the item's own
  // description field, see upsertInventoryItem in src/lib/ebay-inventory.ts).
  const [footer, setFooter] = useState("");
  const [savedFooter, setSavedFooter] = useState(""); // last value confirmed saved, to know if there are unsaved edits
  const [footerSaving, setFooterSaving] = useState(false);
  const [footerSaved, setFooterSaved] = useState(false);
  const [footerError, setFooterError] = useState<string | null>(null);

  const [theme, setTheme] = useState<Theme>("system");
  const [accent, setAccent] = useState<AccentColor>("indigo");
  const [accentSaving, setAccentSaving] = useState(false);

  // Batch-upload item-divider grouping mode (Settings -> "Batch upload:
  // item dividers"). Off by default -- see supabase-migrations/013 and
  // src/app/api/detect-item-dividers/route.ts for what turning this on
  // actually changes in the batch-upload flow.
  const [autoDetectDividers, setAutoDetectDividers] = useState(false);
  const [autoDetectSaving, setAutoDetectSaving] = useState(false);
  const [autoDetectSaved, setAutoDetectSaved] = useState(false);
  const [autoDetectError, setAutoDetectError] = useState<string | null>(null);

  // Settings -> "Store category suggestions" -> AI suggestions. Off by
  // default -- the free keyword match (src/lib/store-category-match.ts)
  // always runs regardless of this toggle; this only adds an extra
  // per-item AI call on top of it. See supabase-migrations/015 and
  // src/app/api/ebay/store-categories/suggest/route.ts.
  const [aiStoreCategory, setAiStoreCategory] = useState(false);
  const [aiStoreCategorySaving, setAiStoreCategorySaving] = useState(false);
  const [aiStoreCategorySaved, setAiStoreCategorySaved] = useState(false);
  const [aiStoreCategoryError, setAiStoreCategoryError] = useState<string | null>(null);

  // Settings -> "Fee estimate" -- lets a seller override the percentage
  // used in the Sales page's estimated fee/net-profit calc. Kept as a
  // string while editing (so "13." or an empty field mid-type doesn't get
  // clobbered by a parsed-number round-trip); parsed to a number (or null
  // to reset to the standard rate) only on save. See src/lib/ebay-fees.ts.
  const [feePercentInput, setFeePercentInput] = useState("");
  const [savedFeePercentOverride, setSavedFeePercentOverride] = useState<number | null>(null);
  const [feePercentSaving, setFeePercentSaving] = useState(false);
  const [feePercentSaved, setFeePercentSaved] = useState(false);
  const [feePercentError, setFeePercentError] = useState<string | null>(null);

  // "Email alerts" -- once-a-day digest, see src/app/api/cron/daily-digest.
  // The hour is stored server-side as a plain UTC integer (0-23,
  // app_settings.notification_email_hour_utc); this page only ever
  // converts to/from the seller's own local clock for display, so an
  // <input type="time"> here always reads back as "about" the same local
  // time later, possibly off by up to 30 minutes for a handful of
  // half/quarter-hour-offset timezones (rounded to the nearest UTC hour),
  // and by exactly one hour across a DST transition (the stored UTC hour
  // never drifts, but its local-time meaning does) -- documented rather
  // than solved with a full IANA-timezone column, which felt like more
  // machinery than a single-seller app's "roughly this time of day" needs.
  const [notificationEmailEnabled, setNotificationEmailEnabled] = useState(true);
  const [notificationEmailHourUtc, setNotificationEmailHourUtc] = useState(13);
  const [notificationSaving, setNotificationSaving] = useState(false);
  const [notificationSaved, setNotificationSaved] = useState(false);
  const [notificationError, setNotificationError] = useState<string | null>(null);

  const [signingOut, setSigningOut] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // eBay Connection (Phase 2: per-user connections, replacing the old
  // shared env-var-based setup)
  const [ebayLoading, setEbayLoading] = useState(true);
  const [ebayConnected, setEbayConnected] = useState(false);
  const [ebayBanner, setEbayBanner] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [fulfillmentPolicies, setFulfillmentPolicies] = useState<EbayPolicy[]>([]);
  const [returnPolicies, setReturnPolicies] = useState<EbayPolicy[]>([]);
  const [needsPolicySetup, setNeedsPolicySetup] = useState(false);
  const [shippingFreeId, setShippingFreeId] = useState("");
  const [shippingHeavyId, setShippingHeavyId] = useState("");
  const [shippingCalculatedId, setShippingCalculatedId] = useState("");
  const [returnPolicyId, setReturnPolicyId] = useState("");
  const [savingPolicies, setSavingPolicies] = useState(false);

  useEffect(() => {
    setTheme(getStoredTheme());
    setAccent(getStoredAccent());
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        setMode(data.defaultShippingMode === "calculated" ? "calculated" : "free");
        const f = data.storeDescriptionFooter ?? "";
        setFooter(f);
        setSavedFooter(f);
        // app_settings.accent_color is the source of truth (synced across
        // devices) — reconcile this device's cookie/attribute with it in
        // case another device changed it since our last visit here.
        const serverAccent = ACCENT_PRESETS.some((p) => p.value === data.accentColor)
          ? (data.accentColor as AccentColor)
          : "indigo";
        setAccent(serverAccent);
        setStoredAccent(serverAccent);
        setAutoDetectDividers(!!data.autoDetectItemDividers);
        setAiStoreCategory(!!data.aiStoreCategorySuggestions);
        const override = typeof data.ebayFeePercentOverride === "number" ? data.ebayFeePercentOverride : null;
        setSavedFeePercentOverride(override);
        setFeePercentInput(override !== null ? String(override) : "");
        setNotificationEmailEnabled(data.notificationEmailEnabled ?? true);
        setNotificationEmailHourUtc(typeof data.notificationEmailHourUtc === "number" ? data.notificationEmailHourUtc : 13);
      })
      .catch(() => setError("Could not load settings"))
      .finally(() => setLoading(false));
  }, []);

  async function handleAutoDetectToggle(next: boolean) {
    if (next === autoDetectDividers || autoDetectSaving) return;
    const prev = autoDetectDividers;
    setAutoDetectDividers(next);
    setAutoDetectSaving(true);
    setAutoDetectSaved(false);
    setAutoDetectError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoDetectItemDividers: next }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setAutoDetectSaved(true);
      setTimeout(() => setAutoDetectSaved(false), 2000);
    } catch {
      setAutoDetectDividers(prev);
      setAutoDetectError("Could not save — try again.");
    } finally {
      setAutoDetectSaving(false);
    }
  }

  async function handleAiStoreCategoryToggle(next: boolean) {
    if (next === aiStoreCategory || aiStoreCategorySaving) return;
    const prev = aiStoreCategory;
    setAiStoreCategory(next);
    setAiStoreCategorySaving(true);
    setAiStoreCategorySaved(false);
    setAiStoreCategoryError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiStoreCategorySuggestions: next }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setAiStoreCategorySaved(true);
      setTimeout(() => setAiStoreCategorySaved(false), 2000);
    } catch {
      setAiStoreCategory(prev);
      setAiStoreCategoryError("Could not save — try again.");
    } finally {
      setAiStoreCategorySaving(false);
    }
  }

  async function handleNotificationToggle(next: boolean) {
    if (next === notificationEmailEnabled || notificationSaving) return;
    const prev = notificationEmailEnabled;
    setNotificationEmailEnabled(next);
    setNotificationSaving(true);
    setNotificationSaved(false);
    setNotificationError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationEmailEnabled: next }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setNotificationSaved(true);
      setTimeout(() => setNotificationSaved(false), 2000);
    } catch {
      setNotificationEmailEnabled(prev);
      setNotificationError("Could not save -- try again.");
    } finally {
      setNotificationSaving(false);
    }
  }

  async function handleNotificationHourChange(nextHourUtc: number) {
    if (nextHourUtc === notificationEmailHourUtc || notificationSaving) return;
    const prev = notificationEmailHourUtc;
    setNotificationEmailHourUtc(nextHourUtc);
    setNotificationSaving(true);
    setNotificationSaved(false);
    setNotificationError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationEmailHourUtc: nextHourUtc }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setNotificationSaved(true);
      setTimeout(() => setNotificationSaved(false), 2000);
    } catch {
      setNotificationEmailHourUtc(prev);
      setNotificationError("Could not save -- try again.");
    } finally {
      setNotificationSaving(false);
    }
  }

  async function handleSaveFeePercent(nextValue: number | null) {
    if (feePercentSaving) return;
    setFeePercentSaving(true);
    setFeePercentSaved(false);
    setFeePercentError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ebayFeePercentOverride: nextValue }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save");
      }
      setSavedFeePercentOverride(nextValue);
      setFeePercentInput(nextValue !== null ? String(nextValue) : "");
      setFeePercentSaved(true);
      setTimeout(() => setFeePercentSaved(false), 2000);
    } catch (err) {
      setFeePercentError((err as Error).message || "Could not save — try again.");
    } finally {
      setFeePercentSaving(false);
    }
  }

  async function handleSaveFooter() {
    if (footerSaving) return;
    setFooterSaving(true);
    setFooterSaved(false);
    setFooterError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeDescriptionFooter: footer }),
      });
      if (!res.ok) throw new Error();
      setSavedFooter(footer);
      setFooterSaved(true);
      setTimeout(() => setFooterSaved(false), 2000);
    } catch {
      setFooterError("Could not save — try again.");
    } finally {
      setFooterSaving(false);
    }
  }

  useEffect(() => {
    // The eBay OAuth callback redirects back here with ?ebay=connected or
    // ?ebay=error&message=... — surface that as a one-time banner, then
    // clean the URL so it doesn't reappear on refresh.
    const params = new URLSearchParams(window.location.search);
    const ebayResult = params.get("ebay");
    if (ebayResult === "connected") {
      setEbayBanner({ type: "success", message: "eBay connected!" });
      window.history.replaceState({}, "", "/settings");
    } else if (ebayResult === "error") {
      setEbayBanner({ type: "error", message: params.get("message") || "Couldn't connect eBay — please try again." });
      window.history.replaceState({}, "", "/settings");
    }

    fetch("/api/ebay/policies")
      .then((r) => r.json())
      .then((data) => {
        if (data.connect) {
          setEbayConnected(false);
          return;
        }
        setEbayConnected(true);
        setFulfillmentPolicies(data.fulfillmentPolicies ?? []);
        setReturnPolicies(data.returnPolicies ?? []);
        setNeedsPolicySetup(!!data.needsSetup);
        setShippingFreeId(data.selected?.shippingFreeId ?? "");
        setShippingHeavyId(data.selected?.shippingHeavyId ?? "");
        setShippingCalculatedId(data.selected?.shippingCalculatedId ?? "");
        setReturnPolicyId(data.selected?.returnPolicyId ?? "");
      })
      .catch(() => setEbayConnected(false))
      .finally(() => setEbayLoading(false));
  }, []);

  async function savePolicies(next: {
    shippingFreeId?: string;
    shippingHeavyId?: string;
    shippingCalculatedId?: string;
    returnPolicyId?: string;
  }) {
    setSavingPolicies(true);
    try {
      const res = await fetch("/api/ebay/policies", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shippingFreeId: next.shippingFreeId ?? shippingFreeId,
          shippingHeavyId: next.shippingHeavyId ?? shippingHeavyId,
          shippingCalculatedId: next.shippingCalculatedId ?? shippingCalculatedId,
          returnPolicyId: next.returnPolicyId ?? returnPolicyId,
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
    } catch {
      setEbayBanner({ type: "error", message: "Couldn't save your policy choice — try again." });
    } finally {
      setSavingPolicies(false);
    }
  }

  async function handleSelect(next: DefaultShippingMode) {
    if (next === mode || saving) return;
    const prev = mode;
    setMode(next);
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultShippingMode: next }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setMode(prev);
      setError("Could not save — try again.");
    } finally {
      setSaving(false);
    }
  }

  function handleThemeSelect(next: Theme) {
    if (next === theme) return;
    setTheme(next);
    setStoredTheme(next);
  }

  async function handleAccentSelect(next: AccentColor) {
    if (next === accent || accentSaving) return;
    const prev = accent;
    setAccent(next);
    setStoredAccent(next); // instant feedback — updates --accent on <html> right away
    setAccentSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accentColor: next }),
      });
      if (!res.ok) throw new Error("Failed to save");
    } catch {
      setAccent(prev);
      setStoredAccent(prev);
      setError("Could not save accent color — try again.");
    } finally {
      setAccentSaving(false);
    }
  }

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
    );
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  // Soft delete: this only timestamps the request (see
  // src/lib/account-deletion.ts) so a daily cron can purge it 30 days from
  // now -- nothing is deleted on the spot. Logging back in any time before
  // then shows /account/pending-deletion with a one-click "Reactivate."
  async function handleDeleteAccount() {
    if (deletingAccount) return;
    const confirmed = window.confirm(
      "Delete your account? Your drafts, photos, eBay connection, and settings will be permanently deleted in 30 days. You can undo this any time before then by logging back in and choosing \"Reactivate.\""
    );
    if (!confirmed) return;

    setDeletingAccount(true);
    setDeleteError(null);
    try {
      const res = await fetch("/api/account/delete", { method: "POST" });
      if (!res.ok) throw new Error();
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
      );
      await supabase.auth.signOut();
      window.location.href = "/login";
    } catch {
      setDeleteError("Couldn't start account deletion -- please try again.");
      setDeletingAccount(false);
    }
  }

  return (
    <main className="relative min-h-screen max-w-md mx-auto px-5 pt-6 pb-5 overflow-hidden">
      <div
        className="bloom d1 stagger"
        style={{ width: 240, height: 240, top: -70, left: -60, background: "var(--glow-primary)" }}
      />
      <div
        className="bloom d1 stagger"
        style={{ width: 200, height: 200, top: 10, right: -70, background: "var(--glow-secondary)" }}
      />

      <div className="relative flex items-center gap-3 mb-6">
        <Link
          href="/dashboard"
          className="w-[34px] h-[34px] rounded-[11px] flex items-center justify-center flex-none"
          style={{ background: "var(--glass)", border: "1px solid var(--glass-line)" }}
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <h1 className="font-display text-xl font-bold">Settings</h1>
      </div>

      <SettingsSection
        delay="d1"
        title="Appearance"
        description="Pick an accent color for the whole app — buttons, tiles, and highlights update everywhere, on every device you're signed into. Theme is per-device; &quot;System&quot; follows your phone or computer's own light/dark setting automatically."
        icon={Palette}
      >
        <p className="text-xs font-semibold text-[var(--text-secondary)] mb-2.5">Accent color</p>
        <div className="flex items-center gap-2.5 mb-2">
          {ACCENT_PRESETS.map((preset) => (
            <button
              key={preset.value}
              type="button"
              onClick={() => handleAccentSelect(preset.value)}
              aria-label={preset.label}
              aria-pressed={accent === preset.value}
              title={preset.label}
              className="w-9 h-9 rounded-full flex-shrink-0 active:scale-90"
              style={{
                background: preset.hex,
                border: accent === preset.value ? "2px solid var(--text-primary)" : "2px solid transparent",
                boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.15)",
                transition: "transform 0.2s var(--spring), border-color 0.15s ease",
              }}
            />
          ))}
          {accentSaving && <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--text-tertiary)] ml-1" />}
        </div>

        <div
          className="rounded-2xl p-3 mb-5 flex items-center gap-3"
          style={{ background: "var(--glass-strong)", border: "1px solid var(--glass-line)" }}
        >
          <div className="flex-1 rounded-xl px-3 py-2" style={{ background: "var(--accent-tint)" }}>
            <p className="text-[9px] font-bold uppercase tracking-wide" style={{ color: "var(--accent-soft)" }}>This week</p>
            <p className="font-display font-extrabold text-base mt-0.5" style={{ color: "var(--text-primary)" }}>$284</p>
          </div>
          <div
            className="text-xs font-bold rounded-xl px-3.5 py-2.5 whitespace-nowrap"
            style={{ background: "var(--accent)", color: "#fff" }}
          >
            + New listing
          </div>
        </div>

        <p className="text-xs font-semibold text-[var(--text-secondary)] mb-2.5">Theme</p>
        <div className="flex flex-col gap-3">
          <OptionCard
            icon={Sun}
            title="Light"
            description="The classic white background, all the time."
            selected={theme === "light"}
            onClick={() => handleThemeSelect("light")}
          />
          <OptionCard
            icon={Moon}
            title="Dark"
            description="A dark background, easier on the eyes in low light."
            selected={theme === "dark"}
            onClick={() => handleThemeSelect("dark")}
          />
          <OptionCard
            icon={MonitorSmartphone}
            title="System"
            description="Match this device's own setting, and switch automatically if it changes."
            selected={theme === "system"}
            onClick={() => handleThemeSelect("system")}
          />
        </div>
      </SettingsSection>

      <SettingsSection
        delay="d2"
        title="Default shipping"
        description="Every new listing (New Listing, Batch Upload, Drafts) starts with this choice automatically, so you don&apos;t have to set it item by item. You can still switch an individual item on its own screen — this just sets what it starts as."
        icon={Truck}
      >
        {loading ? (
          <div className="card p-8 text-center">
            <Loader2 className="w-5 h-5 mx-auto animate-spin text-[var(--text-secondary)]" />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <OptionCard
              icon={Gift}
              title="Free shipping"
              description="Shipping cost is estimated from the item and baked into the price. Buyer sees $0 shipping."
              selected={mode === "free"}
              onClick={() => handleSelect("free")}
            />
            <OptionCard
              icon={PackageCheck}
              title="Calculated shipping"
              description="eBay quotes each buyer their own real shipping rate at checkout, based on the item's estimated weight/package size and the buyer's zip code — not a fixed amount."
              selected={mode === "calculated"}
              onClick={() => handleSelect("calculated")}
            />
          </div>
        )}

        {mode === "calculated" && !loading && (
          <div
            className="card p-3 mt-3 text-xs text-[var(--text-secondary)]"
            style={{ background: "var(--warning-bg)", borderColor: "var(--warning-border)" }}
          >
            Calculated shipping needs a &quot;Calculated: cost varies by buyer
            location&quot; shipping policy set up in eBay Seller Hub, picked below
            under eBay Connection. If that hasn&apos;t been set up yet, listings
            will show an error when you try to list until it is.
          </div>
        )}

        {error && (
          <p className="text-xs mt-2" style={{ color: "var(--danger)" }}>{error}</p>
        )}
        {saving && (
          <p className="text-xs text-[var(--text-secondary)] flex items-center gap-1 mt-2">
            <Loader2 className="w-3 h-3 animate-spin" /> Saving...
          </p>
        )}
        {saved && (
          <p className="text-xs flex items-center gap-1 mt-2" style={{ color: "var(--success)" }}>
            <Check className="w-3 h-3" /> Saved
          </p>
        )}
      </SettingsSection>

      <SettingsSection
        delay="d3"
        title="Batch upload: item dividers"
        description="While uploading a batch, you can always mark where one item's photos end and the next begin for free, with no AI involved -- that skips the AI grouping step for that batch automatically. Turn this on too if you also shoot a numbered marker (a card, a tag, the outside of a poly bag -- whatever you use) as the last photo of each item: the app reads the number, uses it to mark that item's boundary, auto-fills it as the item's SKU, and leaves the marker photo out of the actual listing photos."
        icon={ScanLine}
      >
        <div className="flex flex-col gap-3">
          <OptionCard
            icon={Sparkles}
            title="Off — group with AI only"
            description="Default. Upload photos in order and AI groups them by comparing photos. You can still tap a photo as its item's SKU/number marker on the upload screen any time -- that skips AI grouping for that batch and leaves the tapped photo out of the listing, whether this is on or off."
            selected={!autoDetectDividers}
            onClick={() => handleAutoDetectToggle(false)}
          />
          <OptionCard
            icon={ScanLine}
            title="On — auto-detect from a numbered marker photo"
            description="End each item's photos with a shot of its number. The app finds it, reads the number, marks the item boundary, fills in the SKU field, and drops the marker photo from the listing -- no AI grouping call needed for that item."
            selected={autoDetectDividers}
            onClick={() => handleAutoDetectToggle(true)}
          />
        </div>

        {autoDetectError && (
          <p className="text-xs mt-2" style={{ color: "var(--danger)" }}>{autoDetectError}</p>
        )}
        {autoDetectSaving && (
          <p className="text-xs text-[var(--text-secondary)] flex items-center gap-1 mt-2">
            <Loader2 className="w-3 h-3 animate-spin" /> Saving...
          </p>
        )}
        {autoDetectSaved && (
          <p className="text-xs flex items-center gap-1 mt-2" style={{ color: "var(--success)" }}>
            <Check className="w-3 h-3" /> Saved
          </p>
        )}
      </SettingsSection>

      <SettingsSection
        delay="d4"
        title="Store description"
        description="Write your shop's boilerplate once — welcome message, policies, a sign-off, whatever you'd normally paste into every listing. It gets added to the end of every item's description automatically when you list it. Each item's own description above this only ever has that item's own details; you never see or edit this text on the listing screens."
        icon={FileText}
      >
        <textarea
          className="input"
          rows={8}
          placeholder={'Welcome to our store :)!\nExplore unique second-hand treasures with detailed photos!\n...'}
          value={footer}
          onChange={(e) => { setFooter(e.target.value); setFooterSaved(false); }}
        />
        <div className="flex items-center gap-3 mt-2">
          <button
            onClick={handleSaveFooter}
            disabled={footerSaving || footer === savedFooter}
            className="btn btn-primary text-xs px-3 py-1.5"
          >
            {footerSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save"}
          </button>
          {footerError && (
            <p className="text-xs" style={{ color: "var(--danger)" }}>{footerError}</p>
          )}
          {footerSaved && (
            <p className="text-xs flex items-center gap-1" style={{ color: "var(--success)" }}>
              <Check className="w-3 h-3" /> Saved
            </p>
          )}
        </div>
      </SettingsSection>

      <SettingsSection
        delay="d5"
        title="eBay Connection"
        description="Each account connects its own eBay seller account — your listings, categories, and shipping/return policies are yours alone, never shared with anyone else signed in."
        icon={Store}
      >
        {ebayBanner && (
          <div
            className="card p-3 mb-3 text-xs"
            style={
              ebayBanner.type === "success"
                ? { color: "var(--success)" }
                : { color: "var(--danger)", background: "var(--warning-bg)", borderColor: "var(--warning-border)" }
            }
          >
            {ebayBanner.message}
          </div>
        )}

        {ebayLoading ? (
          <div className="card p-8 text-center">
            <Loader2 className="w-5 h-5 mx-auto animate-spin text-[var(--text-secondary)]" />
          </div>
        ) : !ebayConnected ? (
          <div className="card p-4 flex items-center gap-3">
            <Store className="w-5 h-5 flex-shrink-0 text-[var(--text-secondary)]" />
            <div className="flex-1">
              <p className="text-sm font-medium">Not connected</p>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                Connect your eBay account to start listing.
              </p>
            </div>
            <a href="/api/ebay/connect" className="btn btn-primary text-xs px-3 py-1.5">Connect</a>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="card p-4 flex items-center gap-3">
              <Store className="w-5 h-5 flex-shrink-0" style={{ color: "var(--success)" }} />
              <div className="flex-1">
                <p className="text-sm font-medium">Connected</p>
              </div>
              <a href="/api/ebay/connect" className="btn text-xs px-3 py-1.5">Reconnect</a>
            </div>

            {needsPolicySetup ? (
              <div
                className="card p-3 text-xs text-[var(--text-secondary)]"
                style={{ background: "var(--warning-bg)", borderColor: "var(--warning-border)" }}
              >
                No shipping or return policies found on your eBay account yet.
                Set those up in eBay Seller Hub (Account → Business Policies),
                then come back here to pick them.
              </div>
            ) : (
              <>
                <PolicyPicker
                  label="Free shipping policy"
                  value={shippingFreeId}
                  options={fulfillmentPolicies}
                  onChange={(v) => { setShippingFreeId(v); savePolicies({ shippingFreeId: v }); }}
                />
                <PolicyPicker
                  label="Buyer-pays shipping policy"
                  value={shippingHeavyId}
                  options={fulfillmentPolicies}
                  onChange={(v) => { setShippingHeavyId(v); savePolicies({ shippingHeavyId: v }); }}
                />
                <PolicyPicker
                  label="Calculated shipping policy"
                  value={shippingCalculatedId}
                  options={fulfillmentPolicies}
                  onChange={(v) => { setShippingCalculatedId(v); savePolicies({ shippingCalculatedId: v }); }}
                />
                <PolicyPicker
                  label="Return policy"
                  value={returnPolicyId}
                  options={returnPolicies}
                  onChange={(v) => { setReturnPolicyId(v); savePolicies({ returnPolicyId: v }); }}
                />
                {savingPolicies && (
                  <p className="text-xs text-[var(--text-secondary)] flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" /> Saving...
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        delay="d6"
        title="Store category suggestions"
        description="A free keyword match always suggests one of your real eBay Store Categories automatically wherever you review an item -- no setup, no AI cost. Turn AI suggestions on too for a smarter pick (worth it for categories that don't share obvious words with the item itself) -- it costs one extra AI call per item, counted against your monthly AI usage. Either way, tap the category chip next to an item's SKU field any time to change it yourself."
        icon={Tags}
      >
        <div className="flex flex-col gap-3">
          <OptionCard
            icon={Tags}
            title="Off — keyword match only"
            description="Default. Every item still gets a free suggestion by matching its title against your category names -- no AI usage spent. You can always pick a different category yourself."
            selected={!aiStoreCategory}
            onClick={() => handleAiStoreCategoryToggle(false)}
          />
          <OptionCard
            icon={Sparkles}
            title="On — AI suggestions too"
            description="Adds one AI call per item that picks from your real category list based on the item's full details, replacing the keyword guess when it finds a better fit."
            selected={aiStoreCategory}
            onClick={() => handleAiStoreCategoryToggle(true)}
          />
        </div>

        {aiStoreCategoryError && (
          <p className="text-xs mt-2" style={{ color: "var(--danger)" }}>{aiStoreCategoryError}</p>
        )}
        {aiStoreCategorySaving && (
          <p className="text-xs text-[var(--text-secondary)] flex items-center gap-1 mt-2">
            <Loader2 className="w-3 h-3 animate-spin" /> Saving...
          </p>
        )}
        {aiStoreCategorySaved && (
          <p className="text-xs flex items-center gap-1 mt-2" style={{ color: "var(--success)" }}>
            <Check className="w-3 h-3" /> Saved
          </p>
        )}
      </SettingsSection>

      <SettingsSection
        delay="d7"
        title="Fee estimate"
        description={`Sales history shows an estimated eBay fee and net profit per sale, using eBay's standard final value fee (${EBAY_STANDARD_FEE_PERCENT}% of the sale total, most categories) plus their per-order fee. If you know your actual effective rate differs -- a different category, a Store subscription discount, a seller promotion -- enter it here instead. This never reflects your real eBay invoice; eBay doesn't give this app access to that.`}
        icon={DollarSign}
      >
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              min="0"
              max="100"
              className="input"
              placeholder={`${EBAY_STANDARD_FEE_PERCENT} (standard)`}
              value={feePercentInput}
              onChange={(e) => { setFeePercentInput(e.target.value); setFeePercentSaved(false); }}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[var(--text-tertiary)] pointer-events-none">%</span>
          </div>
          <button
            onClick={() => {
              const trimmed = feePercentInput.trim();
              if (trimmed === "") { handleSaveFeePercent(null); return; }
              const parsed = Number(trimmed);
              if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
                setFeePercentError("Enter a percentage between 0 and 100.");
                return;
              }
              handleSaveFeePercent(parsed);
            }}
            disabled={feePercentSaving || (feePercentInput.trim() === "" ? savedFeePercentOverride === null : Number(feePercentInput) === savedFeePercentOverride)}
            className="btn btn-primary text-xs px-3 py-2 flex-none"
          >
            {feePercentSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save"}
          </button>
        </div>
        {savedFeePercentOverride !== null && (
          <button
            onClick={() => handleSaveFeePercent(null)}
            disabled={feePercentSaving}
            className="text-xs mt-2 underline text-[var(--text-secondary)]"
          >
            Reset to standard ({EBAY_STANDARD_FEE_PERCENT}%)
          </button>
        )}
        {feePercentError && (
          <p className="text-xs mt-2" style={{ color: "var(--danger)" }}>{feePercentError}</p>
        )}
        {feePercentSaved && (
          <p className="text-xs flex items-center gap-1 mt-2" style={{ color: "var(--success)" }}>
            <Check className="w-3 h-3" /> Saved
          </p>
        )}
      </SettingsSection>

      <SettingsSection
        delay="d8"
        title="Email alerts"
        description="Once a day, if something needs your attention -- an order to ship, a pending offer, an unanswered buyer question, or a listing sitting 30+ days with no sale -- Listflow sends you one summary email. No email if there's nothing to report."
        icon={Mail}
      >
        <div className="flex flex-col gap-3">
          <OptionCard
            icon={Mail}
            title="Off"
            description="No email digest."
            selected={!notificationEmailEnabled}
            onClick={() => handleNotificationToggle(false)}
          />
          <OptionCard
            icon={Mail}
            title="On"
            description="Send me a daily digest when something needs my attention."
            selected={notificationEmailEnabled}
            onClick={() => handleNotificationToggle(true)}
          />
        </div>

        {notificationEmailEnabled && (
          <div className="mt-3">
            <label className="text-xs text-[var(--text-secondary)] block mb-1.5">Send around this time</label>
            <input
              type="time"
              className="input w-auto"
              value={utcHourToLocalTimeString(notificationEmailHourUtc)}
              onChange={(e) => {
                if (!e.target.value) return;
                handleNotificationHourChange(localTimeStringToUtcHour(e.target.value));
              }}
            />
          </div>
        )}

        {notificationError && (
          <p className="text-xs mt-2" style={{ color: "var(--danger)" }}>{notificationError}</p>
        )}
        {notificationSaving && (
          <p className="text-xs text-[var(--text-secondary)] flex items-center gap-1 mt-2">
            <Loader2 className="w-3 h-3 animate-spin" /> Saving...
          </p>
        )}
        {notificationSaved && (
          <p className="text-xs flex items-center gap-1 mt-2" style={{ color: "var(--success)" }}>
            <Check className="w-3 h-3" /> Saved
          </p>
        )}
      </SettingsSection>

      <SettingsSection delay="d8" title="Account" icon={UserCircle}>
        <button
          onClick={handleSignOut}
          disabled={signingOut}
          className="btn w-full flex items-center justify-center gap-2"
        >
          {signingOut ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
          Sign out
        </button>

        <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--border)" }}>
          <p className="text-xs font-medium mb-1" style={{ color: "var(--danger)" }}>Danger zone</p>
          <p className="text-xs text-[var(--text-tertiary)] mb-3 leading-relaxed">
            Deleting your account starts a 30-day countdown, not an instant
            wipe. Everything -- drafts, photos, your eBay connection, settings
            -- is permanently deleted after that unless you log back in and
            reactivate first.
          </p>
          {deleteError && (
            <p className="text-xs mb-2" style={{ color: "var(--danger)" }}>{deleteError}</p>
          )}
          <button
            onClick={handleDeleteAccount}
            disabled={deletingAccount}
            className="btn w-full flex items-center justify-center gap-2"
            style={{ color: "var(--danger)" }}
          >
            {deletingAccount ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            Delete account
          </button>
        </div>
      </SettingsSection>

      <footer className="flex items-center justify-center gap-3 text-xs text-[var(--text-tertiary)] mt-2 mb-4">
        <Link href="/terms" className="underline">Terms</Link>
        <span>&middot;</span>
        <Link href="/privacy" className="underline">Privacy</Link>
      </footer>
    </main>
  );
}

function SettingsSection({
  title,
  description,
  icon: Icon,
  children,
  delay,
}: {
  title: string;
  description?: string;
  icon: React.ElementType;
  children: React.ReactNode;
  delay?: string;
}) {
  return (
    <section className={`card stagger p-4 mb-4 ${delay ?? ""}`}>
      <div className="flex items-start gap-3 mb-3">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: "color-mix(in srgb, var(--accent) 14%, var(--bg-surface))" }}
        >
          <Icon className="w-[18px] h-[18px]" style={{ color: "var(--accent)" }} />
        </div>
        <div className="flex-1 pt-1">
          <p className="text-sm font-semibold text-[var(--text-primary)]">{title}</p>
          {description && (
            <p className="text-xs text-[var(--text-tertiary)] mt-1 leading-relaxed">{description}</p>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}

function PolicyPicker({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: EbayPolicy[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="card p-3 flex flex-col gap-1">
      <span className="text-xs font-medium text-[var(--text-secondary)]">{label}</span>
      <select
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">— Not set —</option>
        {options.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
    </label>
  );
}

function OptionCard({
  icon: Icon,
  title,
  description,
  selected,
  onClick,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="card p-4 text-left flex gap-3 items-start active:scale-[.98]"
      style={{ border: selected ? "2px solid var(--accent)" : undefined, transitionTimingFunction: "var(--spring)" }}
    >
      <Icon className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: selected ? "var(--accent)" : "var(--text-secondary)" }} />
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">{title}</p>
          {selected && <Check className="w-3.5 h-3.5" style={{ color: "var(--accent)" }} />}
        </div>
        <p className="text-xs text-[var(--text-secondary)] mt-0.5">{description}</p>
      </div>
    </button>
  );
}
