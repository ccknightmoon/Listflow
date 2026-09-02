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
} from "lucide-react";
import BottomNav from "@/components/BottomNav";
import { getStoredTheme, setStoredTheme, type Theme } from "@/lib/theme";

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

  const [theme, setTheme] = useState<Theme>("system");
  const [signingOut, setSigningOut] = useState(false);

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
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => setMode(data.defaultShippingMode === "calculated" ? "calculated" : "free"))
      .catch(() => setError("Could not load settings"))
      .finally(() => setLoading(false));
  }, []);

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

  return (
    <main className="min-h-screen max-w-md mx-auto px-5 pt-6 pb-24">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/dashboard">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-xl font-medium">Settings</h1>
      </div>

      <SettingsSection
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
        title="Appearance"
        description="Choose how Listflow looks on this device. &quot;System&quot; follows your phone or computer's own light/dark setting automatically."
        icon={Palette}
      >
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

      <SettingsSection title="Account" icon={UserCircle}>
        <button
          onClick={handleSignOut}
          disabled={signingOut}
          className="btn w-full flex items-center justify-center gap-2"
          style={{ color: "var(--danger)" }}
        >
          {signingOut ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
          Sign out
        </button>
      </SettingsSection>

      <BottomNav />
    </main>
  );
}

function SettingsSection({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string;
  description?: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <section className="card p-4 mb-4">
      <div className="flex items-start gap-3 mb-3">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: "color-mix(in srgb, var(--brand-600) 14%, var(--bg-surface))" }}
        >
          <Icon className="w-[18px] h-[18px]" style={{ color: "var(--brand-600)" }} />
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
      className="card p-4 text-left flex gap-3 items-start"
      style={selected ? { border: "2px solid var(--brand-600)" } : undefined}
    >
      <Icon className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: selected ? "var(--brand-600)" : "var(--text-secondary)" }} />
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">{title}</p>
          {selected && <Check className="w-3.5 h-3.5" style={{ color: "var(--brand-600)" }} />}
        </div>
        <p className="text-xs text-[var(--text-secondary)] mt-0.5">{description}</p>
      </div>
    </button>
  );
}
