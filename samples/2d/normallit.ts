import { COLORS } from "../build/canvas";
import { P, Sample } from "../build/dsl";
import type { SampleModule } from "../build/emit";
import { brickTextures } from "../textures/gen-surface";
import { ALL_TARGETS, defineMeta } from "../3d/common";
import { SPRITE_PROP_ID, spriteTexProp } from "./common";

const meta = defineMeta({
  id: "sprite-normal-lit", title: "Normal-Mapped 2D Lit (Height to Normal)",
  description: "Gives a flat sprite relief for 2D lights without a normal-map texture: the sprite's luminance is read as a height field and the Height To Normal node turns its screen-space slope into a tangent-space normal. Built for the Sprite Lit profile (2D Renderer); a debug switch shows the generated normals.",
  tags: ["normal-map", "height-to-normal", "2d-lights", "sprite-lit", "relief", "sprite", "2d"], category: "2D / Sprites", difficulty: "Intermediate", targets: ALL_TARGETS,
  compatNotes: ["Authored for URP Sprite Lit (2D Renderer): the Normal output is lit by 2D Lights; in the Preview the light comes from the lighting controls. The Godot canvas-item target feeds the same normal to NORMAL_MAP.", "The normal comes from screen-space derivatives of the luminance (quality: derivative), so it needs no extra texture fetch and stays crisp at any zoom, but it is 2×2-pixel quantised; for a hand-painted look use a real normal-map texture."],
  requiredFeatures: ["URP 2D Renderer with 2D Lights"], budgetClass: "Mobile", godotProfile: "godot.canvasitem",
  previewConfig: { mode: "2d", sprite: true, lighting: { lit: "lit", azimuth: 35, elevation: 40, intensity: 1.2 }, background: { mode: "dark" } },
});

function build(): Sample {
  const s = new Sample({ id: meta.id, name: meta.title, profile: "unity.urp.sprite-lit" });
  s.add(
    spriteTexProp(),
    P.color("tint", "Tint", { default: [1, 1, 1], tooltip: "Colour multiplied onto the sprite (sRGB).", category: "Sprite" }),
    P.float("strength", "Relief Strength", { default: 2.5, min: -6, max: 6, tooltip: "Bump height. Negative values invert the relief (dark = high); 0 = flat.", category: "Relief" }),
    P.float("contrast", "Height Contrast", { default: 1.4, min: 0.2, max: 4, tooltip: "Contrast of the luminance before it becomes height: higher = deeper grooves.", category: "Relief" }),
    P.float("heightScale", "Detail Scale", { default: 1, min: 0.25, max: 4, tooltip: "Scales the sampling distance of the slope: higher = broader, softer relief.", category: "Relief" }),
    P.bool("showNormals", "Show Normals", { default: false, tooltip: "Debug: output the packed normal (RGB) instead of the sprite colour.", category: "Debug" }),
  );
  s.texture(SPRITE_PROP_ID, "brick", brickTextures(128, 7).albedo);

  const i = s.block("inputs", "Inputs", "Sprite UV and the sprite texture.", { col: 0, color: COLORS.blue });
  i.n("uv", "uv", {});
  i.n("tex", "spriteTexture", { params: { outside: "transparent" } });
  s.w("uv.out", "tex.uv").w(i.po(SPRITE_PROP_ID), "tex.tex");

  const h = s.block("height", "Luminance → height", "`luma` (Rec. 709) of the sprite colour is the height; `saturate((luma − ½) × contrast + ½)` widens the range so mortar lines, rivets and shading become real grooves.", { col: 1, row: 0, color: COLORS.green });
  h.n("gray", "colorGrayscale", {});
  h.n("c0", "subtract", { values: { b: 0.5 } });
  h.n("c1", "multiply", {});
  h.n("c2", "add", { values: { b: 0.5 } });
  h.n("ht", "saturate", {});
  s.w("tex.rgba", "gray.in").w("gray.luma", "c0.a").w("c0.out", "c1.a").w(h.po("contrast"), "c1.b").w("c1.out", "c2.a").w("c2.out", "ht.in");

  const n = s.block("normal", "Height To Normal", "The **Height To Normal** node (*derivative* quality) turns `dHeight/dx, dHeight/dy` into a tangent-space normal `normalize(−slope·strength, 1)`. *Packed* = `normal × ½ + ½` for the debug view. Output goes to the profile's **Normal (Tangent Space)** slot, which the 2D Lights shade.", { col: 2, row: 0, color: COLORS.cyan });
  n.n("hn", "heightToNormal", { params: { quality: "derivative" } });
  s.w("ht.out", "hn.height").w("uv.out", "hn.uv").w(n.po("strength"), "hn.strength").w(n.po("heightScale"), "hn.scale");

  const c = s.block("color", "Colour + debug view", "Sprite colour × tint; with *Show Normals* the packed normal replaces it (blue = facing the viewer).", { col: 2, row: 1, color: COLORS.orange });
  c.n("col", "multiply", {});
  c.n("dbg", "branch", {});
  s.w("tex.rgb", "col.a").w(c.po("tint"), "col.b").w(c.po("showNormals"), "dbg.predicate").w("hn.packed", "dbg.true").w("col.out", "dbg.false");

  const o = s.block("out", "Master output (URP Sprite Lit)", "Base colour, alpha and the generated tangent-space normal.", { col: 3, color: COLORS.violet });
  s.master(o);
  s.w("dbg.out", "master.baseColor").w("tex.a", "master.alpha").w("hn.normal", "master.normalTS");
  return s;
}
export const normalLitSample: SampleModule = { meta, build };
