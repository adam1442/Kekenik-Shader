import { COLORS } from "../build/canvas";
import { kit, port } from "./util";

/** Toon light: N·L remapped to 0…1 and quantised into 3 bands, mixed between a shadow and a lit colour. */
export const toonLight = () => kit({
  id: "ks_toon_light", name: "Toon Light (3 bands)", color: COLORS.orange,
  inputs: [
    port("normal", "Normal", "vec3", "Surface normal (world space).", [0, 1, 0]),
    port("lightDir", "Light Direction", "vec3", "Direction from the surface TOWARDS the light (world space).", [0.4, 0.8, 0.4]),
    port("softness", "Softness", "float", "Width of the band edges (0 = hard cel).", 0.02),
    port("shadow", "Shadow", "color", "Colour of the darkest band.", [0.2, 0.2, 0.35]),
    port("lit", "Lit", "color", "Colour of the brightest band.", [1, 1, 1]),
  ],
  outputs: [
    port("color", "Color", "color", "mix(Shadow, Lit, level)."),
    port("level", "Level", "float", "Band level 0…1 (0, ⅓, ⅔, 1 with soft edges)."),
  ],
  note: "**Toon light** — `v = N·L × ½ + ½` (half-Lambert keeps the dark side readable), then the Toon Ramp node quantises v into 3 equal bands with a feathered edge.",
}, (b, c) => {
  b.n("ndl", "dot", {});
  b.n("half", "multiply", { values: { b: 0.5 } });
  b.n("v", "add", { values: { b: 0.5 } });
  b.n("ramp", "toonRamp", { params: { mode: "bands", bands: 3 } });
  c.w("inputs.normal", "ndl.a").w("inputs.lightDir", "ndl.b").w("ndl.out", "half.a").w("half.out", "v.a")
    .w("v.out", "ramp.value").w("inputs.softness", "ramp.softness").w("inputs.shadow", "ramp.shadow").w("inputs.lit", "ramp.lit")
    .w("ramp.color", "outputs.color").w("ramp.level", "outputs.level");
});
