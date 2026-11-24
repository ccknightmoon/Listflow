// When a photo was taken, from its EXIF data (browser-safe, no deps).
//
// Used to group camera-roll uploads by the pauses between shots (see
// src/lib/time-grouping.ts). Must run on the ORIGINAL file: compressing
// through a canvas drops EXIF. Reads only the first 256 KB.
//
// Returns milliseconds on a "camera clock" (DateTimeOriginal has no time
// zone, so it's read as if UTC). Only differences between photos matter.

const HEAD_BYTES = 256 * 1024;

export async function readCaptureTimeMs(file: Blob): Promise<number | null> {
  try {
    const buf = await file.slice(0, HEAD_BYTES).arrayBuffer();
    return parseJpegCaptureTime(new DataView(buf));
  } catch {
    return null;
  }
}

/** DateTimeOriginal (+ SubSecTimeOriginal) from a JPEG's APP1/Exif block. */
export function parseJpegCaptureTime(view: DataView): number | null {
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null; // not a JPEG
  let off = 2;
  while (off + 4 <= view.byteLength) {
    const marker = view.getUint16(off);
    if ((marker & 0xff00) !== 0xff00) return null;
    const size = view.getUint16(off + 2);
    if (marker === 0xffe1 && off + 10 <= view.byteLength && view.getUint32(off + 4) === 0x45786966 /* "Exif" */) {
      return parseTiff(view, off + 10, Math.min(view.byteLength, off + 2 + size));
    }
    if (marker === 0xffda) return null; // start of image data: no EXIF before it
    off += 2 + size;
  }
  return null;
}

function parseTiff(view: DataView, tiff: number, end: number): number | null {
  if (tiff + 8 > end) return null;
  const order = view.getUint16(tiff);
  const le = order === 0x4949;
  if (!le && order !== 0x4d4d) return null;
  const u16 = (o: number) => view.getUint16(o, le);
  const u32 = (o: number) => view.getUint32(o, le);
  const ascii = (o: number, n: number) => {
    let s = "";
    for (let i = 0; i < n && o + i < end; i++) {
      const c = view.getUint8(o + i);
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  };
  const readIfd = (ifd: number): Map<number, { type: number; count: number; valueOff: number }> => {
    const tags = new Map<number, { type: number; count: number; valueOff: number }>();
    if (ifd + 2 > end) return tags;
    const n = u16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (e + 12 > end) break;
      const type = u16(e + 2);
      const count = u32(e + 4);
      // ASCII values longer than 4 bytes live at an offset from the TIFF header.
      const valueOff = type === 2 && count > 4 ? tiff + u32(e + 8) : e + 8;
      tags.set(u16(e), { type, count, valueOff });
    }
    return tags;
  };
  const ifd0 = readIfd(tiff + u32(tiff + 4));
  const exifPtr = ifd0.get(0x8769);
  const exif = exifPtr ? readIfd(tiff + u32(exifPtr.valueOff)) : new Map();
  const dt = exif.get(0x9003) ?? exif.get(0x9004) ?? ifd0.get(0x0132); // DateTimeOriginal, DateTimeDigitized, DateTime
  if (!dt || dt.type !== 2) return null;
  const ms = parseExifDate(ascii(dt.valueOff, dt.count));
  if (ms == null) return null;
  const sub = exif.get(0x9291) ?? exif.get(0x9292);
  const subStr = sub && sub.type === 2 ? ascii(sub.valueOff, sub.count).trim() : "";
  const frac = /^\d+$/.test(subStr) ? Number(`0.${subStr}`) * 1000 : 0;
  return ms + Math.round(frac);
}

/** "2026:11:24 14:03:22" -> ms (read as UTC). */
export function parseExifDate(s: string): number | null {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s.trim());
  if (!m) return null;
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number);
  if (y < 1990 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return Date.UTC(y, mo - 1, d, h, mi, se);
}
