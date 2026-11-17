/**
 * Safe key/value storage. Wraps localStorage in try/catch and falls back to an
 * in-memory Map when storage is unavailable (e.g. sandboxed preview iframes).
 * Values are strings; use getJSON/setJSON for structured data.
 */

interface StorageBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SafeStorage {
  get(key: string): string | null;
  set(key: string, value: string): boolean;
  remove(key: string): void;
  getJSON<T>(key: string): T | null;
  setJSON(key: string, value: unknown): boolean;
  /** True while the real backend is being used (false after a failure or if unavailable). */
  readonly persistent: boolean;
  /** Keys written through this wrapper that live only in memory. */
  readonly backendName: "localStorage" | "memory" | "custom";
}

const PREFIX = "kekenik-shader:";

function createSafeStorage(
  backendFactory: (() => StorageBackend | null) | undefined = defaultBackend,
  prefix = PREFIX,
): SafeStorage {
  const mem = new Map<string, string>();
  let backend: StorageBackend | null = null;
  try {
    backend = backendFactory ? backendFactory() : null;
    if (backend) {
      // Probe: some environments expose the object but throw on write.
      const probe = `${prefix}__probe__`;
      backend.setItem(probe, "1");
      backend.removeItem(probe);
    }
  } catch {
    backend = null;
  }
  const state = { persistent: backend !== null };
  const name: SafeStorage["backendName"] = backend
    ? backendFactory === defaultBackend
      ? "localStorage"
      : "custom"
    : "memory";

  const api: SafeStorage = {
    get(key) {
      if (backend) {
        try {
          const v = backend.getItem(prefix + key);
          if (v !== null) return v;
        } catch {
          backend = null;
          state.persistent = false;
        }
      }
      return mem.get(key) ?? null;
    },
    set(key, value) {
      mem.set(key, value);
      if (backend) {
        try {
          backend.setItem(prefix + key, value);
          return true;
        } catch {
          backend = null;
          state.persistent = false;
        }
      }
      return false;
    },
    remove(key) {
      mem.delete(key);
      try {
        backend?.removeItem(prefix + key);
      } catch {
        backend = null;
        state.persistent = false;
      }
    },
    getJSON<T>(key: string): T | null {
      const raw = api.get(key);
      if (raw === null) return null;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    },
    setJSON(key, value) {
      try {
        return api.set(key, JSON.stringify(value));
      } catch {
        return false;
      }
    },
    get persistent() {
      return state.persistent;
    },
    backendName: name,
  };
  return api;
}

function defaultBackend(): StorageBackend | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** App-wide storage instance. */
export const storage: SafeStorage = createSafeStorage();
