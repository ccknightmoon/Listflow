"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { isNavVisible } from "@/lib/nav-config";
import { useAnyOverlayOpen } from "@/components/Sheet";
import { Z } from "@/lib/z-layers";
import { CheckCircle2, ChevronDown, ChevronUp, ExternalLink, Loader2, RotateCw, XCircle } from "lucide-react";
import { getPublishQueue, summarizeQueue, type PublishItem } from "@/lib/publish-queue";

const EMPTY: PublishItem[] = [];

// Floating progress for background publishing, shown on every page while
// anything is queued, listing, or finished-but-not-dismissed.
export default function PublishTray() {
  const queue = typeof window === "undefined" ? null : getPublishQueue();
  const items = useSyncExternalStore(
    (cb) => (queue ? queue.subscribe(cb) : () => {}),
    () => (queue ? queue.getItems() : EMPTY),
    () => EMPTY,
  );
  const [open, setOpen] = useState(false);
  const navShown = isNavVisible(usePathname());
  const overlayOpen = useAnyOverlayOpen();
  const ref = useRef<HTMLDivElement | null>(null);
  const visible = Boolean(queue && items.length > 0);

  // Reserve space so the tray never covers content: pages get extra bottom
  // padding, and bottom action bars read --tray-offset to sit above it.
  useEffect(() => {
    const root = document.documentElement;
    if (!visible || !ref.current) {
      root.style.removeProperty("--tray-offset");
      return;
    }
    // globals.css pads <body> by --nav-space + --tray-offset, and bottom
    // action bars sit above --tray-offset, so nothing hides behind the tray.
    const apply = () => {
      const h = (ref.current?.offsetHeight ?? 0) + 8;
      root.style.setProperty("--tray-offset", `${h}px`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [visible, open, items.length]);

  if (!queue || items.length === 0) return null;
  const s = summarizeQueue(items);
  const busy = s.active > 0;
  const activeKinds = new Set(items.filter((i) => i.status === "queued" || i.status === "listing").map((i) => i.kind ?? "publish"));
  const verb = activeKinds.size === 1 && activeKinds.has("price") ? "Updating prices" : activeKinds.has("price") ? "Working" : "Listing";
  const doneWord = items.every((i) => i.kind === "price") ? "updated" : items.every((i) => (i.kind ?? "publish") === "publish") ? "listed" : "done";

  return (
    <div
      ref={ref}
      className={`fixed left-3 right-3 max-w-md mx-auto rounded-2xl text-xs lg:left-auto lg:right-6 lg:mx-0 lg:w-[380px] lg:bottom-6 ${navShown ? "bottom-[calc(84px+env(safe-area-inset-bottom))]" : "bottom-[calc(12px+env(safe-area-inset-bottom))]"}`}
      aria-hidden={overlayOpen || undefined}
      style={{
        zIndex: Z.tray,
        // Hidden while a sheet/modal is open -- it never floats over one.
        opacity: overlayOpen ? 0 : 1,
        pointerEvents: overlayOpen ? "none" : undefined,
        transition: "opacity .15s ease",
        background: "var(--glass-strong)", border: "1px solid var(--glass-line)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", boxShadow: "var(--shadow-card)" }}
      role="status"
      aria-live="polite"
    >
      <button type="button" className="w-full flex items-center gap-2 px-3 min-h-[44px]" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {busy ? <Loader2 className="w-4 h-4 animate-spin" style={{ color: "var(--accent)" }} /> : s.failed ? <XCircle className="w-4 h-4" style={{ color: "var(--danger)" }} /> : <CheckCircle2 className="w-4 h-4" style={{ color: "var(--success)" }} />}
        <span className="flex-1 text-left font-semibold">
          {busy ? `${verb} ${Math.min(s.done + 1, s.total)} of ${s.total}…` : `${s.listed} ${doneWord}${s.failed ? ` · ${s.failed} failed` : ""}`}
        </span>
        <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--glass)" }}>
          <div className="h-full" style={{ width: `${(s.done / s.total) * 100}%`, background: s.failed ? "var(--danger)" : "var(--success)", transition: "width .3s" }} />
        </div>
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
      </button>
      {open && (
        <div className="px-3 pb-3 flex flex-col gap-1.5 max-h-64 overflow-y-auto">
          {items.map((i) => (
            <div key={i.draftId} className="flex items-center gap-2">
              {i.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={i.thumbnail} alt="" className="w-7 h-7 rounded-md object-cover flex-none" />
              ) : <span className="w-7 h-7 rounded-md flex-none" style={{ background: "var(--glass)" }} />}
              <span className="flex-1 min-w-0">
                <span className="block truncate">{i.title}</span>
                {i.status === "failed" && <span className="block truncate" style={{ color: "var(--danger)" }}>{i.error}</span>}
                {i.status !== "failed" && i.note && <span className="block truncate tabular-nums" style={{ color: "var(--text-tertiary)" }}>{i.note}</span>}
              </span>
              {i.status === "listing" && <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: "var(--accent)" }} />}
              {i.status === "queued" && <span style={{ color: "var(--text-tertiary)" }}>queued</span>}
              {i.status === "listed" && (i.url
                ? <a href={i.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-0.5" style={{ color: "var(--success)" }}>live <ExternalLink className="w-3 h-3" /></a>
                : <CheckCircle2 className="w-3.5 h-3.5" style={{ color: "var(--success)" }} />)}
              {i.status === "failed" && (
                i.needsConnect || i.needsReconnect
                  ? <a href="/api/ebay/connect" className="underline" style={{ color: "var(--accent)" }}>Reconnect</a>
                  : <button type="button" onClick={() => queue.retry(i.draftId)} className="flex items-center gap-0.5" style={{ color: "var(--accent)" }}><RotateCw className="w-3 h-3" /> Retry</button>
              )}
            </div>
          ))}
          {!busy && (
            <button type="button" className="self-end mt-1 underline" style={{ color: "var(--text-secondary)" }} onClick={() => { queue.clearFinished(); setOpen(false); }}>
              Dismiss
            </button>
          )}
        </div>
      )}
    </div>
  );
}
