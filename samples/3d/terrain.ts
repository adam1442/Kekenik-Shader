import { COLORS } from "../build/canvas";
import { P, Sample } from "../build/dsl";
import type { SampleModule } from "../build/emit";
import { heightBlend4 } from "../lib";
import { terrainLayers } from "../textures/gen-surface";
import { ALL_TARGETS, defineMeta } from "./common";

const meta = defineMeta({
  id: "terrain-4-layer", title: "4-Layer Vertex-Color Terrain",
  description: "Grass, dirt, rock and snow blended by a weight vector — painted vertex colors (RGBA) or, by default, procedural weights from slope, height and a dirt-patch noise so it also looks right on unpainted meshes. A reusable Height Blend subgraph lets stones and tufts poke through each other.",
  tags: ["terrain", "vertex-color", "height-blend", "splat", "4-layer", "slope", "lit"], category: "3D / Lit", difficulty: "Advanced", targets: ALL_TARGETS,
  compatNotes: ["Use Vertex Colors = on reads RGBA weights (R grass, G dirt, B rock, A snow) from the mesh colour channel — paint them in your DCC tool or with a vertex painter.", "Layer heights are the albedo luminance, so no extra height maps are needed.", "Four texture fetches + one noise: Desktop class."],
  requiredFeatures: [], budgetClass: "Desktop", godotProfile: "godot.spatial", reusableSubgraphs: ["ks_height_blend4"],
  previewConfig: { mode: "3d", mesh: "sphere", lighting: { lit: "lit", azimuth: 45, elevation: 50, intensity: 1.3 } },
});

function build(): Sample {
  const s = new Sample({ id: meta.id, name: meta.title, profile: "unity.urp.lit" });
  const L = terrainLayers(128, 11);
  s.add(
    P.tex("grassMap", "Grass", { default: "white", tooltip: "Layer 1 albedo (vertex colour R).", category: "Layers" }),
    P.tex("dirtMap", "Dirt", { default: "white", tooltip: "Layer 2 albedo (vertex colour G).", category: "Layers" }),
    P.tex("rockMap", "Rock", { default: "white", tooltip: "Layer 3 albedo (vertex colour B).", category: "Layers" }),
    P.tex("snowMap", "Snow", { default: "white", tooltip: "Layer 4 albedo (vertex colour A).", category: "Layers" }),
    P.float("tiling", "Layer Tiling", { default: 9, min: 1, max: 40, tooltip: "Texture repeats across the UV range.", category: "Layers" }),
    P.float("blendDepth", "Blend Depth", { default: 0.22, min: 0.01, max: 1, tooltip: "Height-blend transition depth: small = crisp stone / grass boundaries.", category: "Layers" }),
    P.float("smoothness", "Smoothness", { default: 0.12, min: 0, max: 1, tooltip: "Smoothness of grass, dirt and rock.", category: "Layers" }),
    P.float("snowSmoothness", "Snow Smoothness", { default: 0.4, min: 0, max: 1, tooltip: "Smoothness where snow dominates.", category: "Layers" }),
    P.bool("useVertexColor", "Use Vertex Colors", { default: false, tooltip: "On = RGBA weights from the mesh vertex colours; off = procedural weights below.", category: "Weights" }),
    P.float("snowLine", "Snow Line", { default: 0.12, min: -0.5, max: 0.5, tooltip: "Object-space height where snow starts (procedural weights).", category: "Weights" }),
    P.float("snowSoft", "Snow Softness", { default: 0.18, min: 0.01, max: 0.6, tooltip: "Height range over which snow fades in.", category: "Weights" }),
    P.float("slopeStart", "Rock Slope", { default: 0.3, min: 0, max: 0.9, tooltip: "Slope (1 − N·up) from which rock takes over (procedural weights).", category: "Weights" }),
    P.float("dirtAmount", "Dirt Amount", { default: 0.8, min: 0, max: 1.5, tooltip: "Strength of the noise-driven dirt patches.", category: "Weights" }),
    P.float("dirtScale", "Dirt Scale", { default: 5, min: 1, max: 20, tooltip: "Frequency of the dirt patches (UV space).", category: "Weights" }),
  );
  s.texture("grassMap", "terrain-grass", L.grass).texture("dirtMap", "terrain-dirt", L.dirt).texture("rockMap", "terrain-rock", L.rock).texture("snowMap", "terrain-snow", L.snow);
  s.use(heightBlend4());

  const g = s.block("geo", "Geometry", "UV (tiled per layer), object height, world normal and the mesh vertex colour.", { col: 0, color: COLORS.blue });
  g.n("uv", "uv", {});
  g.n("tile", "multiply", {});
  g.n("opos", "position", { params: { space: "object" } });
  g.n("ps", "split", {});
  g.n("wn", "normal", { params: { space: "world" } });
  g.n("ns", "split", {});
  g.n("vc", "vertexColor", {});
  s.w("uv.out", "tile.a").w(g.po("tiling"), "tile.b").w("opos.out", "ps.in").w("wn.out", "ns.in");

  const w = s.block("weights", "Procedural weights", "`snow = smoothstep(line, line + soft, y)`, `rock = smoothstep(slope, slope + 0.25, 1 − N·up)`, `dirt = smoothstep(0.45, 0.65, fbm) × amount`, grass = 1. Painted vertex colours replace the whole vector when **Use Vertex Colors** is on.", { col: 1, row: 0, color: COLORS.green });
  w.n("snowEnd", "add", {});
  w.n("snow", "smoothstep", {});
  w.n("up", "oneMinus", {});
  w.n("rockEnd", "add", { values: { b: 0.25 } });
  w.n("rock", "smoothstep", {});
  w.n("dn", "noiseFbm", { params: { basis: "value", octaves: 3 } });
  w.n("dirt0", "smoothstep", { values: { edge1: 0.45, edge2: 0.65 } });
  w.n("dirt", "multiply", {});
  w.n("proc", "combine", { values: { r: 1 } });
  w.n("pick", "branch", {});
  s.w(w.po("snowLine"), "snowEnd.a").w(w.po("snowSoft"), "snowEnd.b").w(w.po("snowLine"), "snow.edge1").w("snowEnd.out", "snow.edge2").w("ps.g", "snow.in")
    .w("ns.g", "up.in").w(w.po("slopeStart"), "rockEnd.a").w(w.po("slopeStart"), "rock.edge1").w("rockEnd.out", "rock.edge2").w("up.out", "rock.in")
    .w("uv.out", "dn.p", "UV").w(w.po("dirtScale"), "dn.scale").w("dn.out", "dirt0.in").w("dirt0.out", "dirt.a").w(w.po("dirtAmount"), "dirt.b")
    .w("dirt.out", "proc.g").w("rock.out", "proc.b").w("snow.out", "proc.a").w(w.po("useVertexColor"), "pick.predicate").w("vc.rgba", "pick.true").w("proc.rgba", "pick.false");

  const t = s.block("fetch", "Layer fetch", "Each layer is sampled once at the tiled UV. The albedo luminance (`0.3 R + 0.59 G + 0.11 B`) doubles as the layer height for the height blend.", { col: 1, row: 1, color: COLORS.yellow });
  for (const [id, prop] of [["g", "grassMap"], ["d", "dirtMap"], ["r", "rockMap"], ["s", "snowMap"]] as const) {
    t.n(`${id}Tex`, "sampleTexture2D", {});
    t.n(`${id}H`, "dot", { values: { b: [0.3, 0.59, 0.11] } });
    s.w(t.po(prop), `${id}Tex.tex`).w("tile.out", `${id}Tex.uv`, id === "g" ? "TiledUV" : undefined).w(`${id}Tex.rgb`, `${id}H.a`);
  }
  t.n("hv", "combine", {});
  s.w("gH.out", "hv.r").w("dH.out", "hv.g").w("rH.out", "hv.b").w("sH.out", "hv.a");

  const b = s.block("blend", "Height blend", "The **Height Blend (4 layers)** kit sharpens the raw weights with the layer heights and normalises them.", { col: 2, color: COLORS.cyan });
  b.sub("hb", "ks_height_blend4", { label: "Height Blend" });
  b.n("ws", "split", {});
  s.w("pick.out", "hb.weights", "Weights").w("hv.rgba", "hb.heights").w(b.po("blendDepth"), "hb.depth").w("hb.weights", "ws.in");

  const m = s.block("mix", "Mix", "`albedo = Σ wᵢ × layerᵢ`; smoothness blends towards the snow value by the snow weight.", { col: 3, color: COLORS.orange });
  m.n("c1", "multiply", {});
  m.n("c2", "multiply", {});
  m.n("c3", "multiply", {});
  m.n("c4", "multiply", {});
  m.n("a1", "add", {});
  m.n("a2", "add", {});
  m.n("alb", "add", {});
  m.n("sm", "lerp", {});
  s.w("gTex.rgb", "c1.a").w("ws.r", "c1.b").w("dTex.rgb", "c2.a").w("ws.g", "c2.b").w("rTex.rgb", "c3.a").w("ws.b", "c3.b").w("sTex.rgb", "c4.a").w("ws.a", "c4.b")
    .w("c1.out", "a1.a").w("c2.out", "a1.b").w("c3.out", "a2.a").w("c4.out", "a2.b").w("a1.out", "alb.a").w("a2.out", "alb.b")
    .w(m.po("smoothness"), "sm.a").w(m.po("snowSmoothness"), "sm.b").w("ws.a", "sm.t");

  const o = s.block("out", "Master output (URP Lit)", "Blended albedo and smoothness.", { col: 4, color: COLORS.violet });
  s.master(o);
  s.w("alb.out", "master.baseColor").w("sm.out", "master.smoothness");
  return s;
}
export const terrainSample: SampleModule = { meta, build };
