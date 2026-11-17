import { COLORS } from "../build/canvas";
import { P, Sample } from "../build/dsl";
import type { SampleModule } from "../build/emit";
import { defineMeta } from "../3d/common";
import { GODOT_VFX, VFX_PROFILE, envelope } from "./common";

const meta = defineMeta({
  id: "vfx-shockwave", title: "Shockwave Ripple Distortion",
  description: "Expanding shockwave on a billboard quad: a gaussian ring travels outwards and displaces the screen behind it (opaque scene colour sampled at a ripple-offset screen UV) while a thin HDR ring highlights the wavefront. The ring fades out over the particle's lifetime and the quad edge is masked by a round falloff.",
  tags: ["shockwave", "ripple", "distortion", "refraction", "explosion", "particles", "vfx"], category: "VFX / Particles", difficulty: "Intermediate", targets: ["glsl", "unity", "godot"],
  compatNotes: ["Needs the opaque scene colour: Unity URP asset → Opaque Texture on; Godot hint_screen_texture. Not available in the HLSL / WGSL snippet targets.", "Ring speed is in quad-UV units per second: set it to about 0.5 / Lifetime so the ring just reaches the quad edge as the particle dies; grow the quad with Size over Lifetime."],
  requiredFeatures: ["URP Opaque Texture"], budgetClass: "Mobile", godotProfile: GODOT_VFX,
  previewConfig: {
    mode: "vfx", mesh: "quad", background: { mode: "gradient", ground: "grid" },
    emitter: { rate: 0.55, lifetime: 1.8, lifetimeVar: 0, sizeStart: 0.5, sizeEnd: 3.4, speed: 0, spread: 0, gravity: [0, 0, 0], maxParticles: 4, colorOverLife: envelope(1, 0.02) },
    simulation: { depthTexture: true, opaqueTexture: true },
  },
});

function build(): Sample {
  const s = new Sample({ id: meta.id, name: meta.title, profile: VFX_PROFILE, settings: { blend: "alpha", zwrite: "off", cull: "off" } });
  s.add(
    P.float("lifetime", "Lifetime", { default: 1.8, min: 0.3, max: 6, tooltip: "Particle lifetime in seconds (must match the emitter): converts the normalised age to seconds.", category: "Wave" }),
    P.float("speed", "Ring Speed", { default: 0.26, min: 0.05, max: 1.5, tooltip: "Ring radius growth in quad-UV units per second (≈ 0.5 / Lifetime reaches the quad edge).", category: "Wave" }),
    P.float("width", "Ring Width", { default: 0.07, min: 0.01, max: 0.3, tooltip: "Width of the wavefront (UV units).", category: "Wave" }),
    P.float("frequency", "Ripple Frequency", { default: 16, min: 2, max: 60, tooltip: "Oscillations inside the ring envelope.", category: "Wave" }),
    P.float("amplitude", "Amplitude", { default: 0.04, min: 0, max: 0.2, tooltip: "UV displacement of the ripple.", category: "Distortion" }),
    P.float("screenScale", "Screen Scale", { default: 0.6, min: 0, max: 3, tooltip: "Converts the quad-local displacement to screen UV (grows with the on-screen size of the quad).", category: "Distortion" }),
    P.color("ringColor", "Ring Color", { default: [0.5, 0.8, 1.6], hdr: true, tooltip: "HDR colour of the wavefront highlight.", category: "Highlight" }),
    P.float("glow", "Ring Glow", { default: 0.5, min: 0, max: 3, tooltip: "Brightness of the wavefront highlight (0 = pure distortion).", category: "Highlight" }),
    P.float("edgeFade", "Edge Fade", { default: 0.4, min: 0.2, max: 0.49, tooltip: "Distance from the quad centre where the effect starts fading out (UV units).", category: "Wave" }),
  );

  const i = s.block("inputs", "Particle inputs", "Quad UV, the particle age in seconds (normalised age × lifetime), particle colour and the screen UV of the fragment.", { col: 0, color: COLORS.blue });
  i.n("uv", "uv", {});
  i.n("age", "particleAge", { params: { mode: "normalized" } });
  i.n("pc", "particleColor", {});
  i.n("sp", "screenPosition", {});
  i.n("secs", "multiply", {});
  s.w("age.normalized", "secs.a").w(i.po("lifetime"), "secs.b");

  const r = s.block("ripple", "Ripple", "The **Ripple Shockwave** node: ring radius `speed × t`, gaussian envelope of the given width, `sin` ripple inside it, faded over the lifetime. *offset* is the UV displacement, *strength* the ring envelope (0…1).", { col: 1, color: COLORS.green });
  r.n("rip", "rippleShockwave", {});
  s.w("uv.out", "rip.uv").w("secs.out", "rip.time", "AgeSeconds").w(r.po("speed"), "rip.speed").w(r.po("width"), "rip.width").w(r.po("frequency"), "rip.frequency").w(r.po("amplitude"), "rip.amplitude").w(r.po("lifetime"), "rip.lifetime");

  const d = s.block("refract", "Screen distortion", "`sceneColor(screenUV + offset × screenScale)` — the opaque texture read at a displaced coordinate. The highlight adds `ringColor × strength × glow` on the wavefront.", { col: 2, row: 0, color: COLORS.cyan });
  d.n("off", "multiply", {});
  d.n("suv", "add", {});
  d.n("scene", "sceneColor", {});
  d.n("hl", "multiply", {});
  d.n("hl2", "multiply", {});
  d.n("col", "add", {});
  s.w("rip.offset", "off.a").w(d.po("screenScale"), "off.b").w("sp.normalized", "suv.a", "ScreenUV").w("off.out", "suv.b").w("suv.out", "scene.uv")
    .w(d.po("ringColor"), "hl.a").w("rip.strength", "hl.b").w("hl.out", "hl2.a").w(d.po("glow"), "hl2.b").w("scene.out", "col.a").w("hl2.out", "col.b");

  const m = s.block("mask", "Round mask", "`1 − smoothstep(edgeFade, 0.5, |uv − ½|)`: the quad's square border never shows. Alpha = mask × particle alpha.", { col: 2, row: 1, color: COLORS.yellow });
  m.n("dist", "distance", { values: { b: [0.5, 0.5] } });
  m.n("sm", "smoothstep", { values: { edge2: 0.5 } });
  m.n("round", "oneMinus", {});
  m.n("al", "multiply", {});
  s.w("uv.out", "dist.a").w(m.po("edgeFade"), "sm.edge1").w("dist.out", "sm.in").w("sm.out", "round.in").w("round.out", "al.a").w("pc.a", "al.b");

  const o = s.block("out", "Master output (URP VFX Unlit, alpha)", "Distorted scene colour with the round alpha mask.", { col: 3, color: COLORS.violet });
  s.master(o);
  s.w("col.out", "master.baseColor").w("al.out", "master.alpha");
  return s;
}
export const shockwaveSample: SampleModule = { meta, build };
