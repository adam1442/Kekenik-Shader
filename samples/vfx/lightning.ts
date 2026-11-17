import { COLORS } from "../build/canvas";
import { P, Sample } from "../build/dsl";
import type { SampleModule } from "../build/emit";
import { ALL_TARGETS, defineMeta } from "../3d/common";
import { GODOT_VFX, VFX_PROFILE, envelope } from "./common";

const meta = defineMeta({
  id: "vfx-lightning", title: "Lightning Bolt",
  description: "Animated lightning on a billboard quad. A signed 1-D value noise displaces a horizontal line, pinned to zero at both ends; a second, finer displacement forms a branch. Each time step re-seeds the noise so the bolt jumps, a hash flickers it and a sawtooth flash decays between strikes. Core and glow are HDR.",
  tags: ["lightning", "electric", "noise", "displacement", "flicker", "hdr", "additive", "particles", "vfx"], category: "VFX / Particles", difficulty: "Intermediate", targets: ALL_TARGETS,
  compatNotes: ["The bolt runs along the quad's U axis; rotate / stretch the particle (Stretched Billboard or Rotation over Lifetime) to aim it. Additive, ZWrite off, two-sided; needs Bloom for the HDR glow.", "Jump Rate is the number of different bolt shapes per second (a stepped time, not a continuous one — a smoothly wiggling bolt does not read as lightning)."],
  requiredFeatures: [], budgetClass: "Desktop", godotProfile: GODOT_VFX,
  previewConfig: {
    mode: "vfx", mesh: "quad", background: { mode: "dark", ground: "none" },
    emitter: { rate: 0.6, lifetime: 4, lifetimeVar: 0, sizeStart: 3.2, sizeEnd: 3.2, speed: 0, spread: 0, gravity: [0, 0, 0], maxParticles: 3, colorOverLife: envelope(1, 0.04) },
  },
});

function build(): Sample {
  const s = new Sample({ id: meta.id, name: meta.title, profile: VFX_PROFILE, settings: { blend: "additive", zwrite: "off", cull: "off" } });
  s.add(
    P.float("rate", "Jump Rate", { default: 12, min: 1, max: 30, tooltip: "Different bolt shapes per second.", category: "Motion" }),
    P.float("frequency", "Jag Frequency", { default: 5, min: 1, max: 20, tooltip: "How many bends the bolt has across the quad.", category: "Shape" }),
    P.float("amplitude", "Jag Amplitude", { default: 0.16, min: 0.02, max: 0.35, tooltip: "Maximum sideways displacement (UV units).", category: "Shape" }),
    P.float("branchStrength", "Branch Strength", { default: 0.5, min: 0, max: 1, tooltip: "Brightness of the second, finer bolt (0 = single bolt).", category: "Shape" }),
    P.float("coreWidth", "Core Width", { default: 0.008, min: 0.002, max: 0.03, tooltip: "Half-width of the white-hot core (UV units).", category: "Look" }),
    P.float("glowWidth", "Glow Width", { default: 0.06, min: 0.01, max: 0.2, tooltip: "Reach of the glow around the core (UV units).", category: "Look" }),
    P.float("glowStrength", "Glow Strength", { default: 1, min: 0, max: 3, tooltip: "Brightness of the glow relative to the core.", category: "Look" }),
    P.color("coreColor", "Core Color", { default: [7, 7.5, 10], hdr: true, tooltip: "HDR colour of the core (linear).", category: "Color" }),
    P.color("glowColor", "Glow Color", { default: [0.5, 1.1, 5], hdr: true, tooltip: "HDR colour of the glow (linear).", category: "Color" }),
    P.float("flicker", "Flicker", { default: 0.5, min: 0, max: 1, tooltip: "Random brightness change per time step (0 = steady).", category: "Flash" }),
    P.float("strikePeriod", "Strike Period", { default: 1.1, min: 0.2, max: 3, tooltip: "Seconds between flashes.", category: "Flash" }),
    P.float("flashDecay", "Flash Decay", { default: 2, min: 0.5, max: 6, tooltip: "How fast each flash fades (exponent of the decay curve).", category: "Flash" }),
  );

  const i = s.block("inputs", "Inputs", "Quad UV, time and the particle colour / alpha.", { col: 0, color: COLORS.blue });
  i.n("uv", "uv", {});
  i.n("t", "time", {});
  i.n("pc", "particleColor", {});
  i.n("us", "split", {});
  s.w("uv.out", "us.in");

  const n = s.block("noise", "Stepped noise displacement", "`step = floor(time × rate)` re-seeds the noise: the bolt jumps to a new shape every `1 / rate` s. Signed 1-D value noise along x (`p = (x, ½)`, scale = jag frequency) gives the bend; a second noise at 2.3× frequency adds fine kinks to the branch. The envelope `√(4·x·(1−x))` pins both ends of the bolt to the centre line.", { col: 1, row: 0, color: COLORS.cyan });
  n.n("ts", "multiply", {});
  n.n("stp", "floor", {});
  n.n("sd2", "add", { values: { b: 17 } });
  n.n("pa", "combine", { values: { g: 0.5 } });
  n.n("f2", "multiply", { values: { b: 2.3 } });
  n.n("fbm1", "noiseValue", { params: { dimension: 1, range: "signed" } });
  n.n("fbm2", "noiseValue", { params: { dimension: 1, range: "signed" } });
  n.n("om", "oneMinus", {});
  n.n("e0", "multiply", {});
  n.n("e1", "multiply", { values: { b: 4 } });
  n.n("env", "sqrt", {});
  n.n("a1", "multiply", {});
  n.n("d1", "multiply", {});
  n.n("a2", "multiply", { values: { b: 0.7 } });
  n.n("k2", "multiply", {});
  n.n("k2e", "multiply", {});
  n.n("d2", "add", {});
  s.w("t.time", "ts.a", "Time").w(n.po("rate"), "ts.b").w("ts.out", "stp.in").w("stp.out", "sd2.a").w("us.r", "pa.r").w("pa.rg", "fbm1.p").w(n.po("frequency"), "fbm1.scale").w("stp.out", "fbm1.seed")
    .w(n.po("frequency"), "f2.a").w("pa.rg", "fbm2.p").w("f2.out", "fbm2.scale").w("sd2.out", "fbm2.seed").w("us.r", "om.in").w("us.r", "e0.a").w("om.out", "e0.b").w("e0.out", "e1.a").w("e1.out", "env.in")
    .w(n.po("amplitude"), "a1.a").w("env.out", "a1.b").w("fbm1.out", "d1.a").w("a1.out", "d1.b").w(n.po("amplitude"), "a2.a").w("fbm2.out", "k2.a").w("a2.out", "k2.b").w("k2.out", "k2e.a").w("env.out", "k2e.b").w("d1.out", "d2.a").w("k2e.out", "d2.b");

  const l = s.block("lines", "Distance to the bolts", "`yc = uv.y − ½`; the distance to a bolt is `|yc − displacement|`. Core = `1 − smoothstep(0, width, dist)`; glow = `saturate(1 − dist / glowWidth)²`. The branch uses the second displacement and half the core width.", { col: 2, row: 0, color: COLORS.green });
  l.n("yc", "subtract", { values: { b: 0.5 } });
  l.n("hw", "multiply", { values: { b: 0.5 } });
  for (const k of ["1", "2"]) {
    l.n(`q${k}`, "subtract", {});
    l.n(`dist${k}`, "abs", {});
    l.n(`c${k}0`, "smoothstep", { values: { edge1: 0 } });
    l.n(`core${k}`, "oneMinus", {});
    l.n(`g${k}0`, "divide", {});
    l.n(`g${k}1`, "oneMinus", {});
    l.n(`g${k}2`, "saturate", {});
    l.n(`glow${k}`, "multiply", {});
  }
  s.w("us.g", "yc.a").w(l.po("coreWidth"), "hw.a").w("yc.out", "q1.a").w("d1.out", "q1.b", "Bolt1").w("yc.out", "q2.a").w("d2.out", "q2.b", "Bolt2").w("q1.out", "dist1.in").w("q2.out", "dist2.in")
    .w(l.po("coreWidth"), "c10.edge2").w("dist1.out", "c10.in").w("hw.out", "c20.edge2").w("dist2.out", "c20.in").w("c10.out", "core1.in").w("c20.out", "core2.in")
    .w("dist1.out", "g10.a").w(l.po("glowWidth"), "g10.b").w("g10.out", "g11.in").w("g11.out", "g12.in").w("g12.out", "glow1.a").w("g12.out", "glow1.b")
    .w("dist2.out", "g20.a").w(l.po("glowWidth"), "g20.b").w("g20.out", "g21.in").w("g21.out", "g22.in").w("g22.out", "glow2.a").w("g22.out", "glow2.b");

  const f = s.block("flash", "Flicker + strike flash", "`brightness = lerp(1, hash(step), flicker) × (0.35 + 0.65 × (1 − saw)^decay)`. The sawtooth (period = *Strike Period*) restarts a bright flash that decays; the per-step hash flickers it. `endFade` softens the two bolt ends.", { col: 2, row: 1, color: COLORS.yellow });
  f.n("hs", "hash1to1", {});
  f.n("fl", "lerp", { values: { a: 1 } });
  f.n("saw", "timeSawtooth", {});
  f.n("inv", "oneMinus", {});
  f.n("dc", "power", {});
  f.n("dm", "multiply", { values: { b: 0.65 } });
  f.n("dp", "add", { values: { b: 0.35 } });
  f.n("br", "multiply", {});
  f.n("es", "smoothstep", { values: { edge1: 0, edge2: 0.06 } });
  f.n("ee0", "smoothstep", { values: { edge1: 0.94, edge2: 1 } });
  f.n("ee", "oneMinus", {});
  f.n("endFade", "multiply", {});
  s.w("stp.out", "hs.in", "Step").w("hs.out", "fl.b").w(f.po("flicker"), "fl.t").w("t.time", "saw.t", "Time").w(f.po("strikePeriod"), "saw.period").w("saw.out", "inv.in").w("inv.out", "dc.a").w(f.po("flashDecay"), "dc.b")
    .w("dc.out", "dm.a").w("dm.out", "dp.a").w("fl.out", "br.a").w("dp.out", "br.b").w("us.r", "es.in").w("us.r", "ee0.in").w("ee0.out", "ee.in").w("es.out", "endFade.a").w("ee.out", "endFade.b");

  const c = s.block("color", "Colour + alpha", "`core = core₁ + branch × core₂`, `glow` likewise. Colour = (`coreColor × core + glowColor × glow × strength`) × brightness × endFade × particle colour; alpha = saturate(core + glow) × endFade × particle alpha.", { col: 3, color: COLORS.orange });
  c.n("bc", "multiply", {});
  c.n("bg", "multiply", {});
  c.n("core", "add", {});
  c.n("glow", "add", {});
  c.n("gs", "multiply", {});
  c.n("c1", "multiply", {});
  c.n("c2", "multiply", {});
  c.n("cs", "add", {});
  c.n("cb", "multiply", {});
  c.n("ce", "multiply", {});
  c.n("tint", "multiply", {});
  c.n("za0", "add", {});
  c.n("za1", "saturate", {});
  c.n("za2", "multiply", {});
  c.n("za3", "multiply", {});
  s.w("core2.out", "bc.a").w(c.po("branchStrength"), "bc.b").w("glow2.out", "bg.a").w(c.po("branchStrength"), "bg.b").w("core1.out", "core.a").w("bc.out", "core.b").w("glow1.out", "glow.a").w("bg.out", "glow.b")
    .w("glow.out", "gs.a").w(c.po("glowStrength"), "gs.b").w(c.po("coreColor"), "c1.a").w("core.out", "c1.b").w(c.po("glowColor"), "c2.a").w("gs.out", "c2.b").w("c1.out", "cs.a").w("c2.out", "cs.b")
    .w("cs.out", "cb.a").w("br.out", "cb.b").w("cb.out", "ce.a").w("endFade.out", "ce.b").w("ce.out", "tint.a").w("pc.rgb", "tint.b")
    .w("core.out", "za0.a").w("gs.out", "za0.b").w("za0.out", "za1.in").w("za1.out", "za2.a").w("endFade.out", "za2.b").w("za2.out", "za3.a").w("pc.a", "za3.b");

  const o = s.block("out", "Master output (URP VFX Unlit, additive)", "Additive blend, ZWrite off, two-sided.", { col: 4, color: COLORS.violet });
  s.master(o);
  s.w("tint.out", "master.baseColor").w("za3.out", "master.alpha");
  return s;
}
export const lightningSample: SampleModule = { meta, build };
