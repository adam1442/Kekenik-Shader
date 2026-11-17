import { COLORS } from "../build/canvas";
import { P, Sample } from "../build/dsl";
import type { SampleModule } from "../build/emit";
import { slimeSprite } from "../textures/gen";
import { ALL_TARGETS, defineMeta } from "../3d/common";
import { SPRITE_PROFILE, SPRITE_PROP_ID, spriteTexProp } from "./common";

const meta = defineMeta({
  id: "sprite-shine-sweep", title: "Shine Sweep",
  description: "A glossy diagonal band sweeps across the sprite on a timer with a configurable pause between sweeps, masked to the silhouette. Use the manual progress slider to trigger it from gameplay instead of the clock.",
  tags: ["shine", "sweep", "glint", "sprite", "2d", "ui"], category: "2D / Sprites", difficulty: "Beginner", targets: ALL_TARGETS,
  compatNotes: ["The band travels across the 0…1 UV square of the sprite; for sprites packed in an atlas, feed per-sprite 0…1 UVs (UV node, Sprite Sheet nodes)."],
  requiredFeatures: [], budgetClass: "Mobile", godotProfile: "godot.canvasitem",
  previewConfig: { mode: "2d", sprite: true, background: { mode: "dark" } },
});

function build(): Sample {
  const s = new Sample({ id: meta.id, name: meta.title, profile: SPRITE_PROFILE });
  s.add(
    spriteTexProp(),
    P.bool("auto", "Auto Animate", { default: true, tooltip: "On = the band sweeps on a timer; off = Manual Progress is used.", category: "Timing" }),
    P.float("manual", "Manual Progress", { default: 0.5, min: 0, max: 1, tooltip: "Band position when Auto Animate is off (0 = before the sprite, 1 = past it).", category: "Timing" }),
    P.float("period", "Sweep Duration", { default: 1.6, min: 0.2, max: 6, tooltip: "Seconds one sweep takes.", category: "Timing" }),
    P.float("pause", "Pause Between Sweeps", { default: 1.2, min: 0, max: 4, tooltip: "Idle time between sweeps, as a multiple of the sweep duration.", category: "Timing" }),
    P.float("angle", "Angle", { default: 30, min: -90, max: 90, tooltip: "Direction the band travels, in degrees (0 = left → right).", category: "Band" }),
    P.float("width", "Width", { default: 0.28, min: 0.02, max: 1, tooltip: "Width of the band (UV units).", category: "Band" }),
    P.float("softness", "Softness", { default: 0.1, min: 0, max: 0.5, tooltip: "Feathering of the band edges.", category: "Band" }),
    P.float("intensity", "Intensity", { default: 1.4, min: 0, max: 5, tooltip: "Brightness of the band (HDR; > 1 blooms).", category: "Band" }),
    P.color("tint", "Shine Color", { default: [1, 0.95, 0.8], hdr: true, tooltip: "Colour of the band (linear HDR).", category: "Band" }),
  );
  s.texture(SPRITE_PROP_ID, "slime-sprite", slimeSprite(64, false));

  const src = s.block("src", "Sprite", "Plain sprite fetch.", { col: 0, color: COLORS.blue });
  src.n("uv", "uv", {});
  src.n("sprite", "sampleTexture2D", {});
  s.w(src.po(SPRITE_PROP_ID), "sprite.tex").w("uv.out", "sprite.uv");

  const t = s.block("timing", "Sweep timing", "`auto = fract(time / duration) × (1 + pause)`. Progress above 1 is clamped by the shine node, which is exactly the idle phase between sweeps. **Auto Animate** picks between this and the manual slider.", { col: 1, color: COLORS.green });
  t.n("time", "time", {});
  t.n("phase", "divide", {});
  t.n("cycle", "fract", {});
  t.n("span", "add", { values: { b: 1 } });
  t.n("auto", "multiply", {});
  t.n("pick", "lerp", {});
  s.w("time.time", "phase.a").w(t.po("period"), "phase.b").w("phase.out", "cycle.in").w(t.po("pause"), "span.a").w("cycle.out", "auto.a").w("span.out", "auto.b")
    .w(t.po("manual"), "pick.a").w("auto.out", "pick.b").w(t.po("auto"), "pick.t");

  const sh = s.block("shine", "Shine band", "The **Shine Sweep** node outputs the band mask and a tinted, intensity-scaled colour.", { col: 2, color: COLORS.yellow });
  sh.n("band", "shineSweep", { params: { loop: false } });
  s.w("uv.out", "band.uv").w("pick.out", "band.progress").w(sh.po("width"), "band.width").w(sh.po("softness"), "band.softness").w(sh.po("angle"), "band.angle")
    .w(sh.po("intensity"), "band.intensity").w(sh.po("tint"), "band.tint");

  const c = s.block("comp", "Mask to sprite", "`colour = sprite + band × sprite alpha` — the glint never leaks onto transparent pixels.", { col: 3, color: COLORS.orange });
  c.n("masked", "multiply", {});
  c.n("col", "add", {});
  s.w("band.color", "masked.a").w("sprite.a", "masked.b").w("sprite.rgb", "col.a").w("masked.out", "col.b");

  const out = s.block("out", "Master output (URP Sprite Unlit)", "Colour with glint, original alpha.", { col: 4, color: COLORS.violet });
  s.master(out);
  s.w("col.out", "master.baseColor").w("sprite.a", "master.alpha");
  return s;
}
export const shineSweepSample: SampleModule = { meta, build };
