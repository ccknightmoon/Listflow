"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, RefreshCw, Shirt, Tag, Check, X, PencilLine } from "lucide-react";
import Toast from "@/components/Toast";
import { apiFetch } from "@/lib/api";
import { getPageCache, setPageCache } from "@/lib/page-cache";

interface PendingOffer {
  itemId: string;
  title: string;
  thumbnail: string | null;
  askingPrice: number | null;
  bestOfferId: string;
  buyerUserId: string | null;
  offerPrice: number | null;
  quantity: number;
  expirationTime: string | null;
  buyerMessage: string | null;
}

function offerKey(o: PendingOffer): string {
  return `${o.itemId}-${o.bestOfferId}`;
}

// Deliberately doesn't assume a fixed expiration window (eBay's own docs
// aren't consistent about whether it's 24 or 48 hours) -- just formats
// whatever ExpirationTime the API actually returned.
function formatExpiration(dateStr: string | null): string {
  if (!dateStr) return "";
  const ms = new Date(dateStr).getTime() - Date.now();
  if (Number.isNaN(ms)) return "";
  if (ms <= 0) return "Expired";
  const hours = Math.floor(ms / 3600000);
  if (hours < 1) {
    const mins = Math.max(1, Math.floor(ms / 60000));
    return `Expires in ${mins}m`;
  }
  if (hours < 48) return `Expires in ${hours}h`;
  return `Expires in ${Math.floor(hours / 24)}d`;
}

function pctOfAsking(offerPrice: number | null, askingPrice: number | null): string | null {
  if (offerPrice == null || askingPrice == null || askingPrice <= 0) return null;
  return `${Math.round((offerPrice / askingPrice) * 100)}% of asking`;
}

// See src/lib/page-cache.ts — shows the last-loaded offers list instantly
// on revisit while load() quietly refreshes it in the background.
const OFFERS_CACHE_KEY = "offers:list";

export default function OffersPage() {
  const [offers, setOffers] = useState<PendingOffer[]>(() => getPageCache<PendingOffer[]>(OFFERS_CACHE_KEY) ?? []);
  const [loading, setLoading] = useState(() => getPageCache<PendingOffer[]>(OFFERS_CACHE_KEY) === undefined);
  const [error, setError] = useState<string | null>(null);
  const [needsConnect, setNeedsConnect] = useState(false);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [listingsChecked, setListingsChecked] = useState(0);
  const [responding, setResponding] = useState<Set<string>>(new Set());
  const [counterOpenKey, setCounterOpenKey] = useState<string | null>(null);
  const [counterPrices, setCounterPrices] = useState<Record<string, string>>({});

  useEffect(() => {
    load({ silent: getPageCache<PendingOffer[]>(OFFERS_CACHE_KEY) !== undefined });
  }, []);

  // Mirror the merged list back into the cache so the next visit
  // (within this tab, before it backgrounds) can paint instantly.
  useEffect(() => { setPageCache(OFFERS_CACHE_KEY, offers); }, [offers]);

  async function load(opts: { silent?: boolean } = {}) {
    if (!opts.silent) setLoading(true);
    setError(null);
    setNeedsConnect(false);
    setNeedsReconnect(false);
    try {
      const data = await apiFetch<{
        offers?: PendingOffer[];
        listingsChecked?: number;
        truncated?: boolean;
        error?: string;
        connect?: boolean;
        reconnect?: boolean;
      }>("/api/ebay/offers");
      if (data.error) {
        setError(data.error);
        setNeedsConnect(!!data.connect);
        setNeedsReconnect(!!data.reconnect);
        // Don't clear the list on a transient error -- this branch also
        // fires for routine eBay hiccups (not just a real disconnect), and
        // load() runs silently on every revisit within the page-cache
        // window (src/lib/page-cache.ts). Wiping a good cached list the
        // moment a background refresh hits a blip would make a passing
        // eBay error look worse than doing nothing at all -- same
        // "fall back to what we already had" reasoning store/page.tsx
        // uses for its own eBay failures.
        return;
      }
      setOffers(data.offers ?? []);
      setListingsChecked(data.listingsChecked ?? 0);
      setTruncated(!!data.truncated);
    } catch {
      setError("Failed to load pending offers");
    } finally {
      setLoading(false);
    }
  }

  async function respond(offer: PendingOffer, action: "accept" | "decline" | "counter", counterPriceNum?: number) {
    const key = offerKey(offer);
    setResponding((prev) => new Set(prev).add(key));
    setError(null);
    try {
      const data = await apiFetch<{ error?: string; success?: boolean }>("/api/ebay/offers/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: offer.itemId,
          bestOfferId: offer.bestOfferId,
          action,
          ...(action === "counter" ? { counterPrice: counterPriceNum, quantity: offer.quantity } : {}),
        }),
      });
      if (data.error) throw new Error(data.error);
      setOffers((prev) => prev.filter((o) => offerKey(o) !== key));
      setCounterOpenKey((k) => (k === key ? null : k));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setResponding((prev) => { const next = new Set(prev); next.delete(key); return next; });
    }
  }

  function handleAccept(offer: PendingOffer) {
    const amount = offer.offerPrice != null ? `$${offer.offerPrice.toFixed(2)}` : "this offer";
    if (!confirm(`Accept ${offer.buyerUserId ?? "the buyer"}'s offer of ${amount} for "${offer.title}"? This can't be undone.`)) return;
    respond(offer, "accept");
  }

  function handleDecline(offer: PendingOffer) {
    if (!confirm(`Decline ${offer.buyerUserId ?? "the buyer"}'s offer on "${offer.title}"? This can't be undone.`)) return;
    respond(offer, "decline");
  }

  function handleCounterSubmit(offer: PendingOffer) {
    const key = offerKey(offer);
    const priceNum = Number(counterPrices[key]);
    if (!counterPrices[key] || !Number.isFinite(priceNum) || priceNum <= 0) {
      setError("Enter a valid counter price.");
      return;
    }
    if (!confirm(`Send a counter offer of $${priceNum.toFixed(2)} to ${offer.buyerUserId ?? "the buyer"} for "${offer.title}"?`)) return;
    respond(offer, "counter", priceNum);
  }

  return (
    <main className="relative min-h-screen max-w-md mx-auto px-5 pt-6 pb-5 overflow-hidden" style={{ viewTransitionName: "offers-panel" }}>
      <div
        className="bloom d1 stagger"
        style={{ width: 240, height: 240, top: -70, left: -60, background: "var(--glow-primary)" }}
      />
      <div
        className="bloom d1 stagger"
        style={{ width: 200, height: 200, top: 10, right: -70, background: "var(--glow-secondary)" }}
      />

      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/store"
          className="w-[34px] h-[34px] rounded-[11px] flex items-center justify-center flex-none"
          style={{ background: "var(--glass)", border: "1px solid var(--glass-line)" }}
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-medium">Pending offers</h1>
          {!loading && !error && (
            <p className="text-xs text-[var(--text-secondary)]">
              {offers.length === 0
                ? "No offers awaiting a response"
                : `${offers.length} offer${offers.length !== 1 ? "s" : ""} awaiting a response`}
            </p>
          )}
        </div>
        <button
          onClick={() => load()}
          disabled={loading}
          className="p-2 rounded-lg hover:bg-[var(--bg-page)] transition-colors"
        >
          {loading
            ? <Loader2 className="w-4 h-4 animate-spin text-[var(--text-secondary)]" />
            : <RefreshCw className="w-4 h-4 text-[var(--text-secondary)]" />
          }
        </button>
      </div>

      <Toast
        type="error"
        message={
          error ? (
            <>
              {error}
              {needsConnect && (
                <a href="/api/ebay/connect" className="underline ml-2 font-medium">Connect eBay →</a>
              )}
              {needsReconnect && (
                <a href="/api/ebay/connect" className="underline ml-2 font-medium">Reconnect eBay →</a>
              )}
            </>
          ) : null
        }
        onClose={() => setError(null)}
      />

      {!loading && !error && truncated && (
        <p className="text-[11px] text-[var(--text-tertiary)] mb-3 leading-relaxed">
          Checked the first {listingsChecked} active listings for offers -- you have more than that, so a few of your newest ones weren&apos;t checked this time.
        </p>
      )}

      {loading && (
        <div className="card p-8 text-center">
          <Loader2 className="w-6 h-6 mx-auto mb-3 animate-spin" />
          <p className="text-sm text-[var(--text-secondary)]">Checking your active listings for offers...</p>
        </div>
      )}

      {!loading && !error && offers.length === 0 && (
        <div className="card p-10 text-center">
          <Tag className="w-8 h-8 mx-auto mb-3 text-[var(--text-tertiary)]" />
          <p className="text-sm font-medium mb-1">All caught up!</p>
          <p className="text-xs text-[var(--text-secondary)]">No pending Best Offers right now.</p>
        </div>
      )}

      {!loading && offers.length > 0 && (
        <div className="flex flex-col gap-2">
          {offers.map((offer, i) => {
            const key = offerKey(offer);
            const isResponding = responding.has(key);
            const pct = pctOfAsking(offer.offerPrice, offer.askingPrice);
            const expiration = formatExpiration(offer.expirationTime);
            const counterOpen = counterOpenKey === key;

            return (
              <div key={key} className={`card stagger p-3 ${i < 6 ? `d${i + 1}` : ""}`}>
                <div className="flex items-start gap-3">
                  {offer.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={offer.thumbnail}
                      alt={offer.title}
                      loading="lazy"
                      decoding="async"
                      className="w-12 h-12 rounded-md object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-md bg-[var(--bg-page)] flex items-center justify-center flex-shrink-0">
                      <Shirt className="w-5 h-5 text-[var(--text-secondary)]" />
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{offer.title || "Untitled listing"}</p>
                    <p className="text-xs text-[var(--text-secondary)] mt-0.5 truncate">
                      {offer.buyerUserId ?? "Unknown buyer"}
                      {offer.quantity > 1 ? ` · qty ${offer.quantity}` : ""}
                    </p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="text-sm font-semibold" style={{ color: "var(--accent)" }}>
                        {offer.offerPrice != null ? `$${offer.offerPrice.toFixed(2)}` : "—"}
                      </span>
                      {offer.askingPrice != null && (
                        <span className="text-xs text-[var(--text-tertiary)]">
                          of ${offer.askingPrice.toFixed(2)} asking{pct ? ` (${pct})` : ""}
                        </span>
                      )}
                    </div>
                    {expiration && (
                      <p className="text-[11px] mt-0.5" style={{ color: expiration === "Expired" ? "var(--danger)" : "var(--text-tertiary)" }}>
                        {expiration}
                      </p>
                    )}
                    {offer.buyerMessage && (
                      <p className="text-xs text-[var(--text-secondary)] mt-1 italic truncate">&ldquo;{offer.buyerMessage}&rdquo;</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 mt-3">
                  <button
                    onClick={() => handleAccept(offer)}
                    disabled={isResponding}
                    className="flex-1 flex items-center justify-center gap-1 text-xs font-medium py-2 tap rounded-lg"
                    style={{ background: "color-mix(in srgb, var(--success) 16%, var(--bg-surface))", color: "var(--success)" }}
                  >
                    <Check className="w-3.5 h-3.5" /> Accept
                  </button>
                  <button
                    onClick={() => setCounterOpenKey(counterOpen ? null : key)}
                    disabled={isResponding}
                    className="flex-1 flex items-center justify-center gap-1 text-xs font-medium py-2 tap rounded-lg"
                    style={{ background: "var(--glass)", border: "1px solid var(--glass-line)", color: "var(--text-primary)" }}
                  >
                    <PencilLine className="w-3.5 h-3.5" /> Counter
                  </button>
                  <button
                    onClick={() => handleDecline(offer)}
                    disabled={isResponding}
                    className="flex-1 flex items-center justify-center gap-1 text-xs font-medium py-2 tap rounded-lg"
                    style={{ background: "color-mix(in srgb, var(--danger) 12%, var(--bg-surface))", color: "var(--danger)" }}
                  >
                    <X className="w-3.5 h-3.5" /> Decline
                  </button>
                </div>

                {isResponding && (
                  <p className="text-[11px] text-[var(--text-tertiary)] mt-2 flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" /> Sending to eBay...
                  </p>
                )}

                {counterOpen && !isResponding && (
                  <div className="flex items-center gap-2 mt-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--text-secondary)]">$</span>
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        placeholder="Counter price"
                        value={counterPrices[key] ?? ""}
                        onChange={(e) => setCounterPrices((prev) => ({ ...prev, [key]: e.target.value }))}
                        className="input w-full pl-6 text-sm"
                      />
                    </div>
                    <button
                      onClick={() => handleCounterSubmit(offer)}
                      className="text-xs font-medium px-3 py-2 tap rounded-lg flex-shrink-0"
                      style={{ background: "var(--accent)", color: "#fff" }}
                    >
                      Send
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
