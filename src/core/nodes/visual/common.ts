import type { BuildContext, ParamSchema, PortDef } from "../../registry/nodeDef";
import { T } from "../../types/generics";
import { enumParam } from "../kit";
import { M, type V } from "../procedural/irm";

/**
 * Shared helpers of the library (UV / Texture / Color).
 *
 * COORDINATE CONVENTIONS (all UV nodes):
 *  - UV origin (0,0) is the BOTTOM-LEFT corner of the image, +U points right, +V points UP (OpenGL / WebGL / Godot convention).
 *    Exporters that target a top-left-origin API flip V at the input stage (`flipUvV`), never inside a node.
 *  - Angles are counter-clockwise when looking at the image with V up. 0 = +U direction.
 *  - Tangent space: +X = +U, +Y = +V, +Z = out of the surface (OpenGL-style normal maps, "green up").
 *
 * COLOR-SPACE CONVENTIONS: every colour node documents whether it expects LINEAR or sRGB values. Nodes never convert
 * implicitly. Alpha is passed through unchanged unless a node says otherwise.
 */
export const TAU = 2 * Math.PI;
export const EPS = 1e-20;

export const ANGLE_UNIT = enumParam(
  "unit",
  "Angle unit",
  [
    ["degrees", "Degrees"],
    ["radians", "Radians"],
    ["turns", "Turns"],
  ],
  "degrees",
);
/** Angle of the chosen unit → radians. */
export const angleToRad = (a: V, c: BuildContext): V => {
  const u = c.param<string>("unit");
  return u === "radians" ? a : u === "turns" ? a.mul(TAU) : a.mul(Math.PI / 180);
};

/** Texture sampling mode shared by every node that fetches texels itself. */
export const SAMPLING_PARAM: ParamSchema = enumParam(
  "sampling",
  "Sampling",
  [
    ["implicit", "Implicit LOD (fragment only)"],
    ["lod", "Explicit LOD (any stage)"],
  ],
  "implicit",
);
export const lodPort = (def = 0): PortDef => ({
  id: "lod",
  name: "LOD",
  type: T("float"),
  default: def,
  tooltip: "Mip level used when Sampling = Explicit LOD.",
});

/** Sample `tex` at `uv` with the node's Sampling param (implicit / explicit LOD). Returns the RGBA texel. */
export function fetch(c: BuildContext, m: M, tex: number, uv: V, forceLod?: number): V {
  const explicit = forceLod !== undefined || c.param<string>("sampling") === "lod";
  const lod = forceLod !== undefined ? m.f(forceLod).id : c.in("lod");
  return m.w(c.b.sample(explicit ? { tex, uv: uv.id, mode: "lod", lod } : { tex, uv: uv.id, mode: "implicit" }));
}

export const uvPort = (id = "uv", name = "UV"): PortDef => ({
  id,
  name,
  type: T("vec2"),
  tag: { semantic: "uv" },
  defaultInput: { input: "uv0" },
  tooltip: "UV coordinate (defaults to UV0).",
});
export const colorPort = (id: string, name: string, def: number[] = [1, 1, 1, 1], tooltip?: string): PortDef => ({
  id,
  name,
  type: T("color4"),
  default: def,
  ...(tooltip ? { tooltip } : {}),
});
export const rgbPort = (id: string, name: string, def: number[] = [1, 1, 1], tooltip?: string): PortDef => ({
  id,
  name,
  type: T("color"),
  default: def,
  ...(tooltip ? { tooltip } : {}),
});
export const texPort = (id: string, name: string): PortDef => ({ id, name, type: T("texture2D") });
export const vec3Port = (id: string, name: string, def: number[], tooltip?: string): PortDef => ({
  id,
  name,
  type: T("vec3"),
  default: def,
  ...(tooltip ? { tooltip } : {}),
});
export const colorOut = (id = "out", name = "Out"): PortDef => ({ id, name, type: T("color4") });
export const rgbOut = (id = "out", name = "Out"): PortDef => ({ id, name, type: T("color") });

/** rgb of a vec4 / vec3. */
export const rgbOf = (v: V): V => (v.ty === "vec4" ? v.sw("xyz") : v);
/** vec4 from rgb + alpha taken from `src` (the original colour). */
export const withAlphaOf = (m: M, rgb: V, src: V): V => m.vec("vec4", rgb, src.w);

/** Component-wise: `x` if `cond` (a 0/1 float mask) else `y`. */
export const pick = (cond: V, a: V, b: V): V => b.mix(a, cond);

/** v / |v| with a defined fallback when |v| is 0 (never NaN). */
export function safeNormalize(m: M, v: V, fallback: V): V {
  const len = v.length();
  const ok = len.gt(1e-12);
  return m.sel(ok, v.mul(m.f(1).div(m.sel(ok, len, 1))), fallback);
}

/** Per-target availability note shared by pure-math nodes. */
export const PORTABLE = { all: "Portable IR: identical maths on every target (no engine intrinsics)." };
export const TEX_NOTES = {
  all: "Portable IR texture ops. Implicit-LOD sampling is fragment-only (a compile diagnostic appears in the vertex stage); use Explicit LOD there.",
  glsl: "GLSL ES 3.00: texture() / textureLod() / textureGrad() on a combined sampler2D; inline Sampler State nodes cannot be expressed (warning).",
  hlsl: "HLSL SM5: Texture2D.Sample / SampleLevel / SampleGrad with a separate SamplerState (static check only, never compiled here).",
  wgsl: "WGSL: textureSample / textureSampleLevel / textureSampleGrad (validated by naga). In the vertex stage implicit sampling falls back to level 0 with a warning.",
};
