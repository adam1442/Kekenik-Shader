import { COLORS } from "../build/canvas";
import { P, Sample } from "../build/dsl";
import type { SampleModule } from "../build/emit";
import { ALL_TARGETS, defineMeta } from "../3d/common";

const meta = defineMeta({
  id: "vfx-energy-beam", title: "Energy Beam (Scrolling)",
  description: "Additive energy beam for a cylinder / beam mesh: 3D noise sampled around the tube scrolls along the beam, travelling pulses race down it, a view-facing core glows white-hot against a coloured halo, the ends fade out and a small vertex wobble makes the beam alive.",
  tags: ["beam", "laser", "energy", "scrolling", "additive", "pulse", "vfx"], category: "VFX / Particles", difficulty: "Intermediate", targets: ALL_TARGETS,
  compatNotes: ["UV: U around the tube, V along it (the preview cylinder). The noise uses the cylinder angle as a circle, so there is no seam.", "Additive blend, no depth write, two-sided (set in the graph settings). Bloom makes the HDR core glow."],
  requiredFeatures: [], budgetClass: "Desktop", godotProfile: "godot.spatial.vfx",
  previewConfig: { mode: "3d", mesh: "cylinder", lighting: { lit: "unlit" }, background: { mode: "dark" } },
});

function build(): Sample {
  const s = new Sample({ id: meta.id, name: meta.title, profile: "unity.urp.unlit", settings: { blend: "additive", zwrite: "off", cull: "off" } });
  s.add(
    P.color("glowColor", "Glow Color", { default: [0.1, 0.55, 2.8], hdr: true, tooltip: "HDR colour of the outer halo.", category: "Look" }),
    P.color("coreColor", "Core Color", { default: [2.2, 2.8, 3.4], hdr: true, tooltip: "HDR colour of the hot core.", category: "Look" }),
    P.float("intensity", "Intensity", { default: 1.5, min: 0, max: 5, tooltip: "Overall brightness.", category: "Look" }),
    P.float("coreSharp", "Core Sharpness", { default: 2.4, min: 0.5, max: 10, tooltip: "Exponent of the view-facing core falloff (higher = thinner core).", category: "Look" }),
    P.float("speed", "Scroll Speed", { default: 1.6, min: -6, max: 6, tooltip: "Speed at which the energy travels along the beam (negative = reverse).", category: "Motion" }),
    P.float("noiseFreq", "Noise Length", { default: 3.5, min: 0.5, max: 12, tooltip: "Noise cells along the beam.", category: "Energy" }),
    P.float("swirl", "Noise Swirl", { default: 0.9, min: 0.1, max: 3, tooltip: "Radius of the noise circle around the tube: larger = more variation around the tube.", category: "Energy" }),
    P.float("noiseAmount", "Noise Amount", { default: 0.65, min: 0, max: 1, tooltip: "How much the noise modulates the brightness.", category: "Energy" }),
    P.float("pulses", "Pulse Count", { default: 4, min: 1, max: 12, step: 1, tooltip: "Travelling pulses along the beam.", category: "Pulses" }),
    P.float("pulseStrength", "Pulse Strength", { default: 0.9, min: 0, max: 3, tooltip: "Brightness of the pulses (0 = off).", category: "Pulses" }),
    P.float("endFade", "End Fade", { default: 0.12, min: 0.01, max: 0.5, tooltip: "Fraction of the beam length over which each end fades out.", category: "Look" }),
    P.float("wobble", "Vertex Wobble", { default: 0.015, min: 0, max: 0.08, tooltip: "Amplitude of the radial vertex wobble (object units).", category: "Motion" }),
  );

  const g = s.block("inputs", "Inputs", "UV (U around, V along), world normal + view direction for the core, object position / normal for the wobble, time.", { col: 0, color: COLORS.blue });
  g.n("uv", "uv", {});
  g.n("us", "split", {});
  g.n("wn", "normal", { params: { space: "world" } });
  g.n("v", "viewDirection", { params: { space: "world" } });
  g.n("t", "time", {});

  const n = s.block("noise", "Scrolling energy noise", "`p = (cos θ·r, sin θ·r, v × length − t × speed)` with `θ = 2π·u`: the circle makes the noise continuous around the tube, the third coordinate scrolls it along the beam. 3 octaves of 3D value-fbm give the crackling energy.", { col: 1, row: 0, color: COLORS.green });
  n.n("th", "multiply", { values: { b: 6.28318530718 } });
  n.n("c", "cos", {});
  n.n("sn", "sin", {});
  n.n("cx", "multiply", {});
  n.n("cy", "multiply", {});
  n.n("vl", "multiply", {});
  n.n("ts", "multiply", {});
  n.n("z", "subtract", {});
  n.n("p", "combine", {});
  n.n("fbm", "noiseFbm", { params: { dimension: 3, basis: "value", octaves: 3 }, values: { scale: 1 } });
  s.w("us.r", "th.a").w("th.out", "c.in").w("th.out", "sn.in").w("c.out", "cx.a").w(n.po("swirl"), "cx.b").w("sn.out", "cy.a").w(n.po("swirl"), "cy.b")
    .w("us.g", "vl.a").w(n.po("noiseFreq"), "vl.b").w("t.time", "ts.a", "Time").w(n.po("speed"), "ts.b").w("vl.out", "z.a").w("ts.out", "z.b")
    .w("cx.out", "p.r").w("cy.out", "p.g").w("z.out", "p.b").w("p.rgb", "fbm.p");

  const pu = s.block("pulse", "Travelling pulses", "`pulse = smoothstep(0.7, 1, ½ + ½ sin(2π(v × count − t × speed × 0.5)))` — bright bands that run along the beam.", { col: 1, row: 1, color: COLORS.yellow });
  pu.n("vc", "multiply", {});
  pu.n("pts", "multiply", { values: { b: 0.5 } });
  pu.n("tsp", "multiply", {});
  pu.n("ph", "subtract", {});
  pu.n("tau", "multiply", { values: { b: 6.28318530718 } });
  pu.n("psn", "sin", {});
  pu.n("h", "remap", { values: { inMin: -1, inMax: 1, outMin: 0, outMax: 1 } });
  pu.n("pulse", "smoothstep", { values: { edge1: 0.7, edge2: 1 } });
  pu.n("pk", "multiply", {});
  s.w("us.g", "vc.a").w(pu.po("pulses"), "vc.b").w("t.time", "pts.a").w("pts.out", "tsp.a").w(pu.po("speed"), "tsp.b").w("vc.out", "ph.a").w("tsp.out", "ph.b").w("ph.out", "tau.a").w("tau.out", "psn.in")
    .w("psn.out", "h.in").w("h.out", "pulse.in").w("pulse.out", "pk.a").w(pu.po("pulseStrength"), "pk.b");

  const k = s.block("core", "Core + ends", "`core = (N·V)^sharpness` is 1 where the tube faces the camera. Ends: `smoothstep(0, f, v) × smoothstep(0, f, 1 − v)`.", { col: 2, row: 0, color: COLORS.cyan });
  k.n("nv0", "dot", {});
  k.n("nv", "saturate", {});
  k.n("core", "power", {});
  k.n("e1", "smoothstep", { values: { edge1: 0 } });
  k.n("iv", "oneMinus", {});
  k.n("e2", "smoothstep", { values: { edge1: 0 } });
  k.n("ends", "multiply", {});
  s.w("wn.out", "nv0.a").w("v.out", "nv0.b").w("nv0.out", "nv.in").w("nv.out", "core.a").w(k.po("coreSharp"), "core.b")
    .w(k.po("endFade"), "e1.edge2").w("us.g", "e1.in").w("us.g", "iv.in").w(k.po("endFade"), "e2.edge2").w("iv.out", "e2.in").w("e1.out", "ends.a").w("e2.out", "ends.b");

  const m = s.block("mix", "Combine", "`energy = lerp(1 − noiseAmount, 1, noise)`; brightness = `(energy × (¼ + ¾ core) + pulse × core) × ends × intensity`; colour = `lerp(glow, core colour, core)`.", { col: 3, color: COLORS.orange });
  m.n("na", "oneMinus", {});
  m.n("en", "lerp", { values: { b: 1 } });
  m.n("cb", "multiply", { values: { b: 0.75 } });
  m.n("cb2", "add", { values: { b: 0.25 } });
  m.n("body", "multiply", {});
  m.n("pc", "multiply", {});
  m.n("sum", "add", {});
  m.n("ee", "multiply", {});
  m.n("br", "multiply", {});
  m.n("col", "lerp", {});
  m.n("out", "multiply", {});
  s.w(m.po("noiseAmount"), "na.in").w("na.out", "en.a").w("fbm.out", "en.t").w("core.out", "cb.a").w("cb.out", "cb2.a").w("en.out", "body.a").w("cb2.out", "body.b").w("pk.out", "pc.a").w("core.out", "pc.b")
    .w("body.out", "sum.a").w("pc.out", "sum.b").w("sum.out", "ee.a").w("ends.out", "ee.b").w("ee.out", "br.a").w(m.po("intensity"), "br.b")
    .w(m.po("glowColor"), "col.a").w(m.po("coreColor"), "col.b").w("core.out", "col.t").w("col.out", "out.a").w("br.out", "out.b");

  const w = s.block("vert", "Vertex wobble", "Wave Deformation along the normal (vertex stage only).", { col: 3, row: 1, color: COLORS.pink });
  w.n("opos", "position", { params: { space: "object" } });
  w.n("onrm", "normal", { params: { space: "object" } });
  w.n("wave", "waveDeformation", { values: { frequency: 12, speed: 3 } });
  s.w("opos.out", "wave.position").w("onrm.out", "wave.normal").w("t.time", "wave.time").w(w.po("wobble"), "wave.amplitude");

  const o = s.block("out", "Master output (URP Unlit, additive)", "Additive, ZWrite off, two-sided: set in the graph settings.", { col: 4, color: COLORS.violet });
  s.master(o);
  s.w("out.out", "master.baseColor").w("wave.position", "master.positionOS");
  return s;
}
export const energyBeamSample: SampleModule = { meta, build };
