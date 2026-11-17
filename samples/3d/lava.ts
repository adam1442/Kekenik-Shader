import { COLORS } from "../build/canvas";
import { P, Sample } from "../build/dsl";
import type { SampleModule } from "../build/emit";
import { colorRamp3, flowSample } from "../lib";
import { lavaCrust } from "../textures/gen-surface";
import { waterTextures } from "../textures/gen";
import { ALL_TARGETS, defineMeta } from "./common";

const meta = defineMeta({
  id: "lava-flow", title: "Lava with Flow Map",
  description: "Molten rock: cooled crust plates drift along a flow map while glowing cracks pulse underneath. Two flow-map layers at different speeds give depth, a 3-stop HDR colour ramp turns heat into emission, and the crust gets a derivative bump so the plates feel solid.",
  tags: ["lava", "flow-map", "emission", "heat", "hdr", "crust", "lit"], category: "3D / Lit", difficulty: "Advanced", targets: ALL_TARGETS,
  compatNotes: ["Import the flow map and the crust map as linear data (no sRGB). Flow vectors live in R, G (0.5 = still).", "Emission is HDR; enable Bloom (preview default) to get the glow."],
  requiredFeatures: [], budgetClass: "Desktop", godotProfile: "godot.spatial", thumbnailSlot: "emission", reusableSubgraphs: ["ks_flow_sample", "ks_color_ramp3"],
  previewConfig: { mode: "3d", mesh: "sphere", lighting: { lit: "lit", azimuth: 30, elevation: 40, intensity: 0.7, envIntensity: 0.5 }, background: { mode: "dark" } },
});

function build(): Sample {
  const s = new Sample({ id: meta.id, name: meta.title, profile: "unity.urp.lit" });
  const w = waterTextures(128, 21);
  s.add(
    P.tex("crustMap", "Crust Map", { default: "black", tooltip: "R = heat (1 in the cracks), G = fine detail. Linear data.", category: "Maps" }),
    P.tex("flowMap", "Flow Map", { default: "grey", tooltip: "RG flow vectors (0.5 = still). Linear data.", category: "Maps" }),
    P.float("tiling", "Tiling", { default: 2.5, min: 0.5, max: 10, tooltip: "Texture repeats across the UV range.", category: "Maps" }),
    P.float("flowStrength", "Flow Distance", { default: 0.22, min: 0, max: 0.8, tooltip: "UV distance the crust travels per cycle.", category: "Flow" }),
    P.float("flowSpeed", "Flow Speed", { default: 0.12, min: 0, max: 1, tooltip: "Flow cycles per second.", category: "Flow" }),
    P.float("heatBias", "Heat Bias", { default: 0, min: -0.5, max: 0.5, tooltip: "Positive = wider glowing cracks, negative = more crust.", category: "Heat" }),
    P.color("crustColor", "Crust Color", { default: [0.05, 0.035, 0.03], tooltip: "Albedo of the cooled rock.", category: "Heat" }),
    P.color("coldColor", "Cool Glow", { default: [0.35, 0.02, 0], hdr: true, tooltip: "HDR emission at the cool edge of a crack.", category: "Heat" }),
    P.color("midColor", "Mid Glow", { default: [2.2, 0.55, 0.05], hdr: true, tooltip: "HDR emission in the middle of a crack.", category: "Heat" }),
    P.color("hotColor", "Hot Glow", { default: [4, 2.6, 0.7], hdr: true, tooltip: "HDR emission in the hottest spots.", category: "Heat" }),
    P.float("intensity", "Glow Intensity", { default: 1.4, min: 0, max: 6, tooltip: "Overall emission multiplier.", category: "Heat" }),
    P.float("pulse", "Pulse", { default: 0.3, min: 0, max: 1, tooltip: "Breathing of the glow over time (0 = steady).", category: "Heat" }),
    P.float("bump", "Crust Bump", { default: 1.2, min: 0, max: 4, tooltip: "Strength of the crust normal bump.", category: "Surface" }),
    P.float("smoothness", "Crust Smoothness", { default: 0.12, min: 0, max: 1, tooltip: "Smoothness of the crust (molten parts are glossier).", category: "Surface" }),
  );
  s.texture("crustMap", "lava-crust", lavaCrust(128, 17)).texture("flowMap", "lava-flow", w.flow);
  s.use(flowSample()).use(colorRamp3());

  const g = s.block("uv", "UV + time", "Tiled UV; a second UV set is offset so the two flow layers never line up.", { col: 0, color: COLORS.blue });
  g.n("uv", "uv", {});
  g.n("tile", "uvTilingOffset", {});
  g.n("pack", "combine", {});
  g.n("tile2", "uvTilingOffset", { values: { offset: [0.37, 0.61] } });
  g.n("t", "time", {});
  s.w(g.po("tiling"), "pack.r").w(g.po("tiling"), "pack.g").w("uv.out", "tile.uv").w("pack.rg", "tile.tiling").w("uv.out", "tile2.uv").w("pack.rg", "tile2.tiling");

  const f = s.block("flow", "Two flow layers", "Two **Flow Map Sample** kits advect the crust map along the same flow field: layer B is slightly slower, pushed further and offset in UV. Their heat values are mixed 65 / 35 so the crust seems to slide over a deeper layer.", { col: 1, color: COLORS.cyan });
  f.sub("a", "ks_flow_sample", { label: "Layer A" });
  f.sub("b", "ks_flow_sample", { label: "Layer B (deeper)" });
  f.n("sb", "multiply", { values: { b: 0.6 } });
  f.n("fb", "multiply", { values: { b: 1.4 } });
  s.w(f.po("crustMap"), "a.tex").w(f.po("flowMap"), "a.flow").w("tile.out", "a.uv", "TiledUV").w("t.time", "a.time", "Time").w(f.po("flowStrength"), "a.strength").w(f.po("flowSpeed"), "a.speed")
    .w(f.po("crustMap"), "b.tex").w(f.po("flowMap"), "b.flow").w("tile2.out", "b.uv").w("t.time", "b.time").w(f.po("flowStrength"), "fb.a").w("fb.out", "b.strength").w(f.po("flowSpeed"), "sb.a").w("sb.out", "b.speed");

  const h = s.block("heat", "Heat", "`heat = saturate(mix(A.r, B.r, 0.35) + bias)`. *Crust* is the opposite; the green channel adds fine rock detail to the albedo.", { col: 2, row: 0, color: COLORS.orange });
  h.n("as", "split", {});
  h.n("bs", "split", {});
  h.n("mix", "lerp", { values: { t: 0.35 } });
  h.n("hb", "add", {});
  h.n("heat", "saturate", {});
  h.n("crust", "oneMinus", {});
  h.n("det", "remap", { values: { inMin: 0, inMax: 1, outMin: 0.6, outMax: 1.3 } });
  h.n("alb", "multiply", {});
  s.w("a.color", "as.in").w("b.color", "bs.in").w("as.r", "mix.a").w("bs.r", "mix.b").w("mix.out", "hb.a").w(h.po("heatBias"), "hb.b").w("hb.out", "heat.in").w("heat.out", "crust.in")
    .w("as.g", "det.in").w(h.po("crustColor"), "alb.a").w("det.out", "alb.b");

  const e = s.block("glow", "Glow", "The **Color Ramp** maps heat to cool → mid → hot HDR colours. A mask `smoothstep(0.05, 0.5, heat)` stops the crust from emitting; a pulse `1 + pulse × ½ sin(2t + 6·heat)` makes the cracks breathe out of phase.", { col: 2, row: 1, color: COLORS.red });
  e.sub("ramp", "ks_color_ramp3", { label: "Heat Ramp" });
  e.n("mask", "smoothstep", { values: { edge1: 0.05, edge2: 0.5 } });
  e.n("t2", "multiply", { values: { b: 2 } });
  e.n("h6", "multiply", { values: { b: 6 } });
  e.n("ph", "add", {});
  e.n("sn", "sin", {});
  e.n("pk", "multiply", { values: { b: 0.5 } });
  e.n("pm", "multiply", {});
  e.n("pulse", "add", { values: { b: 1 } });
  e.n("c1", "multiply", {});
  e.n("c2", "multiply", {});
  e.n("c3", "multiply", {});
  s.w("heat.out", "ramp.t").w(e.po("coldColor"), "ramp.cold").w(e.po("midColor"), "ramp.mid").w(e.po("hotColor"), "ramp.hot").w("heat.out", "mask.in").w("heat.out", "h6.a").w("t.time", "t2.a").w("t2.out", "ph.a").w("h6.out", "ph.b")
    .w("ph.out", "sn.in").w("sn.out", "pk.a").w("pk.out", "pm.a").w(e.po("pulse"), "pm.b").w("pm.out", "pulse.a")
    .w("ramp.color", "c1.a").w("mask.out", "c1.b").w("c1.out", "c2.a").w("pulse.out", "c2.b").w("c2.out", "c3.a").w(e.po("intensity"), "c3.b");

  const n = s.block("surf", "Crust bump + gloss", "**Height To Normal** (fast kernel) of the crust (1 − heat) gives raised plates between the cracks. Smoothness blends from *Crust Smoothness* to 0.8 with heat — molten rock is glossy.", { col: 3, color: COLORS.green });
  n.n("nrm", "heightToNormal", { params: { quality: "fast" } });
  n.n("sm", "lerp", { values: { b: 0.8 } });
  s.w("crust.out", "nrm.height").w("tile.out", "nrm.uv").w(n.po("bump"), "nrm.strength").w(n.po("smoothness"), "sm.a").w("heat.out", "sm.t");

  const o = s.block("out", "Master output (URP Lit)", "Dark crust albedo, bump normal, heat-driven smoothness and HDR emission.", { col: 4, color: COLORS.violet });
  s.master(o);
  s.w("alb.out", "master.baseColor").w("nrm.normal", "master.normalTS").w("sm.out", "master.smoothness").w("c3.out", "master.emission");
  return s;
}
export const lavaFlowSample: SampleModule = { meta, build };
