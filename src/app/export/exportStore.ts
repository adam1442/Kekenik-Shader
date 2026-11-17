import { create } from "zustand";
import {
  targetFamilyOf,
  BUNDLE_TARGET_IDS,
  type BundleTargetId,
  type ExportSelection,
  type Graph,
  type TargetChoice,
  defaultProfileFor,
  normalizeRenderer,
  normalizeVersion,
  targetProfiles,
} from "@/core";
import { UNITY_VERSIONS } from "@/core";
import { useCode } from "../panels/code/codeStore";

/** State of the Export dialog. The graph is captured when the dialog opens (the dialog is a snapshot, like a print preview). */
interface ExportState {
  open: boolean;
  graph: Graph | null;
  choices: Record<BundleTargetId, TargetChoice>;
  activePath: string | null;
  /** The user pressed Export on a failing selection and must confirm. */
  confirming: boolean;
  show(graph: Graph): void;
  close(): void;
  setChoice(id: BundleTargetId, patch: Partial<TargetChoice>): void;
  setActive(path: string | null): void;
  setConfirming(v: boolean): void;
}

/** Defaults come from Graph Settings: the engine of the current profile is enabled; versions / renderer follow the graph's settings. */
function defaultChoices(graph: Graph): Record<BundleTargetId, TargetChoice> {
  const cur = targetProfiles.get(graph.profileId);
  const unityVersion =
    typeof graph.settings.unityVersion === "string"
      ? graph.settings.unityVersion
      : (UNITY_VERSIONS.find((v) => v.default)?.id ?? "6000.3");
  const family = targetFamilyOf(graph); // the toolbar Target decides the preselection (portable families have no engine profile)
  return {
    unity: {
      enabled: cur?.engine === "unity-urp",
      profile: defaultProfileFor("unity", graph.profileId),
      version: unityVersion,
    },
    godot: {
      enabled: cur?.engine === "godot",
      profile: defaultProfileFor("godot", graph.profileId),
      version: normalizeVersion(graph.settings.godotVersion),
      renderer: normalizeRenderer(graph.settings.godotRenderer),
    },
    glsl: { enabled: family === "glsl" },
    // HLSL / WGSL start with the flags currently set in the Code panel's option popovers (single source of truth for the flags).
    hlsl: { enabled: family === "hlsl", emit: { ...useCode.getState().options.hlsl } },
    wgsl: { enabled: family === "wgsl", emit: { ...useCode.getState().options.wgsl } },
  };
}

export const useExport = create<ExportState>((set) => ({
  open: false,
  graph: null,
  choices: {
    unity: { enabled: false },
    godot: { enabled: false },
    glsl: { enabled: false },
    hlsl: { enabled: false },
    wgsl: { enabled: false },
  },
  activePath: null,
  confirming: false,
  show: (graph) => set({ open: true, graph, choices: defaultChoices(graph), activePath: null, confirming: false }),
  close: () => set({ open: false, confirming: false }),
  setChoice: (id, patch) =>
    set((s) => ({ choices: { ...s.choices, [id]: { ...s.choices[id], ...patch } }, confirming: false })),
  setActive: (activePath) => set({ activePath }),
  setConfirming: (confirming) => set({ confirming }),
}));

export const selectionOf = (choices: Record<BundleTargetId, TargetChoice>): ExportSelection =>
  Object.fromEntries(BUNDLE_TARGET_IDS.map((id) => [id, choices[id]])) as ExportSelection;
