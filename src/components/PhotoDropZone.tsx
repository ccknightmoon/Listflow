"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ImagePlus } from "lucide-react";
import { dragHasFiles, imageFilesFrom, shouldHandlePaste } from "@/lib/photo-files";

/**
 * Wraps a photo area so computers can add photos without a camera: drag
 * files onto it, or paste (⌘V / Ctrl+V) an image anywhere on the page.
 * Phones never fire these events in practice, so their flow is unchanged.
 */
export default function PhotoDropZone({
  onFiles,
  children,
  className,
  pasteEnabled = true,
  disabled = false,
  label = "Drop photos to add them",
}: {
  onFiles: (files: File[]) => void;
  children: ReactNode;
  className?: string;
  pasteEnabled?: boolean;
  disabled?: boolean;
  label?: string;
}) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const cb = useRef(onFiles);
  useEffect(() => { cb.current = onFiles; }, [onFiles]);

  useEffect(() => {
    if (!pasteEnabled || disabled) return;
    const onPaste = (e: ClipboardEvent) => {
      const files = imageFilesFrom(e.clipboardData);
      const t = e.target as HTMLElement | null;
      const hasText = !!e.clipboardData?.getData("text/plain");
      if (!shouldHandlePaste(t?.tagName, !!t?.isContentEditable, files.length, hasText)) return;
      e.preventDefault();
      cb.current(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [pasteEnabled, disabled]);

  return (
    <div
      className={`relative ${className ?? ""}`}
      onDragEnter={(e) => { if (disabled || !dragHasFiles(e.dataTransfer)) return; e.preventDefault(); depth.current++; setOver(true); }}
      onDragOver={(e) => { if (disabled || !dragHasFiles(e.dataTransfer)) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
      onDragLeave={() => { depth.current = Math.max(0, depth.current - 1); if (depth.current === 0) setOver(false); }}
      onDrop={(e) => {
        if (disabled || !dragHasFiles(e.dataTransfer)) return;
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        const files = imageFilesFrom(e.dataTransfer);
        if (files.length) cb.current(files);
      }}
    >
      {children}
      {over && (
        <div
          className="absolute inset-0 rounded-2xl flex flex-col items-center justify-center gap-2 text-sm font-semibold pointer-events-none"
          style={{ background: "color-mix(in srgb, var(--accent) 18%, var(--bg-surface))", border: "2px dashed var(--accent)", color: "var(--accent)" }}
        >
          <ImagePlus className="w-6 h-6" />
          {label}
        </div>
      )}
    </div>
  );
}
