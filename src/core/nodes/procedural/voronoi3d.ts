import { HASH_PARAM, hashM } from "./hashMode";
import type { NodeDef } from "../../registry/nodeDef";
import { T } from "../../types/generics";
import { baseNode, enumParam } from "../kit";
import { hash31, hash33, seedOffset, wrapCell } from "./hash";
import { M, type V } from "./irm";
import { floatPort, outPort, vec3Port } from "./ports";
import { type VoronoiCfg, metricDist } from "./voronoi";

/**
 * Voronoi / Worley noise in 3D (U17): 3×3×3 neighbourhood search, one jittered feature point per lattice cell, select-based min tracking
 * (no loops / arrays — portable to every target). Units: one cell = 1.0 in q = P·Scale + Offset.
 * Edge distance uses the same bisector formula as the 2D node over the 27 searched points (exact except for rare far-corner cases).
 */
interface Voronoi3Result {
  f1: V;
  f2: V;
  edge: V;
  id: V;
  color: V;
  center: V;
}

function voronoi3D(m: M, q: V, cfg: Pick<VoronoiCfg, "metric" | "randomness" | "so">): Voronoi3Result {
  const i = q.floor();
  const f = q.sub(i);
  const r = cfg.randomness.clamp(0, 1);
  const euclid = cfg.metric === "euclidean";
  const pts: Array<{ diff: V; cell: V }> = [];
  for (let dz = -1; dz <= 1; dz++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const off = m.k("vec3", dx, dy, dz);
        const cell = wrapCell(i.add(off)).add(cfg.so);
        const pt = hash33(m, cell).sub(0.5).mul(r).add(0.5);
        pts.push({ diff: pt.add(off).sub(f), cell });
      }
  let d1: V = m.f(64),
    d2: V = m.f(64);
  let best = m.k("vec3", 0, 0, 0),
    bestCell = m.k("vec3", 0, 0, 0);
  for (const { diff, cell } of pts) {
    const d = metricDist(m, cfg.metric, diff);
    const closer = d.lt(d1);
    d2 = m.sel(closer, d1, m.min(d2, d));
    d1 = m.sel(closer, d, d1);
    best = m.sel(closer, diff, best);
    bestCell = m.sel(closer, cell, bestCell);
  }
  let edge: V = m.f(8);
  for (const { diff: rr } of pts) {
    const delta = rr.sub(best);
    const l2 = delta.dot(delta);
    const cand = best.add(rr).mul(0.5).dot(delta).div(m.max(l2.sqrt(), 1e-6));
    edge = m.sel(l2.gt(1e-5), m.min(edge, cand), edge);
  }
  const root = (d: V) => (euclid ? d.sqrt() : d);
  return {
    f1: root(d1),
    f2: root(d2),
    edge,
    id: hash31(m, bestCell.add(m.k("vec3", 17.17, 3.31, 9.73))),
    color: hash33(m, bestCell.add(m.k("vec3", 23.1, 5.5, 7.7))),
    center: q.add(best),
  };
}

export const voronoi3DNode: NodeDef = baseNode({
  id: "noiseVoronoi3D",
  category: "Procedural/Noise",
  name: "Voronoi 3D",
  synonyms: ["worley 3d", "cellular 3d", "voronoi noise 3d", "volume cells"],
  description:
    "Worley / Voronoi cells in 3D (27-cell search). Outputs: F1 / F2 = distance to the nearest / second nearest feature point, Edge = distance to the nearest cell border, Cell ID in [0,1), per-cell Cell Color, Cell Center (vec3). Distances are in cell units: 0 ≤ F1 ≤ F2. Randomness is clamped to [0,1]; 0 = regular lattice. Defaults to object-space Position, so it textures a mesh without UVs.",
  inputs: [
    {
      id: "p",
      name: "P",
      type: T("vec3"),
      defaultInput: { input: "position", space: "object" },
      tooltip: "3D coordinate (defaults to object-space Position).",
    },
    floatPort("scale", "Scale", 5, "Cells per unit of P."),
    vec3Port("offset", "Offset", [0, 0, 0], "Added to the scaled coordinate (cell units)."),
    floatPort("randomness", "Randomness", 1, "0 = regular lattice, 1 = fully jittered. Clamped to 0…1."),
    floatPort("seed", "Seed", 0, "Any float; reduced modulo 1024."),
  ],
  outputs: [
    outPort("f1", "Distance (F1)", "float"),
    outPort("f2", "Distance 2 (F2)", "float"),
    outPort("edge", "Edge Distance", "float"),
    outPort("cellId", "Cell ID", "float"),
    outPort("cellColor", "Cell Color", "color"),
    outPort("center", "Cell Center", "vec3"),
  ],
  params: [
    enumParam(
      "metric",
      "Distance metric",
      [
        ["euclidean", "Euclidean"],
        ["manhattan", "Manhattan"],
        ["chebyshev", "Chebyshev"],
      ],
      "euclidean",
    ),
    HASH_PARAM,
  ],
  targetNotes: {
    all: "Portable IR (select-based min tracking, no loops / arrays). Large generated code: 27 feature points + the edge pass; prefer Voronoi (2D) when UVs are enough.",
  },
  build: (c) => {
    const m = hashM(c);
    const q = m
      .w(c.in("p"))
      .mul(m.w(c.in("scale")))
      .add(m.w(c.in("offset")));
    const so = seedOffset(m, m.w(c.in("seed")), 3);
    const r = voronoi3D(m, q, { metric: c.param<string>("metric"), randomness: m.w(c.in("randomness")), so });
    return { f1: r.f1.id, f2: r.f2.id, edge: r.edge.id, cellId: r.id.id, cellColor: r.color.id, center: r.center.id };
  },
});
