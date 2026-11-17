import { create } from "zustand";
import { serializeGraph, type Graph } from "@/core";
import { storage } from "@/app/lib/storage";

/** Crash recovery record kept in (safe) storage next to a "session open" flag. */
export interface RecoveryRecord {
  name: string;
  time: number;
  text: string;
}
const REC = "recovery";
const FLAG = "session.open";

/** Pure helper: a previous session that never cleared its flag crashed (or was killed) and left a record. */
function findRecovery(
  s: { get(k: string): string | null; getJSON<T>(k: string): T | null } = storage,
): RecoveryRecord | null {
  if (s.get(FLAG) !== "1") return null;
  const r = s.getJSON<RecoveryRecord>(REC);
  return r && typeof r.text === "string" && r.text.length > 2 ? r : null;
}

export function writeRecovery(graph: Graph, s: typeof storage = storage): boolean {
  return s.setJSON(REC, {
    name: graph.name || "Untitled",
    time: Date.now(),
    text: serializeGraph(graph),
  } satisfies RecoveryRecord);
}

export const clearRecovery = (s: typeof storage = storage): void => s.remove(REC);

/** Call once at startup: returns the record to offer (if the last session crashed) and arms the flag for this session. */
export function beginSession(s: typeof storage = storage): RecoveryRecord | null {
  const found = findRecovery(s);
  s.set(FLAG, "1");
  return found;
}
/** Clean shutdown: disarm the flag (a normal reload never offers recovery). */
export const endSession = (s: typeof storage = storage): void => s.remove(FLAG);

interface RecoveryState {
  record: RecoveryRecord | null;
  set: (r: RecoveryRecord | null) => void;
}
export const useRecovery = create<RecoveryState>((set) => ({ record: null, set: (record) => set({ record }) }));
