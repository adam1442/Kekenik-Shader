import type { BuildContext, NodeDef, PortDef } from "../../registry/nodeDef";
import { T, floatVec, numeric, sameAs } from "../../types/generics";
import { baseNode, enumParam } from "../kit";
import { M, type V } from "./irm";
import { floatPort, outPort, vec2Port } from "./ports";

const NOTE = { all: "Portable IR." };
const UNIT = enumParam(
  "unit",
  "Angle unit",
  [
    ["degrees", "Degrees"],
    ["radians", "Radians"],
    ["turns", "Turns"],
  ],
  "degrees",
);
/** angle in the chosen unit → radians */
const toRad = (_m: M, a: V, c: BuildContext): V => {
  const u = c.param<string>("unit");
  return u === "radians" ? a : u === "turns" ? a.mul(2 * Math.PI) : a.mul(Math.PI / 180);
};
const fromRad = (a: V, c: BuildContext): V => {
  const u = c.param<string>("unit");
  return u === "radians" ? a : u === "turns" ? a.div(2 * Math.PI) : a.mul(180 / Math.PI);
};

export const previewNode: NodeDef = baseNode({
  id: "preview",
  category: "Utility/Debug",
  name: "Preview",
  synonyms: ["debug view", "inspect", "probe", "view value", "watch"],
  description:
    "Pass-through (Out = In, any scalar / vector). New instances show the standard in-node thumbnail (the shared node-preview renderer: float → grey, vector → RGB with out-of-range stripes) — it does not add a second preview system and generates no extra code.",
  inputs: [{ id: "in", name: "In", type: numeric("T"), default: 0.5 }],
  outputs: [{ id: "out", name: "Out", type: sameAs("in") }],
  previewByDefault: true,
  targetNotes: NOTE,
  build: (c) => ({ out: c.in("in") }),
});

export const remapSafeNode: NodeDef = baseNode({
  id: "remapSafe",
  category: "Utility/Math",
  name: "Remap (Safe)",
  synonyms: ["safe remap", "map range safe", "remap clamp", "rescale range"],
  description:
    "Maps In from [In Min, In Max] to [Out Min, Out Max] (linear, works on vectors). Zero-length input range (In Min = In Max) is DEFINED: the result is Out Min (no division by zero). Clamp limits the interpolation factor to 0…1. Reversed ranges are allowed. The core Remap node is unchanged (it divides by zero on a zero range).",
  inputs: [
    { id: "in", name: "In", type: floatVec("T"), default: 0.5 },
    floatPort("inMin", "In Min", -1),
    floatPort("inMax", "In Max", 1),
    floatPort("outMin", "Out Min", 0),
    floatPort("outMax", "Out Max", 1),
  ],
  outputs: [{ id: "out", name: "Out", type: sameAs("in") }],
  params: [{ id: "clamp", label: "Clamp", control: "bool", default: false }],
  targetNotes: NOTE,
  build: (c) => {
    const m = new M(c.b);
    const den = m.w(c.in("inMax")).sub(m.w(c.in("inMin")));
    const zero = den.eq(0);
    const inv = m.sel(zero, 0, m.f(1).div(m.sel(zero, 1, den)));
    let t = m
      .w(c.in("in"))
      .sub(m.w(c.in("inMin")))
      .mul(inv);
    if (c.param("clamp") === true) t = t.saturate();
    return { out: m.w(c.in("outMin")).add(t.mul(m.w(c.in("outMax")).sub(m.w(c.in("outMin"))))).id };
  },
});

export const rotateAxisNode: NodeDef = baseNode({
  id: "rotateAboutAxis",
  category: "Utility/Math",
  name: "Rotate About Axis",
  synonyms: ["axis angle", "rodrigues", "rotate vector", "rotate 3d"],
  description:
    "Rotates vector In around Axis by Rotation (right-handed: counter-clockwise looking down the axis towards the origin) using Rodrigues' formula. Axis is normalised internally; a ZERO-length Axis is degenerate and returns In unchanged.",
  inputs: [
    { id: "in", name: "In", type: T("vec3"), default: [1, 0, 0] },
    { id: "axis", name: "Axis", type: T("vec3"), default: [0, 1, 0] },
    floatPort("rotation", "Rotation", 90),
  ],
  outputs: [outPort("out", "Out", "vec3")],
  params: [UNIT],
  targetNotes: NOTE,
  build: (c) => {
    const m = new M(c.b);
    const v = m.w(c.in("in"));
    const axis = m.w(c.in("axis"));
    const len = axis.length();
    const ok = len.gt(0);
    const n = axis.mul(m.sel(ok, m.f(1).div(m.sel(ok, len, 1)), 0));
    const th = toRad(m, m.w(c.in("rotation")), c);
    const cs = th.cos();
    const rot = v
      .mul(cs)
      .add(m.fn("cross", n, v).mul(th.sin()))
      .add(n.mul(n.dot(v).mul(m.f(1).sub(cs))));
    return { out: m.sel(ok, rot, v).id };
  },
});

export const polarToCartesianNode: NodeDef = baseNode({
  id: "polarToCartesian",
  category: "Utility/Math",
  name: "Polar → Cartesian",
  synonyms: ["polar to cartesian", "polar to xy", "radial to xy"],
  description:
    "Center + Radius·(cos θ, sin θ) with θ measured counter-clockwise from +X in the chosen unit. Any radius / angle is valid (negative radius points the opposite way).",
  inputs: [floatPort("radius", "Radius", 1), floatPort("angle", "Angle", 0), vec2Port("center", "Center", [0, 0])],
  outputs: [outPort("out", "Out", "vec2")],
  params: [UNIT],
  targetNotes: NOTE,
  build: (c) => {
    const m = new M(c.b);
    const th = toRad(m, m.w(c.in("angle")), c);
    return { out: m.w(c.in("center")).add(m.v2(th.cos(), th.sin()).mul(m.w(c.in("radius")))).id };
  },
});

export const cartesianToPolarNode: NodeDef = baseNode({
  id: "cartesianToPolar",
  category: "Utility/Math",
  name: "Cartesian → Polar",
  synonyms: ["cartesian to polar", "xy to polar", "polar coordinates", "to radial"],
  description:
    "Radius = |P − Center| (≥ 0); Angle = atan2(y, x) counter-clockwise from +X. Range: Signed (−π, π] / (−180, 180] / (−0.5, 0.5]; Unsigned [0, 2π) / [0, 360) / [0, 1). At the centre (undefined direction) the angle is 0. Polar = (Radius, Angle).",
  inputs: [
    { id: "p", name: "P", type: T("vec2"), defaultInput: { input: "uv0" } },
    vec2Port("center", "Center", [0.5, 0.5]),
  ],
  outputs: [
    outPort("radius", "Radius", "float"),
    outPort("angle", "Angle", "float"),
    outPort("polar", "Polar", "vec2"),
  ],
  params: [
    UNIT,
    enumParam(
      "range",
      "Angle range",
      [
        ["signed", "Signed"],
        ["unsigned", "Unsigned"],
      ],
      "signed",
    ),
  ],
  targetNotes: NOTE,
  build: (c) => {
    const m = new M(c.b);
    const d = m.w(c.in("p")).sub(m.w(c.in("center")));
    let a = m.atan2(d.y, d.x);
    if (c.param("range") === "unsigned") a = m.sel(a.lt(0), a.add(2 * Math.PI), a);
    const ang = fromRad(a, c);
    const r = d.length();
    return { radius: r.id, angle: ang.id, polar: m.v2(r, ang).id };
  },
});

export const flipNode: NodeDef = baseNode({
  id: "flip",
  category: "Utility/Math",
  name: "Flip",
  synonyms: ["invert channel", "negate channel", "mirror channel", "flip channels"],
  description:
    "Flips the selected channels (Red / Green / Blue / Alpha = x / y / z / w; channels beyond the input's size are ignored). Mode Negate: c → −c. Mode Mirror 0…1: c → 1 − c.",
  inputs: [{ id: "in", name: "In", type: floatVec("T"), default: 1 }],
  outputs: [{ id: "out", name: "Out", type: sameAs("in") }],
  params: [
    enumParam(
      "mode",
      "Mode",
      [
        ["negate", "Negate (−c)"],
        ["mirror", "Mirror 0…1 (1−c)"],
      ],
      "negate",
    ),
    ...(["x:Red", "y:Green", "z:Blue", "w:Alpha"] as const).map((s) => ({
      id: s[0],
      label: s.slice(2),
      control: "bool" as const,
      default: s[0] === "y",
    })),
  ],
  targetNotes: NOTE,
  build: (c) => {
    const m = new M(c.b);
    const v = m.w(c.in("in"));
    const flip = (x: V) => (c.param("mode") === "mirror" ? m.f(1).sub(x) : x.neg());
    if (v.ty === "float") return { out: (c.param("x") === true ? flip(v) : v).id };
    const n = v.ty === "vec2" ? 2 : v.ty === "vec3" ? 3 : 4;
    const comps = "xyzw"
      .slice(0, n)
      .split("")
      .map((ch) => (c.param(ch) === true ? flip(v.sw(ch)) : v.sw(ch)));
    return { out: m.vec(n === 2 ? "vec2" : n === 3 ? "vec3" : "vec4", ...comps).id };
  },
});

const SAT_MODES: Array<[string, string]> = [
  ["signed", "Signed (−1…1)"],
  ["positive", "Positive (≥ 0)"],
  ["negative", "Negative (≤ 0)"],
  ["centered", "Centered (½ + ½x → 0…1)"],
  ["magnitude", "Magnitude (|x| → 0…1)"],
];
export const saturateVariantNode: NodeDef = baseNode({
  id: "saturateVariant",
  category: "Utility/Math",
  name: "Saturate Variants",
  synonyms: ["clamp signed", "clamp negative", "clamp positive", "clamp1", "saturate signed"],
  description:
    "Range limiters beyond the core Saturate (0…1): Signed = clamp(x, −1, 1); Positive = max(x, 0); Negative = min(x, 0); Centered = saturate(0.5 + 0.5x); Magnitude = saturate(|x|). Component-wise.",
  inputs: [{ id: "in", name: "In", type: floatVec("T"), default: 0.5 }],
  outputs: [{ id: "out", name: "Out", type: sameAs("in") }],
  params: [enumParam("mode", "Mode", SAT_MODES, "signed")],
  targetNotes: NOTE,
  build: (c) => {
    const m = new M(c.b);
    const x = m.w(c.in("in"));
    const mode = c.param<string>("mode");
    const out =
      mode === "positive"
        ? x.max(0)
        : mode === "negative"
          ? x.min(0)
          : mode === "centered"
            ? x.mul(0.5).add(0.5).saturate()
            : mode === "magnitude"
              ? x.abs().saturate()
              : x.clamp(-1, 1);
    return { out: out.id };
  },
});

/* ── time helpers ─────────────────────────────────────────────────────────────────────────────── */
const tPort: PortDef = {
  id: "t",
  name: "T",
  type: T("float"),
  defaultInput: { input: "time" },
  tooltip: "Defaults to Time.",
};
const TIME_NOTE =
  " Works for negative T (floor-based). Float32 precision: T loses fractional bits above ~1e5 (use a smaller time base for long-running effects). Invalid period / length (≤ 0) returns 0.";
const tNode = (
  id: string,
  name: string,
  syn: string[],
  desc: string,
  inputs: PortDef[],
  params: NodeDef["params"],
  run: (m: M, t: V, c: BuildContext) => V,
): NodeDef =>
  baseNode({
    id,
    category: "Utility/Time",
    name,
    synonyms: syn,
    description: desc + TIME_NOTE,
    inputs: [tPort, ...inputs],
    outputs: [outPort("out", "Out", "float")],
    params,
    targetNotes: NOTE,
    build: (c) => {
      const m = new M(c.b);
      return { out: run(m, m.w(c.in("t")), c).id };
    },
  });
const safePeriod = (m: M, p: V): { ok: V; p: V } => {
  const ok = p.gt(0);
  return { ok, p: m.sel(ok, p, 1) };
};

export const pingPongNode = tNode(
  "timePingPong",
  "Ping-Pong",
  ["bounce", "back and forth", "triangle wave", "oscillate"],
  "Triangle wave bouncing between 0 and Length (period 2·Length): Length − |(T mod 2·Length) − Length|. Range [0, Length].",
  [floatPort("length", "Length", 1)],
  [],
  (m, t, c) => {
    const { ok, p } = safePeriod(m, m.w(c.in("length")));
    return m.sel(ok, p.sub(t.mod(p.mul(2)).sub(p).abs()), 0);
  },
);

export const sawtoothNode = tNode(
  "timeSawtooth",
  "Sawtooth",
  ["saw", "ramp wave", "repeat", "loop", "fract time"],
  "Repeating ramp: fract(T / Period + Phase). Rising: [0, 1) from 0 up; Falling: (0, 1] (1 − rising). Phase is in periods.",
  [floatPort("period", "Period", 1), floatPort("phase", "Phase", 0)],
  [
    enumParam(
      "direction",
      "Direction",
      [
        ["rising", "Rising"],
        ["falling", "Falling"],
      ],
      "rising",
    ),
  ],
  (m, t, c) => {
    const { ok, p } = safePeriod(m, m.w(c.in("period")));
    const r = t
      .div(p)
      .add(m.w(c.in("phase")))
      .fract();
    return m.sel(ok, c.param("direction") === "falling" ? m.f(1).sub(r) : r, 0);
  },
);

export const smoothLoopNode = tNode(
  "timeSmoothLoop",
  "Smooth Loop",
  ["smooth wave", "cosine loop", "breathing", "ease loop", "pulse"],
  "Seamless 0 → 1 → 0 loop with zero slope at both ends. Cosine: 0.5 − 0.5·cos(2π·x); Smoothstep / Smootherstep ease a triangle wave. x = fract(T / Period + Phase); value 0 at x = 0, 1 at x = 0.5. Range [0, 1].",
  [floatPort("period", "Period", 1), floatPort("phase", "Phase", 0)],
  [
    enumParam(
      "shape",
      "Shape",
      [
        ["cosine", "Cosine"],
        ["smoothstep", "Smoothstep"],
        ["smootherstep", "Smootherstep"],
      ],
      "cosine",
    ),
  ],
  (m, t, c) => {
    const { ok, p } = safePeriod(m, m.w(c.in("period")));
    const x = t
      .div(p)
      .add(m.w(c.in("phase")))
      .fract();
    const shape = c.param<string>("shape");
    const tri = m.f(1).sub(x.mul(2).sub(1).abs());
    const v =
      shape === "smoothstep"
        ? tri.mul(tri).mul(m.f(3).sub(tri.mul(2)))
        : shape === "smootherstep"
          ? tri
              .mul(tri)
              .mul(tri)
              .mul(tri.mul(tri.mul(6).sub(15)).add(10))
          : m.f(0.5).sub(
              x
                .mul(2 * Math.PI)
                .cos()
                .mul(0.5),
            );
    return m.sel(ok, v, 0);
  },
);
