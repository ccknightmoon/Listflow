// Desktop photo input helpers (drag-and-drop and paste). Pure so they can
// be tested without a browser.

type FileLike = { type: string; name?: string };
type ItemLike = { kind: string; type: string; getAsFile: () => File | null };

/** Image files out of a drop/paste DataTransfer (files list first, then items for pasted screenshots). */
export function imageFilesFrom(dt: { files?: ArrayLike<FileLike> | null; items?: ArrayLike<ItemLike> | null } | null | undefined): File[] {
  if (!dt) return [];
  const fromFiles = Array.from(dt.files ?? []).filter((f) => isImage(f)) as File[];
  if (fromFiles.length) return fromFiles;
  const out: File[] = [];
  for (const it of Array.from(dt.items ?? [])) {
    if (it.kind === "file" && it.type.startsWith("image/")) {
      const f = it.getAsFile();
      if (f) out.push(f);
    }
  }
  return out;
}

export function isImage(f: FileLike): boolean {
  if (f.type) return f.type.startsWith("image/");
  return /\.(jpe?g|png|gif|webp|heic|heif|avif)$/i.test(f.name ?? "");
}

/** True if a drag carries files (so we only react to file drags, not text). */
export function dragHasFiles(dt: { types?: ArrayLike<string> | null } | null | undefined): boolean {
  return !!dt && Array.from(dt.types ?? []).includes("Files");
}

/**
 * Should a window-level paste be treated as "add these photos"? Only when
 * the clipboard actually holds images, and never steal a paste meant for a
 * text field that's receiving plain text.
 */
export function shouldHandlePaste(targetTag: string | undefined, isContentEditable: boolean, images: number, hasText: boolean): boolean {
  if (images === 0) return false;
  const typing = targetTag === "INPUT" || targetTag === "TEXTAREA" || isContentEditable;
  return !(typing && hasText);
}
