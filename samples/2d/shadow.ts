import { COLORS } from "../build/canvas";
import { P, Sample } from "../build/dsl";
import type { SampleModule } from "../build/emit";
import { slimeSprite } from "../textures/gen";
import { ALL_TARGETS, defineMeta } from "../3d/common";
import { SPRITE_PROFILE, SPRITE_PROP_ID, spriteTexProp } from "./common";

const meta = defineMeta({
  id: "sprite-silhouette-shadow", title: "Silhouette + Drop Shadow",
  description: "Two sprite effects from the alpha channel: a soft drop shadow (offset, flattened towards a ground line, blurred with a 5-tap cross) drawn behind the sprite, and a silhouette switch that replaces the sprite colours with one flat colour (occlusion outlines, hit marks, hidden-unit indicators).",
  tags: ["shadow", "drop-shadow", "silhouette", "blur", "alpha", "sprite", "2d"], category: "2D / Sprites", difficulty: "Intermediate", targets: ALL_TARGETS,
  compatNotes: ["Needs transparent padding where the shadow falls (offset + blur reach) — the quad clips it otherwise (Full Rect mesh type).", "Five texture fetches per pixel. The shadow is built in the same pass as the sprite, so it needs no extra geometry or sorting; Flatten < 1 squashes it towards the Ground Line for a cast-on-the-floor look."],
  requiredFeatures: [], budgetClass: "Mobile", godotProfile: "godot.canvasitem",
  previewConfig: { mode: "2d", sprite: true, background: { mode: "light" } },
});

function build(): Sample {
  const s = new Sample({ id: meta.id, name: meta.title, profile: SPRITE_PROFILE });
  s.add(
    spriteTexProp(),
    P.color("shadowColor", "Shadow Color", { default: [0.04, 0.03, 0.1], tooltip: "Colour of the shadow (sRGB).", category: "Shadow" }),
    P.float("shadowOpacity", "Shadow Opacity", { default: 0.6, min: 0, max: 1, tooltip: "Maximum opacity of the shadow.", category: "Shadow" }),
    P.vec2("offset", "Shadow Offset", { default: [0.05, -0.06], tooltip: "Shadow position relative to the sprite, in UV units (+x right, +y up).", category: "Shadow" }),
    P.float("blur", "Shadow Blur", { default: 0.012, min: 0, max: 0.04, tooltip: "Radius of the 5-tap blur in UV units (0 = hard shadow).", category: "Shadow" }),
    P.float("flatten", "Flatten", { default: 0.55, min: 0.2, max: 1, tooltip: "Vertical scale of the shadow around the Ground Line: 1 = unchanged, lower = squashed onto the floor.", category: "Shadow" }),
    P.float("ground", "Ground Line", { default: 0.2, min: 0, max: 1, tooltip: "V coordinate (0 = bottom of the sprite) the shadow is squashed towards.", category: "Shadow" }),
    P.float("silhouette", "Silhouette", { default: 0, min: 0, max: 1, tooltip: "0 = normal sprite, 1 = flat silhouette colour. Drive it from gameplay.", category: "Silhouette" }),
    P.color("silhouetteColor", "Silhouette Color", { default: [0.95, 0.2, 0.35], tooltip: "Flat colour of the silhouette (sRGB).", category: "Silhouette" }),
  );
  s.texture(SPRITE_PROP_ID, "slime", slimeSprite(96, false));

  const i = s.block("inputs", "Inputs", "Sprite UV and the sprite itself.", { col: 0, color: COLORS.blue });
  i.n("uv", "uv", {});
  i.n("us", "split", {});
  s.w("uv.out", "us.in");

  const m = s.block("main", "Sprite + silhouette", "The sprite is sampled normally (*Outside: transparent*). The silhouette is `lerp(sprite colour, silhouette colour, amount)`: alpha is untouched, so the outline of the shape is exactly the sprite's.", { col: 1, row: 0, color: COLORS.green });
  m.n("tex", "spriteTexture", { params: { outside: "transparent" } });
  m.n("sil", "lerp", {});
  s.w("uv.out", "tex.uv").w(m.po(SPRITE_PROP_ID), "tex.tex").w("tex.rgb", "sil.a").w(m.po("silhouetteColor"), "sil.b").w(m.po("silhouette"), "sil.t");

  const sh = s.block("shadow", "Shadow UV (offset + flatten)", "`p = uv − offset`, then the V axis is stretched around the ground line: `p.y' = g + (p.y − g) / flatten`. Reading the sprite at a stretched coordinate draws it squashed by *Flatten* — a shadow lying on the floor.", { col: 1, row: 1, color: COLORS.cyan });
  sh.n("p", "subtract", {});
  sh.n("ps", "split", {});
  sh.n("dy", "subtract", {});
  sh.n("dv", "divide", {});
  sh.n("py", "add", {});
  sh.n("puv", "combine", {});
  s.w("uv.out", "p.a").w(sh.po("offset"), "p.b").w("p.out", "ps.in").w("ps.g", "dy.a").w(sh.po("ground"), "dy.b").w("dy.out", "dv.a").w(sh.po("flatten"), "dv.b").w("dv.out", "py.a").w(sh.po("ground"), "py.b")
    .w("ps.r", "puv.r").w("py.out", "puv.g");

  const bl = s.block("blur", "5-tap blur of the alpha", "The shadow alpha is the average of the sprite alpha at the centre and four taps `±blur` along x and y. Cheap, and plenty soft for a small radius; raise *Blur* only up to a few texels.", { col: 2, row: 1, color: COLORS.orange });
  bl.n("nb", "negate", {});
  s.w(bl.po("blur"), "nb.in");
  const dirs: Array<[string, "r" | "g", boolean]> = [["e", "r", false], ["w", "r", true], ["n", "g", false], ["s", "g", true]];
  bl.n("t0", "spriteTexture", { params: { outside: "transparent" } });
  s.w("puv.rg", "t0.uv").w(bl.po(SPRITE_PROP_ID), "t0.tex");
  for (const [k, ch, neg] of dirs) {
    bl.n(`of_${k}`, "combine", {});
    bl.n(`uu_${k}`, "add", {});
    bl.n(`tt_${k}`, "spriteTexture", { params: { outside: "transparent" } });
    s.w(neg ? "nb.out" : bl.po("blur"), `of_${k}.${ch}`).w("puv.rg", `uu_${k}.a`).w(`of_${k}.rg`, `uu_${k}.b`).w(`uu_${k}.out`, `tt_${k}.uv`).w(bl.po(SPRITE_PROP_ID), `tt_${k}.tex`);
  }
  bl.n("sum1", "add", {});
  bl.n("sum2", "add", {});
  bl.n("sum3", "add", {});
  bl.n("sum4", "add", {});
  bl.n("avg", "multiply", { values: { b: 0.2 } });
  bl.n("sa", "multiply", {});
  s.w("t0.a", "sum1.a").w("tt_e.a", "sum1.b").w("sum1.out", "sum2.a").w("tt_w.a", "sum2.b").w("sum2.out", "sum3.a").w("tt_n.a", "sum3.b").w("sum3.out", "sum4.a").w("tt_s.a", "sum4.b").w("sum4.out", "avg.a")
    .w("avg.out", "sa.a").w(bl.po("shadowOpacity"), "sa.b");

  const c = s.block("compose", "Sprite over shadow", "Standard over-operator: `alpha = a + shadow × (1 − a)`; colour = `lerp(shadow colour, sprite colour, a)`.", { col: 3, color: COLORS.yellow });
  c.n("inv", "oneMinus", {});
  c.n("sw", "multiply", {});
  c.n("al", "add", {});
  c.n("col", "lerp", {});
  s.w("tex.a", "inv.in").w("sa.out", "sw.a").w("inv.out", "sw.b").w("tex.a", "al.a").w("sw.out", "al.b").w(c.po("shadowColor"), "col.a").w("sil.out", "col.b").w("tex.a", "col.t");

  const o = s.block("out", "Master output (URP Sprite Unlit)", "Composited colour and alpha.", { col: 4, color: COLORS.violet });
  s.master(o);
  s.w("col.out", "master.baseColor").w("al.out", "master.alpha");
  return s;
}
export const silhouetteShadowSample: SampleModule = { meta, build };
