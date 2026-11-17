/**
 * Tiny async key/value store on IndexedDB with an in-memory fallback.
 * The preview iframe may block IndexedDB (or hang while opening it): any failure switches to memory for the rest of the
 * session and `backend` reports it, so the UI can warn that assets will not survive a reload.
 */
type KvBackendName = "indexedDB" | "memory";

export interface Kv<T> {
  get(key: string): Promise<T | undefined>;
  put(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  all(): Promise<T[]>;
  clear(): Promise<void>;
  /** Backend actually in use (resolves after the first operation). */
  readonly backend: KvBackendName;
}

export interface KvOptions {
  dbName: string;
  storeName?: string;
  /** Inject a factory (tests); `null` forces the memory fallback; default = `globalThis.indexedDB`. */
  factory?: IDBFactory | null;
  /** Give up opening after this many ms (blocked iframes can hang). */
  openTimeoutMs?: number;
}

const wrap = <R>(req: IDBRequest<R>): Promise<R> =>
  new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error ?? new Error("IndexedDB request failed"));
  });

export function createKv<T>(opts: KvOptions): Kv<T> {
  const storeName = opts.storeName ?? "kv";
  const mem = new Map<string, T>();
  let backend: KvBackendName = "memory";
  let dbPromise: Promise<IDBDatabase | null> | undefined;

  const open = (): Promise<IDBDatabase | null> => {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise<IDBDatabase | null>((resolve) => {
      let factory: IDBFactory | null = null;
      try {
        factory = opts.factory === undefined ? (typeof indexedDB !== "undefined" ? indexedDB : null) : opts.factory;
      } catch {
        factory = null;
      }
      if (!factory) return resolve(null);
      const timer = setTimeout(() => resolve(null), opts.openTimeoutMs ?? 2000);
      try {
        const req = factory.open(opts.dbName, 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(storeName)) req.result.createObjectStore(storeName);
        };
        req.onsuccess = () => {
          clearTimeout(timer);
          backend = "indexedDB";
          resolve(req.result);
        };
        req.onerror = () => {
          clearTimeout(timer);
          resolve(null);
        };
        req.onblocked = () => {
          clearTimeout(timer);
          resolve(null);
        };
      } catch {
        clearTimeout(timer);
        resolve(null);
      }
    });
    return dbPromise;
  };

  /** Run `fn` against the object store; on any failure fall back to memory permanently. */
  async function run<R>(
    mode: IDBTransactionMode,
    fn: (s: IDBObjectStore) => Promise<R>,
    fallback: () => R,
  ): Promise<R> {
    const db = await open();
    if (db) {
      try {
        const tx = db.transaction(storeName, mode);
        const done = new Promise<void>((res, rej) => {
          tx.oncomplete = () => res();
          tx.onerror = () => rej(tx.error);
          tx.onabort = () => rej(tx.error);
        });
        const out = await fn(tx.objectStore(storeName));
        await done;
        return out;
      } catch {
        backend = "memory";
        dbPromise = Promise.resolve(null);
      }
    }
    return fallback();
  }

  return {
    get backend() {
      return backend;
    },
    get: (key) =>
      run(
        "readonly",
        (s) => wrap<T | undefined>(s.get(key)),
        () => mem.get(key),
      ),
    put: (key, value) =>
      run(
        "readwrite",
        async (s) => void (await wrap(s.put(value, key))),
        () => void mem.set(key, value),
      ),
    delete: (key) =>
      run(
        "readwrite",
        async (s) => void (await wrap(s.delete(key))),
        () => void mem.delete(key),
      ),
    all: () =>
      run(
        "readonly",
        (s) => wrap<T[]>(s.getAll()),
        () => [...mem.values()],
      ),
    clear: () =>
      run(
        "readwrite",
        async (s) => void (await wrap(s.clear())),
        () => mem.clear(),
      ),
  };
}
