import {
  BarChart3,
  BookOpen,
  Camera,
  FilePlus2,
  FlaskConical,
  History,
  LayoutTemplate,
  Settings,
  Wand2,
} from "lucide-react";
import { getActiveDoc } from "@/ui/graph/graphStore";
import { registerCanvasDrop } from "@/ui/graph/controller/events";
import { setStatus } from "../state";
import { registerCommand } from "../commands/registry";
import { registerPanel } from "../dock/panelRegistry";
import { dropTextureAsset } from "./assetDrop";
import { ALIGN, DIST } from "./arrange";
import { alignSelection, autoLayoutGraph, distributeSelection } from "./layoutActions";
import { useProUi } from "./proState";
import { takeSnapshot } from "./SnapshotsDialog";
import { StatsPanel } from "./StatsPanel";
import { SampleBrowser } from "../samples/SampleBrowser";
import { openPanel } from "../dock/controller";

const hasDoc = (): boolean => !!getActiveDoc();
const ASSET_MIME = "application/x-kk-asset";

/** Panels registered BEFORE the built-in command table is built (so `window.panel.*` toggles exist). */
export function registerProPanels(): void {
  registerPanel({
    id: "stats",
    title: "Statistics",
    icon: BarChart3,
    component: StatsPanel,
    defaultPlacement: { ref: "problems", direction: "within", inactive: true },
    closable: true,
  });
  registerPanel({
    id: "samples",
    title: "Sample Browser",
    icon: FlaskConical,
    component: SampleBrowser,
    defaultPlacement: { floating: { x: 120, y: 70, width: 900, height: 600 } },
    closable: true,
    defaultOpen: false,
  });
}

/** Pro commands, canvas drop target and menu fragments. Idempotent. */
export function registerProFeatures(): void {
  const open = (k: "prefsOpen" | "welcomeOpen" | "snapshotsOpen" | "helpOpen") => () =>
    useProUi.getState().set({ [k]: true });
  registerCommand({
    id: "app.preferences",
    title: "Preferences…",
    category: "Edit",
    icon: Settings,
    shortcut: "Mod+,",
    run: open("prefsOpen"),
  });
  registerCommand({
    id: "file.newFromTemplate",
    title: "New from Template…",
    category: "File",
    icon: LayoutTemplate,
    run: open("welcomeOpen"),
  });
  registerCommand({
    id: "file.samples",
    title: "Sample Browser…",
    category: "File",
    icon: FlaskConical,
    run: () => openPanel("samples"),
  });
  registerCommand({
    id: "file.snapshots",
    title: "Snapshot History…",
    category: "File",
    icon: History,
    when: hasDoc,
    run: open("snapshotsOpen"),
  });
  registerCommand({
    id: "file.snapshotNow",
    title: "Take Snapshot",
    category: "File",
    icon: Camera,
    when: hasDoc,
    run: () => void takeSnapshot(),
  });
  registerCommand({ id: "help.docs", title: "Documentation", category: "Help", icon: BookOpen, run: open("helpOpen") });
  registerCommand({
    id: "help.welcome",
    title: "Welcome Screen",
    category: "Help",
    icon: FilePlus2,
    run: open("welcomeOpen"),
  });
  registerCommand({
    id: "graph.autoLayout",
    title: "Auto Layout (graph or selection)",
    category: "Graph",
    icon: Wand2,
    shortcut: "Mod+Alt+L",
    when: hasDoc,
    run: () => setStatus(autoLayoutGraph() ? "Auto layout applied" : "Nothing to arrange"),
  });
  for (const [m, title, icon] of ALIGN)
    registerCommand({
      id: `graph.align.${m}`,
      title,
      category: "Graph",
      icon,
      when: hasDoc,
      run: () => void alignSelection(m),
    });
  for (const [a, title, icon] of DIST)
    registerCommand({
      id: `graph.distribute.${a}`,
      title,
      category: "Graph",
      icon,
      when: hasDoc,
      run: () => void distributeSelection(a),
    });
  registerCanvasDrop(ASSET_MIME, (payload, world) => void dropTextureAsset(payload, world));
}
