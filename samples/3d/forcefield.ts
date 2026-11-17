import { COLORS } from "../build/canvas";
import { P, Sample } from "../build/dsl";
import type { SampleModule } from "../build/emit";
import { depthIntersect, fresnelKit } from "../lib";
import { defineMeta } from "./common";

const meta = defineMeta({
  id: "force-field", title: "Force Field (Depth Intersection)",
  description: "Additive energy shield: scrolling hexagon grid, fresnel rim, a pulse, and a bright contact line wherever other geometry intersects the shield (scene-depth based).",
  tags: ["force-field", "shield", "depth", "intersection", "additive", "vfx"], category: "3D / Lit", difficulty: "Advanced", targets: ["glsl", "unity", "godot"],
  compatNotes: ["Scene Depth is an engine resource: not available in the HLSL / WGSL snippet targets.", "Add the Depth-Intersector object in the Preview toolbar to see the contact line."],
  requiredFeatures: ["URP Depth Texture"], budgetClass: "Desktop", godotProfile: "godot.spatial", reusableSubgraphs: ["ks_depth_intersect", "ks_fresnel_kit"],
  previewConfig: { mode: "3d", mesh: "sphere", lighting: { lit: "unlit" }, background: { mode: "dark" }, intersector: { kind: "box", position: [0.1, -0.05, 0.3], scale: 0.5 }, simulation: { depthTexture: true, opaqueTexture: true } },
});

function build(): Sample {
  const s = new Sample({ id: meta.id, name: meta.title, profile: "unity.urp.unlit", settings: { blend: "additive", zwrite: "off", cull: "off" } });
  s.add(
    P.color("fieldColor", "Field Color", { default: [0.1, 0.65, 1.6], hdr: true, tooltip: "HDR colour of the shield.", category: "Look" }),
    P.color("contactColor", "Contact Color", { default: [1.6, 2.2, 3], hdr: true, tooltip: "HDR colour of the intersection line.", category: "Look" }),
    P.float("baseOpacity", "Base Opacity", { default: 0.06, min: 0, max: 0.5, tooltip: "Faint fill so the shield is visible between the lines.", category: "Look" }),
    P.float("hexScale", "Hex Scale", { default: 7, min: 1, max: 24, tooltip: "Hexagon cells across the UV range.", category: "Grid" }),
    P.float("hexWidth", "Line Width", { default: 0.1, min: 0.01, max: 0.4, tooltip: "Width of the hexagon lines.", category: "Grid" }),
    P.vec2("scroll", "Scroll", { default: [0, 0.12], tooltip: "UV scroll speed of the grid (units per second).", category: "Grid" }),
    P.float("contactDistance", "Contact Distance", { default: 0.3, min: 0.02, max: 1.5, tooltip: "World-space reach of the intersection glow.", category: "Intersection" }),
    P.float("rimPower", "Rim Power", { default: 2.5, min: 0.5, max: 8, tooltip: "Rim falloff.", category: "Rim" }),
    P.float("rimIntensity", "Rim Intensity", { default: 1, min: 0, max: 3, tooltip: "Strength of the rim.", category: "Rim" }),
    P.float("pulseSpeed", "Pulse Speed", { default: 1.6, min: 0, max: 6, tooltip: "Speed of the brightness pulse (0 = steady).", category: "Rim" }),
  );
  s.use(depthIntersect()).use(fresnelKit());

  const i = s.block("inputs", "Inputs", "UV for the grid, normal + view direction for the rim, and time.", { col: 0, color: COLORS.blue });
  i.n("uv", "uv", {});
  i.n("nrm", "normal", { params: { space: "world" } });
  i.n("vdir", "viewDirection", { params: { space: "world" } });
  i.n("t", "time", {});

  const h = s.block("hex", "Scrolling hex grid", "UV is offset by `scroll × time`, then the **Hexagon pattern** node returns the distance to the cell border; `1 − smoothstep(0, width, edge)` gives crisp lines.", { col: 1, row: 0, color: COLORS.green });
  h.n("off", "multiply", {});
  h.n("uvs", "add", {});
  h.n("hex", "patternHex", {});
  h.n("sm", "smoothstep", { values: { edge1: 0 } });
  h.n("lines", "oneMinus", {});
  s.w(h.po("scroll"), "off.a").w("t.time", "off.b", "Time").w("uv.out", "uvs.a", "UV").w("off.out", "uvs.b").w("uvs.out", "hex.p").w(h.po("hexScale"), "hex.scale")
    .w(h.po("hexWidth"), "sm.edge2").w("hex.edge", "sm.in").w("sm.out", "lines.in");

  const r = s.block("rim", "Rim + pulse", "The **Fresnel kit** lights the silhouette; a slow pulse `½ + ½ sin(t × speed)` modulates the grid so the shield breathes.", { col: 1, row: 1, color: COLORS.cyan });
  r.sub("fres", "ks_fresnel_kit", { label: "Rim" });
  r.n("pt", "multiply", {});
  r.n("ps", "sin", {});
  r.n("pulse", "remap", { values: { inMin: -1, inMax: 1, outMin: 0.55, outMax: 1 } });
  s.w("nrm.out", "fres.normal", "N").w("vdir.out", "fres.viewDir", "V").w(r.po("fieldColor"), "fres.color").w(r.po("rimPower"), "fres.power").w(r.po("rimIntensity"), "fres.intensity")
    .w("t.time", "pt.a", "Time").w(r.po("pulseSpeed"), "pt.b").w("pt.out", "ps.in").w("ps.out", "pulse.in");

  const d = s.block("contact", "Depth intersection", "The **Depth Intersection** kit measures the gap between the opaque scene behind the shield and the shield itself. `contact = (1 − fade)²` is a bright line that thins out smoothly where geometry pierces the field.", { col: 2, color: COLORS.red });
  d.sub("depth", "ks_depth_intersect", { label: "Contact" });
  d.n("c1", "oneMinus", {});
  d.n("c2", "multiply", {});
  s.w(d.po("contactDistance"), "depth.distance").w("depth.fade", "c1.in").w("c1.out", "c2.a").w("c1.out", "c2.b");

  const m = s.block("mix", "Combine", "`brightness = lines × pulse + rim + opacity`; the contact line is added in its own (brighter) colour. Additive blending makes brightness the opacity.", { col: 3, color: COLORS.orange });
  m.n("lp", "multiply", {});
  m.n("b1", "add", {});
  m.n("b2", "add", {});
  m.n("body", "multiply", {});
  m.n("cc", "multiply", {});
  m.n("final", "add", {});
  s.w("lines.out", "lp.a").w("pulse.out", "lp.b").w("lp.out", "b1.a").w("fres.rim", "b1.b").w("b1.out", "b2.a").w(m.po("baseOpacity"), "b2.b")
    .w(m.po("fieldColor"), "body.a").w("b2.out", "body.b").w(m.po("contactColor"), "cc.a").w("c2.out", "cc.b").w("body.out", "final.a").w("cc.out", "final.b");

  const o = s.block("out", "Master output (URP Unlit, additive)", "Additive, ZWrite off, two-sided — set in the graph settings.", { col: 4, color: COLORS.violet });
  s.master(o);
  s.w("final.out", "master.baseColor");
  return s;
}
export const forceFieldSample: SampleModule = { meta, build };
