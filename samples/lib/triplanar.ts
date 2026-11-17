import { COLORS } from "../build/canvas";
import { kit, port } from "./util";

/** Triplanar colour projection (world space) with adjustable blend sharpness. */
export const triplanar = () => kit({
  id: "ks_triplanar", name: "Triplanar Projection", color: COLORS.green,
  inputs: [
    port("tex", "Texture", "texture2D", "Texture projected along X, Y and Z."),
    port("pos", "Position", "vec3", "Projection position (world space).", [0, 0, 0]),
    port("normal", "Normal", "vec3", "Surface normal (world space).", [0, 1, 0]),
    port("tile", "Tile", "float", "Texture repeats per world unit.", 1),
    port("sharpness", "Sharpness", "float", "Blend-weight exponent: 1 = soft seams, 8+ = nearly hard.", 4),
  ],
  outputs: [
    port("rgb", "Color", "color", "Blended projection."),
    port("weights", "Weights", "vec3", "Axis weights (sum = 1): x, y, z."),
  ],
  note: "**Triplanar** — samples the texture on the YZ, XZ and XY planes and blends by `|n|^sharpness` (normalised). No UVs needed, so rocks and terrain never stretch.\nUses explicit LOD-free sampling; for normal maps use the Triplanar Normal node (Whiteout blend) next to this kit.",
}, (b, c) => {
  b.n("tp", "uvTriplanarTexture", { params: { space: "world" } });
  c.w("inputs.tex", "tp.tex").w("inputs.pos", "tp.pos").w("inputs.normal", "tp.normal").w("inputs.tile", "tp.tile").w("inputs.sharpness", "tp.blend")
    .w("tp.rgb", "outputs.rgb").w("tp.weights", "outputs.weights");
});

/** Height-aware layer blend: a coverage mask is modulated by a height field so the top layer collects in the low spots first. */
export const heightBlend = () => kit({
  id: "ks_height_blend", name: "Height Blend", color: COLORS.green,
  inputs: [
    port("mask", "Coverage", "float", "Coverage of the top layer, 0…1 (e.g. up-facing × noise).", 0.5),
    port("height", "Height", "float", "Height of the BASE layer, 0…1 (low = crevice).", 0.5),
    port("depth", "Depth", "float", "How strongly the base height steers the blend (0 = plain mask).", 0.6),
    port("softness", "Softness", "float", "Half-width of the transition.", 0.12),
  ],
  outputs: [port("blend", "Blend", "float", "Final top-layer weight 0…1.")],
  note: "**Height blend** — `blend = smoothstep(½ − s, ½ + s, coverage + (½ − height) × depth)`.\nLow areas of the base height get a bonus, so moss / snow / dust fills crevices before it climbs the ridges.",
}, (b, c) => {
  b.n("inv", "subtract", { values: { a: 0.5 } });
  b.n("push", "multiply", {});
  b.n("score", "add", {});
  b.n("lo", "subtract", { values: { a: 0.5 } });
  b.n("hi", "add", { values: { a: 0.5 } });
  b.n("blend", "smoothstep", {});
  c.w("inputs.height", "inv.b").w("inv.out", "push.a").w("inputs.depth", "push.b").w("inputs.mask", "score.a").w("push.out", "score.b")
    .w("inputs.softness", "lo.b").w("inputs.softness", "hi.b")
    .w("lo.out", "blend.edge1").w("hi.out", "blend.edge2").w("score.out", "blend.in").w("blend.out", "outputs.blend");
});
