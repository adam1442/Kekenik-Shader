import type { BuildContext, NodeDef } from "../../registry/nodeDef";
import { T } from "../../types/generics";
import { M, type V } from "../procedural/irm";
import { floatPort } from "../procedural/ports";
import { CAT, eng, out, sceneNode, worldPosPort } from "./common";
import { eyeDepthOfWorld } from "./depthIr";
import { normalPort, viewDirPort } from "../shading/common";
import { fogFactor } from "../shading/lighting";

/** Fog amount (0 = clear, 1 = fully fogged) from the host fog parameters (density, start, end, mode 0 off | 1 linear | 2 exp | 3 exp²) and an eye depth. The curves are `fogFactor` of the 08c Fake Fog node (single implementation). */
function fogAmount(m: M, params: V, eye: V): V {
  const curve = (mode: string): V => fogFactor(m, eye, mode, params.y, params.z, params.x);
  const mode = params.w;
  return m
    .sel(mode.lt(0.5), 0, m.sel(mode.lt(1.5), curve("linear"), m.sel(mode.lt(2.5), curve("exp"), curve("exp2"))))
    .clamp(0, 1);
}

const fogOf = (c: BuildContext, m: V["m"], pos: V): { amount: V; color: V } => ({
  amount: fogAmount(m, m.w(eng(c, "ks.fog.params")), eyeDepthOfWorld(c, m, pos)),
  color: m.w(eng(c, "ks.fog.color")).sw("xyz"),
});
const FOG_USES = ["ks.fog.params", "ks.fog.color", "ks.matrix.worldToView"];
const FOG_NOTE =
  "Linear: saturate((eye − start) / (end − start)); Exp: 1 − e^(−density·eye); Exp²: 1 − e^(−(density·eye)²); eye = depth along the view axis (perspective AND orthographic). Mode Off gives 0. Godot cannot read its Environment fog (it applies it automatically) — the node is declared for Unity URP and the portable targets only.";

const fogNode: NodeDef = sceneNode({
  id: "sceneFog",
  category: CAT.light,
  name: "Fog",
  synonyms: ["fog factor", "fog color", "fog density", "scene fog", "unity fog"],
  description: `Scene fog information. Amount = fog factor 0…1 (0 = clear, 1 = fully fogged, i.e. 1 − Unity's fogFactor); Visibility = 1 − Amount; Color = fog colour (linear); Density / Start / End and the mode (0 off, 1 linear, 2 exp, 3 exp²) are the raw parameters. ${FOG_NOTE} Position defaults to the fragment's world position. Any stage.`,
  inputs: [worldPosPort()],
  outputs: [
    out("amount", "Amount", "float"),
    out("visibility", "Visibility", "float"),
    out("color", "Color", "vec3"),
    out("density", "Density", "float"),
    out("start", "Start", "float"),
    out("end", "End", "float"),
    out("mode", "Mode", "float"),
  ],
  uses: FOG_USES,
  note: "Unity: needs fog enabled in the Lighting window and `#pragma multi_compile_fog`.",
  build: (c) => {
    const m = new M(c.b);
    const p = m.w(eng(c, "ks.fog.params"));
    const f = fogOf(c, m, m.w(c.in("position")));
    return {
      amount: f.amount.id,
      visibility: m.f(1).sub(f.amount).id,
      color: f.color.id,
      density: p.x.id,
      start: p.y.id,
      end: p.z.id,
      mode: p.w.id,
    };
  },
});

const applyFogNode: NodeDef = sceneNode({
  id: "applyFog",
  category: CAT.light,
  name: "Apply Fog",
  synonyms: ["mix fog", "fog helper", "blend with fog", "apply scene fog"],
  description: `Blends a colour with the scene fog: Out = mix(Color, FogColor, Amount · Strength). Use Additive for additive / premultiplied particles (fades to black instead of the fog colour, like Unity's MixFogColor with black). ${FOG_NOTE} Position defaults to the fragment's world position. Any stage.`,
  inputs: [
    { id: "color", name: "Color", type: T("vec3"), default: [1, 1, 1], tag: { semantic: "color" } },
    worldPosPort(),
    floatPort("strength", "Strength", 1),
  ],
  outputs: [{ id: "out", name: "Out", type: T("vec3") }, out("amount", "Amount", "float")],
  params: [{ id: "additive", label: "Additive (fade to black)", control: "bool", default: false }],
  uses: FOG_USES,
  build: (c) => {
    const m = new M(c.b);
    const f = fogOf(c, m, m.w(c.in("position")));
    const k = f.amount.mul(m.w(c.in("strength")).saturate());
    const target = c.param<boolean>("additive") ? m.k("vec3", 0, 0, 0) : f.color;
    return { out: m.w(c.in("color")).mix(target, k).id, amount: k.id };
  },
});

const mainLightShadowNode: NodeDef = sceneNode({
  id: "mainLightShadow",
  category: CAT.light,
  name: "Main Light Shadow",
  synonyms: ["shadow attenuation", "main light shadows", "receive shadows", "shadow term"],
  description:
    "Shadow attenuation of the main directional light at a world position: 1 = fully lit, 0 = fully shadowed. Unity URP: GetMainLight(TransformWorldToShadowCoord(positionWS)).shadowAttenuation — needs the _MAIN_LIGHT_SHADOWS keywords (the exporter adds the multi_compile) and a shadow-casting main light. The preview and the portable targets have NO shadow maps: the value is always 1 (flagged approximate). Godot cannot read shadows in fragment(). FRAGMENT-ONLY. (Main Light direction / colour — intensity included — are the Main Light Direction / Color nodes.)",
  inputs: [worldPosPort()],
  outputs: [out("out", "Attenuation", "float")],
  stage: "fragment",
  uses: ["ks.light.mainShadow"],
  build: (c) => ({ out: eng(c, "ks.light.mainShadow", [c.in("position")]) }),
});

const reflectionProbeNode: NodeDef = sceneNode({
  id: "reflectionProbe",
  category: CAT.light,
  name: "Reflection Probe",
  synonyms: [
    "environment reflection",
    "glossy reflection",
    "probe sample",
    "reflection cubemap",
    "specular environment",
  ],
  description:
    "Radiance of the reflection probe / skybox environment along the mirror direction R = reflect(−View, Normal) (world space) at a perceptual Roughness 0…1 (blurrier mips as it grows). ENGINE-ONLY and flagged: Unity URP GlossyEnvironmentReflection(R, roughness, 1) (the URP 15+ overload adds probe blending / Forward+ needs the position and screen UV); NOT available on Godot (fragment() cannot read probes), GLSL, WGSL, HLSL — use a texture property there. FRAGMENT-ONLY.",
  inputs: [normalPort("normal", "world"), viewDirPort("world"), floatPort("roughness", "Roughness", 0.5)],
  outputs: [out("out", "Color", "vec3")],
  stage: "fragment",
  capabilities: ["reflectionProbe"],
  uses: ["ks.light.reflectionProbe"],
  build: (c) => {
    const m = new M(c.b);
    const r = m.w(c.b.intrinsic("reflect", [m.w(c.in("viewDir")).neg().id, m.w(c.in("normal")).id]));
    return { out: eng(c, "ks.light.reflectionProbe", [r.id, m.w(c.in("roughness")).saturate().id]) };
  },
});

const lightCountNode: NodeDef = sceneNode({
  id: "additionalLightCount",
  category: CAT.light,
  name: "Additional Light Count",
  synonyms: ["light count", "number of lights", "extra lights count", "per object lights"],
  description:
    "Number of ADDITIONAL (non-main) lights affecting the object. ENGINE-ONLY and flagged: Unity URP (float)GetAdditionalLightsCount() — 0 unless Additional Lights are enabled in the URP asset (Per Pixel / Per Vertex); Godot cannot read lights in fragment(); not available on GLSL / WGSL / HLSL. Any stage.",
  inputs: [],
  outputs: [out("count", "Count", "float")],
  capabilities: ["additionalLights"],
  uses: ["ks.light.additional.count"],
  build: (c) => ({ count: eng(c, "ks.light.additional.count") }),
});

export const LIGHT_INFO_DEFS: NodeDef[] = [
  fogNode,
  applyFogNode,
  mainLightShadowNode,
  reflectionProbeNode,
  lightCountNode,
];
