import { COLORS } from "../build/canvas";
import { P, Sample } from "../build/dsl";
import type { SampleModule } from "../build/emit";
import { paletteRamp } from "../lib";
import { paletteLut, slimeSprite } from "../textures/gen";
import { ALL_TARGETS, defineMeta } from "../3d/common";
import { SPRITE_PROFILE, SPRITE_PROP_ID, spriteTexProp } from "./common";

const meta = defineMeta({
  id: "sprite-palette-swap", title: "Palette Swap (LUT)",
  description: "Recolour an indexed (4-level greyscale) sprite through a palette ramp texture: one row per palette. Pick any two palettes and cross-fade between them — team colours, damage states, day / night variants from a single sprite.",
  tags: ["palette", "lut", "recolor", "sprite", "2d", "pixel-art"], category: "2D / Sprites", difficulty: "Intermediate", targets: ALL_TARGETS,
  compatNotes: ["The sprite must use the grey index levels 0, ⅓, ⅔, 1 (after rounding); the sample's slime does.", "Import the ramp with Filter = Point / Nearest is NOT required — the ramp is sampled on texel centres — but disable mip-maps and compression.", "Sprite filter should be Point for pixel art."],
  requiredFeatures: [], budgetClass: "Mobile", godotProfile: "godot.canvasitem", reusableSubgraphs: ["ks_palette_ramp"],
  previewConfig: { mode: "2d", sprite: true, nearest: true, background: { mode: "checker" } },
});
const PALETTES: number[][][] = [
  [[0.1, 0.25, 0.12], [0.25, 0.7, 0.3], [0.55, 0.9, 0.45], [0.95, 1, 0.9]],
  [[0.2, 0.05, 0.12], [0.75, 0.15, 0.3], [0.98, 0.45, 0.45], [1, 0.92, 0.85]],
  [[0.05, 0.1, 0.25], [0.2, 0.4, 0.85], [0.45, 0.75, 1], [0.92, 0.98, 1]],
  [[0.12, 0.1, 0.05], [0.55, 0.4, 0.12], [0.95, 0.75, 0.25], [1, 0.97, 0.75]],
];

function build(): Sample {
  const s = new Sample({ id: meta.id, name: meta.title, profile: SPRITE_PROFILE });
  s.add(
    spriteTexProp(),
    P.tex("ramp", "Palette Ramp", { default: "white", tooltip: "Palette texture: one palette per row, dark → light, left → right.", category: "Palette" }),
    P.float("paletteA", "Palette A", { default: 0, min: 0, max: 3, step: 1, tooltip: "Row of the first palette (0-based).", category: "Palette" }),
    P.float("paletteB", "Palette B", { default: 2, min: 0, max: 3, step: 1, tooltip: "Row of the second palette (0-based).", category: "Palette" }),
    P.float("blend", "Blend A → B", { default: 0, min: 0, max: 1, tooltip: "0 = palette A, 1 = palette B. Animate it for a smooth recolour.", category: "Palette" }),
    P.float("rows", "Palette Count", { default: 4, min: 1, max: 16, step: 1, tooltip: "Number of rows (palettes) in the ramp texture.", category: "Ramp texture" }),
    P.float("width", "Ramp Width", { default: 64, min: 4, max: 256, step: 1, tooltip: "Texels per row of the ramp texture.", category: "Ramp texture" }),
  );
  s.texture(SPRITE_PROP_ID, "slime-sprite-indexed", slimeSprite(64, true));
  s.texture("ramp", "palette-lut", paletteLut(PALETTES, 64));
  s.use(paletteRamp());

  const src = s.block("src", "Indexed sprite", "The sprite stores *indices* as grey levels (shadow / body / light / highlight), not final colours.", { col: 0, color: COLORS.blue });
  src.n("uv", "uv", {});
  src.n("sprite", "sampleTexture2D", {});
  s.w(src.po(SPRITE_PROP_ID), "sprite.tex").w("uv.out", "sprite.uv");

  const idx = s.block("index", "Snap to palette index", "Grey `v` → index `round(v × 3)` → ramp position `index / 3`. This lands exactly on the four colour stops of every palette, so edges and filtering can never produce in-between colours.", { col: 1, color: COLORS.green });
  idx.n("grey", "split", {});
  idx.n("times3", "multiply", { values: { b: 3 } });
  idx.n("rounded", "round", {});
  idx.n("pos", "divide", { values: { b: 3 } });
  s.w("sprite.rgb", "grey.in").w("grey.r", "times3.a").w("times3.out", "rounded.in").w("rounded.out", "pos.a");

  const pal = s.block("pal", "Palette lookup (A and B)", "Two **Palette Ramp** lookups share the same index; `Blend` cross-fades the resulting colours. Both rows are read on texel centres, so neighbouring palettes never bleed.", { col: 2, color: COLORS.pink });
  pal.sub("rampA", "ks_palette_ramp", { label: "Palette A" });
  pal.sub("rampB", "ks_palette_ramp", { label: "Palette B" });
  pal.n("mix", "lerp", {});
  for (const k of ["A", "B"]) {
    s.w("pos.out", `ramp${k}.value`, "Index").w(pal.po(`palette${k}`), `ramp${k}.palette`).w(pal.po("rows"), `ramp${k}.rows`).w(pal.po("width"), `ramp${k}.width`).w(pal.po("ramp"), `ramp${k}.ramp`);
  }
  s.w("rampA.color", "mix.a").w("rampB.color", "mix.b").w(pal.po("blend"), "mix.t");

  const out = s.block("out", "Master output (URP Sprite Unlit)", "Recoloured RGB with the original sprite alpha (hard pixel edges stay hard).", { col: 3, color: COLORS.violet });
  out.n("rgb", "split", {});
  out.n("col", "combine", {});
  s.master(out);
  s.w("mix.out", "rgb.in").w("rgb.r", "col.r").w("rgb.g", "col.g").w("rgb.b", "col.b").w("col.rgb", "master.baseColor").w("sprite.a", "master.alpha");
  return s;
}
export const paletteSwapSample: SampleModule = { meta, build };
