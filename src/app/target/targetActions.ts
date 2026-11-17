import {
  type Graph,
  type ProfileProblem,
  type TargetFamily,
  TARGET_FAMILIES,
  planTargetSwitch,
  targetFamilyOf,
} from "@/core";
import { useShader } from "@/app/shaderStore";
import { publishProfileProblems } from "@/ui/graph/panels/profileProblems";
import { commit, getActiveDoc, getGraph } from "@/ui/graph/graphStore";
import { useCode } from "@/app/panels/code/codeStore";

/** `useTarget`: the one source of truth for the active target family (graph-level; see `core/profiles/family`). */
export const useTarget = (): TargetFamily => useShader((s) => (s.graph ? targetFamilyOf(s.graph) : "glsl"));
export const getTarget = (): TargetFamily => {
  const g = useShader.getState().graph;
  return g ? targetFamilyOf(g) : "glsl";
};

export interface TargetSwitchPreview {
  family: TargetFamily;
  toProfile: string;
  problems: ProfileProblem[];
  noop: boolean;
}

/** What switching would do (for the confirmation dialog) — pure, no commit. */
export function previewTargetSwitch(family: TargetFamily, graph: Graph = getGraph()): TargetSwitchPreview {
  const plan = planTargetSwitch(graph, family);
  return { family, toProfile: plan.toProfile, problems: plan.problems, noop: targetFamilyOf(graph) === family };
}

/**
 * Switch the target family as ONE undoable graph transaction, then align the app: Code panel default pane (`useShader.target`), Problems
 * scope (profile problems of the dropped wires are published) and the Simulation target (follows automatically — `useSceneSim.follow`).
 */
export function switchTarget(family: TargetFamily): TargetSwitchPreview {
  const graph = getGraph();
  const plan = planTargetSwitch(graph, family);
  if (targetFamilyOf(graph) !== family || plan.ops.length > 1)
    commit(`Target: ${TARGET_FAMILIES.find((f) => f.id === family)!.label}`, plan.ops);
  const doc = getActiveDoc();
  if (doc) publishProfileProblems(doc.id, plan.problems);
  useShader.getState().setTarget(family);
  try {
    useCode.getState().setPaneTarget(0, family);
  } catch {
    /* the code panel may not be mounted */
  }
  return { family, toProfile: plan.toProfile, problems: plan.problems, noop: false };
}
