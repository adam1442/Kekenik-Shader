import type { NodeDef } from "../../registry/nodeDef";
import type { BackendId } from "../../ir/types";
import { T } from "../../types/generics";
import { enumParam } from "../kit";
import { M } from "../procedural/irm";
import { floatPort, outPort } from "../procedural/ports";
import { CONVENTION_PARAM, PROJECTION_PARAM, linearizeDepth } from "./depthMath";
import { uvOrFragment } from "../info/depthIr";
import {
  ENGINE_PIPELINE,
  STAGE_NOTE,
  UNITY_ONLY,
  engineIntrinsic,
  normalPort,
  posPort,
  shNode,
  unit,
  xform,
} from "./common";

/**
 * Nodes that read ENGINE-PROVIDED data (lights, depth / opaque textures). They are never emulated: on a backend that does not know the
 * intrinsic (GLSL / WGSL / HLSL) compilation reports E_NODE_UNSUPPORTED_TARGET with the reason. Names + exact engine spellings: `ENGINE_INTRINSICS`.
 */
const GODOT_LIGHT =
  "Godot 4 exposes light data only inside light(), never in fragment()/vertex(): the node is NOT available — pass the direction / colour as shader parameters or write a light() function.";
const HOST_LIGHT =
  "Host-supplied on the portable targets (D-8d-2): reads the frame uniform fed by Scene Simulation (preview) or by your game integration — not real engine lighting. Ambient is flat (the normal is ignored).";
/** Main light / ambient: Unity URP + the portable targets through the host frame block (Godot: light() only). */
const UNITY_HOST: { backends: BackendId[] } = { backends: ["glsl", "wgsl", "hlsl", "unity"] };
const URP = "Unity URP (ShaderLab + HLSL) only";

const mainLightDirectionNode: NodeDef = shNode({
  id: "mainLightDirection",
  category: "Lighting/Engine",
  name: "Main Light Direction",
  synonyms: ["sun direction", "directional light direction", "light vector"],
  description:
    "Unit direction FROM the surface TOWARDS the main directional light (N·L > 0 = lit) in the chosen Space (World default; View and Object via the engine matrices). Engine-provided (Unity URP: GetMainLight().direction) — on GLSL / WGSL / HLSL it reads the HOST-SUPPLIED frame uniform ks_MainLightDir (the preview feeds it from Scene Simulation; a game integration sets it from its own light) — not real engine lighting. Output: unit vector (0,0,0 is never produced by a valid light).",
  outputs: [{ id: "out", name: "Direction", type: T("vec3"), tag: { semantic: "direction", space: "world" } }],
  params: [
    enumParam(
      "space",
      "Space",
      [
        ["world", "World"],
        ["view", "View"],
        ["object", "Object"],
      ],
      "world",
    ),
  ],
  targets: UNITY_HOST,
  capabilities: ["mainLight"],
  targetNotes: {
    all: `Engine intrinsic ks.light.mainDirection. ${URP}.`,
    unity:
      "URP: GetMainLight().direction (world), normalized; View / Object use the world→view / world→object matrices.",
    godot: GODOT_LIGHT,
    glsl: HOST_LIGHT,
    wgsl: HOST_LIGHT,
    hlsl: HOST_LIGHT,
  },
  build: (c) => {
    const m = new M(c.b);
    const w = m.w(engineIntrinsic(c, "ks.light.mainDirection"));
    const space = c.param<string>("space");
    const d =
      space === "view"
        ? xform(c, m, "ks.matrix.worldToView", w, 0)
        : space === "object"
          ? xform(c, m, "ks.matrix.worldToObject", w, 0)
          : w;
    return { out: unit(m, d, m.k("vec3", 0, 1, 0)).id };
  },
});

const mainLightColorNode: NodeDef = shNode({
  id: "mainLightColor",
  category: "Lighting/Engine",
  name: "Main Light Color",
  synonyms: ["sun color", "directional light color", "light tint"],
  description:
    "Colour of the main directional light: LINEAR RGB with the light intensity already multiplied in (HDR, components may exceed 1). Engine-provided (Unity URP: GetMainLight().color); on GLSL / WGSL / HLSL it is the host-supplied uniform ks_MainLightColor (Scene Simulation in the preview). Output range: [0, ∞) per channel.",
  outputs: [{ id: "out", name: "Color", type: T("color"), tag: { semantic: "color" } }],
  targets: UNITY_HOST,
  capabilities: ["mainLight"],
  targetNotes: {
    all: `Engine intrinsic ks.light.mainColor. ${URP}.`,
    unity: "URP: GetMainLight().color (linear in a linear colour-space project).",
    godot: GODOT_LIGHT,
    glsl: HOST_LIGHT,
    wgsl: HOST_LIGHT,
    hlsl: HOST_LIGHT,
  },
  build: (c) => ({ out: engineIntrinsic(c, "ks.light.mainColor") }),
});

const ambientLightNode: NodeDef = shNode({
  id: "ambientLight",
  category: "Lighting/Engine",
  name: "Ambient Lighting",
  synonyms: ["ambient light", "environment lighting", "spherical harmonics", "gi ambient"],
  description:
    "Linear ambient irradiance for a WORLD-space Normal, times Intensity (≥ 0): the scene's spherical-harmonics ambient probe (Unity URP: SampleSH(normal)). The normal is normalised first. Engine-provided; on GLSL / WGSL / HLSL a flat host-supplied ambient colour (ks_AmbientColor — the normal is ignored, flagged approximate). Output: LINEAR RGB, [0, ∞).",
  inputs: [normalPort("normal", "world"), floatPort("intensity", "Intensity", 1)],
  outputs: [{ id: "out", name: "Color", type: T("color"), tag: { semantic: "color" } }],
  targets: UNITY_HOST,
  capabilities: ["ambientProbe"],
  targetNotes: {
    all: `Engine intrinsic ks.light.ambientSH. ${URP}.`,
    unity: "URP: SampleSH(normalWS); needs the Ambient Mode (Skybox / Gradient / Color) of the Lighting settings.",
    godot: GODOT_LIGHT,
    glsl: HOST_LIGHT,
    wgsl: HOST_LIGHT,
    hlsl: HOST_LIGHT,
  },
  build: (c) => {
    const m = new M(c.b);
    const n = unit(m, m.w(c.in("normal")), m.k("vec3", 0, 1, 0));
    return { out: m.w(engineIntrinsic(c, "ks.light.ambientSH", [n.id])).mul(m.w(c.in("intensity")).max(0)).id };
  },
});

const additionalLightNode: NodeDef = shNode({
  id: "additionalLight",
  category: "Lighting/Engine",
  name: "Additional Light",
  synonyms: ["point light", "spot light", "extra light", "per object light"],
  description:
    "Per-pixel data of additional light #Index (0-based, 0–7) of the object as seen from a WORLD-space Position: Direction (unit, towards the light), Color (linear HDR), Distance and Shadow attenuation (0…1), Valid (1 when Index < the number of additional lights, else 0) and Diffuse = Color · saturate(N·L) · distance · shadow · Valid. Unity URP only (Forward / Forward+ with Additional Lights = Per Pixel). Godot has no readable per-light data in fragment() (light() only), the portable backends have none: both are unsupported and report it. IR has no loops: sum several indices with several nodes.",
  inputs: [posPort("world", "position"), normalPort("normal", "world")],
  outputs: [
    { id: "direction", name: "Direction", type: T("vec3"), tag: { semantic: "direction", space: "world" } },
    outPort("color", "Color", "color"),
    outPort("distanceAtten", "Distance Atten", "float"),
    outPort("shadowAtten", "Shadow Atten", "float"),
    outPort("valid", "Valid", "float"),
    outPort("diffuse", "Diffuse", "color"),
  ],
  params: [
    {
      id: "index",
      label: "Index",
      control: "int",
      default: 0,
      min: 0,
      max: 7,
      step: 1,
      tooltip: "Additional light index 0–7.",
    },
  ],
  targets: UNITY_ONLY,
  capabilities: ["additionalLights"],
  targetNotes: {
    all: `Engine intrinsics ks.light.additional.*. ${URP}, Additional Lights set to Per Pixel.`,
    unity: "URP: GetAdditionalLight((uint)i, positionWS); Valid = i < GetAdditionalLightsCount().",
    godot: GODOT_LIGHT,
    glsl: "Unavailable: GLSL has no engine lights.",
    wgsl: "Unavailable: WGSL has no engine lights.",
    hlsl: "Unavailable as generic HLSL.",
  },
  build: (c) => {
    const m = new M(c.b);
    const idx = Math.round(Math.min(7, Math.max(0, c.param<number>("index"))));
    const args = [c.in("position"), m.f(idx).id];
    const dir = unit(m, m.w(engineIntrinsic(c, "ks.light.additional.direction", args)), m.k("vec3", 0, 1, 0));
    const col = m.w(engineIntrinsic(c, "ks.light.additional.color", args));
    const att = m.w(engineIntrinsic(c, "ks.light.additional.attenuation", args));
    const valid = m.step(idx + 0.5, m.w(engineIntrinsic(c, "ks.light.additional.count")));
    const n = unit(m, m.w(c.in("normal")), m.k("vec3", 0, 1, 0));
    const diffuse = col.mul(n.dot(dir).saturate().mul(att.x).mul(att.y).mul(valid));
    return {
      direction: dir.id,
      color: col.id,
      distanceAtten: att.x.id,
      shadowAtten: att.y.id,
      valid: valid.id,
      diffuse: diffuse.id,
    };
  },
});

const SCREEN_UV = {
  id: "uv",
  name: "Screen UV",
  type: T("vec2"),
  optional: true,
  tag: { semantic: "uv" as const },
  tooltip: "Screen UV 0…1, bottom-left origin. Unconnected = the current fragment's screen position.",
};

const sceneDepthNode: NodeDef = shNode({
  id: "sceneDepth",
  category: "Screen/Depth",
  name: "Scene Depth",
  synonyms: ["depth texture", "camera depth", "z buffer", "depth buffer"],
  description:
    "Reads the CAMERA DEPTH TEXTURE at a screen UV (default: this fragment). Raw = stored depth 0…1 (convention param: Reversed Z 1 = near, or Standard 0 = near); Eye = distance along the view axis in world units, in [near, far]; Linear01 = Eye / far (perspective) or the 0…1 depth (orthographic). Near / far come from the engine camera. Needs the depth texture: Unity URP 'Depth Texture' enabled in the URP asset, Godot hint_depth_texture. Fragment stage only. Never emulated — GLSL / WGSL / HLSL report an error.",
  inputs: [SCREEN_UV],
  outputs: [outPort("raw", "Raw", "float"), outPort("eye", "Eye", "float"), outPort("linear01", "Linear01", "float")],
  params: [CONVENTION_PARAM, PROJECTION_PARAM],
  targets: ENGINE_PIPELINE,
  stage: "fragment",
  capabilities: ["depthTexture"],
  targetNotes: {
    all: `Engine intrinsics ks.screen.sceneDepthRaw + ks.camera.nearFar. ${STAGE_NOTE.fragment} Unity URP / Godot only.`,
    unity: "URP: SampleSceneDepth(uv); enable Depth Texture in the URP Asset (or the camera).",
    godot:
      "uniform sampler2D depth_texture : hint_depth_texture; texture(depth_texture, uv).r (Godot 4 uses reversed Z).",
    glsl: "Unavailable: WebGL2 has no scene depth texture in this preview.",
    wgsl: "Unavailable: no scene depth texture.",
    hlsl: "Unavailable as generic HLSL.",
  },
  build: (c) => {
    const m = new M(c.b);
    const raw = m.w(engineIntrinsic(c, "ks.screen.sceneDepthRaw", [uvOrFragment(c, m).id]));
    const nf = m.w(engineIntrinsic(c, "ks.camera.nearFar"));
    const { eye, linear01 } = linearizeDepth(
      m,
      raw,
      nf.x,
      nf.y,
      c.param<string>("convention"),
      c.param<string>("projection"),
    );
    return { raw: raw.id, eye: eye.id, linear01: linear01.id };
  },
});

const sceneColorNode: NodeDef = shNode({
  id: "sceneColor",
  category: "Screen/Depth",
  name: "Scene Color",
  synonyms: ["opaque texture", "screen texture", "grab pass", "camera color"],
  description:
    "Colour of the OPAQUE scene behind the object at a screen UV (default: this fragment), linear RGB as rendered by the camera before transparents. Needs the opaque texture: Unity URP 'Opaque Texture' on and the material must be Transparent; Godot hint_screen_texture. UVs outside 0…1 follow the engine's sampler (clamp). Fragment stage only. Never emulated with another value — generic targets report an error.",
  inputs: [SCREEN_UV],
  outputs: [{ id: "out", name: "Color", type: T("color"), tag: { semantic: "color" } }],
  targets: ENGINE_PIPELINE,
  stage: "fragment",
  capabilities: ["opaqueTexture"],
  targetNotes: {
    all: `Engine intrinsic ks.screen.sceneColor. ${STAGE_NOTE.fragment} Unity URP / Godot only.`,
    unity: "URP: SampleSceneColor(uv); Opaque Texture on in the URP Asset; Surface Type = Transparent.",
    godot: "uniform sampler2D screen_texture : hint_screen_texture; textureLod(screen_texture, uv, 0.0).rgb",
    glsl: "Unavailable: no opaque scene texture in WebGL2 preview.",
    wgsl: "Unavailable: no opaque scene texture.",
    hlsl: "Unavailable as generic HLSL.",
  },
  build: (c) => {
    const m = new M(c.b);
    return { out: engineIntrinsic(c, "ks.screen.sceneColor", [uvOrFragment(c, m).id]) };
  },
});

export const ENGINE_NODE_DEFS: NodeDef[] = [
  mainLightDirectionNode,
  mainLightColorNode,
  ambientLightNode,
  additionalLightNode,
  sceneDepthNode,
  sceneColorNode,
];
