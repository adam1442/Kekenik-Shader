import type { NodeDef } from "../../registry/nodeDef";
import { T } from "../../types/generics";
import { baseNode, enumParam } from "../kit";
import { M, type V } from "../procedural/irm";
import { floatPort, outPort } from "../procedural/ports";
import { TEX_NOTES, safeNormalize, texPort, uvPort } from "./common";

/**
 * Parallax mapping. Height maps: 1 = high (towards the viewer), 0 = low. View direction: tangent space, pointing FROM the surface TO the eye,
 * z > 0 above the surface. Every height fetch is an explicit-LOD-0 sample, so the node is legal in any shader stage.
 */
const parallaxNode: NodeDef = baseNode({
  id: "uvParallax",
  category: "UV/Mapping",
  name: "Parallax Mapping",
  synonyms: ["parallax occlusion", "pom", "height offset", "relief mapping", "bump offset"],
  description:
    "Offsets UV by the height map to fake depth. Simple (offset limiting, 1 fetch): Out = UV + (h·Amp − Amp/2)·v.xy/(v.z' ) with v = normalize(view) and v.z' = max(v.z, 0) + 0.42, so |offset| ≤ 1.2·Amplitude at every angle. Steep (ray march, Steps fetches): marches Steps layers from the top plane (h = 1) down to h = 0 along the view ray, finds the first layer under the surface and linearly refines between the last two layers (parallax occlusion); offset ≤ 5·Amplitude (z is limited to ≥ 0.2). Amplitude is in UV units. A zero view vector or Amplitude 0 returns UV. Height is read from the chosen channel at LOD 0.",
  inputs: [
    texPort("height", "Height Map"),
    uvPort(),
    floatPort("amplitude", "Amplitude", 0.05, "Total depth in UV units."),
    {
      id: "view",
      name: "View Dir (Tangent)",
      type: T("vec3"),
      defaultInput: { input: "viewDir", space: "tangent" },
      tooltip: "Tangent-space direction from the surface to the eye.",
    },
  ],
  outputs: [outPort("out", "Out", "vec2"), outPort("height", "Height", "float")],
  params: [
    enumParam(
      "mode",
      "Mode",
      [
        ["simple", "Simple (1 fetch)"],
        ["steep", "Steep / POM (Steps fetches)"],
      ],
      "simple",
    ),
    {
      id: "steps",
      label: "Steps",
      control: "int",
      default: 8,
      min: 2,
      max: 32,
      step: 1,
      tooltip: "Ray-march layers (Steep mode only). Unrolled at compile time: cost = Steps texture fetches.",
    },
    enumParam(
      "channel",
      "Height channel",
      [
        ["r", "Red"],
        ["g", "Green"],
        ["b", "Blue"],
        ["a", "Alpha"],
      ],
      "r",
    ),
  ],
  targetNotes: {
    ...TEX_NOTES,
    all: "Explicit-LOD-0 sampling only (works in vertex and fragment stages). Steep mode unrolls Steps texture reads — keep Steps small on mobile.",
  },
  build: (c) => {
    const m = new M(c.b);
    const tex = c.in("height");
    const uv = m.w(c.in("uv")),
      amp = m.w(c.in("amplitude"));
    const ch = c.param<string>("channel") || "r";
    const h = (p: V): V => m.w(c.b.sample({ tex, uv: p.id, mode: "lod", lod: m.f(0).id })).sw(ch);
    const v = safeNormalize(m, m.w(c.in("view")), m.k("vec3", 0, 0, 1));
    const h0 = h(uv);
    if (c.param("mode") !== "steep") {
      const vz = v.z.max(0).add(0.42);
      return { out: uv.add(v.sw("xy").mul(h0.mul(amp).sub(amp.mul(0.5)).div(vz))).id, height: h0.id };
    }
    const n = Math.max(2, Math.min(32, Math.round(Number(c.param("steps")) || 8)));
    const dir = v.sw("xy").div(v.z.max(0.2)).mul(amp); // UV travelled when the ray reaches full depth
    const at = (i: number): V => (i === 0 ? uv : uv.sub(dir.mul(i / n)));
    // surface depth at layer i is (1 − h); the ray is below the surface once layerDepth ≥ surfaceDepth.
    const hs = Array.from({ length: n + 1 }, (_, i) => h(at(i)));
    const diff = (i: number): V =>
      m
        .f(1)
        .sub(hs[i]!)
        .sub(i / n); // surfaceDepth − layerDepth: > 0 above surface, ≤ 0 below
    let res = at(n);
    for (let i = n; i >= 1; i--) {
      const before = diff(i - 1),
        after = diff(i);
      const w = after.div(m.sel(after.sub(before).eq(0), 1, after.sub(before))); // ∈ [0,1] when before > 0 ≥ after
      const refined = at(i).mix(at(i - 1), w.clamp(0, 1));
      res = m.sel(diff(i).le(0), m.sel(diff(i - 1).le(0), res, refined), res);
    }
    // layer 0 is at depth 0 = top plane: if the surface is already at/above it (h ≥ 1) the hit is at UV itself
    res = m.sel(diff(0).le(0), uv, res);
    return { out: res.id, height: h0.id };
  },
});
export const UV_PARALLAX_DEFS: NodeDef[] = [parallaxNode];
