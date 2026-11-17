import { COLORS } from "../build/canvas";
import { P, Sample } from "../build/dsl";
import type { SampleModule } from "../build/emit";
import { colorRamp3 } from "../lib";
import { ALL_TARGETS, defineMeta } from "../3d/common";
import { GODOT_VFX, VFX_PROFILE, envelope } from "./common";

const meta = defineMeta({
  id: "vfx-portal-swirl", title: "Portal Swirl",
  description: "Swirling portal on a billboard quad. A twirl bends the UVs into spiral arms, two counter-rotating value-noise layers churn inside it, a three-colour ramp paints the vortex, a bright core sits in the middle and a ragged HDR rim glows where the noise eats into the disc edge.",
  tags: ["portal", "swirl", "twirl", "noise", "rim-glow", "hdr", "particles", "vfx"], category: "VFX / Particles", difficulty: "Intermediate", targets: ALL_TARGETS,
  compatNotes: ["Alpha blended, two-sided, ZWrite off. The rim and core colours are HDR (linear) and need Bloom to glow.", "Particle colour multiplies the whole portal and its alpha fades it in and out, so open / close animations come from Color over Lifetime and Size over Lifetime."],
  requiredFeatures: [], budgetClass: "Desktop", godotProfile: GODOT_VFX, reusableSubgraphs: ["ks_color_ramp3"],
  previewConfig: {
    mode: "vfx", mesh: "quad", background: { mode: "dark", ground: "none" },
    emitter: { rate: 0.5, lifetime: 5, lifetimeVar: 0, sizeStart: 2, sizeEnd: 2, speed: 0, spread: 0, gravity: [0, 0, 0], maxParticles: 3, colorOverLife: envelope(1, 0.08) },
  },
});

function build(): Sample {
  const s = new Sample({ id: meta.id, name: meta.title, profile: VFX_PROFILE, settings: { blend: "alpha", zwrite: "off", cull: "off" } });
  s.add(
    P.float("radius", "Portal Radius", { default: 0.8, min: 0.3, max: 0.95, tooltip: "Radius of the disc as a share of the quad half-width.", category: "Shape" }),
    P.float("softness", "Edge Softness", { default: 0.05, min: 0.005, max: 0.3, tooltip: "Width of the alpha fade at the disc edge.", category: "Shape" }),
    P.float("wobble", "Edge Wobble", { default: 0.12, min: 0, max: 0.4, tooltip: "How far the noise bites into the disc edge (0 = perfect circle).", category: "Shape" }),
    P.float("twist", "Twist", { default: 6, min: -20, max: 20, tooltip: "Strength of the UV twirl: sign sets the spiral direction, 0 = straight noise.", category: "Swirl" }),
    P.float("spin", "Spin Speed", { default: 0.12, min: -1, max: 1, tooltip: "Rotation speed of the vortex in turns per second.", category: "Swirl" }),
    P.float("noiseScale", "Noise Scale", { default: 3, min: 1, max: 8, tooltip: "Frequency of the vortex noise (bigger = finer arms).", category: "Swirl" }),
    P.color("coldColor", "Outer Color", { default: [0.05, 0.02, 0.18], tooltip: "Vortex colour where the noise is low (sRGB).", category: "Color" }),
    P.color("midColor", "Mid Color", { default: [0.4, 0.1, 0.85], tooltip: "Vortex colour in the middle of the noise range (sRGB).", category: "Color" }),
    P.color("hotColor", "Bright Color", { default: [0.5, 0.9, 1], tooltip: "Vortex colour where the noise is high (sRGB).", category: "Color" }),
    P.color("rimColor", "Rim Color", { default: [1.2, 2.4, 6], hdr: true, tooltip: "HDR colour of the glowing rim (linear).", category: "Glow" }),
    P.float("rimWidth", "Rim Width", { default: 0.18, min: 0.03, max: 0.5, tooltip: "Width of the glowing rim, measured inwards from the edge.", category: "Glow" }),
    P.float("rimIntensity", "Rim Intensity", { default: 1.5, min: 0, max: 5, tooltip: "Brightness of the rim.", category: "Glow" }),
    P.color("coreColor", "Core Color", { default: [4, 3.2, 6], hdr: true, tooltip: "HDR colour of the centre of the vortex (linear).", category: "Glow" }),
    P.float("coreSize", "Core Size", { default: 0.3, min: 0.05, max: 0.8, tooltip: "Radius of the bright centre (share of the quad half-width).", category: "Glow" }),
  );
  s.use(colorRamp3());

  const i = s.block("inputs", "Inputs", "Quad UV, time and the particle colour / alpha.", { col: 0, color: COLORS.blue });
  i.n("uv", "uv", {});
  i.n("t", "time", {});
  i.n("pc", "particleColor", {});

  const w = s.block("swirl", "Twirl + two counter-rotating layers", "`uvTwirl` rotates each UV around the centre by an angle that depends on its radius — the straight noise grid becomes spiral arms. Layer A turns with `time × spin`, layer B the other way at 0.6× and a different scale, so the arms slowly slide through each other.", { col: 1, row: 0, color: COLORS.cyan });
  w.n("tw", "uvTwirl", {});
  w.n("rA", "multiply", {});
  w.n("rB", "multiply", { values: { b: -0.6 } });
  w.n("rotA", "uvRotate", { params: { unit: "turns" } });
  w.n("rotB", "uvRotate", { params: { unit: "turns" } });
  w.n("sB", "multiply", { values: { b: 1.7 } });
  w.n("nA", "noiseFbm", { params: { basis: "value", octaves: 3 } });
  w.n("nB", "noiseFbm", { params: { basis: "value", octaves: 3 }, values: { seed: 4 } });
  w.n("nm", "add", {});
  w.n("nh", "multiply", { values: { b: 0.5 } });
  s.w("uv.out", "tw.uv").w(w.po("twist"), "tw.strength").w("t.time", "rA.a", "Time").w(w.po("spin"), "rA.b").w("rA.out", "rB.a").w("tw.out", "rotA.uv").w("rA.out", "rotA.rotation").w("tw.out", "rotB.uv").w("rB.out", "rotB.rotation")
    .w("rotA.out", "nA.p").w(w.po("noiseScale"), "nA.scale").w(w.po("noiseScale"), "sB.a").w("rotB.out", "nB.p").w("sB.out", "nB.scale").w("nA.out", "nm.a").w("nB.out", "nm.b").w("nm.out", "nh.a");

  const sh = s.block("shape", "Disc, ragged edge, core", "`r` = distance from the centre (1 at the quad edge). The noise pushes the edge radius: `r' = r + (noise − ½) × wobble`. Disc alpha = `1 − smoothstep(R − soft, R, r')`. The rim is the band `[R − width, R]` of `r'` (smoothstep up, then clipped by the disc); the core is `(1 − r / size)²`.", { col: 1, row: 1, color: COLORS.green });
  sh.n("d", "distance", { values: { b: [0.5, 0.5] } });
  sh.n("r", "multiply", { values: { b: 2 } });
  sh.n("nc", "subtract", { values: { b: 0.5 } });
  sh.n("nw", "multiply", {});
  sh.n("rg", "add", {});
  sh.n("rs", "subtract", {});
  sh.n("disc0", "smoothstep", {});
  sh.n("disc", "oneMinus", {});
  sh.n("rw", "subtract", {});
  sh.n("rim0", "smoothstep", {});
  sh.n("rim", "multiply", {});
  sh.n("cd", "divide", {});
  sh.n("ci", "oneMinus", {});
  sh.n("cs", "saturate", {});
  sh.n("core", "multiply", {});
  s.w("uv.out", "d.a").w("d.out", "r.a").w("nh.out", "nc.a", "Noise").w("nc.out", "nw.a").w(sh.po("wobble"), "nw.b").w("r.out", "rg.a").w("nw.out", "rg.b")
    .w(sh.po("radius"), "rs.a").w(sh.po("softness"), "rs.b").w("rs.out", "disc0.edge1").w(sh.po("radius"), "disc0.edge2").w("rg.out", "disc0.in").w("disc0.out", "disc.in")
    .w(sh.po("radius"), "rw.a").w(sh.po("rimWidth"), "rw.b").w("rw.out", "rim0.edge1").w(sh.po("radius"), "rim0.edge2").w("rg.out", "rim0.in").w("rim0.out", "rim.a").w("disc.out", "rim.b")
    .w("r.out", "cd.a").w(sh.po("coreSize"), "cd.b").w("cd.out", "ci.in").w("ci.out", "cs.in").w("cs.out", "core.a").w("cs.out", "core.b");

  const c = s.block("color", "Vortex colour + glow", "The noise (darkened towards the outside, brightened by the core) indexes the shared **Color Ramp** kit. Rim and core are added in HDR on top: `colour = ramp + rim × rimColor × intensity + core × coreColor`.", { col: 2, color: COLORS.orange });
  c.n("fall", "multiply", { values: { b: 0.5 } });
  c.n("ff", "oneMinus", {});
  c.n("ni", "multiply", {});
  c.n("cb", "multiply", { values: { b: 0.5 } });
  c.n("tt0", "add", {});
  c.n("tt", "saturate", {});
  c.sub("ramp", "ks_color_ramp3", { label: "Vortex Ramp" });
  c.n("rc", "multiply", {});
  c.n("ri", "multiply", {});
  c.n("ra", "multiply", {});
  c.n("ca", "multiply", {});
  c.n("s1", "add", {});
  c.n("s2", "add", {});
  c.n("tint", "multiply", {});
  s.w("r.out", "fall.a").w("fall.out", "ff.in").w("nm.out", "ni.a").w("ff.out", "ni.b").w("core.out", "cb.a").w("ni.out", "tt0.a").w("cb.out", "tt0.b").w("tt0.out", "tt.in")
    .w("tt.out", "ramp.t").w(c.po("coldColor"), "ramp.cold").w(c.po("midColor"), "ramp.mid").w(c.po("hotColor"), "ramp.hot")
    .w("rim.out", "ri.a").w(c.po("rimIntensity"), "ri.b").w("ri.out", "ra.a").w(c.po("rimColor"), "ra.b").w("core.out", "ca.a").w(c.po("coreColor"), "ca.b")
    .w("ramp.color", "s1.a").w("ra.out", "s1.b").w("s1.out", "s2.a").w("ca.out", "s2.b").w("s2.out", "tint.a").w("pc.rgb", "tint.b");

  const a = s.block("alpha", "Alpha", "`alpha = disc × particle alpha`.", { col: 2, row: 1, color: COLORS.red });
  a.n("al", "multiply", {});
  s.w("disc.out", "al.a").w("pc.a", "al.b");

  const o = s.block("out", "Master output (URP VFX Unlit, alpha)", "Alpha blend, ZWrite off, two-sided.", { col: 3, color: COLORS.violet });
  s.master(o);
  s.w("tint.out", "master.baseColor").w("al.out", "master.alpha");
  return s;
}
export const portalSample: SampleModule = { meta, build };
