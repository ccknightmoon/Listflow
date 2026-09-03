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
} from "lucide-react";
import BottomNav from "@/components/BottomNav";
import { getStoredTheme, setStoredTheme, type Theme } from "@/lib/theme";
import { ACCENT_PRESETS, getStoredAccent, setStoredAccent, type AccentColor } from "@/lib/accent";

type DefaultShippingMode = "free" | "calculated";

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
      })
      .catch(() => setError("Could not load settings"))
      .finally(() => setLoading(false));
  }, []);

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
    <main className="min-h-screen max-w-md mx-auto px-5 pt-6 pb-24">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/dashboard">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-xl font-medium">Settings</h1>
      </div>

      <SettingsSection
        delay="d1"
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
        delay="d2"
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
        delay="d3"
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
        delay="d4"
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

      <SettingsSection delay="d5" title="Account" icon={UserCircle}>
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

      <BottomNav />
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
