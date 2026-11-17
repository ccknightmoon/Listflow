"use client";

import { useMemo, useState } from "react";
import { Loader2, Eye } from "lucide-react";
import Sheet from "@/components/Sheet";
import { planPriceCut, summarizeCut, PRICE_CUT_PRESETS, type CutRow, type CutTarget } from "@/lib/price-cut";
import { OFFER_DISCOUNTS } from "@/lib/watcher-offers-shared";
import type { PriceChange } from "@/lib/bulk-edit";
import { formatMoney } from "@/lib/format";

type Mode = "preset" | "set" | "minus$" | "minus%";

/**
 * Lower prices quickly: presets (−10/−15/−20%), a custom amount (set $,
 * −$ or −%), an optional floor, a live preview, then one tap. For a single
 * listing with interested buyers, it also offers "Send an offer to
 * watchers" (eBay Negotiation API) as a softer first step.
 */
export default function PriceSheet({
  open, items, thumbnail, watchCount, offerEligible, onClose, onApply, onSendOffer,
}: {
  open: boolean;
  items: CutTarget[];
  thumbnail?: string | null;
  watchCount?: number | null;
  offerEligible?: boolean;
  onClose: () => void;
  onApply: (rows: CutRow[]) => void;
  onSendOffer?: (discount: number) => Promise<string | null>;
}) {
  const [mode, setMode] = useState<Mode>("preset");
  const [preset, setPreset] = useState<number>(15);
  const [custom, setCustom] = useState("");
  const [floor, setFloor] = useState("");
  const [offerPct, setOfferPct] = useState<number>(10);
  const [offerState, setOfferState] = useState<"idle" | "sending" | "sent" | string>("idle");

  const change: PriceChange | null = useMemo(() => {
    if (mode === "preset") return { mode: "percent", value: -preset };
    const v = parseFloat(custom);
    if (!Number.isFinite(v) || v <= 0) return null;
    if (mode === "set") return { mode: "set", value: v };
    if (mode === "minus$") return { mode: "add", value: -v };
    return { mode: "percent", value: -Math.min(v, 95) };
  }, [mode, preset, custom]);
  const floorNum = parseFloat(floor);
  const rows = useMemo(() => (change ? planPriceCut(items, change, Number.isFinite(floorNum) ? floorNum : null) : []), [items, change, floorNum]);
  const sum = summarizeCut(rows);
  const single = items.length === 1;
  const seg = (on: boolean) => ({
    background: on ? "var(--accent-tint)" : "var(--glass)",
    border: `1px solid ${on ? "var(--accent)" : "var(--glass-line)"}`,
    color: on ? "var(--accent)" : "var(--text-secondary)",
  });

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={single ? items[0].title : "Lower prices"}
      header={
        <div className="flex items-start gap-3">
          {single && thumbnail && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumbnail} alt="" width={56} height={56} className="w-14 h-14 rounded-xl object-cover flex-none" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-base font-semibold truncate">{single ? items[0].title : `Lower ${items.length.toLocaleString("en-US")} prices`}</p>
            {single ? (
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                Now {items[0].price != null ? formatMoney(items[0].price) : "unpriced"}
                {watchCount ? <> · <Eye className="inline w-3 h-3 -mt-0.5" /> {watchCount} watching</> : null}
              </p>
            ) : (
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>Runs in the background — progress shows in the tray.</p>
            )}
          </div>
        </div>
      }
      footer={
        <button type="button" className="btn btn-primary w-full min-h-[48px]" disabled={sum.changing === 0} onClick={() => { onApply(rows.filter((r) => r.to != null)); onClose(); }}>
          {single ? (rows[0]?.to != null ? `Lower to ${formatMoney(rows[0].to)}` : "Lower price") : `Lower ${sum.changing.toLocaleString("en-US")} price${sum.changing !== 1 ? "s" : ""}`}
        </button>
      }
    >

        <div className="grid grid-cols-3 gap-1.5 mb-2">
          {PRICE_CUT_PRESETS.map((p) => (
            <button key={p} type="button" className="rounded-xl min-h-[48px] text-sm font-bold" style={seg(mode === "preset" && preset === p)} onClick={() => { setMode("preset"); setPreset(p); }}>
              −{p}%
            </button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-1.5 mb-2">
          {([["set", "Set $"], ["minus$", "− $"], ["minus%", "− %"]] as const).map(([m, t]) => (
            <button key={m} type="button" className="rounded-xl min-h-[40px] text-xs font-semibold" style={seg(mode === m)} onClick={() => setMode(m)}>{t}</button>
          ))}
        </div>
        {mode !== "preset" && (
          <input
            className="input w-full mb-2"
            type="text"
            inputMode="decimal"
            enterKeyHint="done"
            autoFocus
            placeholder={mode === "set" ? "New price, e.g. 19.99" : mode === "minus$" ? "Amount off, e.g. 5" : "Percent off, e.g. 25"}
            value={custom}
            onChange={(e) => setCustom(e.target.value.replace(/[^0-9.]/g, ""))}
            aria-label="Custom amount"
          />
        )}
        <label className="flex items-center gap-2 mb-3 text-xs" style={{ color: "var(--text-secondary)" }}>
          <span className="flex-none">Don&apos;t go below $</span>
          <input
            className="input flex-1 py-1.5"
            type="text"
            inputMode="decimal"
            placeholder="optional floor"
            value={floor}
            onChange={(e) => setFloor(e.target.value.replace(/[^0-9.]/g, ""))}
            aria-label="Minimum price"
          />
        </label>

        {/* Preview */}
        <div className="rounded-2xl p-3 mb-3" style={{ background: "var(--glass)" }}>
          {single ? (
            rows[0]?.to != null ? (
              <p className="text-center tabular-nums">
                <span className="text-sm line-through" style={{ color: "var(--text-tertiary)" }}>{formatMoney(rows[0].from as number)}</span>
                <span className="mx-2">→</span>
                <span className="text-2xl font-extrabold">{formatMoney(rows[0].to)}</span>
                {rows[0].limitedBy && <span className="block text-[11px] mt-1" style={{ color: "var(--text-tertiary)" }}>held at your {rows[0].limitedBy === "cost" ? "item cost" : rows[0].limitedBy === "floor" ? "floor" : "$0.99 minimum"}</span>}
              </p>
            ) : (
              <p className="text-xs text-center" style={{ color: "var(--text-tertiary)" }}>
                {change ? (rows[0]?.reason === "at_floor" ? "Already at your floor / item cost — nothing to lower." : rows[0]?.reason === "no_price" ? "This listing has no price." : "That wouldn't lower the price.") : "Enter an amount."}
              </p>
            )
          ) : (
            <div className="text-xs tabular-nums">
              <p className="font-semibold mb-1">{sum.changing.toLocaleString("en-US")} will drop · {formatMoney(sum.totalReduction)} off in total</p>
              {sum.skipped > 0 && <p style={{ color: "var(--text-tertiary)" }}>{sum.skipped} skipped (already at floor / item cost, or no price)</p>}
              {sum.limited > 0 && <p style={{ color: "var(--text-tertiary)" }}>{sum.limited} held at the floor / item cost</p>}
              <div className="mt-2 flex flex-col gap-0.5 max-h-32 overflow-y-auto">
                {rows.filter((r) => r.to != null).slice(0, 20).map((r) => (
                  <p key={r.id} className="flex justify-between gap-2">
                    <span className="truncate" style={{ color: "var(--text-secondary)" }}>{r.title}</span>
                    <span className="flex-none">{formatMoney(r.from as number)} → {formatMoney(r.to as number)}</span>
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>

        {single && onSendOffer && offerEligible && (
          <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--border)" }}>
            <p className="text-sm font-semibold">Or send an offer to interested buyers</p>
            <p className="text-[11px] mb-2" style={{ color: "var(--text-tertiary)" }}>Only watchers see it, for 2 days — your public price stays the same.</p>
            <div className="grid grid-cols-3 gap-1.5 mb-2">
              {OFFER_DISCOUNTS.map((d) => (
                <button key={d} type="button" className="rounded-xl min-h-[40px] text-xs font-semibold" style={seg(offerPct === d)} onClick={() => setOfferPct(d)}>
                  {d}% off{items[0].price != null ? ` · ${formatMoney(Math.round(items[0].price * (100 - d)) / 100)}` : ""}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn w-full min-h-[44px]"
              disabled={offerState === "sending" || offerState === "sent"}
              onClick={async () => {
                setOfferState("sending");
                const err = await onSendOffer(offerPct);
                setOfferState(err ?? "sent");
              }}
            >
              {offerState === "sending" ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {offerState === "sent" ? "Offer sent ✓" : `Send ${offerPct}% offer`}
            </button>
            {offerState !== "idle" && offerState !== "sending" && offerState !== "sent" && (
              <p className="text-[11px] mt-1" style={{ color: "var(--danger)" }}>{offerState}</p>
            )}
          </div>
        )}
    </Sheet>
  );
}
