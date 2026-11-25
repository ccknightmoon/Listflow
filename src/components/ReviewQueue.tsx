"use client";

// Swipe-to-approve review (one card per item). Phone: swipe right to
// approve, left to hold back. Computer: Enter / → approve, ← hold back,
// E open the full editor, Esc close. Only the flagged fields are shown;
// a missing/flagged price can be fixed right on the card.
// Pure rules live in src/lib/review-queue.ts.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, ChevronLeft, Loader2, Pencil, Send, X } from "lucide-react";
import { Z } from "@/lib/z-layers";
import { formatMoney } from "@/lib/format";
import PriceFloorFields from "@/components/PriceFloorFields";
import { checkPriceAndFloor, moneyText } from "@/lib/offer-floor";
import {
  nextUndecided, swipeDecision, willList, draftIdsToList,
  type Decision, type Decisions, type ReviewItem,
} from "@/lib/review-queue";

interface Props {
  open: boolean;
  items: ReviewItem[];
  decisions: Decisions;
  onDecide: (draftId: string, d: Decision | null) => void;
  /** Saves a new price + Best Offer floor (null = no offers); returns an error message or null. */
  onSavePrice: (draftId: string, price: number, floor: number | null) => Promise<string | null>;
  onListAll: (draftIds: string[]) => void;
  listing: boolean;
  onClose: () => void;
}

export default function ReviewQueue({ open, items, decisions, onDecide, onSavePrice, onListAll, listing, onClose }: Props) {
  const [index, setIndex] = useState(0);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [priceInput, setPriceInput] = useState("");
  const [floorInput, setFloorInput] = useState("");
  const [priceError, setPriceError] = useState<string | null>(null);
  const [savingPrice, setSavingPrice] = useState(false);
  // What was last saved per draft this session (price + floor).
  const [prices, setPrices] = useState<Record<string, { price: number; floor: number | null }>>({});

  // Start at the first undecided card each time the queue opens.
  const [openedFor, setOpenedFor] = useState(false);
  if (open && !openedFor) {
    setOpenedFor(true);
    const first = nextUndecided(items, decisions);
    setIndex(first === -1 ? items.length : first);
  } else if (!open && openedFor) {
    setOpenedFor(false);
  }

  const item = index < items.length ? items[index] : null;
  const saved = useMemo(() => (item ? prices[item.draftId] ?? { price: item.price, floor: item.floor ?? null } : null), [item, prices]);
  const priceCheck = checkPriceAndFloor(priceInput, floorInput);

  const [priceFor, setPriceFor] = useState<string | null>(null);
  if (item && priceFor !== item.draftId) {
    setPriceFor(item.draftId);
    setPriceInput(moneyText(saved?.price ?? null));
    setFloorInput(moneyText(saved?.floor ?? null));
    setPriceError(null);
  }

  const advance = useCallback(() => {
    setDrag(null);
    setIndex((i) => {
      const n = nextUndecided(items, decisions, i + 1);
      return n === -1 ? Math.min(i + 1, items.length) : n;
    });
  }, [items, decisions]);

  const decide = useCallback(async (d: Decision) => {
    if (!item) return;
    if (d === "approve") {
      if (!priceCheck.ok || priceCheck.price == null) {
        setPriceError(priceCheck.priceError ? `${priceCheck.priceError} Fix it to approve this one.` : "Fix the offer floor to approve this one.");
        return;
      }
      const p = priceCheck.price;
      const f = priceCheck.floor;
      if (p !== saved?.price || f !== (saved?.floor ?? null)) {
        setSavingPrice(true);
        const err = await onSavePrice(item.draftId, p, f);
        setSavingPrice(false);
        if (err) {
          setPriceError(err);
          return;
        }
        setPrices((prev) => ({ ...prev, [item.draftId]: { price: p, floor: f } }));
      }
    }
    onDecide(item.draftId, d);
    advance();
  }, [item, priceCheck, saved, onSavePrice, onDecide, advance]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const inField = (e.target as HTMLElement | null)?.tagName === "INPUT";
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (!item) return;
      if (e.key === "Enter" || (!inField && e.key === "ArrowRight")) { e.preventDefault(); void decide("approve"); }
      else if (!inField && (e.key === "ArrowLeft" || e.key === "Backspace")) { e.preventDefault(); void decide("hold"); }
      else if (!inField && (e.key === "e" || e.key === "E")) { e.preventDefault(); window.open(`/drafts/${item.draftId}`, "_blank"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, item, decide, onClose]);

  if (!open) return null;

  const toList = draftIdsToList(items, decisions);
  const decided = items.filter((it) => decisions[it.draftId]).length;
  const dx = drag?.x ?? 0;
  const hint = dx > 40 ? "approve" : dx < -40 ? "hold" : null;

  return (
    <div className="fixed inset-0 flex flex-col" style={{ zIndex: Z.sheet, background: "var(--bg-page)" }} role="dialog" aria-modal="true" aria-label="Review items">
      <div className="flex items-center justify-between gap-2 px-4 pt-[calc(12px+env(safe-area-inset-top))] pb-3 max-w-xl w-full mx-auto">
        <button type="button" onClick={onClose} className="btn text-sm" aria-label="Close review"><X className="w-4 h-4" /> Close</button>
        <p className="text-sm font-semibold tabular-nums" aria-live="polite">{Math.min(index + 1, items.length)} / {items.length} · {decided} reviewed</p>
        <button type="button" className="btn text-sm" disabled={index === 0} onClick={() => setIndex((i) => Math.max(0, i - 1))} aria-label="Previous item"><ChevronLeft className="w-4 h-4" /></button>
      </div>

      <div className="flex-1 min-h-0 flex items-center justify-center px-4 max-w-xl w-full mx-auto">
        {item ? (
          <div
            ref={cardRef}
            className="card w-full p-4 select-none touch-pan-y"
            style={{
              transform: `translateX(${dx}px) rotate(${dx / 30}deg)`,
              transition: drag ? "none" : "transform .18s ease",
              borderColor: hint === "approve" ? "var(--success)" : hint === "hold" ? "var(--danger)" : undefined,
            }}
            onPointerDown={(e) => {
              if ((e.target as HTMLElement).closest("input,button,a")) return;
              start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (!start.current || start.current.id !== e.pointerId) return;
              setDrag({ x: e.clientX - start.current.x, y: e.clientY - start.current.y });
            }}
            onPointerUp={(e) => {
              if (!start.current) return;
              const d = swipeDecision(e.clientX - start.current.x, e.clientY - start.current.y, cardRef.current?.offsetWidth ?? 360);
              start.current = null;
              if (d) void decide(d);
              else setDrag(null);
            }}
            onPointerCancel={() => { start.current = null; setDrag(null); }}
          >
            {item.thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element -- storage URL
              <img src={item.thumbnail} alt="" draggable={false} className="w-full aspect-square object-cover rounded-xl mb-3" />
            ) : (
              <div className="w-full aspect-square rounded-xl mb-3" style={{ background: "var(--glass)" }} />
            )}
            <p className="font-semibold leading-snug">{item.title}</p>
            <div className="flex items-center gap-2 mt-1 text-sm">
              <span className="font-semibold">{priceCheck.price != null ? formatMoney(priceCheck.price) : "—"}</span>
              {priceCheck.floor != null && <span className="text-xs" style={{ color: "var(--text-secondary)" }}>offers from {formatMoney(priceCheck.floor)}</span>}
              <span className="text-xs rounded-full px-2 py-0.5" style={{ background: "var(--glass)", color: willList({ ...item }, decisions) ? "var(--success)" : "var(--text-secondary)" }}>
                {decisions[item.draftId] === "approve" ? "Approved" : decisions[item.draftId] === "hold" ? "Held back" : item.ready ? "Ready" : "Needs a look"}
              </span>
            </div>
            {item.reasons.length > 0 && (
              <ul className="mt-3 flex flex-col gap-1">
                {item.reasons.map((r) => (
                  <li key={r} className="text-xs flex items-start gap-1.5" style={{ color: "var(--warning, #b7791f)" }}>
                    <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" /> {r}
                  </li>
                ))}
              </ul>
            )}
            <PriceFloorFields
              idPrefix={`review-${item.draftId}`}
              className="mt-3"
              price={priceInput}
              floor={floorInput}
              onPriceChange={(v) => { setPriceInput(v); setPriceError(null); }}
              onFloorChange={(v) => { setFloorInput(v); setPriceError(null); }}
              disabled={savingPrice}
            />
            {priceError && <span className="text-xs mt-1 block" style={{ color: "var(--danger)" }} role="alert">{priceError}</span>}
            <Link href={`/drafts/${item.draftId}`} target="_blank" className="text-xs underline mt-3 inline-flex items-center gap-1" style={{ color: "var(--accent)" }}>
              <Pencil className="w-3 h-3" /> Fix other fields in the editor (E)
            </Link>
          </div>
        ) : (
          <div className="card w-full p-6 text-center">
            <p className="font-semibold">All reviewed</p>
            <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
              {toList.length} item{toList.length === 1 ? "" : "s"} ready to list · {items.length - toList.length} held back or still need a look.
            </p>
            <button type="button" className="btn btn-primary w-full min-h-[48px] mt-4" disabled={!toList.length || listing} onClick={() => onListAll(toList)}>
              {listing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} List all Ready ({toList.length})
            </button>
          </div>
        )}
      </div>

      {item && (
        <div className="grid grid-cols-2 gap-3 px-4 pt-3 pb-[calc(16px+env(safe-area-inset-bottom))] max-w-xl w-full mx-auto">
          <button type="button" className="btn min-h-[52px] font-semibold" onClick={() => void decide("hold")} disabled={savingPrice}>
            <X className="w-4 h-4" /> Hold back <span className="hidden lg:inline text-xs opacity-60">←</span>
          </button>
          <button type="button" className="btn btn-primary min-h-[52px] font-semibold" onClick={() => void decide("approve")} disabled={savingPrice}>
            {savingPrice ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Approve <span className="hidden lg:inline text-xs opacity-70">Enter</span>
          </button>
          <p className="col-span-2 text-center text-[11px]" style={{ color: "var(--text-tertiary)" }}>
            <span className="lg:hidden">Swipe right to approve, left to hold back.</span>
            <span className="hidden lg:inline">Enter / → approve · ← hold back · E editor · Esc close</span>
          </p>
        </div>
      )}
    </div>
  );
}
