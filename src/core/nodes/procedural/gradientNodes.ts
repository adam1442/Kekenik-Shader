import type { NodeDef, PortDef } from "../../registry/nodeDef";
import { T } from "../../types/generics";
import { baseNode, enumParam } from "../kit";
import { M, type V } from "./irm";
import { floatPort, outPort, vec2Port } from "./ports";

const CAT = "Procedural/Gradients";
const NOTE = { all: "Portable IR." };
const MIN = 1e-6;
const pPort: PortDef = {
  id: "p",
  name: "P",
  type: T("vec2"),
  defaultInput: { input: "uv0" },
  tooltip: "Coordinate (defaults to UV0).",
};
const MODE = enumParam(
  "mode",
  "Extend",
  [
    ["clamp", "Clamp"],
    ["repeat", "Repeat"],
    ["mirror", "Mirror"],
  ],
  "clamp",
);
const MODE_DOC =
  " Extend: Clamp holds 0 / 1 outside, Repeat wraps (fract), Mirror ping-pongs. Range 0 … 1 in every mode.";

/** t → [0,1] according to the Extend mode. */
function extend(m: M, t: V, mode: string): V {
  if (mode === "repeat") return t.fract();
  if (mode === "mirror") return m.f(1).sub(t.mod(2).sub(1).abs());
  return t.saturate();
}

interface Spec {
  id: string;
  name: string;
  syn: string[];
  desc: string;
  extra: PortDef[];
  withRotation: boolean;
  t: (m: M, d: V, c: import("../../registry/nodeDef").BuildContext) => V;
  mode: boolean;
}
function gradient(s: Spec): NodeDef {
  return baseNode({
    id: s.id,
    category: CAT,
    name: s.name,
    synonyms: s.syn,
    description: s.desc + (s.mode ? MODE_DOC : " Range 0 … 1."),
    inputs: [
      pPort,
      vec2Port("center", "Center", [0.5, 0.5]),
      ...(s.withRotation ? [floatPort("rotation", "Rotation", 0, "Degrees, counter-clockwise.")] : []),
      ...s.extra,
    ],
    outputs: [outPort("out", "Out", "float")],
    params: s.mode ? [MODE] : [],
    targetNotes: NOTE,
    build: (c) => {
      const m = new M(c.b);
      const d = m.w(c.in("p")).sub(m.w(c.in("center")));
      const t = s.t(m, d, c);
      return { out: (s.mode ? extend(m, t, c.param<string>("mode")) : t).id };
    },
  });
}
const safe = (v: V): V => v.abs().max(MIN);

export const linearGradientNode = gradient({
  id: "gradientLinear",
  name: "Linear Gradient",
  syn: ["ramp", "gradient", "linear ramp", "fade"],
  mode: true,
  withRotation: true,
  extra: [floatPort("length", "Length", 1, "Distance over which 0 → 1; |Length| is raised to ≥ 1e-6.")],
  desc: "0 at Center − Length/2, 1 at Center + Length/2 along the direction at Rotation degrees (0 = +X).",
  t: (m, d, c) => {
    const a = m.w(c.in("rotation")).mul(Math.PI / 180);
    return d
      .dot(m.v2(a.cos(), a.sin()))
      .div(safe(m.w(c.in("length"))))
      .add(0.5);
  },
});
export const radialGradientNode = gradient({
  id: "gradientRadial",
  name: "Radial Gradient",
  syn: ["circular gradient", "spot", "vignette", "radial ramp"],
  mode: true,
  withRotation: false,
  extra: [floatPort("radius", "Radius", 0.5, "Distance at which the value reaches 1; |Radius| is raised to ≥ 1e-6.")],
  desc: "|P − Center| / Radius: 0 at the centre, 1 at Radius.",
  t: (m, d, c) => d.length().div(safe(m.w(c.in("radius")))),
});
export const angularGradientNode = gradient({
  id: "gradientAngular",
  name: "Angular Gradient",
  syn: ["conic gradient", "sweep gradient", "angle gradient", "radar"],
  mode: false,
  withRotation: true,
  extra: [],
  desc: "Sweeps 0 → 1 counter-clockwise around Center, starting at the direction Rotation degrees (0 = +X). Discontinuous at the start direction (by definition). Undefined direction at the centre returns 0.",
  t: (m, d, c) =>
    m
      .atan2(d.y, d.x)
      .sub(m.w(c.in("rotation")).mul(Math.PI / 180))
      .div(2 * Math.PI)
      .fract(),
});
export const diamondGradientNode = gradient({
  id: "gradientDiamond",
  name: "Diamond Gradient",
  syn: ["manhattan gradient", "rhombus gradient", "square gradient"],
  mode: true,
  withRotation: true,
  extra: [floatPort("radius", "Radius", 0.5, "|Radius| is raised to ≥ 1e-6.")],
  desc: "(|x| + |y|) / Radius in the frame rotated by Rotation degrees: 0 at the centre, 1 on the diamond of half-diagonal Radius.",
  t: (m, d, c) => {
    const a = m.w(c.in("rotation")).mul(Math.PI / 180);
    const q = m.v2(a.cos().mul(d.x).add(a.sin().mul(d.y)), a.cos().mul(d.y).sub(a.sin().mul(d.x)));
    return q.x
      .abs()
      .add(q.y.abs())
      .div(safe(m.w(c.in("radius"))));
  },
});
