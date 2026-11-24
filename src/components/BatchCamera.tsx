"use client";

// In-app batch camera: shoot item 1, tap "Next item", shoot item 2, ...
// Groups are known at capture time, so batch grouping needs no AI at all.
// Each shot is handed to the page right away (onShot) so it can compress
// and upload while Sel keeps shooting.
//
// Uses the live camera (getUserMedia). Where that isn't available or is
// blocked, it falls back to the phone's own camera one shot at a time
// (<input capture>), with the same Next item / Done flow.

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, ChevronRight, Check, X } from "lucide-react";
import { Z } from "@/lib/z-layers";

export interface CapturedShot {
  /** JPEG data URL, longest side <= maxDimension. */
  dataUrl: string;
  /** When it was taken (device clock, ms). */
  takenAt: number;
  /** First photo of a new item. */
  newItem: boolean;
}

interface Props {
  open: boolean;
  maxDimension: number;
  /** Photos already in the batch (for the cap). */
  existingCount: number;
  maxPhotos: number;
  onShot: (shot: CapturedShot) => void;
  /** Fallback path: files from the phone's own camera. */
  onFiles: (files: File[], newItem: boolean) => void;
  onClose: () => void;
}

export default function BatchCamera({ open, maxDimension, existingCount, maxPhotos, onShot, onFiles, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fallbackInput = useRef<HTMLInputElement | null>(null);
  const [mode, setMode] = useState<"starting" | "live" | "fallback">("starting");
  const [problem, setProblem] = useState<string | null>(null);
  // Per-item photo counts for this session; the last entry is the current item.
  const [items, setItems] = useState<number[]>([0]);
  const [lastThumb, setLastThumb] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const nextIsNewItem = useRef(true);

  const shotsThisSession = items.reduce((a, b) => a + b, 0);
  const atCap = existingCount >= maxPhotos;

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    nextIsNewItem.current = true;
    (async () => {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setMode("fallback");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setMode("live");
      } catch (err) {
        setProblem((err as Error).name === "NotAllowedError"
          ? "Camera access is blocked for Listflow. You can still shoot with your phone's camera below, or allow camera access in your browser settings."
          : "The live camera isn't available here. You can still shoot with your phone's camera below.");
        setMode("fallback");
      }
    })();
    return () => {
      cancelled = true;
      stop();
    };
  }, [open, stop]);

  const capture = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.videoWidth || atCap) return;
    const scale = Math.min(1, maxDimension / Math.max(v.videoWidth, v.videoHeight));
    const w = Math.round(v.videoWidth * scale);
    const h = Math.round(v.videoHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, w, h);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    const newItem = nextIsNewItem.current;
    nextIsNewItem.current = false;
    onShot({ dataUrl, takenAt: Date.now(), newItem });
    setItems((prev) => {
      const next = [...prev];
      next[next.length - 1] += 1;
      return next;
    });
    setLastThumb(dataUrl);
    setFlash(true);
    window.setTimeout(() => setFlash(false), 120);
  }, [atCap, maxDimension, onShot]);

  const nextItem = useCallback(() => {
    // Only start a new item once the current one has a photo.
    setItems((prev) => (prev[prev.length - 1] > 0 ? [...prev, 0] : prev));
    if (items[items.length - 1] > 0) nextIsNewItem.current = true;
    setLastThumb(null);
  }, [items]);

  // Keyboard (desktop webcams): Space = shoot, N = next item, Esc = done.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " " && mode === "live") { e.preventDefault(); capture(); }
      else if (e.key === "n" || e.key === "N") { e.preventDefault(); nextItem(); }
      else if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, mode, capture, nextItem, onClose]);

  if (!open) return null;
  const itemNo = items.length;
  const inItem = items[items.length - 1];
  const finishedItems = items.filter((n) => n > 0).length;

  return (
    <div className="fixed inset-0 flex flex-col" style={{ zIndex: Z.sheet, background: "#000", color: "#fff" }} role="dialog" aria-modal="true" aria-label="Batch camera">
      <div className="flex items-center justify-between px-4 pt-[calc(12px+env(safe-area-inset-top))] pb-2">
        <button type="button" onClick={onClose} className="rounded-full px-3 py-1.5 text-sm font-semibold flex items-center gap-1" style={{ background: "rgba(255,255,255,0.15)" }} aria-label="Done">
          {shotsThisSession > 0 ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />} {shotsThisSession > 0 ? "Done" : "Close"}
        </button>
        <div className="text-sm font-semibold tabular-nums" aria-live="polite">
          Item {itemNo} · {inItem} photo{inItem === 1 ? "" : "s"}
        </div>
        <div className="text-xs tabular-nums opacity-70">{finishedItems} item{finishedItems === 1 ? "" : "s"} · {shotsThisSession} shots</div>
      </div>

      <div className="relative flex-1 min-h-0 flex items-center justify-center overflow-hidden">
        {mode !== "fallback" && (
          <video ref={videoRef} playsInline muted className="max-w-full max-h-full object-contain" />
        )}
        {flash && <div className="absolute inset-0" style={{ background: "rgba(255,255,255,0.5)" }} />}
        {mode === "starting" && <p className="absolute text-sm opacity-80">Starting camera…</p>}
        {mode === "fallback" && (
          <div className="px-6 text-center max-w-sm">
            {problem && <p className="text-sm mb-4 opacity-90">{problem}</p>}
            <button type="button" className="btn btn-primary min-h-[52px] px-6 text-base" onClick={() => fallbackInput.current?.click()} disabled={atCap}>
              <Camera className="w-5 h-5" /> Take a photo
            </button>
            <input
              ref={fallbackInput}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = "";
                if (files.length === 0) return;
                const newItem = nextIsNewItem.current;
                nextIsNewItem.current = false;
                onFiles(files, newItem);
                setItems((prev) => {
                  const next = [...prev];
                  next[next.length - 1] += files.length;
                  return next;
                });
              }}
            />
          </div>
        )}
        {atCap && <p className="absolute bottom-3 text-xs px-3 py-1 rounded-full" style={{ background: "rgba(0,0,0,0.6)" }}>Batch is full ({maxPhotos} photos)</p>}
      </div>

      <div className="grid grid-cols-3 items-center px-6 pt-3 pb-[calc(20px+env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-2">
          {lastThumb ? (
            // eslint-disable-next-line @next/next/no-img-element -- local data URL preview
            <img src={lastThumb} alt="Last photo" className="w-12 h-12 rounded-lg object-cover" />
          ) : <span className="w-12 h-12" />}
          <span className="text-[11px] opacity-70 leading-tight">Remove extra shots<br />in the next step</span>
        </div>
        <div className="flex justify-center">
          {mode === "live" && (
            <button
              type="button"
              onClick={capture}
              disabled={atCap}
              aria-label="Take photo"
              className="w-[72px] h-[72px] rounded-full disabled:opacity-40"
              style={{ background: "#fff", boxShadow: "0 0 0 4px rgba(255,255,255,0.35)" }}
            />
          )}
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={nextItem}
            disabled={inItem === 0}
            className="rounded-full px-4 py-3 text-sm font-bold flex items-center gap-1 disabled:opacity-40"
            style={{ background: "var(--accent)", color: "#fff" }}
          >
            Next item <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
