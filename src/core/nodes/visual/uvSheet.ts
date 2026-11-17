import type { NodeDef } from "../../registry/nodeDef";
import { T } from "../../types/generics";
import { baseNode, enumParam } from "../kit";
import { M, type V } from "../procedural/irm";
import { floatPort, outPort } from "../procedural/ports";
import { SAMPLING_PARAM, TEX_NOTES, fetch, lodPort, texPort, uvPort } from "./common";

/** Flipbook / sprite-sheet animation and flow maps. */
const flipbookNode: NodeDef = baseNode({
  id: "uvFlipbook",
  category: "UV/Animation",
  name: "Flipbook",
  synonyms: ["sprite sheet", "texture atlas animation", "frame animation", "spritesheet uv"],
  description:
    "Maps UV (0…1 over ONE frame) into a Columns × Rows sprite sheet. Frames are numbered row by row (left → right); Start picks the first row (Top-left = frame 0 is the top-left cell, Bottom-left = bottom-left cell). Frame is floored and wraps with floor-mod (negative frames loop; Reverse plays the sheet backwards). Columns / Rows are floored and at least 1. Edge handles UV outside 0…1: Repeat = fract (no bleeding into neighbour frames), Clamp, None (raw, bleeds). Interpolate adds the NEXT frame's UV and Blend = fract(Frame) for a cross-fade (lerp the two samples by Blend); without it Blend = 0 and UV Next = UV. Output UV range: inside the selected cell.",
  inputs: [
    uvPort(),
    floatPort("columns", "Columns", 4),
    floatPort("rows", "Rows", 4),
    floatPort("frame", "Frame", 0, "Frame number (floor is used; the fraction drives Blend when Interpolate is on)."),
  ],
  outputs: [
    outPort("out", "UV", "vec2"),
    outPort("next", "UV Next", "vec2"),
    outPort("blend", "Blend", "float"),
    outPort("index", "Index", "float"),
  ],
  params: [
    enumParam(
      "start",
      "Start",
      [
        ["topLeft", "Top-left"],
        ["bottomLeft", "Bottom-left"],
      ],
      "topLeft",
    ),
    enumParam(
      "direction",
      "Playback",
      [
        ["forward", "Forward"],
        ["reverse", "Reverse"],
      ],
      "forward",
    ),
    enumParam(
      "edge",
      "Edge",
      [
        ["repeat", "Repeat"],
        ["clamp", "Clamp"],
        ["none", "None"],
      ],
      "repeat",
    ),
    { id: "interpolate", label: "Interpolate", control: "bool", default: false },
  ],
  targetNotes: {
    all: "UV maths only — identical on every target. The sprite sheet texture should use Clamp wrapping and point or linear filtering with no mips (or mip bias) to avoid bleeding.",
  },
  build: (c) => {
    const m = new M(c.b);
    const cols = m.w(c.in("columns")).floor().max(1),
      rows = m.w(c.in("rows")).floor().max(1);
    const total = cols.mul(rows);
    const raw = m.w(c.in("frame")).floor();
    const edge = c.param<string>("edge");
    const uv0 = m.w(c.in("uv"));
    const uv = edge === "repeat" ? uv0.fract() : edge === "clamp" ? uv0.clamp(0, 1) : uv0;
    const rev = c.param("direction") === "reverse";
    const top = c.param("start") !== "bottomLeft";
    const cell = (f: V): { uv: V; idx: V } => {
      const w = f.mod(total);
      const idx = rev ? total.sub(1).sub(w) : w;
      const col = idx.mod(cols),
        row = idx.div(cols).floor();
      const rowFromBottom = top ? rows.sub(1).sub(row) : row;
      return { uv: uv.add(m.v2(col, rowFromBottom)).div(m.v2(cols, rows)), idx };
    };
    const a = cell(raw);
    const interp = c.param("interpolate") === true;
    // The NEXT frame in time is frame + 1 for both directions: Reverse already maps it to the previous cell via idx = total − 1 − w.
    const nextSrc = interp ? cell(raw.add(1)) : a;
    const blend = interp ? m.w(c.in("frame")).fract() : m.f(0);
    return { out: a.uv.id, next: nextSrc.uv.id, blend: blend.id, index: a.idx.id };
  },
});

const flowDesc =
  "Dual-phase flow-map animation. Flow = (R, G)·2 − 1 of the flow map (LINEAR data: import as non-sRGB), +R = +U, +G = +V (use Invert Y for DirectX-style maps); B / A are ignored. With T' = Time·Speed + Phase: phase A = fract(T'), phase B = fract(T' + 0.5); UV A/B = UV − Flow·Strength·phase (content moves ALONG the flow). Blend = |2·phaseA − 1| is the weight of layer B: Out = lerp(sample(UV A), sample(UV B), Blend) — both layers are invisible exactly when they restart, hiding the reset. Strength 0 → no motion. Texel (0.5, 0.5) = zero flow.";
const flowMapNode: NodeDef = baseNode({
  id: "uvFlowMap",
  category: "UV/Animation",
  name: "Flow Map",
  synonyms: ["flow uv", "water flow", "vector field distortion", "flowmap"],
  description: flowDesc,
  inputs: [
    uvPort(),
    texPort("flowTex", "Flow Map"),
    { id: "t", name: "Time", type: T("float"), defaultInput: { input: "time" } },
    floatPort("strength", "Strength", 0.2, "Maximum UV distance a layer travels per cycle."),
    floatPort("speed", "Speed", 1, "Cycles per second."),
    floatPort("phase", "Phase", 0, "Per-pixel cycle offset (feed noise to hide the pulsing)."),
    lodPort(),
  ],
  outputs: [
    outPort("uvA", "UV A", "vec2"),
    outPort("uvB", "UV B", "vec2"),
    outPort("blend", "Blend", "float"),
    outPort("flow", "Flow", "vec2"),
  ],
  params: [SAMPLING_PARAM, { id: "invertY", label: "Invert Y", control: "bool", default: false }],
  targetNotes: TEX_NOTES,
  build: (c) => {
    const m = new M(c.b);
    const uv = m.w(c.in("uv"));
    const texel = fetch(c, m, c.in("flowTex"), uv);
    let flow = m.v2(texel.x, texel.y).mul(2).sub(1);
    if (c.param("invertY") === true) flow = m.v2(flow.x, flow.y.neg());
    const t = m
      .w(c.in("t"))
      .mul(m.w(c.in("speed")))
      .add(m.w(c.in("phase")));
    const pa = t.fract(),
      pb = t.add(0.5).fract();
    const k = flow.mul(m.w(c.in("strength")));
    return { uvA: uv.sub(k.mul(pa)).id, uvB: uv.sub(k.mul(pb)).id, blend: pa.mul(2).sub(1).abs().id, flow: flow.id };
  },
});
export const UV_SHEET_DEFS: NodeDef[] = [flipbookNode, flowMapNode];
