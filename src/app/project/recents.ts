import { storage } from "@/app/lib/storage";

export interface RecentProject {
  name: string;
  time: number;
  /** Snapshot (local history) holding the last saved copy — "recent" reopens it even without file-system access. */
  snapshotId: string;
}
const KEY = "recents";
const MAX = 8;

export const listRecents = (): RecentProject[] => {
  const v = storage.getJSON<RecentProject[]>(KEY);
  return Array.isArray(v)
    ? v.filter((r) => r && typeof r.name === "string" && typeof r.snapshotId === "string").slice(0, MAX)
    : [];
};
export function addRecent(r: RecentProject): void {
  storage.setJSON(KEY, [r, ...listRecents().filter((x) => x.name !== r.name)].slice(0, MAX));
}
export const clearRecents = (): void => storage.remove(KEY);
