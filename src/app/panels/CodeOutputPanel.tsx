import { Columns2, GitCompareArrows, Package } from "lucide-react";
import { useMemo } from "react";
import { type CompileResult, type GeneratedTarget, compileGodot, compileUnity } from "@/core";
import { APP_VERSION } from "../lib/version";
import { IconButton } from "@/ui";
import { useGraphs } from "@/ui/graph/graphStore";
import { SubgraphOutputSelect } from "@/ui/graph/SubgraphOutputSelect";
import type { PanelProps } from "../dock/panelRegistry";
import { useExport } from "../export/exportStore";
import { useShader } from "../shaderStore";
import { CodePane } from "./code/CodePane";
import { DiffView } from "./code/DiffView";
import { MAX_PANES, compileTarget, useCode } from "./code/codeStore";

const NO_SELECTION: string[] = [];

/** Code Output: up to 3 side-by-side targets, per-target tabs / options / diagnostics, source-map link to the graph, diff, Export… (opens the Export dialog). */
export function CodeOutputPanel(_props: PanelProps) {
  const { graph, graphName, result: glslResult, emitOptions, keywordValues } = useShader();
  const { panes, diff, options, addPane, setDiff } = useCode();
  const selection = useGraphs((s) => s.docs.find((d) => d.id === s.activeId)?.selection) ?? NO_SELECTION;

  const results = useMemo(
    () =>
      panes.map((p): CompileResult | null => {
        if (!graph) return null;
        if (p.target === "glsl") return glslResult;
        if (p.target === "hlsl" || p.target === "wgsl")
          return compileTarget(graph, p.target as GeneratedTarget, emitOptions, keywordValues, options[p.target]);
        if (p.target === "unity") return compileUnity(graph, { generatorVersion: APP_VERSION }).result;
        if (p.target === "godot") return compileGodot(graph, { generatorVersion: APP_VERSION }).result;
        return null;
      }),
    [panes, graph, glslResult, emitOptions, keywordValues, options],
  );

  const diffFiles =
    diff && panes.length >= 2
      ? [0, 1].map(
          (i) =>
            results[i]?.files.find((f) => f.path === panes[i]!.file) ??
            results[i]?.files.find((f) => f.path === "shader.frag") ??
            results[i]?.files[0],
        )
      : null;

  /** Export is one feature: the Export dialog (all targets, preview, zip). */
  const exportAll = () => {
    if (graph) useExport.getState().show(graph);
  };

  return (
    <div className="kk-codepanel" data-kk="code-output">
      <div className="kk-codepanel__top">
        <span>{panes.length === 1 ? "1 target" : `${panes.length} targets`}</span>
        <SubgraphOutputSelect />
        <span className="kk-spacer" />
        <IconButton
          icon={Columns2}
          label="Add target pane"
          size="sm"
          disabled={panes.length >= MAX_PANES}
          onClick={addPane}
        />
        <IconButton
          icon={GitCompareArrows}
          label="Diff first two targets"
          size="sm"
          active={diff}
          disabled={panes.length < 2}
          onClick={() => setDiff(!diff)}
        />
        <IconButton icon={Package} label="Export… (all targets)" size="sm" disabled={!graph} onClick={exportAll} />
      </div>
      {diffFiles && diffFiles[0] && diffFiles[1] ? (
        <DiffView
          left={diffFiles[0].content}
          right={diffFiles[1].content}
          leftLabel={`${panes[0]!.target}/${diffFiles[0].path}`}
          rightLabel={`${panes[1]!.target}/${diffFiles[1].path}`}
        />
      ) : (
        <div className="kk-codepanel__panes">
          {panes.map((p, i) => (
            <CodePane
              key={i}
              index={i}
              target={p.target}
              file={p.file}
              result={results[i] ?? null}
              hasGraph={!!graph}
              graphName={graphName}
              selection={selection}
              canRemove={panes.length > 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
