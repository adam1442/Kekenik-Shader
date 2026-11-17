import { COLORS } from "../build/canvas";
import { kit, port } from "./util";

/** Rim / Fresnel kit: view-dependent rim mask, tinted glow and its inverse (face-on mask). */
export const fresnelKit = () => kit({
  id: "ks_fresnel_kit", name: "Fresnel Rim Kit", color: COLORS.cyan,
  inputs: [
    port("normal", "Normal", "vec3", "Surface normal (world space).", [0, 0, 1]),
    port("viewDir", "View Direction", "vec3", "Unit vector from the surface to the camera (world space).", [0, 0, 1]),
    port("color", "Rim Color", "color", "Colour of the glow output (linear, may exceed 1 for HDR bloom).", [1, 1, 1]),
    port("power", "Power", "float", "Fresnel exponent: higher = thinner rim.", 3),
    port("intensity", "Intensity", "float", "Multiplier of the rim mask.", 1),
  ],
  outputs: [
    port("rim", "Rim", "float", "Rim mask 0…1 (1 on silhouettes)."),
    port("glow", "Glow", "color", "Rim colour × rim mask."),
    port("faceOn", "Face-On", "float", "1 − rim: strongest where the surface faces the camera."),
  ],
  note: "**Fresnel kit** — `(1 − N·V)^power × intensity`.\nThe Fresnel node gives the view-dependent term; the mask is saturated so it can drive alpha, emission or a ramp directly. Glow = colour × mask.",
}, (b, c) => {
  b.n("fres", "fresnel", { params: { mode: "power" } });
  b.n("scale", "multiply", {});
  b.n("sat", "saturate", {});
  b.n("tint", "multiply", {});
  b.n("inv", "oneMinus", {});
  c.w("inputs.normal", "fres.normal").w("inputs.viewDir", "fres.viewDir").w("inputs.power", "fres.power")
    .w("fres.out", "scale.a").w("inputs.intensity", "scale.b").w("scale.out", "sat.in")
    .w("inputs.color", "tint.a").w("sat.out", "tint.b").w("sat.out", "inv.in")
    .w("sat.out", "outputs.rim").w("tint.out", "outputs.glow").w("inv.out", "outputs.faceOn");
});
