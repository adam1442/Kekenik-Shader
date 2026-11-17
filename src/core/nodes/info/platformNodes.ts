import type { BuildContext, NodeDef } from "../../registry/nodeDef";
import { T, floatVec, sameAs } from "../../types/generics";
import { TARGET_CONVENTIONS, TARGET_LABEL, type SceneTarget } from "../../engine/targets";
import { CAT, sceneNode } from "./common";

const PORTS: Array<{ id: SceneTarget; name: string }> = [
  { id: "unity", name: "Unity URP" },
  { id: "godot", name: "Godot 4" },
  { id: "glsl", name: "GLSL (WebGL2)" },
  { id: "wgsl", name: "WGSL (WebGPU)" },
  { id: "hlsl", name: "HLSL" },
];

const targetSwitchNode: NodeDef = sceneNode({
  id: "targetSwitch",
  category: CAT.platform,
  name: "Target Switch",
  synonyms: ["platform switch", "per target branch", "engine switch", "compile time branch", "target branch"],
  description:
    "COMPILE-TIME branch per export target: Out = the input of the target the shader is being compiled for (Unity URP, Godot 4, GLSL, WGSL, HLSL). Only that input is read — the other branches (and every node that only feeds them) are neither built nor validated, produce no code and cost nothing at run time, so engine-specific nodes (Scene Depth, Main Light …) can sit safely on their own target's input. In the preview the SIMULATED target of Scene Simulation decides (GLSL when the simulation is off). All inputs share one type; an unconnected input uses its default 0. The IR text view behaves like GLSL.",
  inputs: PORTS.map((p) => ({ id: p.id, name: p.name, type: floatVec("T"), default: 0 })),
  outputs: [{ id: "out", name: "Out", type: sameAs("glsl") }],
  liveInputs: (_node, target) => [target],
  build: (c: BuildContext) => ({ out: c.in(c.target) }),
});

type FlagKey = "reversedZ" | "yFlipped" | "linearColor";
const table = (k: FlagKey): string =>
  (["glsl", "wgsl", "hlsl", "unity", "godot"] as SceneTarget[])
    .map((t) => `${TARGET_LABEL[t]}: ${TARGET_CONVENTIONS[t][k] ? 1 : 0}`)
    .join(", ") + ".";

const flagNode = (
  id: string,
  name: string,
  synonyms: string[],
  description: string,
  extra: string,
  uses: string[],
  pick: (c: BuildContext) => boolean,
): NodeDef =>
  sceneNode({
    id,
    category: CAT.platform,
    name,
    synonyms,
    description: `${description} Resolved at COMPILE time for the target (or the simulated target in the preview): a constant 0 / 1 with no run-time cost. ${extra}`,
    inputs: [],
    outputs: [{ id: "out", name: "Out", type: T("float") }],
    uses,
    build: (c) => ({ out: c.b.float(pick(c) ? 1 : 0) }),
  });

const isReversedZNode = flagNode(
  "isReversedZ",
  "Is Reversed-Z",
  ["reversed z", "reverse depth", "unity_reversed_z", "depth direction"],
  "1 when the target stores depth reversed (1 at the near plane: Unity on D3D / Metal / Vulkan, Godot 4 Forward+), 0 for standard depth (0 at near: OpenGL / WebGL, generic D3D, WebGPU default).",
  table("reversedZ"),
  ["const:isReversedZ"],
  (c) => TARGET_CONVENTIONS[c.target].reversedZ,
);
const isYFlippedNode = flagNode(
  "isYFlipped",
  "Is Y-Flipped Target",
  ["y flip", "flipped y", "upside down render target", "uv starts at top", "ndc y down"],
  "1 when NDC / render-target Y points DOWN relative to OpenGL (Godot 4 Vulkan renderers), 0 otherwise. Unity's flip depends on the platform and render texture at run time (_ProjectionParams.x): the compile-time value there is 0 (flagged approximate).",
  table("yFlipped"),
  ["const:isYFlipped"],
  (c) => TARGET_CONVENTIONS[c.target].yFlipped,
);
const isLinearNode = flagNode(
  "isLinearColor",
  "Is Linear Color Space",
  ["linear color space", "gamma or linear", "colorspace linear", "is gamma"],
  "1 when the target shades in linear colour space (Unity Linear project, Godot 4), 0 when colours are written to the output as-is (the GLSL / WGSL / HLSL exports and the preview). Unity's value assumes a Linear project (flagged approximate).",
  table("linearColor"),
  ["const:isLinear"],
  (c) => TARGET_CONVENTIONS[c.target].linearColor,
);
const isPreviewNode = flagNode(
  "isPreview",
  "Is Preview",
  ["preview only", "editor preview", "kekenik preview", "is editor"],
  "1 only while the shader is compiled for the Kekenik Shader preview viewport, 0 in every export — lets you add editor-only debug visualisation that never ships.",
  "GLSL: 1 in the preview viewport, 0 in exported GLSL; every other target: 0.",
  ["const:isPreview"],
  (c) => c.isPreview,
);

export const PLATFORM_NODE_DEFS: NodeDef[] = [
  targetSwitchNode,
  isReversedZNode,
  isYFlippedNode,
  isLinearNode,
  isPreviewNode,
];
