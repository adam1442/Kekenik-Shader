import { COLORS } from "../build/canvas";
import { P, Sample } from "../build/dsl";
import type { SampleModule } from "../build/emit";
import { softDissolve } from "../lib";
import { smokeTex } from "../textures/gen-fx";
import { ALL_TARGETS, defineMeta } from "../3d/common";
import { GODOT_VFX, VFX_PROFILE, envelope } from "./common";

const meta = defineMeta({
  id: "vfx-dissolve-trail", title: "Dissolve Trail (Particle Age)",
  description: "Comet-shaped spark whose body dissolves with the particle's age. The normalised age and a stable random number come from custom vertex streams; the noise scrolls down the tail, the tail dissolves before the head, and the cut line glows in HDR. Built on the shared Soft Edge Dissolve subgraph.",
  tags: ["dissolve", "trail", "spark", "particle-age", "custom-vertex-streams", "hdr", "additive", "particles", "vfx"], category: "VFX / Particles", difficulty: "Intermediate", targets: ALL_TARGETS,
  compatNotes: [
    "REQUIRED custom vertex streams — Unity: Particle System → Renderer → Custom Vertex Streams: UV (default), then Age Percent → TEXCOORD1.x and Stable Random → TEXCOORD1.y. Godot: copy INSTANCE_CUSTOM.x (age) and .y (random) into UV2.x / UV2.y in vertex().",
    "Without the streams the age reads 0 and nothing dissolves. The quad's V axis is the length of the comet (head at V = 1): orient the particle along its velocity (Stretched Billboard in Unity) to get a real trail.",
    "Additive, ZWrite off, two-sided; HDR colours need Bloom. One texture fetch per pixel.",
  ],
  requiredFeatures: ["Custom Vertex Streams (Age Percent, Stable Random)"], budgetClass: "Mobile", godotProfile: GODOT_VFX, reusableSubgraphs: ["ks_soft_dissolve"],
  previewConfig: {
    mode: "vfx", mesh: "quad", background: { mode: "dark", ground: "none" },
    emitter: { rate: 7, lifetime: 2.2, lifetimeVar: 0.15, sizeStart: 1.3, sizeEnd: 1.3, speed: 0.7, spread: 18, gravity: [0, 0, 0], maxParticles: 24, colorOverLife: envelope(1, 0.04) },
  },
});

function build(): Sample {
  const s = new Sample({ id: meta.id, name: meta.title, profile: VFX_PROFILE, settings: { blend: "additive", zwrite: "off", cull: "off" } });
  s.add(
    P.tex("noiseMap", "Dissolve Noise", { default: "grey", tooltip: "Tileable noise (grey) that decides which parts dissolve first. Linear data, wrap mode Repeat.", category: "Dissolve" }),
    P.float("ageCurve", "Age Curve", { default: 1.2, min: 0.3, max: 3, tooltip: "Shapes the dissolve over the particle's life: below 1 = fast start, above 1 = holds, then collapses.", category: "Dissolve" }),
    P.float("tailBias", "Tail Bias", { default: 0.45, min: 0, max: 1, tooltip: "How much the tail dissolves before the head (0 = pure noise, 1 = a clean wipe from the tail).", category: "Dissolve" }),
    P.float("edgeWidth", "Edge Width", { default: 0.12, min: 0.02, max: 0.4, tooltip: "Width of the glowing band along the cut line (noise units).", category: "Dissolve" }),
    P.float("softness", "Edge Softness", { default: 0.04, min: 0.005, max: 0.2, tooltip: "Feathering of the cut line.", category: "Dissolve" }),
    P.float("tileX", "Noise Tiling X", { default: 1, min: 0.25, max: 4, tooltip: "Noise repeats across the width of the comet.", category: "Noise" }),
    P.float("tileY", "Noise Tiling Y", { default: 2, min: 0.25, max: 6, tooltip: "Noise repeats along the length of the comet.", category: "Noise" }),
    P.float("scroll", "Scroll Speed", { default: 1.5, min: 0, max: 5, tooltip: "How far the noise slides down the tail over the particle's life (texture repeats).", category: "Noise" }),
    P.float("tailWidth", "Tail Width", { default: 0.14, min: 0.02, max: 0.6, tooltip: "Width of the very tip of the tail relative to the head.", category: "Shape" }),
    P.color("tailColor", "Tail Color", { default: [0.9, 0.25, 0.08], tooltip: "Body colour at the tail (sRGB).", category: "Color" }),
    P.color("headColor", "Head Color", { default: [2.2, 1.4, 0.5], hdr: true, tooltip: "HDR body colour at the head (linear).", category: "Color" }),
    P.color("edgeColor", "Edge Color", { default: [7, 2.6, 0.5], hdr: true, tooltip: "HDR colour of the glowing cut line (linear).", category: "Color" }),
    P.float("edgeIntensity", "Edge Intensity", { default: 1, min: 0, max: 3, tooltip: "Brightness of the cut line.", category: "Color" }),
  );
  s.texture("noiseMap", "trail-noise", smokeTex(128, 21));
  s.use(softDissolve());

  const i = s.block("inputs", "Particle inputs (custom vertex streams)", "**Age** = *Age Percent* (TEXCOORD1.x) and **Random** = *Stable Random* (TEXCOORD1.y) of the Unity particle system, colour = vertex colour. V is the length axis of the comet (head at V = 1), U the width.", { col: 0, color: COLORS.blue });
  i.n("uv", "uv", {});
  i.n("us", "split", {});
  i.n("age", "particleAge", { params: { mode: "normalized" } });
  i.n("rnd", "particleRandom", {});
  i.n("pc", "particleColor", {});
  s.w("uv.out", "us.in");

  const sh = s.block("shape", "Comet shape", "Half-width profile `0.12 + 0.88·v^1.4` scaled by *Tail Width*: narrow at the tail, full at the head. `across = |u − ½|·2`; mask = `1 − smoothstep(0.6·p, p, across)`. The head end is cut softly with `1 − smoothstep(0.9, 1, v)`.", { col: 1, row: 0, color: COLORS.green });
  sh.n("vp", "power", { values: { b: 1.4 } });
  sh.n("vs", "multiply", { values: { b: 0.88 } });
  sh.n("pr0", "add", { values: { b: 0.12 } });
  sh.n("pr", "multiply", {});
  sh.n("ud", "subtract", { values: { b: 0.5 } });
  sh.n("ua", "abs", {});
  sh.n("ac", "multiply", { values: { b: 2 } });
  sh.n("pin", "multiply", { values: { b: 0.6 } });
  sh.n("m0", "smoothstep", {});
  sh.n("m1", "oneMinus", {});
  sh.n("cap0", "smoothstep", { values: { edge1: 0.9, edge2: 1 } });
  sh.n("cap", "oneMinus", {});
  sh.n("shape", "multiply", {});
  s.w("us.g", "vp.a").w("vp.out", "vs.a").w("vs.out", "pr0.a").w("pr0.out", "pr.a").w(sh.po("tailWidth"), "pr.b").w("us.r", "ud.a").w("ud.out", "ua.in").w("ua.out", "ac.a")
    .w("pr.out", "pin.a").w("pin.out", "m0.edge1").w("pr.out", "m0.edge2").w("ac.out", "m0.in").w("m0.out", "m1.in").w("us.g", "cap0.in").w("cap0.out", "cap.in").w("m1.out", "shape.a").w("cap.out", "shape.b");

  const n = s.block("noise", "Scrolling noise", "`uv' = (u·tileX + random, v·tileY − age·scroll)`: the random number offsets the pattern per particle so no two sparks match, and the pattern slides down the tail as the particle ages. One texture fetch.", { col: 1, row: 1, color: COLORS.cyan });
  n.n("tl", "combine", {});
  n.n("sc", "multiply", {});
  n.n("neg", "negate", {});
  n.n("off", "combine", {});
  n.n("nuv", "uvTilingOffset", {});
  n.n("ns", "sampleTexture2D", {});
  n.n("nr", "split", {});
  s.w(n.po("tileX"), "tl.r").w(n.po("tileY"), "tl.g").w("age.normalized", "sc.a").w(n.po("scroll"), "sc.b").w("sc.out", "neg.in").w("rnd.value", "off.r").w("neg.out", "off.g")
    .w("uv.out", "nuv.uv").w("tl.rg", "nuv.tiling").w("off.rg", "nuv.offset").w(n.po("noiseMap"), "ns.tex").w("nuv.out", "ns.uv").w("ns.rgb", "nr.in");

  const d = s.block("dissolve", "Age-driven dissolve", "`noise' = lerp(noise, v, tailBias)` — the head (v = 1) keeps the highest values and survives longest. `amount = age^curve` drives the shared **Soft Edge Dissolve** subgraph, which returns the alpha mask and the glowing band just inside the cut.", { col: 2, row: 0, color: COLORS.orange });
  d.n("nb", "lerp", {});
  d.n("amt", "power", {});
  d.sub("dis", "ks_soft_dissolve", { label: "Age Dissolve" });
  s.w("nr.r", "nb.a").w("us.g", "nb.b", "Along").w(d.po("tailBias"), "nb.t").w("age.normalized", "amt.a", "Age").w(d.po("ageCurve"), "amt.b")
    .w("nb.out", "dis.noise").w("amt.out", "dis.amount").w(d.po("edgeWidth"), "dis.edgeWidth").w(d.po("softness"), "dis.softness");

  const c = s.block("color", "Colour + alpha", "`body = lerp(tail, head, v)`; `colour = (body + edgeColor × edge × intensity) × particle colour`; alpha = shape × dissolve alpha × particle alpha.", { col: 3, color: COLORS.yellow });
  c.n("body", "lerp", {});
  c.n("eg", "multiply", {});
  c.n("ei", "multiply", {});
  c.n("sum", "add", {});
  c.n("tint", "multiply", {});
  c.n("a1", "multiply", {});
  c.n("a2", "multiply", {});
  s.w(c.po("tailColor"), "body.a").w(c.po("headColor"), "body.b").w("us.g", "body.t", "Along").w("dis.edge", "eg.a").w(c.po("edgeColor"), "eg.b").w("eg.out", "ei.a").w(c.po("edgeIntensity"), "ei.b")
    .w("body.out", "sum.a").w("ei.out", "sum.b").w("sum.out", "tint.a").w("pc.rgb", "tint.b").w("shape.out", "a1.a").w("dis.alpha", "a1.b").w("a1.out", "a2.a").w("pc.a", "a2.b");

  const o = s.block("out", "Master output (URP VFX Unlit, additive)", "Additive blend, ZWrite off, two-sided.", { col: 4, color: COLORS.violet });
  s.master(o);
  s.w("tint.out", "master.baseColor").w("a2.out", "master.alpha");
  return s;
}
export const dissolveTrailSample: SampleModule = { meta, build };
