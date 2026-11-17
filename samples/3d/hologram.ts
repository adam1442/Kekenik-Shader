import { COLORS } from "../build/canvas";
import { P, Sample } from "../build/dsl";
import type { SampleModule } from "../build/emit";
import { fresnelKit } from "../lib";
import { ALL_TARGETS, defineMeta } from "./common";

const meta = defineMeta({
  id: "hologram", title: "Hologram",
  description: "Additive sci-fi hologram: scrolling scan-lines in world space, fresnel rim, electric flicker and a small vertex wobble. One unlit additive pass.",
  tags: ["hologram", "additive", "scanlines", "fresnel", "sci-fi", "vfx"], category: "3D / Lit", difficulty: "Intermediate", targets: ALL_TARGETS,
  compatNotes: ["Additive blend, no depth write (set in the graph settings)."], requiredFeatures: [],
  budgetClass: "Mobile", godotProfile: "godot.spatial", reusableSubgraphs: ["ks_fresnel_kit"],
  previewConfig: { mode: "3d", mesh: "capsule", lighting: { lit: "unlit" }, background: { mode: "dark" } },
});

function build(): Sample {
  const s = new Sample({ id: meta.id, name: meta.title, profile: "unity.urp.unlit", settings: { blend: "additive", zwrite: "off", cull: "off" } });
  s.add(
    P.color("holoColor", "Hologram Color", { default: [0.15, 0.75, 1.4], hdr: true, tooltip: "HDR colour of the hologram.", category: "Look" }),
    P.float("intensity", "Intensity", { default: 1.2, min: 0, max: 4, tooltip: "Overall brightness.", category: "Look" }),
    P.float("density", "Scanline Density", { default: 38, min: 4, max: 120, tooltip: "Scan-lines per world unit (vertical).", category: "Scanlines" }),
    P.float("speed", "Scanline Speed", { default: 0.6, min: -3, max: 3, tooltip: "Scroll speed in lines per second (negative = down).", category: "Scanlines" }),
    P.float("lineSharp", "Scanline Sharpness", { default: 0.35, min: 0.02, max: 0.5, tooltip: "Smaller = harder lines.", category: "Scanlines" }),
    P.float("rimPower", "Rim Power", { default: 2.2, min: 0.5, max: 8, tooltip: "Rim falloff.", category: "Rim" }),
    P.float("flicker", "Flicker", { default: 0.12, min: 0, max: 0.5, tooltip: "Amount of electric flicker (0 = steady).", category: "Motion" }),
    P.float("wobble", "Vertex Wobble", { default: 0.012, min: 0, max: 0.08, tooltip: "Amplitude of the vertex wobble (object units).", category: "Motion" }),
  );
  s.use(fresnelKit());

  const i = s.block("inputs", "Inputs", "World position (for the scan-lines), world normal and view direction (for the rim), and time.", { col: 0, color: COLORS.blue });
  i.n("wpos", "position", { params: { space: "world" } });
  i.n("nrm", "normal", { params: { space: "world" } });
  i.n("vdir", "viewDirection", { params: { space: "world" } });
  i.n("t", "time", {});

  const sc = s.block("scan", "Scan-lines", "`fract(y × density − t × speed)` is a sawtooth; `smoothstep` of its distance to the middle turns it into thin bright bars that crawl upwards.", { col: 1, row: 0, color: COLORS.green });
  sc.n("ysplit", "split", {});
  sc.n("yd", "multiply", {});
  sc.n("ts", "multiply", {});
  sc.n("ph", "subtract", {});
  sc.n("fr", "fract", {});
  sc.n("tri", "subtract", { values: { b: 0.5 } });
  sc.n("ab", "abs", {});
  sc.n("sm", "smoothstep", { values: { edge1: 0.0 } });
  sc.n("lines", "oneMinus", {});
  s.w("wpos.out", "ysplit.in", "WorldPos").w("ysplit.g", "yd.a").w(sc.po("density"), "yd.b").w("t.time", "ts.a", "Time").w(sc.po("speed"), "ts.b")
    .w("yd.out", "ph.a").w("ts.out", "ph.b").w("ph.out", "fr.in").w("fr.out", "tri.a").w("tri.out", "ab.in")
    .w(sc.po("lineSharp"), "sm.edge2").w("ab.out", "sm.in").w("sm.out", "lines.in");

  const r = s.block("rim", "Rim", "The **Fresnel kit** makes silhouettes glow; the face-on output keeps a faint body so the hologram does not vanish.", { col: 1, row: 1, color: COLORS.cyan });
  r.sub("fres", "ks_fresnel_kit", { label: "Rim", values: { intensity: 1.3 } });
  s.w("nrm.out", "fres.normal", "N").w("vdir.out", "fres.viewDir", "V").w(r.po("holoColor"), "fres.color").w(r.po("rimPower"), "fres.power");

  const f = s.block("flick", "Flicker", "`1 − flicker × (½ + ½ sin(47t)·sin(13t))`: two incommensurate sines give an irregular, electric flicker without noise.", { col: 2, row: 0, color: COLORS.yellow });
  f.n("a", "multiply", { values: { b: 47 } });
  f.n("b", "multiply", { values: { b: 13 } });
  f.n("sa", "sin", {});
  f.n("sb", "sin", {});
  f.n("p", "multiply", {});
  f.n("h", "remap", { values: { inMin: -1, inMax: 1, outMin: 0, outMax: 1 } });
  f.n("k", "multiply", {});
  f.n("flick", "oneMinus", {});
  s.w("t.time", "a.a", "Time").w("t.time", "b.a", "Time").w("a.out", "sa.in").w("b.out", "sb.in").w("sa.out", "p.a").w("sb.out", "p.b").w("p.out", "h.in").w("h.out", "k.a").w(f.po("flicker"), "k.b").w("k.out", "flick.in");

  const c = s.block("mix", "Combine", "`brightness = (0.12 + 0.55 × lines + rim) × flicker × intensity`; colour = hologram colour (rim kit already tinted) — additive blending turns brightness into opacity.", { col: 3, color: COLORS.orange });
  c.n("l", "multiply", { values: { b: 0.55 } });
  c.n("base", "add", { values: { b: 0.12 } });
  c.n("tot", "add", {});
  c.n("fl", "multiply", {});
  c.n("gain", "multiply", {});
  c.n("col", "multiply", {});
  s.w("lines.out", "l.a").w("l.out", "base.a").w("base.out", "tot.a").w("fres.rim", "tot.b").w("tot.out", "fl.a").w("flick.out", "fl.b", "Flicker").w("fl.out", "gain.a").w(c.po("intensity"), "gain.b")
    .w(c.po("holoColor"), "col.a").w("gain.out", "col.b");

  const v = s.block("vert", "Vertex wobble", "A tiny sine wave along the normal (Wave Deformation node) makes the silhouette shimmer. Vertex stage only.", { col: 3, row: 1, color: COLORS.pink });
  v.n("opos", "position", { params: { space: "object" } });
  v.n("onrm", "normal", { params: { space: "object" } });
  v.n("wave", "waveDeformation", { values: { frequency: 9, speed: 1.4 } });
  s.w("opos.out", "wave.position").w("onrm.out", "wave.normal").w("t.time", "wave.time", "Time").w(v.po("wobble"), "wave.amplitude");

  const o = s.block("out", "Master output (URP Unlit, additive)", "Additive blend + ZWrite off + two-sided are set in the graph settings.", { col: 4, color: COLORS.violet });
  s.master(o);
  s.w("col.out", "master.baseColor").w("wave.position", "master.positionOS");
  return s;
}
export const hologramSample: SampleModule = { meta, build };
