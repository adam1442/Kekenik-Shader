import { create } from "zustand";
import type { AssetInfo, AssetProvider } from "@/ui";
import { type AssetKind, classifyFile, mimeFor, sizeWarning } from "./classify";
import { describeImage, hdrThumb, parseHdr } from "./decode";
import { type Kv, createKv } from "./kv";

/** Persisted record (Blob included). */
interface AssetRecord {
  id: string;
  name: string;
  kind: AssetKind;
  ext: string;
  mime: string;
  size: number;
  created: number;
  width?: number;
  height?: number;
  thumb?: string;
  warning?: string;
  data: Blob;
}

export type AssetMeta = Omit<AssetRecord, "data">;

export interface ImportResult {
  file: string;
  ok: boolean;
  asset?: AssetMeta;
  error?: string;
}

interface AssetsState {
  items: AssetMeta[];
  ready: boolean;
  backend: "indexedDB" | "memory";
  /** Increases on every change (cheap subscription key). */
  revision: number;
}

export const useAssets = create<AssetsState>(() => ({ items: [], ready: false, backend: "memory", revision: 0 }));

const kv: Kv<AssetRecord> = createKv<AssetRecord>({ dbName: "kekenik-shader-assets" });
const blobs = new Map<string, Blob>();
let counter = 0;

const meta = ({ data: _data, ...m }: AssetRecord): AssetMeta => m;
const newId = (kind: AssetKind): string =>
  `${kind}-${Date.now().toString(36)}-${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const publish = (items: AssetMeta[]): void =>
  useAssets.setState((s) => ({ items, ready: true, backend: kv.backend, revision: s.revision + 1 }));

/** Load every persisted asset (idempotent). */
export async function loadAssets(): Promise<void> {
  const all = await kv.all();
  all.sort((a, b) => a.created - b.created);
  blobs.clear();
  for (const r of all) blobs.set(r.id, r.data);
  publish(all.map(meta));
}

let loading: Promise<void> | null = null;
/** Load persisted assets once per session. */
export const ensureAssetsLoaded = (): Promise<void> => (loading ??= loadAssets());

export const getAssetMeta = (id: string | null | undefined): AssetMeta | undefined =>
  id ? useAssets.getState().items.find((a) => a.id === id) : undefined;
export const getAssetBlob = (id: string | null | undefined): Blob | undefined => (id ? blobs.get(id) : undefined);

/** Import one file as an asset (decodes images / HDR to validate them and build a thumbnail). */
export async function importFile(file: File, forcedId?: string): Promise<ImportResult> {
  const c = classifyFile(file.name);
  if (!c)
    return {
      file: file.name,
      ok: false,
      error: `Unsupported file type “.${file.name.split(".").pop() ?? ""}”. Supported: GLB, GLTF, OBJ, FBX, PNG, JPG, WebP, HDR.`,
    };
  const data = new Blob([await file.arrayBuffer()], { type: file.type || mimeFor(c.ext) });
  const rec: AssetRecord = {
    id: forcedId ?? newId(c.kind),
    name: file.name,
    kind: c.kind,
    ext: c.ext,
    mime: data.type,
    size: data.size,
    created: Date.now(),
    data,
  };
  try {
    if (c.kind === "texture") Object.assign(rec, await describeImage(data));
    else if (c.kind === "hdr") {
      const hdr = parseHdr(await data.arrayBuffer());
      Object.assign(rec, { width: hdr.width, height: hdr.height, thumb: hdrThumb(hdr) });
    }
  } catch (e) {
    return { file: file.name, ok: false, error: `${file.name}: ${(e as Error).message}` };
  }
  const warning = sizeWarning(c.kind, rec.size, rec.width, rec.height);
  if (warning) rec.warning = warning;
  blobs.set(rec.id, data);
  await kv.put(rec.id, rec);
  publish([...useAssets.getState().items.filter((a) => a.id !== rec.id), meta(rec)]);
  return { file: file.name, ok: true, asset: meta(rec) };
}

export async function importFiles(files: readonly File[]): Promise<ImportResult[]> {
  const out: ImportResult[] = [];
  for (const f of files) out.push(await importFile(f));
  return out;
}

export async function renameAsset(id: string, name: string): Promise<boolean> {
  const rec = await kv.get(id);
  const clean = name.trim();
  if (!rec || !clean) return false;
  await kv.put(id, { ...rec, name: clean });
  publish(useAssets.getState().items.map((a) => (a.id === id ? { ...a, name: clean } : a)));
  return true;
}

export async function deleteAsset(id: string): Promise<void> {
  await kv.delete(id);
  blobs.delete(id);
  publish(useAssets.getState().items.filter((a) => a.id !== id));
}

/** AssetProvider for the shared TextureSlot control (textures only; drag id = `application/x-kk-asset`). */
export const assetProvider: AssetProvider = {
  list: (q) =>
    useAssets
      .getState()
      .items.filter((a) => a.kind === "texture" && (!q || a.name.toLowerCase().includes(q.toLowerCase())))
      .map(toInfo),
  get: (id) => {
    const a = getAssetMeta(id);
    return a && a.kind === "texture" ? toInfo(a) : undefined;
  },
  subscribe: (fn) => useAssets.subscribe(fn),
};

function toInfo(a: AssetMeta): AssetInfo {
  return {
    id: a.id,
    name: a.name,
    ...(a.thumb ? { thumb: a.thumb } : {}),
    info: a.width ? `${a.width}×${a.height}` : a.ext.toUpperCase(),
  };
}
