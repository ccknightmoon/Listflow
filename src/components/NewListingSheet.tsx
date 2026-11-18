"use client";

import { useRouter } from "next/navigation";
import { Camera, Images, FileText } from "lucide-react";
import Sheet from "@/components/Sheet";
import { setPendingPhotos } from "@/lib/pending-photos";
import PhotoDropZone from "@/components/PhotoDropZone";
import { useIsDesktop } from "@/lib/use-is-desktop";

// Opened from the "+" in the bottom nav. The camera / photo picker opens
// directly from the tap here (labels wrapping hidden inputs), then the
// photos are handed to New Listing or Batch Upload, which start working
// on them immediately.
export default function NewListingSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const isDesktop = useIsDesktop();
  function go(target: "single" | "batch", files: FileList | File[] | null, path: string) {
    if (!files || files.length === 0) return;
    setPendingPhotos(target, Array.from(files));
    onClose();
    router.push(path);
  }

  // The rows are <label>s around hidden file inputs (so a tap opens the
  // camera/picker directly); make them reachable and usable by keyboard.
  const openPickerOnKey = (e: React.KeyboardEvent<HTMLLabelElement>) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    e.currentTarget.querySelector("input")?.click();
  };
  const row = "tap flex items-center gap-3 w-full rounded-2xl px-4 py-3.5 text-left cursor-pointer";
  const rowStyle = { background: "var(--glass)", border: "1px solid var(--glass-line)" } as const;

  return (
    <Sheet open={open} onClose={onClose} title="Start a listing">
        {/* Computers: drop or paste photos straight in. One photo = one
            item; several = batch (AI groups them). Same as picking files. */}
        <PhotoDropZone
          pasteEnabled={open && isDesktop}
          disabled={!isDesktop}
          label="Drop: 1 photo → new listing, several → batch"
          onFiles={(files) => (files.length > 1 ? go("batch", files, "/batch-upload") : go("single", files, "/new-listing"))}
        >
        {isDesktop && (
          <div className="mb-3 rounded-2xl px-4 py-5 text-center text-sm" style={{ border: "2px dashed var(--glass-line)", color: "var(--text-secondary)" }}>
            Drag photos here, or paste with ⌘V / Ctrl+V
          </div>
        )}
        <div className="flex flex-col gap-2">
          <label className={`${row} focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]`} style={rowStyle} tabIndex={0} role="button" onKeyDown={openPickerOnKey}>
            <span className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "var(--accent-tint)", color: "var(--accent)" }}>
              <Camera className="w-5 h-5" />
            </span>
            <span className="flex-1">
              <span className="block text-sm font-semibold">{isDesktop ? "One item from photos" : "Snap one item"}</span>
              <span className="block text-xs" style={{ color: "var(--text-secondary)" }}>{isDesktop ? "Choose its photos — AI fills in the listing" : "Camera opens now — AI fills in the listing"}</span>
            </span>
            <input type="file" accept="image/*" capture={isDesktop ? undefined : "environment"} multiple className="hidden" onChange={(e) => go("single", e.target.files, "/new-listing")} />
          </label>
          <label className={`${row} focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]`} style={rowStyle} tabIndex={0} role="button" onKeyDown={openPickerOnKey}>
            <span className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "var(--accent-tint)", color: "var(--accent)" }}>
              <Images className="w-5 h-5" />
            </span>
            <span className="flex-1">
              <span className="block text-sm font-semibold">Batch from photos</span>
              <span className="block text-xs" style={{ color: "var(--text-secondary)" }}>Pick many photos — AI groups them into items</span>
            </span>
            <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => go("batch", e.target.files, "/batch-upload")} />
          </label>
          <button type="button" className={row} style={rowStyle} onClick={() => { onClose(); router.push("/drafts"); }}>
            <span className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "var(--glass)", color: "var(--text-secondary)" }}>
              <FileText className="w-5 h-5" />
            </span>
            <span className="flex-1">
              <span className="block text-sm font-semibold">Drafts</span>
              <span className="block text-xs" style={{ color: "var(--text-secondary)" }}>Finish and list saved items</span>
            </span>
          </button>
        </div>
        </PhotoDropZone>
    </Sheet>
  );
}
