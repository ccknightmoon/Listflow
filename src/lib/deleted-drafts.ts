// "This draft was deleted" markers kept on the device, so nothing cached --
// the instant-paint snapshot (persisted-snapshot.ts, up to 3 days old), the
// in-tab page cache, an old tab left open -- can ever show a deleted draft
// again, even offline or before the live list arrives. The server is the
// real source of truth (a deleted row is gone for good); this only guards
// what the screen paints from saved copies.
const KEY = "listflow:deleted-drafts:v1";
const KEEP_MS = 30 * 86_400_000;

export type Tombstones = Record<string, number>; // draftId -> deletedAt

export function pruneTombstones(t: Tombstones, now = Date.now()): Tombstones {
  const out: Tombstones = {};
  for (const [id, at] of Object.entries(t)) if (typeof at === "number" && now - at < KEEP_MS) out[id] = at;
  return out;
}

export function addTombstones(t: Tombstones, ids: string[], now = Date.now()): Tombstones {
  const out = pruneTombstones(t, now);
  for (const id of ids) out[id] = now;
  return out;
}

export function withoutDeleted<T extends { id: string }>(items: T[], t: Tombstones): T[] {
  return items.filter((d) => !(d.id in t));
}

export function readTombstones(): Tombstones {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? pruneTombstones(JSON.parse(raw) as Tombstones) : {};
  } catch {
    return {};
  }
}

export function rememberDeleted(ids: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(addTombstones(readTombstones(), ids)));
  } catch {
    // storage blocked: the server list is still authoritative
  }
}
