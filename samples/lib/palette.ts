import { COLORS } from "../build/canvas";
import { kit, port } from "./util";

/** Palette ramp lookup: row `palette` of a ramp texture sampled at `value` (texel-centre exact, no row bleeding). */
export const paletteRamp = () => kit({
  id: "ks_palette_ramp", name: "Palette Ramp", color: COLORS.pink,
  inputs: [
    port("value", "Value", "float", "Position on the ramp, 0…1 (e.g. sprite luminance).", 0.5),
    port("palette", "Palette", "float", "Row of the ramp texture (0 = first palette).", 0),
    port("rows", "Rows", "float", "Number of palettes (rows) in the ramp texture.", 4),
    port("width", "Width", "float", "Texels per row of the ramp texture.", 64),
    port("ramp", "Ramp", "texture2D", "Ramp texture: one palette per row, dark → light."),
  ],
  outputs: [port("color", "Color", "color4", "Colour of the palette at Value.")],
  note: "**Palette ramp** — `u = value × (w−1)/w + 0.5/w`, `v = (row + 0.5)/rows`: both land on texel centres, so neighbouring rows never bleed and the ends of the ramp stay clean.\nSampled with explicit LOD 0 (no mip mixing of rows).",
}, (b, c) => {
  b.n("sat", "saturate", {});
  b.n("wm1", "subtract", { values: { b: 1 } });
  b.n("k", "divide", {});
  b.n("scaled", "multiply", {});
  b.n("half", "divide", { values: { a: 0.5 } });
  b.n("u", "add", {});
  b.n("row", "add", { values: { b: 0.5 } });
  b.n("v", "divide", {});
  b.n("uv", "combine", {});
  b.n("tex", "sampleTexture2D", { params: { mode: "lod" }, values: { lod: 0 } });
  c.w("inputs.value", "sat.in").w("inputs.width", "wm1.a").w("wm1.out", "k.a").w("inputs.width", "k.b")
    .w("sat.out", "scaled.a").w("k.out", "scaled.b").w("inputs.width", "half.b").w("scaled.out", "u.a").w("half.out", "u.b")
    .w("inputs.palette", "row.a").w("row.out", "v.a").w("inputs.rows", "v.b")
    .w("u.out", "uv.r").w("v.out", "uv.g").w("inputs.ramp", "tex.tex").w("uv.rg", "tex.uv").w("tex.rgba", "outputs.color");
});
