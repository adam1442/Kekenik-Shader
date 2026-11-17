import type { NodeDef } from "../../registry/nodeDef";
import { T } from "../../types/generics";
import { enumParam } from "../kit";
import { M } from "../procedural/irm";
import { floatPort, outPort } from "../procedural/ports";
import { CONVENTION_PARAM, PROJECTION_PARAM, linearizeDepth } from "./depthMath";
import { screenUvOfFragment } from "../info/depthIr";
import { STAGE_NOTE, noteAll, normalPort, shNode, unit } from "./common";

/** Profile-independent screen / depth maths. They consume a depth value (from Scene Depth or a property) and need no engine data themselves. */

const linearEyeDepthNode: NodeDef = shNode({
  id: "linearEyeDepth",
  category: "Screen/Depth",
  name: "Linear Eye Depth",
  synonyms: ["linearize depth", "depth to distance", "linear depth", "eye space depth"],
  description:
    "Converts a raw depth value into world-unit EYE depth (distance along the view axis) and Linear01 (= Eye / Far for perspective, the 0…1 depth for orthographic). Raw is clamped to its legal range (see convention: Reversed Z 1 = near, Standard 0 = near, OpenGL NDC −1…1), Near ≥ 1e-6 and Far ≥ Near + 1e-6, so Eye ∈ [Near, Far] and is always finite. Perspective: Eye = n·f / (f − d·(f − n)); Orthographic: Eye = n + d·(f − n). Pure maths, any stage.",
  inputs: [floatPort("raw", "Raw Depth", 0.5), floatPort("near", "Near", 0.1), floatPort("far", "Far", 1000)],
  outputs: [outPort("eye", "Eye", "float"), outPort("linear01", "Linear01", "float")],
  params: [CONVENTION_PARAM, PROJECTION_PARAM],
  targetNotes: noteAll(
    "Feed Near / Far from the camera (properties) or use Scene Depth, which reads them from the engine. Reversed Z is the default on D3D11/12, Metal, Vulkan and Godot 4.",
  ),
  build: (c) => {
    const m = new M(c.b);
    const r = linearizeDepth(
      m,
      m.w(c.in("raw")),
      m.w(c.in("near")),
      m.w(c.in("far")),
      c.param<string>("convention"),
      c.param<string>("projection"),
    );
    return { eye: r.eye.id, linear01: r.linear01.id };
  },
});

const softParticleNode: NodeDef = shNode({
  id: "softParticleFade",
  category: "Screen/Depth",
  name: "Soft Particle Depth Fade",
  synonyms: ["soft particles", "depth fade", "particle intersection fade", "scene depth fade"],
  description:
    "Fades a surface where it approaches opaque geometry. Fade = saturate((SceneEye − FragmentEye) / Distance), 0…1: 0 where the surface touches the scene, 1 at Distance world units in front of it. FragmentEye = clip-space w (perspective cameras only; fragment stage only). Depth input: Raw (linearised here with the chosen convention — Reversed Z, Standard or NDC — and Near / Far) or Eye (already linear, e.g. from Scene Depth). Distance ≤ 1e-6 gives a hard cut (1 where the scene is behind the fragment). Surfaces behind the scene depth get 0. Outputs Fade and the signed Difference in world units.",
  inputs: [
    floatPort(
      "depth",
      "Scene Depth",
      0.5,
      "Raw depth (Scene Depth › Raw) or linear eye depth, see the Depth input param.",
    ),
    floatPort("distance", "Distance", 1),
    floatPort("near", "Near", 0.1),
    floatPort("far", "Far", 1000),
  ],
  outputs: [outPort("fade", "Fade", "float"), outPort("difference", "Difference", "float")],
  params: [
    enumParam(
      "depthInput",
      "Depth input",
      [
        ["raw", "Raw depth"],
        ["eye", "Linear eye depth"],
      ],
      "raw",
    ),
    CONVENTION_PARAM,
  ],
  stage: "fragment",
  capabilities: ["depthTexture"],
  targetNotes: {
    ...noteAll(
      `${STAGE_NOTE.fragment} Perspective cameras only. The depth texture itself must come from the Scene Depth node (Unity URP / Godot).`,
    ),
    glsl: "Compiles in GLSL when the depth comes from a texture / property you provide; Scene Depth itself is unavailable there.",
  },
  build: (c) => {
    const m = new M(c.b);
    const frag = m.w(c.b.input("screenPos")).w;
    const d = m.w(c.in("depth"));
    const scene =
      c.param<string>("depthInput") === "eye"
        ? d
        : linearizeDepth(m, d, m.w(c.in("near")), m.w(c.in("far")), c.param<string>("convention"), "perspective").eye;
    const dist = m.w(c.in("distance"));
    const diff = scene.sub(frag);
    const fade = m.sel(dist.gt(1e-6), diff.div(m.sel(dist.gt(1e-6), dist, 1)).saturate(), m.step(0, diff));
    return { fade: fade.id, difference: diff.id };
  },
});

const distortionNode: NodeDef = shNode({
  id: "distortionOffset",
  category: "Screen/Depth",
  name: "Distortion Offset",
  synonyms: ["refraction offset", "screen distortion", "heat haze", "refraction uv"],
  description:
    "Screen-space UV offset for refraction / heat-haze. UV SPACE: screen UV 0…1, bottom-left origin; Offset is in those units (0.05 = 5 % of the screen height / width), x divided by Aspect (width / height) so a round distortion stays round. Mode Normal: Offset = N_view.xy · Strength. Mode Refraction: R = refract((0,0,−1), N_view, 1/IOR), Offset = R.xy · Strength (zero on total internal reflection / when facing the camera). Map (−1…1, e.g. normal-map xy) adds Map · Strength. Output UV = this fragment's screen UV + Offset, clamped to 0…1 when Clamp is on — feed it to Scene Color, which needs the opaque texture (URP Opaque Texture / Godot screen texture). The node itself is portable maths; fragment stage only (reads the screen position).",
  inputs: [
    normalPort("normal", "view", "Normal (view)"),
    floatPort("strength", "Strength", 0.05),
    floatPort("ior", "IOR", 1.33),
    {
      id: "map",
      name: "Map",
      type: T("vec2"),
      default: [0, 0],
      tooltip: "Extra signed offset −1…1 (e.g. a normal map's xy).",
    },
    floatPort("aspect", "Aspect", 1.7778),
  ],
  outputs: [
    { id: "offset", name: "Offset", type: T("vec2") },
    { id: "uv", name: "UV", type: T("vec2"), tag: { semantic: "uv" } },
  ],
  params: [
    enumParam(
      "mode",
      "Mode",
      [
        ["normal", "Normal"],
        ["refraction", "Refraction"],
      ],
      "normal",
    ),
    { id: "clamp", label: "Clamp UV", control: "bool", default: true },
  ],
  stage: "fragment",
  capabilities: ["opaqueTexture"],
  targetNotes: noteAll(`${STAGE_NOTE.fragment} The UV output is only useful with Scene Color (engine targets).`),
  build: (c) => {
    const m = new M(c.b);
    const n = unit(m, m.w(c.in("normal")), m.k("vec3", 0, 0, 1));
    const k = m.w(c.in("strength"));
    const dir =
      c.param<string>("mode") === "refraction"
        ? m
            .w(c.b.intrinsic("refract", [m.k("vec3", 0, 0, -1).id, n.id, m.f(1).div(m.w(c.in("ior")).max(1e-3)).id]))
            .sw("xy")
        : n.sw("xy");
    const o = dir.add(m.w(c.in("map"))).mul(k);
    const offset = m.v2(o.x.div(m.w(c.in("aspect")).max(1e-3)), o.y);
    const uv = screenUvOfFragment(c, m).add(offset);
    return { offset: offset.id, uv: (c.param<boolean>("clamp") ? uv.clamp(0, 1) : uv).id };
  },
});

export const SCREEN_NODE_DEFS: NodeDef[] = [linearEyeDepthNode, softParticleNode, distortionNode];
