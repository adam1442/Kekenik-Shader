import { COLORS } from "../build/canvas";
import { P, Sample } from "../build/dsl";
import type { SampleModule } from "../build/emit";
import { ALL_TARGETS, defineMeta } from "../3d/common";
import { GODOT_VFX, VFX_PROFILE, envelope } from "./common";

const meta = defineMeta({
  id: "vfx-glow-orb", title: "Glow Orb",
  description: "Additive energy orb on a billboard quad. A fake sphere normal is rebuilt from the quad UV: a white-hot HDR core and a coloured halo follow the facing ratio, a thin fresnel ring accents the silhouette, and a per-particle phase pulses the brightness.",
  tags: ["orb", "glow", "hdr", "fresnel", "pulse", "additive", "particles", "vfx"], category: "VFX / Particles", difficulty: "Beginner", targets: ALL_TARGETS,
  compatNotes: ["HDR colours are linear and need a Bloom post effect to glow (Unity: Volume → Bloom; Godot: Environment → Glow).", "Particle colour multiplies the result and its alpha fades the orb, so Color over Lifetime still works; the per-particle random number offsets the pulse phase."],
  requiredFeatures: [], budgetClass: "Mobile", godotProfile: GODOT_VFX,
  previewConfig: {
    mode: "vfx", mesh: "quad", background: { mode: "dark", ground: "none" },
    emitter: { rate: 2.5, lifetime: 4, lifetimeVar: 0, sizeStart: 1.4, sizeEnd: 1.4, speed: 0.15, spread: 25, gravity: [0, 0, 0], maxParticles: 8, colorOverLife: envelope(1, 0.12) },
  },
});

function build(): Sample {
  const s = new Sample({ id: meta.id, name: meta.title, profile: VFX_PROFILE, settings: { blend: "additive", zwrite: "off", cull: "off" } });
  s.add(
    P.color("coreColor", "Core Color", { default: [6, 5.2, 3.2], hdr: true, tooltip: "HDR colour of the white-hot centre (linear; values above 1 bloom).", category: "Color" }),
    P.color("glowColor", "Glow Color", { default: [0.25, 0.9, 3.5], hdr: true, tooltip: "HDR colour of the halo around the core (linear).", category: "Color" }),
    P.float("intensity", "Intensity", { default: 1, min: 0, max: 4, tooltip: "Overall brightness multiplier.", category: "Color" }),
    P.float("corePower", "Core Tightness", { default: 14, min: 2, max: 60, tooltip: "Facing-ratio exponent of the core: higher = smaller white-hot spot.", category: "Shape" }),
    P.float("haloPower", "Halo Falloff", { default: 2.2, min: 0.5, max: 8, tooltip: "Facing-ratio exponent of the halo: higher = tighter glow.", category: "Shape" }),
    P.float("rimPower", "Rim Power", { default: 3, min: 1, max: 10, tooltip: "Fresnel exponent of the silhouette ring: higher = thinner ring.", category: "Rim" }),
    P.float("rimGain", "Rim Gain", { default: 0.5, min: 0, max: 3, tooltip: "Brightness of the silhouette ring (0 = off).", category: "Rim" }),
    P.float("pulseAmount", "Pulse Amount", { default: 0.25, min: 0, max: 1, tooltip: "Depth of the brightness pulse (0 = steady).", category: "Pulse" }),
    P.float("pulseSpeed", "Pulse Speed", { default: 3, min: 0, max: 12, tooltip: "Pulse frequency in radians per second.", category: "Pulse" }),
  );

  const i = s.block("inputs", "Particle inputs", "Quad UV, a per-particle random number (pulse phase) and the particle colour / alpha.", { col: 0, color: COLORS.blue });
  i.n("uv", "uv", {});
  i.n("rnd", "particleRandom", {});
  i.n("pc", "particleColor", {});
  i.n("t", "time", {});

  const f = s.block("sphere", "Fake sphere facing ratio", "`r = 2·|uv − ½|` is the distance from the centre (1 at the quad edge). A sphere of radius 1 has `N·V = z = √(1 − r²)` — that is the facing ratio. The halo is `z^haloPower`, the core `z^corePower` (a high power leaves only the centre) and the rim `(1 − z)^rimPower`.", { col: 1, row: 0, color: COLORS.cyan });
  f.n("d", "distance", { values: { b: [0.5, 0.5] } });
  f.n("r", "multiply", { values: { b: 2 } });
  f.n("rs", "saturate", {});
  f.n("rr", "multiply", {});
  f.n("om", "oneMinus", {});
  f.n("z", "sqrt", {});
  f.n("zi", "oneMinus", {});
  f.n("core", "power", {});
  f.n("halo", "power", {});
  f.n("rim0", "power", {});
  f.n("rim", "multiply", {});
  s.w("uv.out", "d.a").w("d.out", "r.a").w("r.out", "rs.in").w("rs.out", "rr.a").w("rs.out", "rr.b").w("rr.out", "om.in").w("om.out", "z.in").w("z.out", "zi.in")
    .w("z.out", "core.a").w(f.po("corePower"), "core.b").w("z.out", "halo.a").w(f.po("haloPower"), "halo.b").w("zi.out", "rim0.a").w(f.po("rimPower"), "rim0.b").w("rim0.out", "rim.a").w(f.po("rimGain"), "rim.b");

  const p = s.block("pulse", "Pulse", "`pulse = 1 + amount · sin(time · speed + random · 2π)` — the random phase keeps several orbs from beating in unison.", { col: 1, row: 1, color: COLORS.yellow });
  p.n("ph", "multiply", { values: { b: 6.2832 } });
  p.n("ts", "multiply", {});
  p.n("arg", "add", {});
  p.n("sn", "sin", {});
  p.n("am", "multiply", {});
  p.n("pulse", "add", { values: { a: 1 } });
  s.w("rnd.value", "ph.a").w("t.time", "ts.a", "Time").w(p.po("pulseSpeed"), "ts.b").w("ts.out", "arg.a").w("ph.out", "arg.b").w("arg.out", "sn.in").w("sn.out", "am.a").w(p.po("pulseAmount"), "am.b").w("am.out", "pulse.b");

  const c = s.block("color", "Colour + alpha", "`colour = lerp(glow, core, core mask) × (halo + rim) × pulse × intensity × particle colour`. The quad edge is faded with `1 − smoothstep(0.8, 1, r)` so the square never shows.", { col: 2, color: COLORS.orange });
  c.n("body", "add", {});
  c.n("mixc", "lerp", {});
  c.n("lit", "multiply", {});
  c.n("pl", "multiply", {});
  c.n("it", "multiply", {});
  c.n("tint", "multiply", {});
  c.n("ef", "smoothstep", { values: { edge1: 0.8, edge2: 1 } });
  c.n("em", "oneMinus", {});
  c.n("al", "multiply", {});
  s.w("halo.out", "body.a").w("rim.out", "body.b").w(c.po("glowColor"), "mixc.a").w(c.po("coreColor"), "mixc.b").w("core.out", "mixc.t").w("mixc.out", "lit.a").w("body.out", "lit.b")
    .w("lit.out", "pl.a").w("pulse.out", "pl.b").w("pl.out", "it.a").w(c.po("intensity"), "it.b").w("it.out", "tint.a").w("pc.rgb", "tint.b")
    .w("rs.out", "ef.in", "EdgeR").w("ef.out", "em.in").w("em.out", "al.a").w("pc.a", "al.b");

  const o = s.block("out", "Master output (URP VFX Unlit, additive)", "Additive blend, ZWrite off, two-sided. Alpha scales the additive contribution.", { col: 3, color: COLORS.violet });
  s.master(o);
  s.w("tint.out", "master.baseColor").w("al.out", "master.alpha");
  return s;
}
export const glowOrbSample: SampleModule = { meta, build };
