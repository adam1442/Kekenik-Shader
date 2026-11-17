import type { BuildContext, NodeDef, ParamSchema, PortDef } from "../../registry/nodeDef";
import { T } from "../../types/generics";
import { baseNode } from "../kit";
import { M, type V } from "./irm";
import { floatPort, outPort, vec2Port } from "./ports";
import {
  localSpace,
  sdEllipse,
  sdPolygon,
  sdRect,
  sdRing,
  sdRoundRect,
  sdSegment,
  sdStar,
  smoothMax,
  smoothMin,
} from "./sdf";

const CAT = "Procedural/Shapes";
const NOTE = {
  all: "Portable IR. Antialiasing is a separate node (SDF → Mask) which uses fwidth() (fragment stage only; use its Fixed mode elsewhere).",
};
const SIGN =
  " Returns a signed distance in units of P: negative inside, 0 on the boundary, positive outside; the shape is centred at Center and rotated counter-clockwise by Rotation (degrees).";

const pPort: PortDef = {
  id: "p",
  name: "P",
  type: T("vec2"),
  defaultInput: { input: "uv0" },
  tooltip: "Coordinate (defaults to UV0).",
};
const common: PortDef[] = [
  pPort,
  vec2Port("center", "Center", [0.5, 0.5]),
  floatPort("rotation", "Rotation", 0, "Degrees, counter-clockwise."),
];

interface ShapeSpec {
  id: string;
  name: string;
  synonyms: string[];
  description: string;
  inputs: PortDef[];
  params?: ParamSchema[];
  run: (m: M, q: V, c: BuildContext) => V;
}

function shape(s: ShapeSpec): NodeDef {
  return baseNode({
    id: s.id,
    category: CAT,
    name: s.name,
    synonyms: s.synonyms,
    description: s.description + SIGN,
    inputs: [...common, ...s.inputs],
    outputs: [outPort("sdf", "SDF", "float")],
    params: s.params ?? [],
    targetNotes: NOTE,
    build: (c) => {
      const m = new M(c.b);
      const q = localSpace(m, m.w(c.in("p")), m.w(c.in("center")), m.w(c.in("rotation")));
      return { sdf: s.run(m, q, c).id };
    },
  });
}

const sidesParam = (def: number): ParamSchema => ({
  id: "sides",
  label: "Sides",
  control: "int",
  default: def,
  min: 3,
  max: 64,
  step: 1,
});
function sides(c: BuildContext): number {
  const n = Number(c.param("sides"));
  if (!Number.isInteger(n) || n < 3 || n > 64)
    c.fail(`Sides must be an integer from 3 to 64 (got ${String(c.param("sides"))}).`);
  return n;
}

export const rectNode = shape({
  id: "sdfRect",
  name: "Rectangle SDF",
  synonyms: ["box", "rect", "square sdf"],
  description: "Axis-aligned rectangle of full Size (negative sizes use their magnitude). Exact distance.",
  inputs: [vec2Port("size", "Size", [0.5, 0.3])],
  run: (m, q, c) => sdRect(m, q, m.w(c.in("size")).abs().mul(0.5)),
});
export const roundRectNode = shape({
  id: "sdfRoundRect",
  name: "Rounded Rectangle SDF",
  synonyms: ["rounded box", "round rect", "rounded corners"],
  description:
    "Rectangle with per-corner radii (Radii = top-right, bottom-right, top-left, bottom-left). Radii are clamped to 0 … min(Size)/2 (a documented semantic: larger radii would invert the shape). Exact distance.",
  inputs: [
    vec2Port("size", "Size", [0.5, 0.3]),
    { id: "radii", name: "Radii", type: T("vec4"), default: [0.08, 0.08, 0.08, 0.08], tooltip: "TR, BR, TL, BL" },
  ],
  run: (m, q, c) => sdRoundRect(m, q, m.w(c.in("size")).abs().mul(0.5), m.w(c.in("radii"))),
});
export const ellipseNode = shape({
  id: "sdfEllipse",
  name: "Ellipse SDF",
  synonyms: ["oval", "circle sdf", "ellipsoid"],
  description:
    "Ellipse with Radii (x, y). APPROXIMATE distance (first-order: exact zero set and sign, magnitude off the boundary is not Euclidean). Radii below 1e-6 are raised to 1e-6.",
  inputs: [vec2Port("radii", "Radii", [0.3, 0.2])],
  run: (m, q, c) => sdEllipse(m, q, m.w(c.in("radii"))),
});
export const polygonNode = shape({
  id: "sdfPolygon",
  name: "Polygon SDF",
  synonyms: ["regular polygon", "ngon", "hexagon sdf", "triangle sdf", "pentagon"],
  description:
    "Regular polygon with circumradius Radius and `Sides` ≥ 3 (integer parameter); vertex 0 points up. Exact distance.",
  inputs: [floatPort("radius", "Radius", 0.3)],
  params: [sidesParam(6)],
  run: (m, q, c) => sdPolygon(m, q, m.w(c.in("radius")), sides(c)),
});
export const starNode = shape({
  id: "sdfStar",
  name: "Star SDF",
  synonyms: ["star", "pointed star", "spikes"],
  description:
    "n-pointed star with outer Radius. Sharpness m is clamped to [2, Sides]: m = 2 gives the regular polygon, m = Sides the thinnest points. Vertex 0 points up.",
  inputs: [floatPort("radius", "Radius", 0.3), floatPort("sharpness", "Sharpness", 3)],
  params: [sidesParam(5)],
  run: (m, q, c) => sdStar(m, q, m.w(c.in("radius")), sides(c), m.w(c.in("sharpness"))),
});
export const ringNode = shape({
  id: "sdfRing",
  name: "Ring SDF",
  synonyms: ["annulus", "donut", "circle outline", "torus 2d"],
  description:
    "Ring (annulus) with mid-line Radius and full Thickness. Thickness 0 returns the distance to the circle itself (never negative). Exact distance.",
  inputs: [floatPort("radius", "Radius", 0.3), floatPort("thickness", "Thickness", 0.06)],
  run: (m, q, c) => sdRing(m, q, m.w(c.in("radius")), m.w(c.in("thickness"))),
});

/** Segment ignores Center / Rotation: its end points are given directly in the coordinate space of P. */
export const segmentNode: NodeDef = baseNode({
  id: "sdfSegment",
  category: CAT,
  name: "Line Segment SDF",
  synonyms: ["line", "capsule", "segment", "stroke"],
  description:
    "Capsule around the segment A → B with full Thickness (end points are in the space of P; no Center / Rotation). A = B degenerates to a circle (no division by zero)." +
    SIGN.split(";")[0],
  inputs: [
    pPort,
    vec2Port("a", "A", [0.2, 0.5]),
    vec2Port("b", "B", [0.8, 0.5]),
    floatPort("thickness", "Thickness", 0.05),
  ],
  outputs: [outPort("sdf", "SDF", "float")],
  targetNotes: NOTE,
  build: (c) => {
    const m = new M(c.b);
    return { sdf: sdSegment(m, m.w(c.in("p")), m.w(c.in("a")), m.w(c.in("b")), m.w(c.in("thickness"))).id };
  },
});

/* ── boolean ops + antialiased mask ──────────────────────────────────────────────────────────── */
const SDF_CAT = "Procedural/SDF";
const f2 = (): PortDef[] => [floatPort("a", "A", 0), floatPort("b", "B", 0)];
const boolNode = (
  id: string,
  name: string,
  syn: string[],
  desc: string,
  run: (m: M, a: V, b: V, c: BuildContext) => V,
  extra: PortDef[] = [],
): NodeDef =>
  baseNode({
    id,
    category: SDF_CAT,
    name,
    synonyms: syn,
    description: desc,
    inputs: [...f2(), ...extra],
    outputs: [outPort("out", "Out", "float")],
    targetNotes: { all: "Portable IR." },
    build: (c) => {
      const m = new M(c.b);
      return { out: run(m, m.w(c.in("a")), m.w(c.in("b")), c).id };
    },
  });
export const unionNode = boolNode(
  "sdfUnion",
  "SDF Union",
  ["sdf add", "merge shapes", "min"],
  "min(A, B): the region inside A OR B. Exact inside, a lower bound outside.",
  (m, a, b) => m.min(a, b),
);
export const subtractNode = boolNode(
  "sdfSubtract",
  "SDF Subtract",
  ["sdf difference", "cut", "carve", "a minus b"],
  "max(A, −B): A with B carved out (the region inside A but NOT inside B). Exact inside A, a bound elsewhere.",
  (m, a, b) => m.max(a, b.neg()),
);
export const intersectNode = boolNode(
  "sdfIntersect",
  "SDF Intersect",
  ["sdf and", "common", "max"],
  "max(A, B): the region inside A AND inside B. Exact inside, a lower bound outside.",
  (m, a, b) => m.max(a, b),
);
export const smoothUnionNode = boolNode(
  "sdfSmoothUnion",
  "SDF Smooth Union",
  ["smooth min", "blend shapes", "metaballs", "smin"],
  "Polynomial smooth minimum of A and B with blend width K (distance units). Continuous (C1) in A, B and K; K ≤ 1e-6 behaves as the hard union.",
  (m, a, b, c) => smoothMin(m, a, b, m.w(c.in("k"))),
  [floatPort("k", "Smoothness", 0.1)],
);
export const smoothSubtractNode = boolNode(
  "sdfSmoothSubtract",
  "SDF Smooth Subtract",
  ["smooth difference", "smooth cut", "smooth carve", "smax"],
  "Polynomial smooth maximum of A and −B (A with B carved out, with a rounded cut of blend width K). Continuous (C1) in A, B and K; K ≤ 1e-6 behaves as the hard Subtract.",
  (m, a, b, c) => smoothMax(m, a, b.neg(), m.w(c.in("k"))),
  [floatPort("k", "Smoothness", 0.1)],
);
export const smoothIntersectNode = boolNode(
  "sdfSmoothIntersect",
  "SDF Smooth Intersect",
  ["smooth and", "smooth common", "smooth max", "rounded intersection"],
  "Polynomial smooth maximum of A and B (the region inside both, with a rounded crease of blend width K). Continuous (C1) in A, B and K; K ≤ 1e-6 behaves as the hard Intersect.",
  (m, a, b, c) => smoothMax(m, a, b, m.w(c.in("k"))),
  [floatPort("k", "Smoothness", 0.1)],
);

export const sdfMaskNode: NodeDef = baseNode({
  id: "sdfMask",
  category: SDF_CAT,
  name: "SDF → Mask",
  synonyms: ["sdf to mask", "antialias", "anti-aliased mask", "sdf fill", "coverage"],
  description:
    "Anti-aliased coverage mask: saturate(0.5 − (SDF − Offset) / w) — 1 inside, 0 outside, exactly 0.5 on the boundary (SDF = Offset). Auto mode: w = max(fwidth(SDF) · Softness, 1e-6), i.e. Softness is the edge width in PIXELS (fragment stage only). Fixed mode: w = max(Softness, 1e-6) in SDF units — use it in the vertex stage or where derivatives are unavailable. Offset > 0 grows the shape.",
  inputs: [
    floatPort("sdf", "SDF", 0),
    floatPort("softness", "Softness", 1, "Auto: edge width in pixels. Fixed: edge width in SDF units."),
    floatPort("offset", "Offset", 0, "Isoline of the field that becomes the edge (positive grows the shape)."),
  ],
  outputs: [outPort("mask", "Mask", "float")],
  params: [
    {
      id: "mode",
      label: "Width",
      control: "enum",
      default: "auto",
      options: [
        { value: "auto", label: "Auto (fwidth)" },
        { value: "fixed", label: "Fixed" },
      ],
    },
    { id: "invert", label: "Invert", control: "bool", default: false },
  ],
  targetNotes: {
    all: "Auto mode needs derivatives: fragment stage only (a vertex-stage use reports E_STAGE_VIOLATION). WGSL: derivative uniformity is satisfied (no divergent control flow is generated). Documented fallback: Width = Fixed.",
  },
  build: (c) => {
    const m = new M(c.b);
    const sdf = m.w(c.in("sdf"));
    const soft = m.w(c.in("softness"));
    const w = c.param("mode") === "fixed" ? soft.max(1e-6) : m.w(c.b.deriv("fwidth", sdf.id)).mul(soft).max(1e-6);
    const mask = m
      .f(0.5)
      .sub(sdf.sub(m.w(c.in("offset"))).div(w))
      .saturate();
    return { mask: (c.param("invert") === true ? m.f(1).sub(mask) : mask).id };
  },
});
