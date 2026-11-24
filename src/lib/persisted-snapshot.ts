// Last-known screen data kept on the device (localStorage), so a screen can
// paint instantly on open and refresh in the background. Per user: each
// snapshot records whose data it is, and a screen drops it as soon as the
// server says a different user is signed in. Cleared on sign-out.
// Every access is wrapped: storage can be missing, full or blocked.
const PREFIX = "listflow:snap:v1:";

interface Stored<T> {
  userId: string | null;
  savedAt: number;
  value: T;
}

export function loadSnapshot<T>(name: string, maxAgeMs = 7 * 86_400_000, now = Date.now()): { value: T; userId: string | null; savedAt: number } | null {
  try {
    const raw = localStorage.getItem(PREFIX + name);
    if (!raw) return null;
    const s = JSON.parse(raw) as Stored<T>;
    if (!s || typeof s.savedAt !== "number" || now - s.savedAt > maxAgeMs) return null;
    return { value: s.value, userId: s.userId ?? null, savedAt: s.savedAt };
  } catch {
    return null;
  }
}

export function saveSnapshot<T>(name: string, value: T, userId: string | null, now = Date.now()): void {
  try {
    localStorage.setItem(PREFIX + name, JSON.stringify({ userId, savedAt: now, value } satisfies Stored<T>));
  } catch {
    // full / private mode: just no instant paint next time
  }
}

export function clearSnapshots(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    // ignore
  }
}
