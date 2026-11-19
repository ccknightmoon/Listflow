// Small concurrency helpers shared by the batch page (photo compression,
// background uploads, analysis). Pure and dependency-free so they can be
// unit-tested without a browser.

/** Runs `fn` over `items` with at most `limit` in flight; keeps input order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

/**
 * A shared limiter: every `run(fn)` call queues behind the others so no
 * more than `limit` are in flight at once, across callers.
 */
export function createLimiter(limit: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  function next() {
    if (active >= limit) return;
    const start = waiting.shift();
    if (start) {
      active++;
      start();
    }
  }
  return {
    run<T>(fn: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        waiting.push(() => {
          fn()
            .then(resolve, reject)
            .finally(() => {
              active--;
              next();
            });
        });
        next();
      });
    },
    get active() {
      return active;
    },
    get queued() {
      return waiting.length;
    },
  };
}

/** Retries `fn` up to `attempts` times with a growing pause between tries. */
export async function retry<T>(
  fn: () => Promise<T>,
  attempts = 3,
  baseDelayMs = 800,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
): Promise<T> {
  let last: unknown;
  for (let a = 1; a <= attempts; a++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (a < attempts) await sleep(baseDelayMs * a);
    }
  }
  throw last;
}
