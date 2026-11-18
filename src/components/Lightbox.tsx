"use client";

import PhotoViewer from "@/components/PhotoViewer";

/** Single-photo viewer (kept for older call sites). See PhotoViewer. */
export default function Lightbox({ src, onClose }: { src: string | null; onClose: () => void }) {
  return <PhotoViewer photos={src ? [src] : []} index={src ? 0 : null} onClose={onClose} />;
}
