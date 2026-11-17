import { create } from "zustand";
import { storage } from "@/app/lib/storage";

/** Canvas preferences (persisted through the safe storage wrapper) + search recents / library favorites. */
export interface CanvasPrefs {
  showGrid: boolean;
  snap: boolean;
  gridSize: number;
  minimap: boolean;
  /** Grid look: dots (default), lines or crosses (Preferences, ). */
  gridStyle: "dots" | "lines" | "cross";
  set: (p: Partial<Omit<CanvasPrefs, "set">>) => void;
}

const KEY = "graph.prefs";
const saved = storage.getJSON<Partial<CanvasPrefs>>(KEY) ?? {};

export const useCanvasPrefs = create<CanvasPrefs>((set, get) => ({
  showGrid: saved.showGrid ?? true,
  snap: saved.snap ?? false,
  gridSize: saved.gridSize ?? 16,
  minimap: saved.minimap ?? true,
  gridStyle: saved.gridStyle ?? "dots",
  set: (p) => {
    set(p);
    const { showGrid, snap, gridSize, minimap, gridStyle } = get();
    storage.setJSON(KEY, { showGrid, snap, gridSize, minimap, gridStyle });
  },
}));

interface NodePrefs {
  recents: string[];
  favorites: string[];
  favoritesOnly: boolean;
  /** Bumped by "Collapse All Categories" in the library. */
  collapseTick: number;
  addRecent: (defId: string) => void;
  toggleFavorite: (defId: string) => void;
  setFavoritesOnly: (v: boolean) => void;
  collapseAll: () => void;
}

const NKEY = "nodes.prefs";
const ns = storage.getJSON<{ recents?: string[]; favorites?: string[] }>(NKEY) ?? {};

export const useNodePrefs = create<NodePrefs>((set, get) => {
  const persist = () => storage.setJSON(NKEY, { recents: get().recents, favorites: get().favorites });
  return {
    recents: ns.recents ?? [],
    favorites: ns.favorites ?? [],
    favoritesOnly: false,
    collapseTick: 0,
    addRecent: (id) => {
      set({ recents: [id, ...get().recents.filter((x) => x !== id)].slice(0, 12) });
      persist();
    },
    toggleFavorite: (id) => {
      const f = get().favorites;
      set({ favorites: f.includes(id) ? f.filter((x) => x !== id) : [...f, id] });
      persist();
    },
    setFavoritesOnly: (favoritesOnly) => set({ favoritesOnly }),
    collapseAll: () => set({ collapseTick: get().collapseTick + 1 }),
  };
});
