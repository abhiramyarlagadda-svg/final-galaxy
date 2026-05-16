import type { Job } from './radarClient';

const DB_NAME = 'job-radar';
const DB_VERSION = 1;
const STORE = 'jobs';
const META_STORE = 'meta';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

export async function readAllCached(): Promise<Job[]> {
  try {
    const db = await openDB();
    return await new Promise<Job[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result as Job[]) || []);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('[cache] read failed, returning empty', err);
    return [];
  }
}

export async function writeCached(jobs: Job[]): Promise<void> {
  if (jobs.length === 0) return;
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      for (const j of jobs) store.put(j);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[cache] write failed', err);
  }
}

export async function clearCache(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE, META_STORE], 'readwrite');
      tx.objectStore(STORE).clear();
      tx.objectStore(META_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[cache] clear failed', err);
  }
}

export async function readMeta<T = unknown>(key: string): Promise<T | null> {
  try {
    const db = await openDB();
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(META_STORE, 'readonly');
      const req = tx.objectStore(META_STORE).get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function writeMeta(key: string, value: unknown): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(META_STORE, 'readwrite');
      tx.objectStore(META_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[cache] meta write failed', err);
  }
}

export function latestPostedAt(jobs: Job[]): string | null {
  let max: string | null = null;
  for (const j of jobs) {
    if (j.postedAt && (!max || j.postedAt > max)) max = j.postedAt;
  }
  return max;
}
