import { create } from "zustand";
import { EMPTY_SAMPLE_FILTER, type SampleFilter, type SampleIndexEntry, filterSamples } from "@/core";
import { getSampleSource } from "./source";

interface SampleState {
  status: "idle" | "loading" | "ready" | "error";
  entries: SampleIndexEntry[];
  error: string;
  filter: SampleFilter;
  selectedId: string | null;
  load: (force?: boolean) => Promise<void>;
  setFilter: (p: Partial<SampleFilter>) => void;
  select: (id: string | null) => void;
}

export const useSamples = create<SampleState>((set, get) => ({
  status: "idle", entries: [], error: "", filter: EMPTY_SAMPLE_FILTER, selectedId: null,
  load: async (force = false) => {
    if (!force && (get().status === "ready" || get().status === "loading")) return;
    set({ status: "loading", error: "" });
    try {
      const idx = await getSampleSource().index();
      set({ status: "ready", entries: idx.samples });
    } catch (e) {
      set({ status: "error", error: (e as Error).message });
    }
  },
  setFilter: (p) => set((s) => ({ filter: { ...s.filter, ...p } })),
  select: (id) => set({ selectedId: id }),
}));

/** Entries after the active filter. PURE helper — never pass it as a zustand selector (it returns a new array each call; use `useMemo`). */
export const visibleSamples = (s: Pick<SampleState, "entries" | "filter">): SampleIndexEntry[] => filterSamples(s.entries, s.filter);
