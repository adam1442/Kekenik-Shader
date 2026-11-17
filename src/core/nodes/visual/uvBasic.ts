import type { NodeDef } from "../../registry/nodeDef";
import { T } from "../../types/generics";
import { baseNode, enumParam } from "../kit";
import { M, type V } from "../procedural/irm";
import { floatPort, outPort, vec2Port } from "../procedural/ports";
import { ANGLE_UNIT, TAU, angleToRad, uvPort } from "./common";

/** UV nodes, part 1: affine and radial warps. Conventions: see common.ts (origin bottom-left, V up, CCW angles). */
const UVNOTE = {
  all: "UV maths only — identical on every target. UV origin is bottom-left (V up); exporters flip V at the input stage when a target needs it.",
};

const tilingOffsetNode: NodeDef = baseNode({
  id: "uvTilingOffset",
  category: "UV/Transform",
  name: "Tiling And Offset",
  synonyms: ["tile uv", "scale uv", "uv offset", "uv repeat"],
  description:
    "Out = UV · Tiling + Offset (component-wise). Tiling 2 repeats the texture twice (UV range 0…2 with a Repeat sampler); negative Tiling mirrors the axis. Defined for any UV (negative / above 1); the wrap mode of the sampler decides what lies outside 0…1. Output range: unbounded.",
  inputs: [uvPort(), vec2Port("tiling", "Tiling", [1, 1]), vec2Port("offset", "Offset", [0, 0])],
  outputs: [outPort("out", "Out", "vec2")],
  targetNotes: UVNOTE,
  build: (c) => {
    const m = new M(c.b);
    return {
      out: m
        .w(c.in("uv"))
        .mul(m.w(c.in("tiling")))
        .add(m.w(c.in("offset"))).id,
    };
  },
});

const uvRotateNode: NodeDef = baseNode({
  id: "uvRotate",
  category: "UV/Transform",
  name: "UV Rotate",
  synonyms: ["rotate uv", "spin uv", "uv pivot rotation"],
  description:
    "Rotates UV around Center (pivot) by Rotation, counter-clockwise with V up: (dx, dy) → (dx·cosθ − dy·sinθ, dx·sinθ + dy·cosθ) + Center. Rotating the UV by +θ makes the SAMPLED image appear rotated by −θ. Rotation 0 returns the input exactly. Output range: unbounded.",
  inputs: [
    uvPort(),
    vec2Port("center", "Center", [0.5, 0.5], "Pivot in UV space."),
    floatPort("rotation", "Rotation", 0),
  ],
  outputs: [outPort("out", "Out", "vec2")],
  params: [ANGLE_UNIT],
  targetNotes: UVNOTE,
  build: (c) => {
    const m = new M(c.b);
    const d = m.w(c.in("uv")).sub(m.w(c.in("center")));
    const th = angleToRad(m.w(c.in("rotation")), c);
    const cs = th.cos(),
      sn = th.sin();
    return { out: m.v2(d.x.mul(cs).sub(d.y.mul(sn)), d.x.mul(sn).add(d.y.mul(cs))).add(m.w(c.in("center"))).id };
  },
});

const uvPolarNode: NodeDef = baseNode({
  id: "uvPolar",
  category: "UV/Mapping",
  name: "Polar Mapping",
  synonyms: ["polar uv", "radial uv", "angle radius uv", "wrap around point"],
  description:
    "Polar mapping around Center. Out = (Angle·Length Scale, Radius·Radial Scale) where Angle is in TURNS measured counter-clockwise from +U, range [0, 1), and Radius = |UV − Center| (≥ 0). At the centre the direction is undefined: Angle = 0. Use Out as UV to wrap a texture around a point (U = around, V = outwards); the sampler must repeat in U.",
  inputs: [
    uvPort(),
    vec2Port("center", "Center", [0.5, 0.5]),
    floatPort("radialScale", "Radial Scale", 1),
    floatPort("lengthScale", "Length Scale", 1),
  ],
  outputs: [outPort("out", "Out", "vec2"), outPort("radius", "Radius", "float"), outPort("angle", "Angle", "float")],
  targetNotes: UVNOTE,
  build: (c) => {
    const m = new M(c.b);
    const d = m.w(c.in("uv")).sub(m.w(c.in("center")));
    const t = m.atan2(d.y, d.x).div(TAU);
    const angle = t.sub(t.floor());
    const r = d.length();
    return {
      out: m.v2(angle.mul(m.w(c.in("lengthScale"))), r.mul(m.w(c.in("radialScale")))).id,
      radius: r.id,
      angle: angle.id,
    };
  },
});

const uvTwirlNode: NodeDef = baseNode({
  id: "uvTwirl",
  category: "UV/Distortion",
  name: "Twirl",
  synonyms: ["swirl", "vortex uv", "spiral distortion"],
  description:
    "Rotates UV around Center by an angle that grows with the distance: θ = Strength · |UV − Center| (radians per UV unit, counter-clockwise for positive Strength), then adds Offset. The centre is a fixed point (identity); Strength 0 returns UV + Offset. Output range: unbounded.",
  inputs: [
    uvPort(),
    vec2Port("center", "Center", [0.5, 0.5]),
    floatPort("strength", "Strength", 10),
    vec2Port("offset", "Offset", [0, 0]),
  ],
  outputs: [outPort("out", "Out", "vec2")],
  targetNotes: UVNOTE,
  build: (c) => {
    const m = new M(c.b);
    const d = m.w(c.in("uv")).sub(m.w(c.in("center")));
    const th = d.length().mul(m.w(c.in("strength")));
    const cs = th.cos(),
      sn = th.sin();
    return {
      out: m
        .v2(d.x.mul(cs).sub(d.y.mul(sn)), d.x.mul(sn).add(d.y.mul(cs)))
        .add(m.w(c.in("center")))
        .add(m.w(c.in("offset"))).id,
    };
  },
});

const uvSphericalNode: NodeDef = baseNode({
  id: "uvSpherical",
  category: "UV/Mapping",
  name: "Spherical Mapping",
  synonyms: ["equirectangular", "latlong", "sphere uv", "direction to uv", "panorama"],
  description:
    "Equirectangular (lat-long) UV of a direction: U = atan2(z, x)/2π + 0.5, V = asin(y/|d|)/π + 0.5. +X maps to U = 0.5, +Y (up) to V = 1, −Y to V = 0. Output range [0, 1]². The direction need not be normalised; the ZERO vector is defined as (0.5, 0.5). The U seam (direction −X) is U = 0 / 1 — use a Repeat sampler and explicit LOD or gradients to avoid a mip seam.",
  inputs: [
    {
      id: "dir",
      name: "Direction",
      type: T("vec3"),
      defaultInput: { input: "position", space: "object" },
      tooltip: "Direction from the sphere centre (defaults to object-space Position).",
    },
  ],
  outputs: [outPort("out", "Out", "vec2")],
  targetNotes: UVNOTE,
  build: (c) => {
    const m = new M(c.b);
    const d = m.w(c.in("dir"));
    const len = d.length();
    const ok = len.gt(0);
    const yn = m.sel(ok, d.y.div(m.sel(ok, len, 1)), 0).clamp(-1, 1);
    return { out: m.v2(m.atan2(d.z, d.x).div(TAU).add(0.5), m.fn("asin", yn).div(Math.PI).add(0.5)).id };
  },
});

const uvSphereWarpNode: NodeDef = baseNode({
  id: "uvSphereWarp",
  category: "UV/Distortion",
  name: "Spherical Warp",
  synonyms: ["fisheye", "lens distortion", "barrel distortion", "bulge"],
  description:
    "Radial lens distortion around Center: Out = UV + d·(|d|⁴·Strength) + Offset with d = UV − Center. Positive Strength pushes the sampled coordinate outwards towards the edges (the image looks pinched at the rim), negative pulls it in. Identity at the centre and for Strength 0. Output range: unbounded.",
  inputs: [
    uvPort(),
    vec2Port("center", "Center", [0.5, 0.5]),
    floatPort("strength", "Strength", 1),
    vec2Port("offset", "Offset", [0, 0]),
  ],
  outputs: [outPort("out", "Out", "vec2")],
  targetNotes: UVNOTE,
  build: (c) => {
    const m = new M(c.b);
    const d = m.w(c.in("uv")).sub(m.w(c.in("center")));
    const d2 = d.dot(d);
    return {
      out: m
        .w(c.in("uv"))
        .add(d.mul(d2.mul(d2).mul(m.w(c.in("strength")))))
        .add(m.w(c.in("offset"))).id,
    };
  },
});

const uvRadialShearNode: NodeDef = baseNode({
  id: "uvRadialShear",
  category: "UV/Distortion",
  name: "Radial Shear",
  synonyms: ["shear uv", "radial skew", "tangential distortion"],
  description:
    "Shears UV tangentially, stronger with distance: Out = UV + (d.y, −d.x)·(|d|²·Strength) + Offset with d = UV − Center and a per-axis Strength (vec2). The centre is a fixed point; Strength (0, 0) returns UV + Offset. (d.y, −d.x) is d rotated 90° clockwise. Output range: unbounded.",
  inputs: [
    uvPort(),
    vec2Port("center", "Center", [0.5, 0.5]),
    vec2Port("strength", "Strength", [10, 10]),
    vec2Port("offset", "Offset", [0, 0]),
  ],
  outputs: [outPort("out", "Out", "vec2")],
  targetNotes: UVNOTE,
  build: (c) => {
    const m = new M(c.b);
    const d = m.w(c.in("uv")).sub(m.w(c.in("center")));
    const k = m.w(c.in("strength")).mul(d.dot(d));
    return {
      out: m
        .w(c.in("uv"))
        .add(m.v2(d.y, d.x.neg()).mul(k))
        .add(m.w(c.in("offset"))).id,
    };
  },
});

const uvPixelateNode: NodeDef = baseNode({
  id: "uvPixelate",
  category: "UV/Mapping",
  name: "Pixelate (UV Snap)",
  synonyms: ["uv snap", "pixel snap", "mosaic", "retro pixels", "quantize uv"],
  description:
    "Snaps UV to a grid of Resolution cells per UV unit. Mode Center: (floor(UV·R) + 0.5)/R (cell centre — use for point-sampled pixel art); Corner: floor(UV·R)/R (lower-left corner). Cell boundaries sit exactly at multiples of 1/R, also for negative UV (floor semantics). A Resolution component ≤ 0 is invalid and leaves that axis UNSNAPPED. Cell is the integer cell index (as float).",
  inputs: [uvPort(), vec2Port("resolution", "Resolution", [64, 64], "Cells per UV unit on each axis.")],
  outputs: [outPort("out", "Out", "vec2"), outPort("cell", "Cell", "vec2")],
  params: [
    enumParam(
      "mode",
      "Snap to",
      [
        ["center", "Cell center"],
        ["corner", "Cell corner"],
      ],
      "center",
    ),
  ],
  targetNotes: UVNOTE,
  build: (c) => {
    const m = new M(c.b);
    const uv = m.w(c.in("uv")),
      res = m.w(c.in("resolution"));
    const off = c.param("mode") === "corner" ? 0 : 0.5;
    const axis = (u: V, r: V): { o: V; cell: V } => {
      const ok = r.gt(0);
      const rs = m.sel(ok, r, 1);
      const cell = u.mul(rs).floor();
      return { o: m.sel(ok, cell.add(off).div(rs), u), cell: m.sel(ok, cell, 0) };
    };
    const x = axis(uv.x, res.x),
      y = axis(uv.y, res.y);
    return { out: m.v2(x.o, y.o).id, cell: m.v2(x.cell, y.cell).id };
  },
});

const uvScrollNode: NodeDef = baseNode({
  id: "uvScroll",
  category: "UV/Animation",
  name: "UV Scroll",
  synonyms: ["pan uv", "scroll texture", "uv animation", "conveyor", "uv speed"],
  description:
    "Animated UV offset: Offset = f(Speed · Time). Linear: UV + Speed·T. Wrap: UV + fract(Speed·T) (keeps float precision for long-running scenes; identical to Linear when the texture repeats). Ping-Pong: UV + triangle(Speed·T) bouncing in 0…1. Time defaults to the Time input; negative speeds scroll the other way. Offset is returned as well. Float32 precision degrades for Linear when |Speed·T| > ~1e4.",
  inputs: [
    uvPort(),
    vec2Port("speed", "Speed", [0.1, 0], "UV units per second."),
    { id: "t", name: "T", type: T("float"), defaultInput: { input: "time" }, tooltip: "Defaults to Time." },
  ],
  outputs: [outPort("out", "Out", "vec2"), outPort("offset", "Offset", "vec2")],
  params: [
    enumParam(
      "mode",
      "Mode",
      [
        ["linear", "Linear"],
        ["wrap", "Wrap (fract)"],
        ["pingpong", "Ping-Pong"],
      ],
      "linear",
    ),
  ],
  targetNotes: UVNOTE,
  build: (c) => {
    const m = new M(c.b);
    const raw = m.w(c.in("speed")).mul(m.w(c.in("t")));
    const mode = c.param<string>("mode");
    const off = mode === "wrap" ? raw.fract() : mode === "pingpong" ? m.f(1).sub(raw.mod(2).sub(1).abs()) : raw;
    return { out: m.w(c.in("uv")).add(off).id, offset: off.id };
  },
});

export const UV_BASIC_DEFS: NodeDef[] = [
  tilingOffsetNode,
  uvRotateNode,
  uvPolarNode,
  uvTwirlNode,
  uvSphericalNode,
  uvSphereWarpNode,
  uvRadialShearNode,
  uvPixelateNode,
  uvScrollNode,
];
