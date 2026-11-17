import type { BuildContext, NodeDef } from "../../registry/nodeDef";
import type { ExprId } from "../../ir/types";
import { cloneCone } from "../../ir/clone";
import { baseNode, enumParam } from "../kit";
import { M, type V } from "../procedural/irm";
import { floatPort, outPort } from "../procedural/ports";
import { T } from "../../types/generics";
import { PORTABLE, uvPort } from "./common";
import { flatNormal, normalFromGradient } from "./normalMath";

/** Default fixed step (UV units) and the unit of the Pixel step mode (the default Step is exactly one pixel). */
const HN_DEFAULT_STEP = 1 / 256;
/** Cone-size guard: re-evaluating a Height network larger than this raises W_HEIGHT_NORMAL_COST. */
const HN_CONE_GUARD = 2000;

const QUALITY: Array<[string, string]> = [
  ["fast", "Fast (forward difference, +2 evaluations)"],
  ["good", "Good (central difference, +4 evaluations)"],
  ["derivative", "Derivative (ddx / ddy, +0, fragment only, 2×2-blocky)"],
];
const STEP_MODE: Array<[string, string]> = [
  ["fixed", "Fixed (UV units)"],
  ["pixel", "Pixel (× fwidth(UV))"],
];

/** Per-quality number of EXTRA evaluations of the Height cone. */
const HN_EXTRA_EVALS: Record<string, number> = { fast: 2, good: 4, derivative: 0 };

interface Slope {
  gx: V;
  gy: V;
  /** Height depends on the UV leaf (false ⇒ flat normal + diagnostic). */
  dependent: boolean;
  /** Original cone size and total rebuilt expressions (cost). */
  cone: number;
  rebuilt: number;
}

/** dh/du, dh/dv of the Height network by re-evaluating its cone at uv ± (du, 0) / (0, dv) — or by screen derivatives. */
function slope(c: BuildContext, m: M, h: ExprId, uv: ExprId): Slope {
  const quality = c.param<string>("quality") || "good";
  const hv = m.w(h);
  if (quality === "derivative") {
    // Chain rule through the screen-space Jacobian of uv: solve [dh/dx, dh/dy] = [dh/du, dh/dv]·J.
    const uvV = m.w(uv);
    const dux = m.w(c.b.deriv("ddx", uv)),
      duy = m.w(c.b.deriv("ddy", uv));
    const hx = m.w(c.b.deriv("ddx", h)),
      hy = m.w(c.b.deriv("ddy", h));
    const det = dux.x.mul(duy.y).sub(duy.x.mul(dux.y));
    const ok = det.abs().gt(1e-20);
    const safe = m.sel(ok, det, 1);
    const gx = m.sel(ok, hx.mul(duy.y).sub(hy.mul(dux.y)).div(safe), 0);
    const gy = m.sel(ok, hy.mul(dux.x).sub(hx.mul(duy.x)).div(safe), 0);
    void uvV;
    return { gx, gy, dependent: true, cone: 0, rebuilt: 0 };
  }
  const step = m.w(c.in("step"));
  let du: V, dv: V;
  if (c.param<string>("stepMode") === "pixel") {
    const fw = m.w(c.b.deriv("fwidth", uv));
    const px = step.mul(1 / HN_DEFAULT_STEP);
    du = fw.x.mul(px).max(1e-8);
    dv = fw.y.mul(px).max(1e-8);
  } else {
    du = step.abs().max(1e-8);
    dv = du;
  }
  const at = (sx: number, sy: number): { v: V; dependent: boolean; cone: number; rebuilt: number } => {
    const off = m.vec("vec2", sx === 0 ? m.f(0) : du.mul(sx), sy === 0 ? m.f(0) : dv.mul(sy));
    const r = cloneCone(c.b, h, new Map([[uv, m.w(uv).add(off).id]]));
    return { v: m.w(r.id), dependent: r.dependent, cone: r.coneSize, rebuilt: r.rebuilt };
  };
  const good = quality === "good";
  const px = at(1, 0),
    py = at(0, 1);
  const nx = good ? at(-1, 0) : null,
    ny = good ? at(0, -1) : null;
  const gx = good ? px.v.sub(nx!.v).div(du.mul(2)) : px.v.sub(hv).div(du);
  const gy = good ? py.v.sub(ny!.v).div(dv.mul(2)) : py.v.sub(hv).div(dv);
  const all = [px, py, ...(good ? [nx!, ny!] : [])];
  return {
    gx,
    gy,
    dependent: px.dependent || py.dependent,
    cone: px.cone,
    rebuilt: all.reduce((n, r) => n + r.rebuilt, 0),
  };
}

const NORMAL_TAG = { semantic: "normal" as const, space: "tangent" as const };

export const heightToNormalNode: NodeDef = baseNode({
  id: "heightToNormal",
  category: "Texture/Normal",
  name: "Height To Normal",
  synonyms: [
    "normal from gradient",
    "procedural normal",
    "bump from noise",
    "normal from any height",
    "bump from gradient",
  ],
  description:
    "Builds a tangent-space normal map from ANY grayscale (float) network — a Radial Gradient, noise, SDF, a texture sample… — by re-evaluating the Height network at neighbouring UV coordinates: n = normalize(−dh/du·k, −dh/dv·k, 1), k = Strength·Scale. " +
    "Fast: forward difference (the Height cone is evaluated 2 extra times). Good: central difference (4 extra evaluations, symmetric, most accurate). Derivative: ddx / ddy of the height (0 extra evaluations, fragment stage only, blocky on 2×2 pixel quads). " +
    "Step is the sampling offset in UV units (default 1/256); in Pixel step mode the offset is fwidth(UV) × (Step ÷ 1/256), i.e. the default is exactly one pixel. The optional UV input must be the coordinate your Height network was computed from (default: UV0); if Height does not depend on it the node warns and returns the flat normal. " +
    "Cost: the cone is re-evaluated inline (no function calls — Godot compatible), so a heavy Height network costs ×(1 + extra evaluations). Tangent space: +X = +U, +Y = +V (green up), +Z out of the surface.",
  inputs: [
    {
      id: "height",
      name: "Height",
      type: T("float"),
      default: 0,
      tooltip: "Any float network that depends on the UV input (gradient, noise, shape, texture…).",
    },
    uvPort("uv", "UV"),
    floatPort("strength", "Strength", 1, "Slope multiplier (1 = the exact gradient)."),
    floatPort("scale", "Scale", 1, "Height scale applied together with Strength."),
    floatPort(
      "step",
      "Step",
      HN_DEFAULT_STEP,
      "Sampling offset: UV units (Fixed) or HN default ×  fwidth(UV) (Pixel).",
    ),
  ],
  outputs: [
    { id: "normal", name: "Normal", type: T("vec3"), tag: NORMAL_TAG },
    { id: "packed", name: "Normal (packed 0–1)", type: T("vec3"), tag: { semantic: "color" } },
    outPort("slope", "Slope", "float"),
  ],
  params: [
    enumParam("quality", "Quality", QUALITY, "good"),
    enumParam("stepMode", "Step mode", STEP_MODE, "fixed"),
    { id: "flipGreen", label: "Flip Green (DirectX)", control: "bool", default: false },
  ],
  targetNotes: {
    all: `${PORTABLE.all} Derivative quality needs fragment-stage derivatives; Fast / Good work in any stage.`,
  },
  build: (c) => {
    const m = new M(c.b);
    const h = c.in("height"),
      uv = c.in("uv");
    const s = slope(c, m, h, uv);
    if (!s.dependent && c.connected("height"))
      c.warn(
        "W_HEIGHT_NORMAL_NO_DEPENDENCY",
        "Height does not depend on the UV input, so the normal is flat. Connect the same coordinate to UV (or leave both on UV0).",
      );
    const k = m.w(c.in("strength")).mul(m.w(c.in("scale")));
    const flat = flatNormal(m);
    const n = s.dependent ? normalFromGradient(m, s.gx, s.gy, k, c.param("flipGreen") === true) : flat;
    const extra = HN_EXTRA_EVALS[c.param<string>("quality") || "good"] ?? 4;
    if (s.cone * extra > HN_CONE_GUARD)
      c.warn(
        "W_HEIGHT_NORMAL_COST",
        `Height network has ${s.cone} IR nodes and is re-evaluated ${extra}× (≈ ×${1 + extra} cost, ${s.rebuilt} extra nodes). Consider baking it to a texture.`,
      );
    const slopeV = s.dependent ? m.vec("vec2", s.gx.mul(k), s.gy.mul(k)).length() : m.f(0);
    return { normal: n.id, packed: n.mul(0.5).add(0.5).id, slope: slopeV.id };
  },
});
