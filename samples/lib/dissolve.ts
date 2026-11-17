import { COLORS } from "../build/canvas";
import { kit, port } from "./util";

/** Soft-edge dissolve: alpha mask + glowing edge band from any 0…1 noise and an amount. */
export const softDissolve = () => kit({
  id: "ks_soft_dissolve", name: "Soft Edge Dissolve", color: COLORS.orange,
  inputs: [
    port("noise", "Noise", "float", "Any 0…1 pattern that decides what disappears first.", 0.5),
    port("amount", "Amount", "float", "0 = fully visible, 1 = fully dissolved.", 0),
    port("edgeWidth", "Edge Width", "float", "Width of the glowing band (in noise units).", 0.08),
    port("softness", "Softness", "float", "Feathering of both borders (clamped to ≥ 0.001).", 0.02),
  ],
  outputs: [
    port("alpha", "Alpha", "float", "Visibility mask 0…1 (feathered)."),
    port("edge", "Edge", "float", "Glowing band 0…1, just inside the cut."),
  ],
  note: "**Soft dissolve** — the cut line is `t = amount × (1 + width) − width`, so amount 0 hides nothing and amount 1 hides everything, edge band included.\n`alpha = smoothstep(t, t+soft, noise)`; the band is `alpha × (1 − smoothstep(t+width, t+width+soft, noise))`.",
}, (b, c) => {
  b.n("w1", "add", { values: { b: 1 } });
  b.n("cut0", "multiply", {});
  b.n("t", "subtract", {});
  b.n("soft", "maximum", { values: { b: 0.001 } });
  b.n("tEnd", "add", {});
  b.n("alpha", "smoothstep", {});
  b.n("bandA", "add", {});
  b.n("bandB", "add", {});
  b.n("upper", "smoothstep", {});
  b.n("below", "oneMinus", {});
  b.n("edge", "multiply", {});
  c.w("inputs.edgeWidth", "w1.a").w("inputs.amount", "cut0.a").w("w1.out", "cut0.b").w("cut0.out", "t.a").w("inputs.edgeWidth", "t.b")
    .w("inputs.softness", "soft.a").w("t.out", "tEnd.a").w("soft.out", "tEnd.b")
    .w("t.out", "alpha.edge1").w("tEnd.out", "alpha.edge2").w("inputs.noise", "alpha.in")
    .w("t.out", "bandA.a").w("inputs.edgeWidth", "bandA.b").w("bandA.out", "bandB.a").w("soft.out", "bandB.b")
    .w("bandA.out", "upper.edge1").w("bandB.out", "upper.edge2").w("inputs.noise", "upper.in").w("upper.out", "below.in")
    .w("alpha.out", "edge.a").w("below.out", "edge.b")
    .w("alpha.out", "outputs.alpha").w("edge.out", "outputs.edge");
});
