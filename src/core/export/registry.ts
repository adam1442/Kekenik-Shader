import { compileForTarget, type GeneratedTarget } from "../codegen/compileTargets";
import { compileUnity } from "../codegen/unity";
import { unityTargetById } from "../codegen/unity/data/targets";
import type { Graph } from "../graph/types";
import { targetProfiles } from "../profiles";
import { godotExportTarget } from "./godotTarget";
import { unityHelperFiles, unityReadmeExtras } from "./unityHelpers";
import type { ExportFile } from "../profiles/types";

export interface ExportOpts {
  generatorVersion?: string;
}

/** One export format. adds Godot and the Export dialog on top of this registry (zip, README, parameters.json). */
export interface ExportTarget {
  id: string;
  label: string;
  /** Primary file extension (without dot). */
  extension: string;
  generate(graph: Graph, opts?: ExportOpts): ExportFile[];
  /** Markdown usage notes for the README of an export bundle. */
  readmeSection(graph: Graph, opts?: ExportOpts): string;
  /** Extra fields for `parameters.json`. */
  manifestExtras(graph: Graph, opts?: ExportOpts): Record<string, unknown>;
}

const portable = (id: GeneratedTarget, label: string, extension: string, note: string): ExportTarget => ({
  id,
  label,
  extension,
  generate: (graph) =>
    compileForTarget(graph, id).files.map((f) => ({ path: f.path, content: f.content, language: f.language })),
  readmeSection: () => `## ${label}\n\n${note}\n`,
  manifestExtras: () => ({ target: id }),
});

export const UNITY_README = (graph: Graph): string => {
  const p = targetProfiles.get(graph.profileId);
  const t = unityTargetById(graph.settings.unityVersion);
  const lines = [
    "## Unity (URP)",
    "",
    `Target: Unity ${t.unity} / URP ${t.urp} · Profile: ${p?.label ?? graph.profileId}.`,
    "",
    "1. Copy the `.shader` file into your project's `Assets/` folder.",
    "2. Create a Material and pick the shader from the shader menu (its name starts with `Kekenik/`).",
    "3. Requires the Universal Render Pipeline (HDRP and Built-in RP are not supported).",
    "4. Exposed parameters appear in the Material inspector (labels, ranges, HDR pickers, texture defaults).",
    "",
    "Limitations: Lit GBuffer (Deferred) pass, DOTS instancing, APV and Enlighten are not generated (baked GI / Meta / MotionVectors / decals / LOD cross-fade are Surface Options of the Lit profile).",
    ...unityReadmeExtras(graph).flatMap((x) => ["", x]),
  ];
  if (p?.family === "lit")
    lines.push(
      "",
      "Lit v1 scope: realtime main + additional lights, shadows, ambient SH and reflection probes (through `UniversalFragmentPBR`). Not generated: lightmaps / shadowmask / APV, GBuffer, Meta, MotionVectors, decals, LOD cross-fade, debug display. The colour pass uses `UniversalForwardOnly`, so objects also render in Deferred projects (forward-shaded). Pass set: ForwardLit, ShadowCaster (Cast Shadows), DepthOnly, DepthNormals.",
    );
  if (p?.family === "sprite")
    lines.push(
      "",
      p.id.endsWith("sprite-lit")
        ? "Sprite Lit requires the 2D Renderer (Light2D); with the Universal Renderer the unlit `UniversalForward` fallback pass is used. Name the normal / mask texture parameters `_NormalMap` / `_MaskTex` to receive the sprite's secondary textures. Sprite profiles are not SRP-Batcher compatible."
        : "Sprite profiles are not SRP-Batcher compatible (SpriteRenderer uses property blocks). The sprite texture is `_MainTex`.",
    );
  if (p?.family === "vfx")
    lines.push(
      "",
      "Soft particles need *Depth Texture* enabled in the URP asset. Enable the Custom Vertex Streams listed in the shader header on the Particle System renderer.",
    );
  return lines.join("\n") + "\n";
};

const unity: ExportTarget = {
  id: "unity",
  label: "Unity URP (.shader)",
  extension: "shader",
  generate: (graph, opts) => {
    const r = compileUnity(graph, opts?.generatorVersion ? { generatorVersion: opts.generatorVersion } : {});
    return r.text ? [{ path: r.fileName, content: r.text, language: "shaderlab" }, ...unityHelperFiles(r.text)] : [];
  },
  readmeSection: UNITY_README,
  manifestExtras: (graph) => ({
    target: "unity-urp",
    unityVersion: unityTargetById(graph.settings.unityVersion).id,
    profile: graph.profileId,
  }),
};

const targets = new Map<string, ExportTarget>();
const registerExportTarget = (t: ExportTarget): void => void targets.set(t.id, t);
export const getExportTarget = (id: string): ExportTarget | undefined => targets.get(id);
export const listExportTargets = (): ExportTarget[] => [...targets.values()];

registerExportTarget(
  portable(
    "glsl",
    "GLSL ES 3.00 (WebGL2)",
    "frag",
    "Host contract is documented in the shader header (attributes, `ks_*` uniforms).",
  ),
);
registerExportTarget(
  portable("hlsl", "HLSL", "hlsl", "Generic Direct3D HLSL (SM 5.0+); see the header for the host contract."),
);
registerExportTarget(
  portable("wgsl", "WGSL (WebGPU)", "wgsl", "Validated with naga; see the header for the host contract."),
);
registerExportTarget(unity);
registerExportTarget(godotExportTarget);
