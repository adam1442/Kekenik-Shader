import { storage } from "@/app/lib/storage";
import { colorsEqual, type Rgba } from "@/core/values/color";

/** Project swatches + recent colors, persisted through the safe storage helper (in-memory fallback). */
const SW = "controls.swatches";
const RC = "controls.recents";
const listeners = new Set<() => void>();

const DEFAULT_SWATCHES: Rgba[] = [
  "#ffffff",
  "#000000",
  "#ff3b30",
  "#ff9500",
  "#ffcc00",
  "#34c759",
  "#00c7be",
  "#0a84ff",
  "#5e5ce6",
  "#bf5af2",
].map((h) => {
  const n = parseInt(h.slice(1), 16);
  const f = (c: number) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : Math.pow((c / 255 + 0.055) / 1.055, 2.4));
  return { r: f((n >> 16) & 255), g: f((n >> 8) & 255), b: f(n & 255), a: 1 };
});

function load(key: string, fallback: Rgba[]): Rgba[] {
  const v = storage.getJSON<Rgba[]>(key);
  return Array.isArray(v) && v.every((c) => c && typeof c.r === "number") ? v : fallback;
}

export const swatchStore = {
  swatches: (): Rgba[] => load(SW, DEFAULT_SWATCHES),
  recents: (): Rgba[] => load(RC, []),
  addSwatch(c: Rgba): void {
    const cur = swatchStore.swatches();
    if (cur.some((x) => colorsEqual(x, c, 1e-4))) return;
    storage.setJSON(SW, [...cur, c].slice(-32));
    listeners.forEach((l) => l());
  },
  removeSwatch(i: number): void {
    storage.setJSON(
      SW,
      swatchStore.swatches().filter((_, j) => j !== i),
    );
    listeners.forEach((l) => l());
  },
  pushRecent(c: Rgba): void {
    const cur = swatchStore.recents().filter((x) => !colorsEqual(x, c, 1e-4));
    storage.setJSON(RC, [c, ...cur].slice(0, 12));
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
