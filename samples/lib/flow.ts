import { COLORS } from "../build/canvas";
import { kit, port } from "./util";

/** Flow-map sampling: two phase-shifted samples advected along a flow texture, cross-faded so the loop reset is invisible. */
export const flowSample = () => kit({
  id: "ks_flow_sample", name: "Flow Map Sample", color: COLORS.cyan,
  inputs: [
    port("tex", "Texture", "texture2D", "Texture to advect (e.g. a ripple normal map)."),
    port("flow", "Flow Map", "texture2D", "Flow vectors in R, G (0.5 = still). Import as linear data."),
    port("uv", "UV", "vec2", "Base UV.", [0, 0]),
    port("time", "Time", "float", "Seconds.", 0),
    port("strength", "Strength", "float", "Max UV distance a layer travels per cycle.", 0.25),
    port("speed", "Speed", "float", "Cycles per second.", 0.4),
  ],
  outputs: [port("color", "Color", "color4", "Cross-faded texel (raw, un-decoded).")],
  note: "**Flow map** — Flow Map node returns two UV sets A/B offset by `flow × strength × phase` with phases half a cycle apart, plus the blend weight `|2·phaseA − 1|`.\nWe sample the texture at A and B and `lerp` by that weight; each layer is invisible exactly when it restarts, which hides the pop.",
}, (b, c) => {
  b.n("fm", "uvFlowMap", {});
  b.n("sa", "sampleTexture2D", {});
  b.n("sb", "sampleTexture2D", {});
  b.n("mix", "lerp", {});
  c.w("inputs.uv", "fm.uv").w("inputs.flow", "fm.flowTex").w("inputs.time", "fm.t").w("inputs.strength", "fm.strength").w("inputs.speed", "fm.speed")
    .w("inputs.tex", "sa.tex").w("fm.uvA", "sa.uv").w("inputs.tex", "sb.tex").w("fm.uvB", "sb.uv")
    .w("sa.rgba", "mix.a").w("sb.rgba", "mix.b").w("fm.blend", "mix.t").w("mix.out", "outputs.color");
});
