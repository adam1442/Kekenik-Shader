import { COLORS } from "../build/canvas";
import { P, Sample } from "../build/dsl";
import type { SampleModule } from "../build/emit";
import { retroScene } from "../textures/gen-fx";
import { ALL_TARGETS, defineMeta } from "../3d/common";
import { SPRITE_PROFILE, SPRITE_PROP_ID, spriteTexProp } from "./common";

const meta = defineMeta({
  id: "sprite-crt", title: "CRT Monitor",
  description: "Old tube-TV look for any sprite or full-screen quad: barrel distortion with a rounded-off screen edge, radial chromatic aberration, scanlines that roll, an RGB phosphor mask, vignette and a faint power flicker.",
  tags: ["crt", "scanlines", "retro", "barrel", "chromatic-aberration", "phosphor", "2d"], category: "2D / Sprites", difficulty: "Intermediate", targets: ALL_TARGETS,
  compatNotes: ["Scanline and phosphor frequencies are in UV space (lines per sprite height): set Scanline Count to the sprite's pixel height for true pixel-aligned lines.", "Pixels outside the curved screen become transparent."],
  requiredFeatures: [], budgetClass: "Mobile", godotProfile: "godot.canvasitem",
  previewConfig: { mode: "2d", sprite: true, background: { mode: "dark" } },
});

function build(): Sample {
  const s = new Sample({ id: meta.id, name: meta.title, profile: SPRITE_PROFILE });
  s.add(
    spriteTexProp(),
    P.float("curvature", "Curvature", { default: 0.22, min: 0, max: 0.8, tooltip: "Barrel distortion of the screen (0 = flat).", category: "Screen" }),
    P.float("brightness", "Brightness", { default: 1.15, min: 0.5, max: 2.5, tooltip: "Overall brightness (compensates scanline / mask darkening).", category: "Screen" }),
    P.float("vignette", "Vignette", { default: 0.55, min: 0, max: 1, tooltip: "Darkening towards the screen corners.", category: "Screen" }),
    P.float("aberration", "Chromatic Aberration", { default: 0.012, min: 0, max: 0.05, tooltip: "Radial colour fringing (fraction of the distance from the centre).", category: "Signal" }),
    P.float("flicker", "Flicker", { default: 0.06, min: 0, max: 0.3, tooltip: "Amplitude of the 50 Hz brightness flicker.", category: "Signal" }),
    P.float("lines", "Scanline Count", { default: 120, min: 40, max: 480, tooltip: "Scanlines per sprite height.", category: "Scanlines" }),
    P.float("scanIntensity", "Scanline Intensity", { default: 0.45, min: 0, max: 1, tooltip: "Darkness between scanlines.", category: "Scanlines" }),
    P.float("scanSharp", "Scanline Sharpness", { default: 1.4, min: 0.5, max: 4, tooltip: "Thinner bright lines with higher values.", category: "Scanlines" }),
    P.float("roll", "Roll Speed", { default: 0.12, min: -1, max: 1, tooltip: "How fast the scanline pattern crawls (lines per second; 0 = static).", category: "Scanlines" }),
    P.float("maskDensity", "Phosphor Density", { default: 90, min: 20, max: 400, tooltip: "RGB phosphor triads across the sprite width.", category: "Phosphor" }),
    P.float("maskStrength", "Phosphor Strength", { default: 0.4, min: 0, max: 1, tooltip: "Visibility of the RGB mask (0 = off).", category: "Phosphor" }),
  );
  s.texture(SPRITE_PROP_ID, "retro-scene", retroScene(128, 128));

  const c = s.block("curve", "Barrel distortion + screen mask", "`c = uv − ½`, `uv' = ½ + c × (1 + curvature × |c|²)`: the screen edge samples further out than the centre. The same scaled vector gives the screen mask `1 − smoothstep(0.495, 0.5, max(|x|, |y|))`, so everything beyond the curved glass is transparent.", { col: 0, color: COLORS.blue });
  c.n("uv", "uv", {});
  c.n("c", "subtract", { values: { b: 0.5 } });
  c.n("r2", "dot", {});
  c.n("kr", "multiply", {});
  c.n("k", "add", { values: { b: 1 } });
  c.n("ck", "multiply", {});
  c.n("uvc", "add", { values: { b: 0.5 } });
  c.n("xy", "split", {});
  c.n("ax", "abs", {});
  c.n("ay", "abs", {});
  c.n("mx", "maximum", {});
  c.n("edge", "smoothstep", { values: { edge1: 0.495, edge2: 0.5 } });
  c.n("inside", "oneMinus", {});
  s.w("uv.out", "c.a").w("c.out", "r2.a").w("c.out", "r2.b").w("r2.out", "kr.a").w(c.po("curvature"), "kr.b").w("kr.out", "k.a").w("c.out", "ck.a").w("k.out", "ck.b").w("ck.out", "uvc.a")
    .w("ck.out", "xy.in").w("xy.r", "ax.in").w("xy.g", "ay.in").w("ax.out", "mx.a").w("ay.out", "mx.b").w("mx.out", "edge.in").w("edge.out", "inside.in");

  const t = s.block("tex", "Sprite + chromatic aberration", "The **Chromatic Aberration** node samples the sprite three times; red is pushed further from the centre than blue (radial mode), like a cheap lens.", { col: 1, row: 0, color: COLORS.cyan });
  t.n("ca", "chromaticAberration", { params: { mode: "radial" } });
  t.n("sp", "split", {});
  t.n("rgb", "combine", {});
  s.w(t.po(SPRITE_PROP_ID), "ca.tex").w("uvc.out", "ca.uv", "ScreenUV").w(t.po("aberration"), "ca.strength").w("ca.rgba", "sp.in").w("sp.r", "rgb.r").w("sp.g", "rgb.g").w("sp.b", "rgb.b");

  const sc = s.block("scan", "Scanlines + phosphor mask", "**CRT Scanlines** darken between lines (phase scrolls with time). The phosphor mask is three cosines `½ + ½cos(2π(x·density − k/3))` — one per channel, floor `1 − strength` — multiplied onto the colour.", { col: 2, row: 0, color: COLORS.green });
  sc.n("t", "time", {});
  sc.n("ph", "multiply", {});
  sc.n("crt", "crtScanlines", {});
  sc.n("ux", "split", {});
  sc.n("x", "multiply", {});
  sc.n("floor", "oneMinus", {});
  sc.n("m", "combine", {});
  sc.n("lit", "multiply", {});
  s.w("t.time", "ph.a", "Time").w(sc.po("roll"), "ph.b").w("rgb.rgb", "crt.color").w("uvc.out", "crt.coord").w(sc.po("lines"), "crt.lines").w(sc.po("scanIntensity"), "crt.intensity").w(sc.po("scanSharp"), "crt.sharpness").w("ph.out", "crt.phase")
    .w("uvc.out", "ux.in").w("ux.r", "x.a").w(sc.po("maskDensity"), "x.b").w(sc.po("maskStrength"), "floor.in");
  (["r", "g", "b"] as const).forEach((ch, k) => {
    sc.n(`o_${ch}`, "subtract", { values: { b: k / 3 } });
    sc.n(`t_${ch}`, "multiply", { values: { b: 6.28318530718 } });
    sc.n(`c_${ch}`, "cos", {});
    sc.n(`h_${ch}`, "remap", { values: { inMin: -1, inMax: 1, outMax: 1 } });
    s.w("x.out", `o_${ch}.a`).w(`o_${ch}.out`, `t_${ch}.a`).w(`t_${ch}.out`, `c_${ch}.in`).w(`c_${ch}.out`, `h_${ch}.in`).w("floor.out", `h_${ch}.outMin`).w(`h_${ch}.out`, `m.${ch}`);
  });
  s.w("crt.out", "lit.a").w("m.rgb", "lit.b");

  const f = s.block("final", "Vignette, flicker, gain", "`vignette = 1 − v × smoothstep(0.2, 0.72, |c'|)`; flicker = `1 − amount × ½(1 + sin(97t))`; the result is multiplied by *Brightness*.", { col: 3, color: COLORS.orange });
  f.n("len", "length", {});
  f.n("vs", "smoothstep", { values: { edge1: 0.2, edge2: 0.72 } });
  f.n("vk", "multiply", {});
  f.n("vig", "oneMinus", {});
  f.n("t97", "multiply", { values: { b: 97 } });
  f.n("sn", "sin", {});
  f.n("h", "remap", { values: { inMin: -1, inMax: 1, outMin: 0, outMax: 1 } });
  f.n("fk", "multiply", {});
  f.n("fl", "oneMinus", {});
  f.n("g1", "multiply", {});
  f.n("g2", "multiply", {});
  f.n("g3", "multiply", {});
  f.n("al", "multiply", {});
  s.w("ck.out", "len.in").w("len.out", "vs.in").w("vs.out", "vk.a").w(f.po("vignette"), "vk.b").w("vk.out", "vig.in").w("t.time", "t97.a").w("t97.out", "sn.in").w("sn.out", "h.in").w("h.out", "fk.a").w(f.po("flicker"), "fk.b").w("fk.out", "fl.in")
    .w("lit.out", "g1.a").w("vig.out", "g1.b").w("g1.out", "g2.a").w("fl.out", "g2.b").w("g2.out", "g3.a").w(f.po("brightness"), "g3.b").w("inside.out", "al.a").w("sp.a", "al.b");

  const o = s.block("out", "Master output (URP Sprite Unlit)", "Colour and the screen-shaped alpha.", { col: 4, color: COLORS.violet });
  s.master(o);
  s.w("g3.out", "master.baseColor").w("al.out", "master.alpha");
  return s;
}
export const crtSample: SampleModule = { meta, build };
