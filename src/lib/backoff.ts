// Retry timing for OpenAI calls (Volume Phase 1: 6 analyses at once can hit
// rate limits). Honors OpenAI's retry-after when given; otherwise
// exponential with jitter. Kept short enough to fit Vercel's 60 s limit.

export const MAX_BACKOFF_MS = 20_000;

export function retryDelayMs(attempt: number, err: { isRateLimit?: boolean; retryAfterMs?: number } | null | undefined, random = Math.random): number {
  if (err?.isRateLimit) {
    if (err.retryAfterMs && err.retryAfterMs > 0) return Math.min(MAX_BACKOFF_MS, err.retryAfterMs + Math.round(random() * 500));
    const base = Math.min(MAX_BACKOFF_MS, 2000 * 2 ** (attempt - 1));
    return Math.round(base * (0.75 + random() * 0.5));
  }
  return 1000 * attempt;
}

/** Run `fn`, retrying up to `attempts` times with retryDelayMs between tries. */
export async function withBackoff<T>(fn: () => Promise<T>, attempts = 3, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<T> {
  let last: unknown;
  for (let a = 1; a <= attempts; a++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (a < attempts) await sleep(retryDelayMs(a, e as { isRateLimit?: boolean; retryAfterMs?: number }));
    }
  }
  throw last;
}
