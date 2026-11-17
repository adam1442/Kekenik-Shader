import { useMemo } from "react";
import { create } from "zustand";
import { type Graph, type ProfileProblem, compileGodot, compileUnity } from "@/core";
import { useGraphs } from "../graphStore";

/** Problems raised by the profile framework: profile-switch results (`profile.block-dropped`, …) per document + Unity static validators. */
interface ProfileProblemState {
  docId: string;
  list: ProfileProblem[];
}
const useProfileProblems = create<ProfileProblemState>(() => ({ docId: "", list: [] }));

/** Replace the switch problems of a document (an empty list clears them). */
export const publishProfileProblems = (docId: string, list: ProfileProblem[]): void =>
  useProfileProblems.setState({ docId, list });

/** Unity validator findings worth showing: errors and warnings, minus the (many) per-API "unverified-by-doc" notes (they live in the manual checklist). */
function unityGraphProblems(graph: Graph | null | undefined): ProfileProblem[] {
  if (!graph || !(graph.profileId.startsWith("unity.") || graph.profileId.startsWith("godot."))) return [];
  try {
    const problems = graph.profileId.startsWith("godot.") ? compileGodot(graph).problems : compileUnity(graph).problems;
    return problems.filter(
      (p) =>
        p.severity !== "info" &&
        !(p.rule === "unity.api-whitelist" && p.severity === "warning") &&
        p.rule !== "godot.unverified-api",
    );
  } catch {
    return [];
  }
}

/** Everything the Problems panel shows from the profile framework for the active document (stable between graph changes). */
export function useProfileProblemList(): ProfileProblem[] {
  const activeId = useGraphs((s) => s.activeId);
  const analysisGraph = useGraphs((s) => s.analysisGraph);
  const switched = useProfileProblems((s) => (s.docId === activeId ? s.list : EMPTY));
  const unity = useMemo(() => unityGraphProblems(analysisGraph), [analysisGraph]);
  return useMemo(() => [...switched, ...unity], [switched, unity]);
}
const EMPTY: ProfileProblem[] = [];
