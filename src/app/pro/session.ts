import { parseKShader, serializeGraph } from "@/core";
import { storage } from "@/app/lib/storage";
import { getRootDoc, openDoc } from "@/ui/graph/graphStore";
import { usePrefs } from "@/app/prefs/preferences";
import {
  beginSession,
  clearRecovery,
  endSession,
  type RecoveryRecord,
  useRecovery,
  writeRecovery,
} from "@/app/project/recovery";
import { snapshots } from "@/app/project/snapshotStore";
import { useProUi } from "./proState";

let lastText = "";

/** One autosave pass: write the crash-recovery record and (when the text changed) a local-history snapshot. Returns true when something was saved. */
async function autosaveTick(): Promise<boolean> {
  const d = getRootDoc();
  if (!d) return false;
  const text = serializeGraph(d.graph);
  if (text === lastText) return false;
  lastText = text;
  writeRecovery(d.graph);
  await snapshots.add(d.graph.name || "Untitled", "Autosave", text, Object.keys(d.graph.nodes).length);
  return true;
}

/** Open the recovered graph in a new tab. */
export function restoreRecovery(r: RecoveryRecord): boolean {
  try {
    openDoc(parseKShader(r.text).graph, { fit: true });
    clearRecovery();
    useRecovery.getState().set(null);
    return true;
  } catch {
    return false;
  }
}

/** App start: arm crash detection, offer recovery, show the welcome screen on first run, run the autosave timer. Returns a disposer. */
export function startSession(): () => void {
  const found = beginSession();
  useRecovery.getState().set(found);
  if (found || storage.get("welcome.seen") !== "1") {
    storage.set("welcome.seen", "1");
    useProUi.getState().set({ welcomeOpen: true });
  }
  let last = Date.now();
  const timer = window.setInterval(() => {
    const sec = usePrefs.getState().autosaveSec;
    if (sec <= 0 || Date.now() - last < sec * 1000) return;
    last = Date.now();
    void autosaveTick();
  }, 1000);
  const onUnload = () => endSession();
  window.addEventListener("beforeunload", onUnload);
  return () => {
    window.clearInterval(timer);
    window.removeEventListener("beforeunload", onUnload);
    endSession();
  };
}
