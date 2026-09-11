export interface BatchRecoverySnapshot {
  step: "upload" | "grouping" | "review" | "results";
  photos: unknown[];
  groups: number[][];
  results: unknown[];
  customPrices: Record<number, string>;
  customSkus: Record<number, string>;
  draftIds: Record<number, string>;
}

const DB_NAME = "listflow-recovery";
const STORE_NAME = "batches";
const BATCH_KEY = "active";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open recovery storage."));
  });
}

export async function loadBatchRecovery(): Promise<BatchRecoverySnapshot | null> {
  if (typeof indexedDB === "undefined") return null;
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(BATCH_KEY);
    request.onsuccess = () => resolve((request.result as BatchRecoverySnapshot | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error("Could not load recovery data."));
  });
}

export async function saveBatchRecovery(snapshot: BatchRecoverySnapshot): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(snapshot, BATCH_KEY);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("Could not save recovery data."));
  });
}

export async function clearBatchRecovery(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).delete(BATCH_KEY);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("Could not clear recovery data."));
  });
}
