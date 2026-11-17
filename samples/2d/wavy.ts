import { COLORS } from "../build/canvas";
import { P, Sample } from "../build/dsl";
import type { SampleModule } from "../build/emit";
import { slimeSprite } from "../textures/gen";
import { ALL_TARGETS, defineMeta } from "../3d/common";
import { SPRITE_PROFILE, SPRITE_PROP_ID, spriteTexProp } from "./common";

const meta = defineMeta({
  id: "sprite-wavy-shake", title: "Wavy Sway + Shake",
  description: "UV displacement for sprites: a travelling sine wave sways the sprite (flags, banners, plants, underwater look) with an optional bottom anchor so the base stays put, and a stepped random shake jolts the whole sprite for hit reactions. Samples outside the sprite are transparent, so nothing smears at the border.",
  tags: ["wave", "sway", "shake", "uv-displacement", "flag", "hit-reaction", "sprite", "2d"], category: "2D / Sprites", difficulty: "Beginner", targets: ALL_TARGETS,
  compatNotes: ["Displacement moves pixels inside the quad: keep transparent padding around the sprite of at least Wave Amount × sprite size (Full Rect mesh type), otherwise the quad clips the motion.", "Drive Shake Amount from gameplay (damage) and ease it back to 0; the shake pattern jumps Shake Rate times per second, so it is deterministic and never blurs."],
  requiredFeatures: [], budgetClass: "Mobile", godotProfile: "godot.canvasitem",
  previewConfig: { mode: "2d", sprite: true, background: { mode: "checker" } },
});

function build(): Sample {
  const s = new Sample({ id: meta.id, name: meta.title, profile: SPRITE_PROFILE });
  s.add(
    spriteTexProp(),
    P.color("tint", "Tint", { default: [1, 1, 1], tooltip: "Colour multiplied onto the sprite (sRGB).", category: "Sprite" }),
    P.float("amount", "Wave Amount", { default: 0.025, min: 0, max: 0.1, tooltip: "Maximum sideways displacement of the wave (UV units).", category: "Wave" }),
    P.float("frequency", "Wave Frequency", { default: 3, min: 0.5, max: 12, tooltip: "Number of wave crests across the sprite height.", category: "Wave" }),
    P.float("speed", "Wave Speed", { default: 3, min: 0, max: 10, tooltip: "Travel speed of the wave in radians per second; a negative value reverses the direction.", category: "Wave" }),
    P.float("vertical", "Vertical Wobble", { default: 0.4, min: 0, max: 1, tooltip: "Share of the amount applied vertically (a second wave across the width).", category: "Wave" }),
    P.float("anchor", "Bottom Anchor", { default: 0.8, min: 0, max: 1, tooltip: "0 = the whole sprite sways equally, 1 = the base (V = 0) stays still and the top sways most.", category: "Wave" }),
    P.float("anchorPower", "Anchor Falloff", { default: 1.5, min: 0.5, max: 4, tooltip: "Curve of the anchor weight: higher = more of the lower part stays calm.", category: "Wave" }),
    P.float("shake", "Shake Amount", { default: 0.006, min: 0, max: 0.05, tooltip: "Distance of the random jolt in UV units (0 = off). Drive it from gameplay.", category: "Shake" }),
    P.float("shakeRate", "Shake Rate", { default: 24, min: 4, max: 60, tooltip: "How many times per second the shake direction changes.", category: "Shake" }),
    P.float("seed", "Shake Seed", { default: 5, min: 0, max: 100, tooltip: "Selects a different random shake sequence per sprite.", category: "Shake" }),
  );
  s.texture(SPRITE_PROP_ID, "slime", slimeSprite(96, false));

  const i = s.block("inputs", "Inputs", "Sprite UV and time.", { col: 0, color: COLORS.blue });
  i.n("uv", "uv", {});
  i.n("us", "split", {});
  i.n("t", "time", {});
  s.w("uv.out", "us.in");

  const w = s.block("wave", "Travelling wave + anchor", "`dx = sin(v·freq·2π + t·speed) · amount · weight` shifts every row sideways; a second wave across the width (`dy`) wobbles vertically. The weight `lerp(1, v^falloff, anchor)` is 0 at the base, so a flag or plant stays attached to the ground.", { col: 1, row: 0, color: COLORS.cyan });
  w.n("f1", "multiply", {});
  w.n("p1", "multiply", { values: { b: 6.2832 } });
  w.n("ts", "multiply", {});
  w.n("a1", "add", {});
  w.n("s1", "sin", {});
  w.n("f2", "multiply", {});
  w.n("p2", "multiply", { values: { b: 6.2832 } });
  w.n("ts2", "multiply", { values: { b: 1.3 } });
  w.n("a2", "add", {});
  w.n("s2", "sin", {});
  w.n("pw", "power", {});
  w.n("wg", "lerp", { values: { a: 1 } });
  w.n("am", "multiply", {});
  w.n("dx", "multiply", {});
  w.n("dy0", "multiply", {});
  w.n("dy", "multiply", {});
  w.n("off", "combine", {});
  s.w("us.g", "f1.a").w(w.po("frequency"), "f1.b").w("f1.out", "p1.a").w("t.time", "ts.a", "Time").w(w.po("speed"), "ts.b").w("p1.out", "a1.a").w("ts.out", "a1.b").w("a1.out", "s1.in")
    .w("us.r", "f2.a").w(w.po("frequency"), "f2.b").w("f2.out", "p2.a").w("ts.out", "ts2.a").w("p2.out", "a2.a").w("ts2.out", "a2.b").w("a2.out", "s2.in")
    .w("us.g", "pw.a").w(w.po("anchorPower"), "pw.b").w("pw.out", "wg.b").w(w.po("anchor"), "wg.t").w(w.po("amount"), "am.a").w("wg.out", "am.b")
    .w("s1.out", "dx.a").w("am.out", "dx.b").w("s2.out", "dy0.a").w("am.out", "dy0.b").w("dy0.out", "dy.a").w(w.po("vertical"), "dy.b").w("dx.out", "off.r").w("dy.out", "off.g");

  const k = s.block("shake", "Stepped shake", "`step = floor(t·rate)`; a hash of `(step, seed)` gives a random direction in (−1…1)², scaled by *Shake Amount*. The value is constant within a step, so the sprite jolts instead of blurring.", { col: 1, row: 1, color: COLORS.red });
  k.n("tr", "multiply", {});
  k.n("st", "floor", {});
  k.n("key", "combine", {});
  k.n("h", "hash2to2", {});
  k.n("c", "subtract", { values: { b: 0.5 } });
  k.n("c2", "multiply", { values: { b: 2 } });
  k.n("sh", "multiply", {});
  s.w("t.time", "tr.a", "Time").w(k.po("shakeRate"), "tr.b").w("tr.out", "st.in").w("st.out", "key.r").w(k.po("seed"), "key.g").w("key.rg", "h.in").w("h.out", "c.a").w("c.out", "c2.a").w("c2.out", "sh.a").w(k.po("shake"), "sh.b");

  const m = s.block("sample", "Displaced sample", "`uv' = uv + wave + shake`. The **Sprite Texture** node with *Outside: transparent* returns alpha 0 for UVs outside 0…1, so the sprite never smears its border pixels.", { col: 2, color: COLORS.orange });
  m.n("u1", "add", {});
  m.n("u2", "add", {});
  m.n("tex", "spriteTexture", { params: { outside: "transparent" } });
  m.n("col", "multiply", {});
  s.w("uv.out", "u1.a").w("off.rg", "u1.b").w("u1.out", "u2.a").w("sh.out", "u2.b").w(m.po(SPRITE_PROP_ID), "tex.tex").w("u2.out", "tex.uv").w("tex.rgb", "col.a").w(m.po("tint"), "col.b");

  const o = s.block("out", "Master output (URP Sprite Unlit)", "Displaced colour and alpha.", { col: 3, color: COLORS.violet });
  s.master(o);
  s.w("col.out", "master.baseColor").w("tex.a", "master.alpha");
  return s;
}
export const wavyShakeSample: SampleModule = { meta, build };
