import { createGraph } from "../graph/create";
import type { Graph } from "../graph/types";
import { makeProperty } from "../properties/model";
import { SampleBuilder } from "../samples/builder";
import { PROFILE_TEST_GRAPHS } from "./testGraphs";
import { switchProfile } from "./switch";

export type TemplateEngine = "unity" | "godot";

export interface GraphTemplate {
  id: string;
  name: string;
  description: string;
  kind: "3D" | "2D" | "VFX";
  /** Unity URP profile the template is authored for; Godot is reached through `switchProfile`. */
  unityProfile: string;
  godotProfile: string;
  build: (profileId: string) => Graph;
}

const fromTest =
  (testId: string) =>
  (profile: string): Graph =>
    PROFILE_TEST_GRAPHS.find((g) => g.id === testId)!.build(profile);

/** Toon: stepped light ramp driven by a light-direction PROPERTY (no engine light needed ⇒ identical on every target). */
function toon(profileId: string): Graph {
  const props = [
    makeProperty("lit", "Lit Color", "color", { default: [0.95, 0.6, 0.35], category: "Toon" }),
    makeProperty("shade", "Shadow Color", "color", { default: [0.22, 0.18, 0.4], category: "Toon" }),
    makeProperty("lightDir", "Light Direction", "vec3", { default: [0.4, 0.8, 0.4], category: "Toon" }),
  ];
  return new SampleBuilder(createGraph({ name: "Toon", profileId, properties: props }))
    .n("master", "masterOutput", {}, 6)
    .n("p_lit", "property", { params: { property: "lit" } }, 0, 0)
    .n("p_shade", "property", { params: { property: "shade" } }, 0, 1)
    .n("p_dir", "property", { params: { property: "lightDir" } }, 0, 2)
    .n("nrm", "normal", { params: { space: "world" } }, 1, 3)
    .n("ndl", "dot", {}, 2, 2)
    .n("half", "multiply", { values: { b: 0.5 } }, 3, 2)
    .n("rem", "add", { values: { b: 0.5 } }, 4, 2)
    .n("ramp", "toonRamp", {}, 5, 1)
    .w("p_dir.out", "ndl.a")
    .w("nrm.out", "ndl.b")
    .w("ndl.out", "half.a")
    .w("half.out", "rem.a")
    .w("rem.out", "ramp.value")
    .w("p_shade.out", "ramp.shadow")
    .w("p_lit.out", "ramp.lit")
    .w("ramp.color", "master.baseColor")
    .build();
}

export const GRAPH_TEMPLATES: readonly GraphTemplate[] = [
  {
    id: "unlit",
    name: "Unlit",
    description: "Textured, tinted unlit surface with alpha clip + vertex wobble.",
    kind: "3D",
    unityProfile: "unity.urp.unlit",
    godotProfile: "godot.spatial",
    build: fromTest("UnlitTextured"),
  },
  {
    id: "lit",
    name: "Lit (PBR)",
    description: "Albedo, normal map, metallic / smoothness / occlusion and HDR emission.",
    kind: "3D",
    unityProfile: "unity.urp.lit",
    godotProfile: "godot.spatial",
    build: fromTest("LitPBR"),
  },
  {
    id: "sprite",
    name: "Sprite",
    description: "2D sprite shader with a tinted main texture.",
    kind: "2D",
    unityProfile: "unity.urp.sprite-unlit",
    godotProfile: "godot.canvasitem",
    build: fromTest("UnlitTextured"),
  },
  {
    id: "vfx",
    name: "VFX / Particle",
    description: "Additive soft particle (depth-faded) driven by particle colour.",
    kind: "VFX",
    unityProfile: "unity.urp.vfx-unlit",
    godotProfile: "godot.spatial.vfx",
    build: fromTest("ParticleAdditiveSoft"),
  },
  {
    id: "toon",
    name: "Toon",
    description: "Stepped light ramp with lit / shadow colours (light direction is a parameter).",
    kind: "3D",
    unityProfile: "unity.urp.unlit",
    godotProfile: "godot.spatial",
    build: toon,
  },
];

/** Build a template for an engine. Godot goes through `switchProfile`; unmappable pieces are reported as `problems`. */
export function buildTemplate(id: string, engine: TemplateEngine = "unity"): { graph: Graph; problems: string[] } {
  const t = GRAPH_TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown template "${id}"`);
  const unity = t.build(t.unityProfile);
  const named = (g: Graph): Graph => ({ ...g, name: t.name });
  if (engine === "unity") return { graph: named(unity), problems: [] };
  const sw = switchProfile(unity, t.godotProfile);
  return {
    graph: named(sw.graph),
    problems: sw.problems.map((p) => (typeof p === "string" ? p : ((p as { message?: string }).message ?? String(p)))),
  };
}
