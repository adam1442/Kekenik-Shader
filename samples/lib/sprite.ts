import { COLORS } from "../build/canvas";
import { kit, port } from "./util";

/** Pixel snap: UV snapped to the centre of a texel grid so pixel art stays crisp at any scale / rotation. */
export const pixelSnap = () => kit({
  id: "ks_pixel_snap", name: "Pixel Snap", color: COLORS.green,
  inputs: [
    port("uv", "UV", "vec2", "UV to snap (origin bottom-left).", [0, 0]),
    port("resolution", "Resolution", "vec2", "Texels per axis of the grid (texture size for a 1:1 sprite).", [64, 64]),
  ],
  outputs: [
    port("uv", "Snapped UV", "vec2", "UV at the centre of the texel containing the input."),
    port("texel", "Texel", "vec2", "Integer texel coordinate (as float)."),
  ],
  note: "**Pixel snap** — `uv' = (floor(uv × res) + 0.5) / res`. Feed the snapped UV into the texture sample (point filtering) and every screen pixel inside a texel reads exactly that texel.",
}, (b, c) => {
  b.n("snap", "pixelSnap", { params: { anchor: "center" } });
  c.w("inputs.uv", "snap.uv").w("inputs.resolution", "snap.resolution").w("snap.uv", "outputs.uv").w("snap.texel", "outputs.texel");
});

/** Outline + soft glow around a sprite silhouette, composited behind the sprite. */
export const outlineKit = () => kit({
  id: "ks_outline_kit", name: "Outline + Glow Kit", color: COLORS.yellow,
  inputs: [
    port("tex", "Sprite", "texture2D", "Sprite texture (alpha = silhouette)."),
    port("uv", "UV", "vec2", "Sprite UV.", [0, 0]),
    port("outlineColor", "Outline Color", "color4", "Colour + opacity of the crisp outline.", [0, 0, 0, 1]),
    port("thickness", "Outline Thickness", "float", "Outline width in texels.", 1),
    port("glowColor", "Glow Color", "color4", "Glow colour (rgb, may exceed 1) × glow opacity (a).", [1, 0.9, 0.3, 1]),
    port("glowSize", "Glow Size", "float", "Glow reach in texels (≥ outline thickness).", 6),
  ],
  outputs: [
    port("final", "Final", "color4", "Sprite + outline over the glow (straight alpha)."),
    port("outline", "Outline Only", "color4", "Sprite + outline, no glow."),
    port("glow", "Glow Mask", "float", "Soft glow coverage 0…1 (outside the silhouette)."),
  ],
  note: "**Outline + glow** — the Sprite Outline node samples the alpha on 8-direction rings (4 for the inner glow ring). The glow uses three rings (⅓, ⅔ and 1× the glow size) with weights 0.5 / 0.3 / 0.2, so coverage falls off in steps that read as a smooth halo.\nFinal = outline-sprite *over* glow: `α = a + g(1−a)`, `rgb = (rgb·a + glow·g(1−a)) / α`.",
}, (b, c) => {
  const o = { params: { unit: "texels", samples: "8", sampling: "implicit" } };
  b.n("ol", "spriteOutline", o);
  for (const [i, f] of [[1, 0.34], [2, 0.67], [3, 1]] as const) {
    b.n(`gs${i}`, "multiply", { values: { b: f } });
    b.n(`g${i}`, "spriteOutline", i === 1 ? { params: { ...o.params, samples: "4" } } : o); // inner ring: 4 taps (it is mostly covered by the sprite)
  }
  b.n("m1", "multiply", { values: { b: 0.5 } });
  b.n("m2", "multiply", { values: { b: 0.3 } });
  b.n("m3", "multiply", { values: { b: 0.2 } });
  b.n("ga0", "add", {});
  b.n("ga1", "add", {});
  b.n("gsat", "saturate", {});
  b.n("gsplit", "split", {});
  b.n("osplit", "split", {});
  b.n("gcol", "combine", {});
  b.n("ocol", "combine", {});
  b.n("gAlpha", "multiply", {});
  b.n("behind", "oneMinus", {});
  b.n("ga", "multiply", {});
  b.n("outA", "add", {});
  b.n("den", "maximum", { values: { b: 0.0001 } });
  b.n("num1", "multiply", {});
  b.n("num2", "multiply", {});
  b.n("num", "add", {});
  b.n("rgb", "divide", {});
  b.n("rgbSplit", "split", {});
  b.n("fin", "combine", {});
  c.w("inputs.tex", "ol.tex").w("inputs.uv", "ol.uv").w("inputs.outlineColor", "ol.color").w("inputs.thickness", "ol.thickness");
  for (const i of [1, 2, 3]) {
    c.w("inputs.glowSize", `gs${i}.a`).w(`gs${i}.out`, `g${i}.thickness`).w("inputs.tex", `g${i}.tex`).w("inputs.uv", `g${i}.uv`);
  }
  c.w("g1.mask", "m1.a").w("g2.mask", "m2.a").w("g3.mask", "m3.a").w("m1.out", "ga0.a").w("m2.out", "ga0.b").w("ga0.out", "ga1.a").w("m3.out", "ga1.b").w("ga1.out", "gsat.in")
    .w("inputs.glowColor", "gsplit.in").w("gsat.out", "gAlpha.a").w("gsplit.a", "gAlpha.b")
    .w("gsplit.r", "gcol.r").w("gsplit.g", "gcol.g").w("gsplit.b", "gcol.b")
    .w("ol.rgba", "osplit.in").w("osplit.r", "ocol.r").w("osplit.g", "ocol.g").w("osplit.b", "ocol.b")
    .w("osplit.a", "behind.in").w("gAlpha.out", "ga.a").w("behind.out", "ga.b")
    .w("osplit.a", "outA.a").w("ga.out", "outA.b").w("outA.out", "den.a")
    .w("ocol.rgb", "num1.a").w("osplit.a", "num1.b").w("gcol.rgb", "num2.a").w("ga.out", "num2.b").w("num1.out", "num.a").w("num2.out", "num.b")
    .w("num.out", "rgb.a").w("den.out", "rgb.b").w("rgb.out", "rgbSplit.in")
    .w("rgbSplit.r", "fin.r").w("rgbSplit.g", "fin.g").w("rgbSplit.b", "fin.b").w("outA.out", "fin.a")
    .w("fin.rgba", "outputs.final").w("ol.rgba", "outputs.outline").w("gsat.out", "outputs.glow");
});
