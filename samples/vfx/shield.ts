import { COLORS } from "../build/canvas";
import { P, Sample } from "../build/dsl";
import type { SampleModule } from "../build/emit";
import { fresnelKit } from "../lib";
import { ALL_TARGETS, defineMeta } from "../3d/common";

const meta = defineMeta({
  id: "vfx-shield-aura", title: "Shield Aura with Hit Ripple",
  description: "Energy shield on a sphere: a fresnel rim, a flickering hexagon grid and an expanding hit ripple. The ripple is driven by two parameters (impact position in object space and seconds since the hit), so gameplay code can trigger it on any point; an Auto Hit switch replays it in the preview.",
  tags: ["shield", "fresnel", "hex-grid", "ripple", "hit", "hdr", "additive", "vfx"], category: "VFX / Particles", difficulty: "Intermediate", targets: ALL_TARGETS,
  compatNotes: ["Additive, two-sided, ZWrite off. Needs Bloom for the HDR glow.", "Hit Position is in OBJECT space (the shield's local coordinates); set Hit Time = Time.time − impactTime from a script, or switch Auto Hit on for a looping demo.", "The hex grid uses mesh UVs scaled 2:1 (U wraps the equator), so cells pinch slightly at the poles of a UV sphere."],
  requiredFeatures: [], budgetClass: "Mobile", godotProfile: "godot.spatial", reusableSubgraphs: ["ks_fresnel_kit"],
  previewConfig: { mode: "3d", mesh: "sphere", lighting: { lit: "unlit" }, background: { mode: "dark", ground: "none" } },
});

function build(): Sample {
  const s = new Sample({ id: meta.id, name: meta.title, profile: "unity.urp.unlit", settings: { blend: "additive", zwrite: "off", cull: "off" } });
  s.add(
    P.color("shieldColor", "Shield Color", { default: [0.2, 0.8, 3], hdr: true, tooltip: "HDR colour of the rim and the hex grid (linear).", category: "Shield" }),
    P.float("intensity", "Intensity", { default: 1, min: 0, max: 3, tooltip: "Overall brightness of the shield.", category: "Shield" }),
    P.float("rimPower", "Rim Power", { default: 3, min: 0.5, max: 8, tooltip: "Fresnel exponent: higher = thinner rim.", category: "Rim" }),
    P.float("rimStrength", "Rim Strength", { default: 0.9, min: 0, max: 3, tooltip: "Brightness of the fresnel rim.", category: "Rim" }),
    P.float("hexDensity", "Hex Density", { default: 5, min: 1, max: 14, tooltip: "Hexagons per UV unit (vertical); the horizontal count is doubled.", category: "Hex Grid" }),
    P.float("lineWidth", "Line Width", { default: 0.12, min: 0.02, max: 0.4, tooltip: "Width of the hexagon outlines (share of the cell).", category: "Hex Grid" }),
    P.float("lineStrength", "Line Strength", { default: 0.7, min: 0, max: 2, tooltip: "Brightness of the hexagon outlines.", category: "Hex Grid" }),
    P.float("cellFlicker", "Cell Flicker", { default: 0.35, min: 0, max: 1, tooltip: "Brightness of the randomly pulsing cell fills (0 = off).", category: "Hex Grid" }),
    P.float("flickerSpeed", "Flicker Speed", { default: 2, min: 0, max: 8, tooltip: "Speed of the cell pulsing in radians per second.", category: "Hex Grid" }),
    P.color("hitColor", "Hit Color", { default: [3, 2.2, 1], hdr: true, tooltip: "HDR colour of the impact ripple (linear).", category: "Hit Ripple" }),
    P.vec3("hitPos", "Hit Position", { default: [0.5, 0.3, 0.8], tooltip: "Impact point in OBJECT space (local coordinates of the shield mesh).", category: "Hit Ripple" }),
    P.float("hitTime", "Hit Time", { default: 0.4, min: 0, max: 5, tooltip: "Seconds since the hit. Set from a script: Time.time − impact time.", category: "Hit Ripple" }),
    P.float("rippleSpeed", "Ripple Speed", { default: 1.6, min: 0.1, max: 5, tooltip: "Expansion speed of the ripple in object units per second.", category: "Hit Ripple" }),
    P.float("rippleWidth", "Ripple Width", { default: 0.16, min: 0.02, max: 0.6, tooltip: "Thickness of the ripple ring (object units).", category: "Hit Ripple" }),
    P.float("rippleLife", "Ripple Life", { default: 1.6, min: 0.3, max: 5, tooltip: "Seconds until the ripple has faded out.", category: "Hit Ripple" }),
    P.bool("autoHit", "Auto Hit (demo)", { default: true, tooltip: "On: Hit Time loops by itself every Ripple Life + 0.8 s (preview demo). Off: Hit Time is used.", category: "Hit Ripple" }),
  );
  s.use(fresnelKit());

  const i = s.block("inputs", "Surface inputs", "World normal / view direction for the fresnel, mesh UV for the hex grid and the OBJECT-space position for the ripple distance.", { col: 0, color: COLORS.blue });
  i.n("nrm", "normal", { params: { space: "world" } });
  i.n("vd", "viewDirection", { params: { space: "world" } });
  i.n("uv", "uv", {});
  i.n("pos", "position", { params: { space: "object" } });
  i.n("t", "time", {});

  const r = s.block("rim", "Fresnel rim", "The shared **Fresnel Rim Kit**: `(1 − N·V)^power`, scaled by *Rim Strength*. The rim makes the shield read as a volume.", { col: 1, row: 0, color: COLORS.cyan });
  r.sub("fr", "ks_fresnel_kit", { label: "Rim" });
  s.w("nrm.out", "fr.normal").w("vd.out", "fr.viewDir").w(r.po("rimPower"), "fr.power").w(r.po("rimStrength"), "fr.intensity");

  const h = s.block("hex", "Hex grid + cell flicker", "`uv × (2, 1)` keeps the hexagons round on a 2:1 UV sphere. *Edge* is 0 in the cell centre and 1 on the border, so the outline is `smoothstep(1 − width, 1, edge)`. Every cell gets a random phase from a hash of its ID, so the fills pulse out of sync. The sum is weighted by `0.25 + rim`: the grid shows mostly towards the silhouette.", { col: 1, row: 1, color: COLORS.green });
  h.n("uv2", "multiply", { values: { b: [2, 1] } });
  h.n("hexn", "patternHex", {});
  h.n("lw", "oneMinus", {});
  h.n("line", "smoothstep", { values: { edge2: 1 } });
  h.n("lines", "multiply", {});
  h.n("cid", "hash2to1", {});
  h.n("ph", "multiply", { values: { b: 6.2832 } });
  h.n("ts", "multiply", {});
  h.n("arg", "add", {});
  h.n("sn", "sin", {});
  h.n("pos01", "remap", {});
  h.n("fill0", "multiply", {});
  h.n("fill", "multiply", {});
  h.n("sum", "add", {});
  h.n("wt", "add", { values: { a: 0.25 } });
  h.n("gridTerm", "multiply", {});
  s.w("uv.out", "uv2.a").w("uv2.out", "hexn.p").w(h.po("hexDensity"), "hexn.scale").w(h.po("lineWidth"), "lw.in").w("lw.out", "line.edge1").w("hexn.edge", "line.in")
    .w("line.out", "lines.a").w(h.po("lineStrength"), "lines.b").w("hexn.id", "cid.in").w("cid.out", "ph.a").w("t.time", "ts.a", "Time").w(h.po("flickerSpeed"), "ts.b")
    .w("ts.out", "arg.a").w("ph.out", "arg.b").w("arg.out", "sn.in").w("sn.out", "pos01.in").w("pos01.out", "fill0.a").w("cid.out", "fill0.b").w("fill0.out", "fill.a").w(h.po("cellFlicker"), "fill.b")
    .w("lines.out", "sum.a").w("fill.out", "sum.b").w("fr.rim", "wt.b", "Rim").w("sum.out", "gridTerm.a").w("wt.out", "gridTerm.b");

  const rp = s.block("ripple", "Hit ripple", "Time since the hit is `T` (the *Hit Time* parameter, or a looping sawtooth when *Auto Hit* is on). The wavefront radius is `T × speed`; the ring is `1 − smoothstep(0, width, |distance(pos, hitPos) − radius|)` and it fades with `1 − T / life`. Inside the ring the hex outlines flash brighter (`ring × (0.6 + 1.6 × line)`), which makes the wave read as travelling through the grid.", { col: 2, row: 0, color: COLORS.orange });
  rp.n("cyc", "add", { values: { b: 0.8 } });
  rp.n("saw", "timeSawtooth", {});
  rp.n("autoT", "multiply", {});
  rp.n("T", "branch", {});
  rp.n("rad", "multiply", {});
  rp.n("dd", "distance", {});
  rp.n("diff", "subtract", {});
  rp.n("ad", "abs", {});
  rp.n("band", "smoothstep", { values: { edge1: 0 } });
  rp.n("ring", "oneMinus", {});
  rp.n("age", "divide", {});
  rp.n("ageI", "oneMinus", {});
  rp.n("fade", "saturate", {});
  rp.n("rf", "multiply", {});
  rp.n("lb", "multiply", { values: { b: 1.6 } });
  rp.n("lb2", "add", { values: { b: 0.6 } });
  rp.n("rippleTerm", "multiply", {});
  s.w(rp.po("rippleLife"), "cyc.a").w("t.time", "saw.t", "Time").w("cyc.out", "saw.period").w("saw.out", "autoT.a").w("cyc.out", "autoT.b").w(rp.po("autoHit"), "T.predicate").w("autoT.out", "T.true").w(rp.po("hitTime"), "T.false")
    .w("T.out", "rad.a").w(rp.po("rippleSpeed"), "rad.b").w("pos.out", "dd.a").w(rp.po("hitPos"), "dd.b").w("dd.out", "diff.a").w("rad.out", "diff.b").w("diff.out", "ad.in").w(rp.po("rippleWidth"), "band.edge2").w("ad.out", "band.in")
    .w("band.out", "ring.in").w("T.out", "age.a").w(rp.po("rippleLife"), "age.b").w("age.out", "ageI.in").w("ageI.out", "fade.in").w("ring.out", "rf.a").w("fade.out", "rf.b")
    .w("line.out", "lb.a", "HexLine").w("lb.out", "lb2.a").w("rf.out", "rippleTerm.a").w("lb2.out", "rippleTerm.b");

  const c = s.block("color", "Colour + alpha", "`base = rim + grid`; colour = (`shield × base + hit × ripple`) × intensity, alpha = saturate(base + ripple). The ripple has its own HDR colour so a hit reads as a different energy from the idle shield.", { col: 3, color: COLORS.yellow });
  c.n("base", "add", {});
  c.n("c1", "multiply", {});
  c.n("c2", "multiply", {});
  c.n("csum", "add", {});
  c.n("col", "multiply", {});
  c.n("a0", "add", {});
  c.n("a", "saturate", {});
  s.w("fr.rim", "base.a", "Rim").w("gridTerm.out", "base.b").w(c.po("shieldColor"), "c1.a").w("base.out", "c1.b").w(c.po("hitColor"), "c2.a").w("rippleTerm.out", "c2.b")
    .w("c1.out", "csum.a").w("c2.out", "csum.b").w("csum.out", "col.a").w(c.po("intensity"), "col.b").w("base.out", "a0.a").w("rippleTerm.out", "a0.b").w("a0.out", "a.in");

  const o = s.block("out", "Master output (URP Unlit, additive)", "Additive blend, ZWrite off, two-sided.", { col: 4, color: COLORS.violet });
  s.master(o);
  s.w("col.out", "master.baseColor").w("a.out", "master.alpha");
  return s;
}
export const shieldSample: SampleModule = { meta, build };
