import { COLORS } from "../build/canvas";
import { kit, port } from "./util";

/** Noise stack: two value-noise layers, the second domain-warped by the first (2 noise evaluations — cheap and portable). */
export const noiseStack = () => kit({
  id: "ks_noise_stack", name: "Noise Stack", color: COLORS.violet,
  inputs: [
    port("uv", "UV", "vec2", "Sample position (any 2D coordinate: UV, world XZ, …).", [0, 0]),
    port("scale", "Scale", "float", "Base frequency of the first layer.", 4),
    port("warp", "Warp", "float", "How far the first layer bends the coordinates of the second (0 = none).", 0.25),
    port("seed", "Seed", "float", "Any float; changes the pattern.", 0),
  ],
  outputs: [
    port("n", "Noise", "float", "Warped noise, 0…1."),
    port("base", "Base", "float", "The unwarped first layer, 0…1."),
  ],
  note: "**Noise stack** — layer 1 is plain value noise; layer 2 samples value noise at `uv + (layer1 − 0.5) × warp` and 2.1× the frequency, which breaks up the regular look of a single layer.\nOnly two noise evaluations (≈ 2 × the cost of one Value 2D node, see the Stats panel) — for richer detail swap the nodes for FBM and mind the budget.",
}, (b, c) => {
  b.n("n1", "noiseValue", {});
  b.n("center", "subtract", { values: { b: 0.5 } });
  b.n("off", "multiply", {});
  b.n("uv2", "add", {});
  b.n("scale2", "multiply", { values: { b: 2.1 } });
  b.n("seed2", "add", { values: { b: 3 } });
  b.n("n2", "noiseValue", {});
  c.w("inputs.uv", "n1.p").w("inputs.scale", "n1.scale").w("inputs.seed", "n1.seed")
    .w("n1.out", "center.a").w("center.out", "off.a").w("inputs.warp", "off.b")
    .w("inputs.uv", "uv2.a").w("off.out", "uv2.b").w("uv2.out", "n2.p")
    .w("inputs.scale", "scale2.a").w("scale2.out", "n2.scale").w("inputs.seed", "seed2.a").w("seed2.out", "n2.seed")
    .w("n2.out", "outputs.n").w("n1.out", "outputs.base");
});
