/**
 * Local snapshot history. IndexedDB when available, an in-memory Map otherwise (sandboxed iframes block storage).
 * Pure data layer: UI and autosave sit on top. All methods are async and never throw.
 */
export interface Snapshot {
  id: string;
  /** Project key (graph name) the snapshot belongs to. */
  project: string;
  label: string;
  time: number;
  /** Serialized `.kshader` text. */
  text: string;
  nodes: number;
}
interface SnapshotBackend {
  name: "indexeddb" | "memory";
  put(s: Snapshot): Promise<void>;
  all(): Promise<Snapshot[]>;
  remove(id: string): Promise<void>;
}

const memoryBackend = (): SnapshotBackend => {
  const m = new Map<string, Snapshot>();
  return {
    name: "memory",
    put: async (s) => void m.set(s.id, s),
    all: async () => [...m.values()],
    remove: async (id) => void m.delete(id),
  };
};

const DB = "kekenik-shader";
const STORE = "snapshots";

/** Resolves to an IndexedDB-backed store or `null` when IndexedDB is missing / blocked. */
async function idbBackend(
  factory: IDBFactory | undefined = typeof indexedDB === "undefined" ? undefined : indexedDB,
): Promise<SnapshotBackend | null> {
  if (!factory) return null;
  try {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const req = factory.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
      req.onblocked = () => rej(new Error("blocked"));
    });
    const tx = <T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
      new Promise((res, rej) => {
        const r = f(db.transaction(STORE, mode).objectStore(STORE));
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    return {
      name: "indexeddb",
      put: async (s) => void (await tx("readwrite", (o) => o.put(s))),
      all: () => tx("readonly", (o) => o.getAll() as IDBRequest<Snapshot[]>),
      remove: async (id) => void (await tx("readwrite", (o) => o.delete(id))),
    };
  } catch {
    return null;
  }
}

class SnapshotStore {
  private fallback = memoryBackend();
  private ready: Promise<SnapshotBackend>;
  constructor(backend?: SnapshotBackend | Promise<SnapshotBackend | null>) {
    this.ready = Promise.resolve(backend ?? idbBackend()).then((b) => b ?? this.fallback);
  }
  async backendName(): Promise<string> {
    return (await this.ready).name;
  }
  private async run<T>(f: (b: SnapshotBackend) => Promise<T>, d: T): Promise<T> {
    const b = await this.ready;
    try {
      return await f(b);
    } catch {
      return b === this.fallback ? d : f(this.fallback).catch(() => d); // a failing IndexedDB degrades to memory
    }
  }
  /** Save a snapshot unless the newest one of the project has identical text. Keeps at most `keep` per project (default 40). */
  async add(project: string, label: string, text: string, nodes: number, keep = 40): Promise<Snapshot | null> {
    const list = await this.list(project);
    if (list[0]?.text === text) return null;
    const s: Snapshot = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      project,
      label,
      time: Date.now(),
      text,
      nodes,
    };
    await this.run((b) => b.put(s), undefined);
    for (const old of list.slice(keep - 1)) await this.run((b) => b.remove(old.id), undefined);
    return s;
  }
  /** Newest first. `project` undefined = every project. */
  async list(project?: string): Promise<Snapshot[]> {
    const all = await this.run((b) => b.all(), [] as Snapshot[]);
    return all
      .filter((s) => project === undefined || s.project === project)
      .sort((a, b) => b.time - a.time || (a.id < b.id ? 1 : -1));
  }
  async get(id: string): Promise<Snapshot | undefined> {
    return (await this.list()).find((s) => s.id === id);
  }
  async remove(id: string): Promise<void> {
    await this.run((b) => b.remove(id), undefined);
  }
}

export const snapshots = new SnapshotStore();
