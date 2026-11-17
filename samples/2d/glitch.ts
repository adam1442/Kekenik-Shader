import { COLORS } from "../build/canvas";
import { P, Sample } from "../build/dsl";
import type { SampleModule } from "../build/emit";
import { retroScene } from "../textures/gen-fx";
import { ALL_TARGETS, defineMeta } from "../3d/common";
import { SPRITE_PROFILE, SPRITE_PROP_ID, spriteTexProp } from "./common";

const meta = defineMeta({
  id: "sprite-glitch", title: "Digital Glitch",
  description: "Horizontal band glitch that jumps a few times per second: random bands slide sideways, split into red / blue ghosts along the slide direction, flash inverted colours and sprinkle static. Deterministic per time step and seed, so it can be driven from gameplay.",
  tags: ["glitch", "digital", "chromatic-aberration", "bands", "static", "damage", "2d"], category: "2D / Sprites", difficulty: "Intermediate", targets: ALL_TARGETS,
  compatNotes: ["Drive Intensity from gameplay (damage, hacking) for hit reactions — at 0 the sprite is untouched.", "Pattern changes Glitch Rate times per second; the Seed picks a different sequence per sprite."],
  requiredFeatures: [], budgetClass: "Mobile", godotProfile: "godot.canvasitem",
  previewConfig: { mode: "2d", sprite: true, background: { mode: "dark" } },
});

function build(): Sample {
  const s = new Sample({ id: meta.id, name: meta.title, profile: SPRITE_PROFILE });
  s.add(
    spriteTexProp(),
    P.float("intensity", "Intensity", { default: 0.55, min: 0, max: 1, tooltip: "Share of bands that glitch at any moment (0 = off).", category: "Glitch" }),
    P.float("amount", "Slide Distance", { default: 0.08, min: 0, max: 0.3, tooltip: "Maximum horizontal displacement of a band (UV units).", category: "Glitch" }),
    P.float("bands", "Band Count", { default: 18, min: 4, max: 64, step: 1, tooltip: "Horizontal bands the sprite is cut into.", category: "Glitch" }),
    P.float("rate", "Glitch Rate", { default: 7, min: 1, max: 30, tooltip: "How many times per second the pattern jumps.", category: "Glitch" }),
    P.float("seed", "Seed", { default: 3, min: 0, max: 100, tooltip: "Selects a different random sequence.", category: "Glitch" }),
    P.float("aberration", "Colour Split", { default: 0.03, min: 0, max: 0.12, tooltip: "Red / blue ghost distance inside glitching bands.", category: "Colour" }),
    P.float("invertChance", "Invert Chance", { default: 0.3, min: 0, max: 1, tooltip: "Share of glitching bands that flash inverted colours.", category: "Colour" }),
    P.float("staticAmount", "Static", { default: 0.25, min: 0, max: 1, tooltip: "Brightness of the noise sprinkled inside glitching bands.", category: "Colour" }),
  );
  s.texture(SPRITE_PROP_ID, "retro-scene", retroScene(128, 128));

  const g = s.block("band", "Band displacement", "The **Glitch** node cuts V into bands; per (band, time step) a hash decides whether the band is active (*mask*) and how far it slides. The pattern is constant within a step and jumps *Rate* times per second.", { col: 0, color: COLORS.red });
  g.n("uv", "uv", {});
  g.n("t", "time", {});
  g.n("gl", "glitch", {});
  s.w("uv.out", "gl.uv").w("t.time", "gl.time", "Time").w(g.po("seed"), "gl.seed").w(g.po("intensity"), "gl.intensity").w(g.po("amount"), "gl.amount").w(g.po("bands"), "gl.bands").w(g.po("rate"), "gl.rate");

  const c = s.block("split", "Colour split", "Chromatic Aberration in *directional* mode (along x): strength = `split × (0.25 + mask)` — a small constant fringe everywhere, a big one inside active bands.", { col: 1, row: 0, color: COLORS.cyan });
  c.n("m", "add", { values: { b: 0.25 } });
  c.n("st", "multiply", {});
  c.n("ca", "chromaticAberration", { params: { mode: "directional" } });
  c.n("sp", "split", {});
  c.n("rgb", "combine", {});
  s.w("gl.mask", "m.a").w("m.out", "st.a").w(c.po("aberration"), "st.b").w(c.po(SPRITE_PROP_ID), "ca.tex").w("gl.uv", "ca.uv", "GlitchUV").w("st.out", "ca.strength").w("ca.rgba", "sp.in")
    .w("sp.r", "rgb.r").w("sp.g", "rgb.g").w("sp.b", "rgb.b");

  const k = s.block("flash", "Inversion flashes + static", "A second hash `h(band, step)` selects the bands that flash inverted (`h > 1 − chance`, only where the band is active). Static = per-texel hash of `floor(uv × 96) + step` × mask × amount, added on top.", { col: 1, row: 1, color: COLORS.yellow });
  k.n("us", "split", {});
  k.n("band", "multiply", {});
  k.n("bi", "floor", {});
  k.n("tr", "multiply", {});
  k.n("ti", "floor", {});
  k.n("key", "combine", {});
  k.n("hb", "hash2to1", {});
  k.n("thr", "oneMinus", {});
  k.n("hit", "step", {});
  k.n("flash", "multiply", {});
  k.n("cell", "multiply", { values: { b: 96 } });
  k.n("cf", "floor", {});
  k.n("tcell", "add", {});
  k.n("sn", "hash2to1", {});
  k.n("stat0", "multiply", {});
  k.n("stat", "multiply", {});
  s.w("uv.out", "us.in").w("us.g", "band.a").w(k.po("bands"), "band.b").w("band.out", "bi.in").w("t.time", "tr.a").w(k.po("rate"), "tr.b").w("tr.out", "ti.in")
    .w("bi.out", "key.r").w("ti.out", "key.g").w("key.rg", "hb.in").w(k.po("invertChance"), "thr.in").w("thr.out", "hit.edge").w("hb.out", "hit.in").w("hit.out", "flash.a").w("gl.mask", "flash.b")
    .w("uv.out", "cell.a").w("cell.out", "cf.in").w("cf.out", "tcell.a").w("key.rg", "tcell.b").w("tcell.out", "sn.in").w("sn.out", "stat0.a").w("gl.mask", "stat0.b").w("stat0.out", "stat.a").w(k.po("staticAmount"), "stat.b");

  const m = s.block("mix", "Combine", "`colour = lerp(colour, 1 − colour, flash) + static`. Alpha comes from the displaced sprite, so the silhouette tears together with the colour.", { col: 2, color: COLORS.orange });
  m.n("inv", "oneMinus", {});
  m.n("lr", "lerp", {});
  m.n("add", "add", {});
  s.w("rgb.rgb", "inv.in").w("rgb.rgb", "lr.a").w("inv.out", "lr.b").w("flash.out", "lr.t").w("lr.out", "add.a").w("stat.out", "add.b");

  const o = s.block("out", "Master output (URP Sprite Unlit)", "Glitched colour and displaced alpha.", { col: 3, color: COLORS.violet });
  s.master(o);
  s.w("add.out", "master.baseColor").w("sp.a", "master.alpha");
  return s;
}
export const glitchSample: SampleModule = { meta, build };
