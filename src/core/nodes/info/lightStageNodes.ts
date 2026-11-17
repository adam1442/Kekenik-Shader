import type { NodeDef } from "../../registry/nodeDef";
import { enumParam } from "../kit";
import { M, type V } from "../procedural/irm";
import { unit } from "../shading/common";
import { CAT, eng, mulPoint, out, sceneNode } from "./common";

/**
 * Godot `light` stage nodes . They exist only inside the Light-stage master blocks (`stage: "light"` ⇒ the IR rejects
 * them anywhere else, `E_STAGE_VIOLATION`) and compile for Godot spatial only. Godot runs light() once per light that affects the
 * fragment, so "Main Light" is the pass where Is Directional = 1 and "Additional Light" any other pass — there is no index / count.
 */
const SPACE = enumParam(
  "space",
  "Space",
  [
    ["world", "World"],
    ["view", "View (Godot native)"],
  ],
  "world",
);
const VIEW_MATRIX_USE = "ks.matrix.viewToWorld";

/** A light() direction in the chosen space (Godot hands light() VIEW-space vectors). */
function inSpace(c: Parameters<NonNullable<NodeDef["build"]>>[0], m: M, v: V, space: string): V {
  return space === "view" ? v : unit(m, mulPoint(m, eng(c, VIEW_MATRIX_USE), v, 0), m.k("vec3", 0, 1, 0));
}

const lightStageLightNode: NodeDef = sceneNode({
  id: "godotLight",
  category: CAT.light,
  name: "Light (per light, Godot)",
  stage: "light",
  synonyms: [
    "light()",
    "main light godot",
    "additional light godot",
    "per light",
    "light direction godot",
    "attenuation",
    "light color godot",
    "toon light",
  ],
  description:
    "Data of the light currently being shaded by Godot's light() function (runs once per light): Direction (towards the light), Color (Godot LIGHT_COLOR = colour × energy × PI — divide by PI for Unity-style intensity), Attenuation (distance + shadow, 0…1), Is Directional (1 for the main DirectionalLight3D pass), Specular Amount. This is the Godot counterpart of the Main Light / Additional Light nodes. LIGHT-STAGE ONLY: connect to Diffuse Light / Specular Light (Surface Options ▸ Custom light()).",
  outputs: [
    out("direction", "Direction", "vec3"),
    out("color", "Color", "vec3"),
    out("attenuation", "Attenuation", "float"),
    out("isDirectional", "Is Directional", "float"),
    out("specularAmount", "Specular Amount", "float"),
  ],
  params: [SPACE],
  uses: [
    "ks.lightstage.direction",
    "ks.lightstage.color",
    "ks.lightstage.attenuation",
    "ks.lightstage.isDirectional",
    "ks.lightstage.specularAmount",
    VIEW_MATRIX_USE,
  ],
  note: "Godot spatial only; evaluated inside light(). Not shown in the preview.",
  build: (c) => {
    const m = new M(c.b);
    const dir = m.w(eng(c, "ks.lightstage.direction"));
    return {
      direction: inSpace(c, m, dir, c.param<string>("space")).id,
      color: eng(c, "ks.lightstage.color"),
      attenuation: eng(c, "ks.lightstage.attenuation"),
      isDirectional: eng(c, "ks.lightstage.isDirectional"),
      specularAmount: eng(c, "ks.lightstage.specularAmount"),
    };
  },
});

const lightStageSurfaceNode: NodeDef = sceneNode({
  id: "godotLightSurface",
  category: CAT.light,
  name: "Light Surface (Godot)",
  stage: "light",
  synonyms: ["light() normal", "light view", "light albedo", "surface in light", "toon normal"],
  description:
    "Surface data as seen by Godot's light(): Normal and View (unit vectors, in the chosen Space), plus Albedo, Roughness and Metallic exactly as fragment() wrote them. LIGHT-STAGE ONLY (Surface Options ▸ Custom light()).",
  outputs: [
    out("normal", "Normal", "vec3"),
    out("view", "View", "vec3"),
    out("albedo", "Albedo", "vec3"),
    out("roughness", "Roughness", "float"),
    out("metallic", "Metallic", "float"),
  ],
  params: [SPACE],
  uses: [
    "ks.lightstage.normal",
    "ks.lightstage.view",
    "ks.lightstage.albedo",
    "ks.lightstage.roughness",
    "ks.lightstage.metallic",
    VIEW_MATRIX_USE,
  ],
  note: "Godot spatial only; evaluated inside light(). Not shown in the preview.",
  build: (c) => {
    const m = new M(c.b);
    const space = c.param<string>("space");
    return {
      normal: inSpace(c, m, m.w(eng(c, "ks.lightstage.normal")), space).id,
      view: inSpace(c, m, m.w(eng(c, "ks.lightstage.view")), space).id,
      albedo: eng(c, "ks.lightstage.albedo"),
      roughness: eng(c, "ks.lightstage.roughness"),
      metallic: eng(c, "ks.lightstage.metallic"),
    };
  },
});

export const LIGHT_STAGE_DEFS: NodeDef[] = [lightStageLightNode, lightStageSurfaceNode];
