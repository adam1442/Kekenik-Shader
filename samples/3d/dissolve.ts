import { COLORS } from "../build/canvas";
import { P, Sample } from "../build/dsl";
import type { SampleModule } from "../build/emit";
import { softDissolve, triplanar } from "../lib";
import { fbm, heightTex } from "../textures/gen";
import { ALL_TARGETS, defineMeta } from "./common";

const meta = defineMeta({
  id: "dissolve-glow-edge", title: "Dissolve with Glowing Edge",
  description: "Noise-driven dissolve with a soft, HDR glowing edge. The pattern is projected triplanar in world space, so it works on any mesh without UVs; alpha clip makes it shadow-correct.",
  tags: ["dissolve", "emission", "alpha-clip", "triplanar", "vfx"], category: "3D / Lit", difficulty: "Intermediate", targets: ALL_TARGETS,
  compatNotes: ["Alpha clip is on (threshold 0.5); the soft border is generated before the clip, so the edge band stays crisp."], requiredFeatures: [],
  budgetClass: "Mobile", godotProfile: "godot.spatial", reusableSubgraphs: ["ks_soft_dissolve", "ks_triplanar"],
  previewConfig: { mode: "3d", mesh: "torus", lighting: { lit: "lit", azimuth: 30, elevation: 45 } },
});
const noise = heightTex(fbm(128, 128, 4, 4, 77), "Seeded tileable fractal noise (dissolve pattern)");

function build(): Sample {
  const s = new Sample({ id: meta.id, name: meta.title, profile: "unity.urp.lit", settings: { alphaClip: true } });
  s.add(
    P.tex("noiseTex", "Dissolve Noise", { default: "grey", tooltip: "Greyscale pattern: dark areas dissolve first.", category: "Dissolve" }),
    P.float("amount", "Dissolve", { default: 0.4, min: 0, max: 1, tooltip: "0 = fully visible, 1 = fully dissolved. Animate this from gameplay.", category: "Dissolve" }),
    P.float("tile", "Noise Tiling", { default: 1.4, min: 0.2, max: 6, tooltip: "Noise repeats per world unit.", category: "Dissolve" }),
    P.float("softness", "Edge Softness", { default: 0.02, min: 0, max: 0.2, tooltip: "Feathering of the cut.", category: "Dissolve" }),
    P.float("edgeWidth", "Edge Width", { default: 0.09, min: 0, max: 0.4, tooltip: "Width of the glowing band.", category: "Edge" }),
    P.color("edgeColor", "Edge Color", { default: [5, 1.4, 0.25], hdr: true, tooltip: "HDR emission of the edge (values above 1 bloom).", category: "Edge" }),
    P.color("baseTint", "Base Color", { default: [0.62, 0.66, 0.74], tooltip: "Surface colour (sRGB).", category: "Surface" }),
    P.float("smoothness", "Smoothness", { default: 0.45, min: 0, max: 1, tooltip: "Surface smoothness.", category: "Surface" }),
  );
  s.texture("noiseTex", "dissolve-noise", noise);
  s.use(triplanar()).use(softDissolve());

  const g = s.block("geo", "Geometry", "World position + normal feed the triplanar projection (shared through portals).", { col: 0, color: COLORS.blue });
  g.n("wpos", "position", { params: { space: "world" } });
  g.n("wnrm", "normal", { params: { space: "world" } });

  const n = s.block("noise", "Triplanar noise", "The noise texture is projected on three axes (**Triplanar** kit) and the red channel is the dissolve pattern — dark = gone first.", { col: 1, color: COLORS.violet });
  n.sub("tri", "ks_triplanar", { label: "Noise" });
  n.n("r", "split", {});
  s.w("wpos.out", "tri.pos", "WorldPos").w("wnrm.out", "tri.normal", "WorldNormal").w(n.po("noiseTex"), "tri.tex").w(n.po("tile"), "tri.tile").w("tri.rgb", "r.in");

  const d = s.block("cut", "Soft dissolve", "The **Soft Dissolve** kit turns *noise + amount* into an alpha mask and a thin edge band. Alpha feeds the alpha-clip; the band feeds emission.", { col: 2, color: COLORS.orange });
  d.sub("dis", "ks_soft_dissolve", { label: "Dissolve" });
  s.w("r.r", "dis.noise").w(d.po("amount"), "dis.amount").w(d.po("edgeWidth"), "dis.edgeWidth").w(d.po("softness"), "dis.softness");

  const e = s.block("emit", "Glowing edge", "`emission = edge × edge colour` (HDR). The surface itself stays a plain tinted dielectric.", { col: 3, color: COLORS.red });
  e.n("glow", "multiply", {});
  s.w("dis.edge", "glow.a").w(e.po("edgeColor"), "glow.b");

  const o = s.block("out", "Master output (URP Lit, alpha clip)", "Alpha clip is enabled in the graph settings; the threshold is 0.5.", { col: 4, color: COLORS.cyan });
  s.master(o);
  o.n("half", "float", { values: { x: 0.5 } });
  s.w(o.po("baseTint"), "master.baseColor").w(o.po("smoothness"), "master.smoothness").w("glow.out", "master.emission").w("dis.alpha", "master.alpha").w("half.out", "master.alphaClipThreshold");
  return s;
}
export const dissolveSample: SampleModule = { meta, build };
