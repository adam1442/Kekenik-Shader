import type { NodeDef, PortDef } from "../../registry/nodeDef";
import { T } from "../../types/generics";
import { baseNode } from "../kit";
import { M, type V } from "./irm";
import { floatPort, outPort, vec2Port } from "./ports";

const CAT = "Procedural/Patterns";
const NOTE = {
  all: "Portable IR (floor / fract / mod); negative and large coordinates use floor-based cells, so patterns are continuous across 0.",
};
const pPort: PortDef = {
  id: "p",
  name: "P",
  type: T("vec2"),
  defaultInput: { input: "uv0" },
  tooltip: "Coordinate (defaults to UV0).",
};

export const checkerNode: NodeDef = baseNode({
  id: "patternChecker",
  category: CAT,
  name: "Checkerboard",
  synonyms: ["checker", "chess", "tiles", "grid squares"],
  description:
    "Alternating 0 / 1 squares: Out = (⌊x·Fx + Ox⌋ + ⌊y·Fy + Oy⌋) mod 2. Pattern value (0 or 1, hard edges); period 2/F in each axis. Cell = integer cell index.",
  inputs: [
    pPort,
    vec2Port("frequency", "Frequency", [8, 8], "Cells per unit."),
    vec2Port("offset", "Offset", [0, 0], "Shift in cells."),
  ],
  outputs: [outPort("out", "Out", "float"), outPort("cell", "Cell", "vec2")],
  targetNotes: NOTE,
  build: (c) => {
    const m = new M(c.b);
    const cell = m
      .w(c.in("p"))
      .mul(m.w(c.in("frequency")))
      .add(m.w(c.in("offset")))
      .floor();
    return { out: cell.x.add(cell.y).mod(2).id, cell: cell.id };
  },
});

export const brickNode: NodeDef = baseNode({
  id: "patternBrick",
  category: CAT,
  name: "Brick Pattern",
  synonyms: ["bricks", "masonry", "wall", "running bond"],
  description:
    "Running-bond bricks. Frequency = (bricks across, rows) per unit; every odd row is shifted by Row Offset (0.5 = half a brick). Mortar = gap width as a fraction of a cell (x, y). Mask: 1 on brick, 0 on mortar; Smoothness is the edge ramp in cell fractions (0 = hard). Period: 1/Fx horizontally and 2/Fy vertically. ID = integer brick index, UV = position inside the brick (0…1).",
  inputs: [
    pPort,
    vec2Port("frequency", "Frequency", [4, 8]),
    vec2Port("mortar", "Mortar", [0.03, 0.06]),
    floatPort("offset", "Row Offset", 0.5),
    floatPort("smoothness", "Smoothness", 0),
  ],
  outputs: [outPort("mask", "Mask", "float"), outPort("id", "ID", "vec2"), outPort("uv", "UV", "vec2")],
  targetNotes: NOTE,
  build: (c) => {
    const m = new M(c.b);
    const q = m.w(c.in("p")).mul(m.w(c.in("frequency")));
    const row = q.y.floor();
    const shifted = m.v2(q.x.add(row.mod(2).mul(m.w(c.in("offset")))), q.y);
    const id = shifted.floor();
    const f = shifted.sub(id);
    const edge = m.min(f, m.f(1).sub(f));
    const soft = m.w(c.in("smoothness")).max(1e-6);
    const k = edge
      .sub(m.w(c.in("mortar")).abs().mul(0.5))
      .div(soft)
      .saturate();
    return { mask: m.min(k.x, k.y).id, id: id.id, uv: f.id };
  },
});

const HEX = 1.7320508075688772;
export const hexNode: NodeDef = baseNode({
  id: "patternHex",
  category: CAT,
  name: "Hexagonal Grid",
  synonyms: ["hex", "honeycomb", "hexagons", "hex tiling"],
  description:
    "Pointy-top hexagonal tiling; Scale = hexagons per unit of P (cell width 1/Scale). Outputs: Local = position relative to the cell centre (cell units), ID = unique integer pair per hexagon, Edge = hexagonal distance to the centre normalised so 0 = centre … 1 = cell border, Border = 1 − Edge (1 on the border line, 0 at the centre). Period (1, √3)/Scale.",
  inputs: [pPort, floatPort("scale", "Scale", 4)],
  outputs: [
    outPort("edge", "Edge", "float"),
    outPort("border", "Border", "float"),
    outPort("local", "Local", "vec2"),
    outPort("id", "ID", "vec2"),
  ],
  targetNotes: NOTE,
  build: (c) => {
    const m = new M(c.b);
    const q = m.w(c.in("p")).mul(m.w(c.in("scale")));
    // Two interleaved rectangular lattices (period (1, √3)): L1 at (i, j√3), L2 at (i+½, (j+½)√3). The nearest centre of each is a per-axis rounding.
    const c1 = m.v2(q.x.add(0.5).floor(), q.y.div(HEX).add(0.5).floor().mul(HEX));
    const c2 = m.v2(q.x.floor().add(0.5), q.y.div(HEX).floor().add(0.5).mul(HEX));
    const h1 = q.sub(c1);
    const h2 = q.sub(c2);
    const useB = h2.dot(h2).lt(h1.dot(h1));
    const local = m.sel(useB, h2, h1);
    const centre = m.sel(useB, c2, c1);
    const a = local.abs();
    const dist = m.max(a.dot(m.k("vec2", 0.5, HEX / 2)), a.x).mul(2);
    return {
      edge: dist.id,
      border: m.f(1).sub(dist).id,
      local: local.id,
      id: m.v2(centre.x.mul(2), centre.y.mul(2 / HEX)).id,
    };
  },
});

export const stripesNode: NodeDef = baseNode({
  id: "patternStripes",
  category: CAT,
  name: "Stripes",
  synonyms: ["lines", "bars", "zebra", "diagonal lines"],
  description:
    "Parallel stripes: phase = P·(cos A, sin A)·Frequency + Offset; Out = 1 inside the first Width (0…1) of each period, 0 elsewhere (pattern value). Smoothness softens each edge over that fraction of the period (inside the stripe; 0 = hard). Angle is the direction of the stripe NORMAL in degrees (0 = vertical stripes). ID = stripe index ⌊phase⌋. Period 1/Frequency.",
  inputs: [
    pPort,
    floatPort("frequency", "Frequency", 8),
    floatPort("width", "Width", 0.5),
    floatPort("angle", "Angle", 0),
    floatPort("smoothness", "Smoothness", 0),
    floatPort("offset", "Offset", 0),
  ],
  outputs: [outPort("out", "Out", "float"), outPort("id", "ID", "float")],
  targetNotes: NOTE,
  build: (c) => {
    const m = new M(c.b);
    const a = m.w(c.in("angle")).mul(Math.PI / 180);
    const t = m
      .w(c.in("p"))
      .dot(m.v2(a.cos(), a.sin()))
      .mul(m.w(c.in("frequency")))
      .add(m.w(c.in("offset")));
    const ph = t.fract();
    const soft = m.w(c.in("smoothness")).max(1e-6);
    const out: V = m.min(ph.div(soft).saturate(), m.w(c.in("width")).sub(ph).div(soft).saturate());
    return { out: out.id, id: t.floor().id };
  },
});
