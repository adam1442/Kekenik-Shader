import { HASH_PARAM, hashM } from "./hashMode";
import type { NodeDef } from "../../registry/nodeDef";
import { T } from "../../types/generics";
import { baseNode, enumParam } from "../kit";
import { hash21, hash22, hash33, seedOffset, wrapCell } from "./hash";
import { M, type V } from "./irm";
import { floatPort, outPort, vec2Port } from "./ports";

/**
 * Voronoi / Worley noise (2D, 3×3 neighbourhood search, edge distance by the exact two-pass bisector method).
 * Units: one lattice cell = 1.0 in the scaled space q = P·Scale + Offset; all distances are in that space.
 * Bounds with Randomness ∈ [0,1]: 0 ≤ F1 ≤ F2 ≤ 2√2 (F1 < √2 for Euclidean).
 */
const BIG = 8;
const WINDOW = 2;

interface VoronoiResult {
  f1: V;
  f2: V;
  edge: V;
  id: V;
  color: V;
  center: V;
}

export interface VoronoiCfg {
  metric: string;
  placement: string;
  randomness: V;
  so: V;
}

/** Distance (squared for Euclidean) of a vec2 / vec3 offset under `metric` (shared by the 2D and 3D Voronoi). */
export function metricDist(m: M, metric: string, d: V): V {
  if (metric === "euclidean") return d.dot(d);
  const a = d.abs();
  const parts = d.ty === "vec2" ? [a.x, a.y] : [a.x, a.y, a.z];
  return parts.reduce((acc, c) => (metric === "manhattan" ? acc.add(c) : m.max(acc, c)));
}

function voronoi2D(m: M, q: V, cfg: VoronoiCfg): VoronoiResult {
  const i = q.floor();
  const f = q.sub(i);
  const r = cfg.randomness.clamp(0, 1);
  const euclid = cfg.metric === "euclidean";
  const memo = new Map<string, { diff: V; cell: V }>();
  /** Feature point of the cell at offset (dx,dy): vector from the fragment to the point (local, relative to cell `i`). */
  const at = (dx: number, dy: number) => {
    const key = `${dx},${dy}`;
    let hit = memo.get(key);
    if (!hit) {
      const cell = wrapCell(i.add(m.k("vec2", dx, dy))).add(cfg.so);
      const h = hash22(m, cell);
      let pt: V;
      if (cfg.placement === "staggered") {
        const odd = wrapCell(i.add(m.k("vec2", dx, dy))).y.mod(2);
        const shift = odd.mul(0.5).sub(0.25);
        pt = m.v2(shift.add(0.5).add(h.x.sub(0.5).mul(r).mul(0.5)), h.y.sub(0.5).mul(r).add(0.5));
      } else {
        pt = h.sub(0.5).mul(r).add(0.5);
      }
      const local = pt.add(m.k("vec2", dx, dy));
      hit = { diff: local.sub(f), cell };
      memo.set(key, hit);
    }
    return hit;
  };
  const dist = (d: V): V => metricDist(m, cfg.metric, d);
  let d1: V = m.f(BIG * BIG);
  let d2: V = m.f(BIG * BIG);
  let best = m.k("vec2", 0, 0);
  let bestCell = m.k("vec2", 0, 0);
  let bestOff = m.k("vec2", 0, 0);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const { diff, cell } = at(dx, dy);
      const d = dist(diff);
      const closer = d.lt(d1);
      d2 = m.sel(closer, d1, m.min(d2, d));
      d1 = m.sel(closer, d, d1);
      best = m.sel(closer, diff, best);
      bestCell = m.sel(closer, cell, bestCell);
      bestOff = m.sel(closer, m.k("vec2", dx, dy), bestOff);
    }
  }
  // Edge distance: exact distance to the nearest cell border (Euclidean bisector) — second pass over a 5×5 window.
  let edge: V = m.f(BIG);
  for (let dy = -WINDOW; dy <= WINDOW; dy++) {
    for (let dx = -WINDOW; dx <= WINDOW; dx++) {
      const rr = at(dx, dy).diff;
      const delta = rr.sub(best);
      const l2 = delta.dot(delta);
      const ok = l2.gt(1e-5);
      const cand = best.add(rr).mul(0.5).dot(delta).div(m.max(l2.sqrt(), 1e-6));
      edge = m.sel(ok, m.min(edge, cand), edge);
    }
  }
  const root = (d: V) => (euclid ? d.sqrt() : d);
  const id = hash21(m, bestCell.add(m.k("vec2", 17.17, 3.31)));
  const color = hash33(m, m.v3(bestCell.x, bestCell.y, 23.1));
  void bestOff;
  return { f1: root(d1), f2: root(d2), edge, id, color, center: q.add(best) };
}

const OUTS = [
  outPort("f1", "Distance (F1)", "float"),
  outPort("f2", "Distance 2 (F2)", "float"),
  outPort("edge", "Edge Distance", "float"),
  outPort("cellId", "Cell ID", "float"),
  outPort("cellColor", "Cell Color", "color"),
  outPort("center", "Cell Center", "vec2"),
];

export const voronoiNode: NodeDef = baseNode({
  id: "noiseVoronoi",
  category: "Procedural/Noise",
  name: "Voronoi",
  synonyms: ["worley", "cellular", "cells", "voronoi noise", "f1 f2"],
  description:
    "Worley / Voronoi cells (2D). Outputs: F1 = distance to the nearest feature point, F2 = to the second nearest, Edge = exact distance to the nearest cell border, Cell ID = hash of the nearest cell in [0,1), Cell Color = per-cell RGB hash, Cell Center = nearest feature point. Distances are in cell units (1 cell = 1.0): 0 ≤ F1 ≤ F2 ≤ 2√2. Randomness is clamped to [0,1] (the 3×3 search is only exact there); 0 = regular grid. Euclidean uses a 3×3 search; with Manhattan/Chebyshev F2 may show rare artefacts; Edge is always Euclidean. For 3D use the Voronoi 3D node.",
  inputs: [
    { id: "p", name: "P", type: T("vec2"), defaultInput: { input: "uv0" } },
    floatPort("scale", "Scale", 5, "Cells per unit of P."),
    vec2Port("offset", "Offset", [0, 0], "Added to the scaled coordinate (cell units)."),
    floatPort("randomness", "Randomness", 1, "0 = regular lattice, 1 = fully jittered. Clamped to 0…1."),
    floatPort("seed", "Seed", 0, "Any float; reduced modulo 1024."),
  ],
  outputs: OUTS,
  params: [
    enumParam(
      "placement",
      "Feature points",
      [
        ["jittered", "Jittered grid"],
        ["staggered", "Staggered rows"],
      ],
      "jittered",
    ),
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
    all: "Portable IR (select-based min tracking, no loops/arrays). Large generated code (~35 cell evaluations); Edge Distance dominates the cost.",
  },
  build: (c) => {
    const m = hashM(c);
    const q = m
      .w(c.in("p"))
      .mul(m.w(c.in("scale")))
      .add(m.w(c.in("offset")));
    const so = seedOffset(m, m.w(c.in("seed")), 2);
    const r = voronoi2D(m, q, {
      metric: c.param<string>("metric"),
      placement: c.param<string>("placement"),
      randomness: m.w(c.in("randomness")),
      so,
    });
    return { f1: r.f1.id, f2: r.f2.id, edge: r.edge.id, cellId: r.id.id, cellColor: r.color.id, center: r.center.id };
  },
});
