import type { NodeDef } from "../../registry/nodeDef";
import { T } from "../../types/generics";
import { enumParam } from "../kit";
import { M, type V } from "../procedural/irm";
import { hash31 } from "../procedural/hash";
import { floatPort, outPort, vec2Port } from "../procedural/ports";
import { STAGE_NOTE, TAU, normalPort, posPort, shNode, timePort, unit, xform } from "./common";

/**
 * VERTEX deformation nodes (vertex-only, `stage: "vertex"`). Every node outputs an object-space `Offset` (wire it to "Vertex Offset")
 * and the displaced `Position`. Position / normal inputs default to the OBJECT-space mesh attributes.
 */
const OUT_OFFSET = {
  id: "offset",
  name: "Offset",
  type: T("vec3"),
  tag: { semantic: "direction" as const, space: "object" as const },
};
const OUT_POS = {
  id: "position",
  name: "Position",
  type: T("vec3"),
  tag: { semantic: "position" as const, space: "object" as const },
};
const VNOTES = { all: `${STAGE_NOTE.vertex} Object-space Offset → Vertex Offset slot. Portable IR maths.` };

type Plane = "xz" | "xy" | "yz";
const planeOf = (p: V, plane: Plane): V => (plane === "xy" ? p.sw("xy") : plane === "yz" ? p.sw("yz") : p.sw("xz"));
const lift = (m: M, g: V, plane: Plane): V =>
  plane === "xy" ? m.v3(g.x, g.y, 0) : plane === "yz" ? m.v3(0, g.x, g.y) : m.v3(g.x, 0, g.y);

const waveNode: NodeDef = shNode({
  id: "waveDeformation",
  category: "Vertex/Deform",
  name: "Wave Deformation",
  synonyms: ["vertex wave", "sine wave displacement", "water wave", "ripple vertex"],
  description:
    "VERTEX-ONLY sine wave. Height h = Amplitude · sin(2π · (Frequency · s − Speed · Time)), s = position along Direction in the chosen Plane (Plane mode) or the distance from Center (Radial mode); Frequency = cycles per object-space unit, Speed = cycles per second (the wave travels along +s). Offset = Axis · h (Axis: the normal or X / Y / Z), range [−Amplitude, Amplitude]. The analytic Normal is exact for a flat surface whose normal is the displacement axis: N' = normalize(N − tangential gradient of h). Object space in, object space out.",
  inputs: [
    posPort("object"),
    normalPort("normal", "object"),
    timePort(),
    floatPort("amplitude", "Amplitude", 0.1),
    floatPort("frequency", "Frequency", 2),
    floatPort("speed", "Speed", 0.5),
    vec2Port("direction", "Direction", [1, 0], "Travel direction in the Plane (normalised; 0,0 → +first axis)."),
    vec2Port("center", "Center", [0, 0], "Radial mode: wave origin in the Plane."),
  ],
  outputs: [
    OUT_OFFSET,
    OUT_POS,
    { id: "normal", name: "Normal", type: T("vec3"), tag: { semantic: "normal", space: "object" } },
    outPort("height", "Height", "float"),
  ],
  params: [
    enumParam(
      "shape",
      "Shape",
      [
        ["plane", "Plane wave"],
        ["radial", "Radial"],
      ],
      "plane",
    ),
    enumParam(
      "plane",
      "Plane",
      [
        ["xz", "XZ (ground)"],
        ["xy", "XY"],
        ["yz", "YZ"],
      ],
      "xz",
    ),
    enumParam(
      "axis",
      "Displace along",
      [
        ["y", "Y"],
        ["normal", "Normal"],
        ["x", "X"],
        ["z", "Z"],
      ],
      "y",
    ),
  ],
  stage: "vertex",
  targetNotes: VNOTES,
  build: (c) => {
    const m = new M(c.b);
    const plane = c.param<Plane>("plane");
    const pos = m.w(c.in("position"));
    const p2 = planeOf(pos, plane);
    const n0 = unit(m, m.w(c.in("normal")), m.k("vec3", 0, 1, 0));
    const axis =
      ({ y: m.k("vec3", 0, 1, 0), x: m.k("vec3", 1, 0, 0), z: m.k("vec3", 0, 0, 1), normal: n0 } as Record<string, V>)[
        c.param<string>("axis")
      ] ?? n0;
    const amp = m.w(c.in("amplitude"));
    const freq = m.w(c.in("frequency"));
    let s: V;
    let dirGrad: V;
    if (c.param<string>("shape") === "radial") {
      const rel = p2.sub(m.w(c.in("center")));
      const r = rel.length();
      s = r;
      dirGrad = m.sel(r.gt(1e-9), rel.div(m.sel(r.gt(1e-9), r, 1)), m.k("vec2", 0, 0));
    } else {
      s = p2.dot(unit(m, m.w(c.in("direction")), m.k("vec2", 1, 0)));
      dirGrad = unit(m, m.w(c.in("direction")), m.k("vec2", 1, 0));
    }
    const phase = freq
      .mul(s)
      .sub(m.w(c.in("speed")).mul(m.w(c.in("time"))))
      .mul(TAU);
    const h = amp.mul(phase.sin());
    const g3 = lift(m, dirGrad.mul(amp.mul(TAU).mul(freq).mul(phase.cos())), plane);
    const normal = unit(m, n0.sub(g3.sub(n0.mul(g3.dot(n0)))), n0);
    const offset = axis.mul(h);
    return { offset: offset.id, position: pos.add(offset).id, normal: normal.id, height: h.id };
  },
});

const windNode: NodeDef = shNode({
  id: "windFoliage",
  category: "Vertex/Deform",
  name: "Wind / Foliage Deformation",
  synonyms: ["wind sway", "grass wind", "tree sway", "foliage animation"],
  description:
    "VERTEX-ONLY wind. Direction = unit(Direction) in the chosen Space (Object or World; World converts position in and offset out through the engine matrices). Gust = (sin φ + 0.5·sin(2.3 φ + 1.7)) / 1.5 with φ = 2π(Frequency · Time − Spatial · (position · Direction)); Amount = Strength · Mask · (0.5 + 0.5 · Gust) ∈ [0, Strength · Mask], so the plant only ever leans DOWNWIND. Flutter adds a perpendicular jitter Turbulence · Strength · Mask · sin(3.1 φ + 2π · hash(position)). Mask (clamped 0…1; wire vertex colour R or a height ramp) pins the roots with 0. The offset is a translation, not a length-preserving bend.",
  inputs: [
    posPort("object"),
    {
      id: "mask",
      name: "Mask",
      type: T("float"),
      default: 1,
      tooltip: "Per-vertex weight 0…1 (clamped). 0 = pinned (roots), 1 = full motion. Wire Vertex Color R / UV.y.",
    },
    timePort(),
    floatPort("strength", "Strength", 0.2),
    floatPort("frequency", "Frequency", 0.8),
    floatPort("spatial", "Spatial", 0.5, "Phase shift per unit along the wind direction (gust travel)."),
    floatPort("turbulence", "Turbulence", 0.3),
    {
      id: "direction",
      name: "Direction",
      type: T("vec3"),
      default: [1, 0, 0],
      tooltip: "Wind direction (normalised; 0 → +X). In the chosen Space.",
    },
  ],
  outputs: [OUT_OFFSET, OUT_POS, outPort("amount", "Amount", "float")],
  params: [
    enumParam(
      "space",
      "Space",
      [
        ["object", "Object"],
        ["world", "World"],
      ],
      "object",
    ),
  ],
  stage: "vertex",
  targetNotes: {
    ...VNOTES,
    all: `${VNOTES.all} World space needs the engine matrices (ks.matrix.objectToWorld / worldToObject).`,
  },
  build: (c) => {
    const m = new M(c.b);
    const world = c.param<string>("space") === "world";
    const posObj = m.w(c.in("position"));
    const P = world ? xform(c, m, "ks.matrix.objectToWorld", posObj, 1) : posObj;
    const dir = unit(m, m.w(c.in("direction")), m.k("vec3", 1, 0, 0));
    const mask = m.w(c.in("mask")).saturate();
    const k = m.w(c.in("strength"));
    const phi = m
      .w(c.in("frequency"))
      .mul(m.w(c.in("time")))
      .sub(m.w(c.in("spatial")).mul(P.dot(dir)))
      .mul(TAU);
    const gust = phi.sin().add(phi.mul(2.3).add(1.7).sin().mul(0.5)).div(1.5);
    const amount = k.mul(mask).mul(gust.mul(0.5).add(0.5));
    const perp = unit(m, m.w(c.b.intrinsic("cross", [dir.id, m.k("vec3", 0, 1, 0).id])), m.k("vec3", 0, 0, 1));
    const flutter = m
      .w(c.in("turbulence"))
      .mul(k)
      .mul(mask)
      .mul(phi.mul(3.1).add(hash31(m, P).mul(TAU)).sin());
    const off = dir.mul(amount).add(perp.mul(flutter));
    const offset = world ? xform(c, m, "ks.matrix.worldToObject", off, 0) : off;
    return { offset: offset.id, position: posObj.add(offset).id, amount: amount.id };
  },
});

const billboardNode: NodeDef = shNode({
  id: "billboard",
  category: "Vertex/Deform",
  name: "Billboard",
  synonyms: ["camera facing", "face camera", "sprite billboard", "impostor facing"],
  description:
    "VERTEX-ONLY camera-facing quad. The mesh must be authored around its PIVOT (the object origin), e.g. a quad in the XY plane facing +Z; vertices are rebuilt as pivot_world + Right · (x · sx) + Up · (y · sy) + Back · (z · sz), (sx, sy, sz) = lengths of the object-to-world axes (object scale is kept; rotation is replaced). Spherical: Right / Up / Back are the camera axes (always screen-aligned). Cylindrical: rotates only around the locked WORLD axis Y (trees, grass: stays upright) or X; the quad turns to face the camera as projected perpendicular to that axis (camera exactly on the axis → fixed fallback frame). Outputs the object-space Offset / Position and the camera-facing object-space Normal.",
  inputs: [posPort("object")],
  outputs: [
    OUT_OFFSET,
    OUT_POS,
    { id: "normal", name: "Normal", type: T("vec3"), tag: { semantic: "normal", space: "object" } },
  ],
  params: [
    enumParam(
      "mode",
      "Mode",
      [
        ["spherical", "Spherical (all axes)"],
        ["cylindrical", "Cylindrical (locked axis)"],
      ],
      "spherical",
    ),
    enumParam(
      "axis",
      "Locked axis",
      [
        ["y", "Y (upright)"],
        ["x", "X"],
      ],
      "y",
    ),
  ],
  stage: "vertex",
  targetNotes: {
    ...VNOTES,
    all: `${VNOTES.all} Needs the engine matrices objectToWorld / worldToObject / viewToWorld and the camera position.`,
  },
  build: (c) => {
    const m = new M(c.b);
    const pos = m.w(c.in("position"));
    const OW = "ks.matrix.objectToWorld";
    const centre = xform(c, m, OW, m.k("vec3", 0, 0, 0), 1);
    const sx = xform(c, m, OW, m.k("vec3", 1, 0, 0), 0).length();
    const sy = xform(c, m, OW, m.k("vec3", 0, 1, 0), 0).length();
    const sz = xform(c, m, OW, m.k("vec3", 0, 0, 1), 0).length();
    let right: V;
    let up: V;
    let back: V;
    if (c.param<string>("mode") === "spherical") {
      right = xform(c, m, "ks.matrix.viewToWorld", m.k("vec3", 1, 0, 0), 0);
      up = xform(c, m, "ks.matrix.viewToWorld", m.k("vec3", 0, 1, 0), 0);
      back = xform(c, m, "ks.matrix.viewToWorld", m.k("vec3", 0, 0, 1), 0);
    } else {
      const lockX = c.param<string>("axis") === "x";
      const A = lockX ? m.k("vec3", 1, 0, 0) : m.k("vec3", 0, 1, 0);
      const toCam = m.w(c.b.input("cameraPos", "world")).sub(centre);
      const fb = m.k("vec3", 0, 0, 1);
      const t = unit(m, toCam.sub(A.mul(toCam.dot(A))), fb);
      const cr = (a: V, b: V): V => m.w(c.b.intrinsic("cross", [a.id, b.id]));
      back = t;
      if (lockX) {
        right = A;
        up = cr(t, A);
      } else {
        right = cr(A, t);
        up = A;
      }
    }
    const nw = centre
      .add(right.mul(pos.x.mul(sx)))
      .add(up.mul(pos.y.mul(sy)))
      .add(back.mul(pos.z.mul(sz)));
    const posNew = xform(c, m, "ks.matrix.worldToObject", nw, 1);
    return {
      offset: posNew.sub(pos).id,
      position: posNew.id,
      normal: unit(m, xform(c, m, "ks.matrix.worldToObject", back, 0), m.k("vec3", 0, 0, 1)).id,
    };
  },
});

export const VERTEX_DEFORM_DEFS: NodeDef[] = [waveNode, windNode, billboardNode];
