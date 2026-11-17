import type { NodeDef, PortDef, ResolvedPorts } from "../../registry/nodeDef";
import { T } from "../../types/generics";
import { baseNode, enumParam } from "../kit";
import { M, type V } from "../procedural/irm";
import { floatPort, outPort } from "../procedural/ports";
import { PORTABLE, TEX_NOTES, colorOut, colorPort, rgbOf, rgbPort, texPort } from "./common";

const NOTE = { all: PORTABLE.all };
const MIN_FUZZ = 1e-5;

const replaceColorNode: NodeDef = baseNode({
  id: "colorReplace",
  category: "Color/Mask",
  name: "Replace Color",
  synonyms: ["color swap", "recolor", "chroma replace", "color key replace"],
  description:
    "Replaces colours close to From with To. d = Euclidean RGB distance |In − From|. d ≤ Range → exactly To; d ≥ Range + Fuzziness → In unchanged; in between a LINEAR cross-fade (To → In). Fuzziness below 1e-5 is treated as 1e-5 (hard edge, no division by zero). Compare in ONE colour space (usually the one From was picked in). Alpha untouched.",
  inputs: [
    colorPort("in", "In", [1, 0.2, 0.2, 1]),
    rgbPort("from", "From", [1, 0, 0]),
    rgbPort("to", "To", [0, 0.6, 1]),
    floatPort("range", "Range", 0.2),
    floatPort("fuzziness", "Fuzziness", 0.1),
  ],
  outputs: [colorOut()],
  targetNotes: NOTE,
  build: (c) => {
    const m = new M(c.b);
    const v = m.w(c.in("in")),
      rgb = rgbOf(v);
    const d = rgb.sub(m.w(c.in("from"))).length();
    const k = d
      .sub(m.w(c.in("range")))
      .div(m.w(c.in("fuzziness")).max(MIN_FUZZ))
      .saturate();
    return { out: m.vec("vec4", m.w(c.in("to")).mix(rgb, k), v.w).id };
  },
});

const colorMaskNode: NodeDef = baseNode({
  id: "colorMask",
  category: "Color/Mask",
  name: "Color Mask",
  synonyms: ["chroma key", "color key", "select color", "color range mask"],
  description:
    "Soft mask of how close In is to Mask Color: Mask = saturate(1 − (d − Range)/Fuzziness) with d = |In − Mask Color| (Euclidean RGB). d ≤ Range → 1; d ≥ Range + Fuzziness → 0; linear in between. Fuzziness below 1e-5 is treated as 1e-5. Output range [0, 1]. Compare values of one colour space.",
  inputs: [
    rgbPort("in", "In", [1, 0.2, 0.2]),
    rgbPort("mask", "Mask Color", [1, 0, 0]),
    floatPort("range", "Range", 0.2),
    floatPort("fuzziness", "Fuzziness", 0.1),
  ],
  outputs: [outPort("out", "Mask", "float")],
  targetNotes: NOTE,
  build: (c) => {
    const m = new M(c.b);
    const d = m
      .w(c.in("in"))
      .sub(m.w(c.in("mask")))
      .length();
    return {
      out: m
        .f(1)
        .sub(d.sub(m.w(c.in("range"))).div(m.w(c.in("fuzziness")).max(MIN_FUZZ)))
        .saturate().id,
    };
  },
});

/** LUT layout descriptor: `strip` = Size slices side by side (texture Size² × Size); `grid` = Size slices in a √Size × √Size tile grid (Size must be a perfect square: 16, 64, …). */
function lutLayout(layout: string, size: number): { w: number; h: number; tiles: number } {
  if (layout === "grid") {
    const k = Math.round(Math.sqrt(size));
    if (k * k !== size) throw new Error(`Grid LUT layout needs a perfect-square Size (16, 64, …), got ${size}.`);
    return { w: k * size, h: k * size, tiles: k };
  }
  return { w: size * size, h: size, tiles: size };
}

const lutNode: NodeDef = baseNode({
  id: "colorLut",
  category: "Color/Mask",
  name: "LUT Lookup",
  synonyms: ["color lookup table", "3d lut", "color grading lut", "lut strip", "color cube"],
  description:
    "Applies a 3D colour lookup table stored in a 2D texture. Layouts: Strip = Size slices side by side (texture Size² × Size, e.g. 256×16 for Size 16), blue selects the slice left→right; Grid = Size slices in a √Size × √Size tile grid (e.g. 64×64 for 16, 512×512 for 64), slice k at tile (k mod √Size, k div √Size). Inside a slice red grows along U and green along V. Addressing is half-texel exact: coordinate = (index·(Size − 1) + 0.5)/extent, blue is interpolated manually between two slices (trilinear overall). Input RGB is SATURATED to 0…1 and read in the LUT's input space (usually sRGB-encoded). Flip V = the file stores rows top-to-bottom. The LUT texture must be Linear-filtered, Clamp-wrapped, no mips, and imported as LINEAR data (sRGB off). Always explicit LOD 0. Amount blends from In to the graded colour. Alpha untouched.",
  inputs: [colorPort("in", "In", [0.6, 0.4, 0.2, 1]), texPort("lut", "LUT"), floatPort("amount", "Amount", 1)],
  outputs: [colorOut()],
  params: [
    enumParam(
      "layout",
      "Layout",
      [
        ["strip", "Strip (Size² × Size)"],
        ["grid", "Grid (√Size tiles)"],
      ],
      "strip",
    ),
    {
      id: "size",
      label: "LUT size",
      control: "int",
      default: 16,
      min: 2,
      max: 64,
      step: 1,
      tooltip: "Entries per axis (16, 32, 64…). Grid layout needs 16, 64.",
    },
    { id: "flipV", label: "Flip V", control: "bool", default: false },
  ],
  targetNotes: {
    ...TEX_NOTES,
    all: "Two explicit-LOD-0 samples per pixel (works in any stage). The LUT texture needs linear filtering + clamp + no mips.",
  },
  build: (c) => {
    const m = new M(c.b);
    const n = Math.max(2, Math.min(64, Math.round(Number(c.param("size")) || 16)));
    let lay: ReturnType<typeof lutLayout>;
    try {
      lay = lutLayout(c.param<string>("layout"), n);
    } catch (e) {
      return c.fail((e as Error).message);
    }
    const flip = c.param("flipV") === true;
    const v = m.w(c.in("in")),
      rgb = rgbOf(v).saturate();
    const tex = c.in("lut");
    const slice = (k: V): V => {
      const col = lay.tiles === n ? k : k.mod(lay.tiles),
        row = lay.tiles === n ? m.f(0) : k.div(lay.tiles).floor();
      const u = col
        .mul(n)
        .add(rgb.x.mul(n - 1))
        .add(0.5)
        .div(lay.w);
      const vv = row
        .mul(n)
        .add(rgb.y.mul(n - 1))
        .add(0.5)
        .div(lay.h);
      return m
        .w(c.b.sample({ tex, uv: m.v2(u, flip ? m.f(1).sub(vv) : vv).id, mode: "lod", lod: m.f(0).id }))
        .sw("xyz");
    };
    const z = rgb.z.mul(n - 1),
      z0 = z.floor(),
      z1 = z0.add(1).min(n - 1);
    const graded = slice(z0).mix(slice(z1), z.sub(z0));
    return { out: m.vec("vec4", rgbOf(v).mix(graded, m.w(c.in("amount"))), v.w).id };
  },
});

/* ── palette swap ─────────────────────────────────────────────────────────────────────────────── */
const PALETTE_MAX = 8;
const PAL_FROM: number[][] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 1, 1],
  [1, 1, 0],
  [0, 1, 1],
  [1, 0, 1],
  [0, 0, 0],
];
const PAL_TO: number[][] = [
  [0.9, 0.3, 0.1],
  [0.2, 0.7, 0.3],
  [0.1, 0.3, 0.8],
  [0.95, 0.9, 0.8],
  [0.8, 0.7, 0.1],
  [0.1, 0.6, 0.6],
  [0.7, 0.2, 0.7],
  [0.1, 0.05, 0.1],
];

const paletteCount = (v: unknown): number => Math.max(1, Math.min(PALETTE_MAX, Math.round(Number(v) || 4)));
function palettePorts(count: number): ResolvedPorts {
  const inputs: PortDef[] = [
    colorPort("in", "In", [0.9, 0.1, 0.1, 1]),
    floatPort("tolerance", "Tolerance", 0.25, "Maximum RGB distance for a match (inclusive)."),
  ];
  for (let i = 0; i < count; i++)
    inputs.push(rgbPort(`from${i}`, `From ${i + 1}`, PAL_FROM[i]), rgbPort(`to${i}`, `To ${i + 1}`, PAL_TO[i]));
  return {
    inputs,
    outputs: [colorOut(), outPort("index", "Index", "float"), outPort("distance", "Distance", "float")],
  };
}

const paletteSwapNode: NodeDef = baseNode({
  id: "colorPaletteSwap",
  category: "Color/Mask",
  name: "Palette Swap",
  synonyms: ["palette remap", "indexed color swap", "recolor palette", "sprite palette"],
  description:
    "Finds the From colour nearest to In (Euclidean RGB distance) and outputs its To colour. A match needs distance ≤ Tolerance (inclusive); otherwise In passes through unchanged and Index = −1. Ties between equally distant From colours are broken DETERMINISTICALLY: the LOWEST index wins. Index is the matched pair (0-based), Distance the distance to the nearest From colour (even when it is outside the tolerance). 1–8 pairs (Pairs parameter). Compare in one colour space; use Tolerance 0 + point filtering for exact indexed-colour sprites. Alpha untouched.",
  inputs: palettePorts(4).inputs,
  outputs: palettePorts(4).outputs,
  params: [{ id: "count", label: "Pairs", control: "int", default: 4, min: 1, max: PALETTE_MAX, step: 1 }],
  targetNotes: NOTE,
  dynamicPorts: (node) => palettePorts(paletteCount(node.params.count ?? 4)),
  build: (c) => {
    const m = new M(c.b);
    const n = paletteCount(c.param("count"));
    const v = m.w(c.in("in")),
      rgb = rgbOf(v);
    let best = rgb.sub(m.w(c.in("from0"))).length(),
      bestTo = m.w(c.in("to0")),
      idx = m.f(0);
    for (let i = 1; i < n; i++) {
      const d = rgb.sub(m.w(c.in(`from${i}`))).length();
      const closer = d.lt(best); // strict: ties keep the lower index
      bestTo = m.sel(closer, m.w(c.in(`to${i}`)), bestTo);
      idx = m.sel(closer, m.f(i), idx);
      best = m.sel(closer, d, best);
    }
    const hit = best.le(m.w(c.in("tolerance")));
    return { out: m.vec("vec4", m.sel(hit, bestTo, rgb), v.w).id, index: m.sel(hit, idx, -1).id, distance: best.id };
  },
});

/* ── Bayer ordered dither ─────────────────────────────────────────────────────────────────────── */
/** Bayer matrix entry for integer pixel (x, y) of an N×N matrix (N = 2^k): Σ_i 4^(k−1−i)·(2·(bx_i xor by_i) + by_i), i = bit index from the LSB. */
const bayerIndexIR = (m: M, x: V, y: V, k: number): V => {
  let idx = m.f(0);
  for (let i = 0; i < k; i++) {
    const bx = x
        .div(2 ** i)
        .floor()
        .mod(2),
      by = y
        .div(2 ** i)
        .floor()
        .mod(2);
    idx = idx.add(
      bx
        .sub(by)
        .abs()
        .mul(2)
        .add(by)
        .mul(4 ** (k - 1 - i)),
    );
  }
  return idx;
};

const bayerDitherNode: NodeDef = baseNode({
  id: "colorBayerDither",
  category: "Color/Mask",
  name: "Bayer Dither",
  synonyms: ["bayer ordered dither", "bayer matrix", "retro dither", "color quantize dither", "halftone dither"],
  description:
    "Ordered dithering with a Bayer matrix of size 2, 4 or 8 (entries 0…N²−1, tiled every N pixels — also for negative pixels). Threshold = (Bayer(x, y) + 0.5)/N² ∈ (0, 1), never 0 or 1. Each RGB channel is saturated to 0…1 and quantised to Levels steps (Levels ≥ 2, floored): Out = floor(c·(Levels − 1) + Threshold)/(Levels − 1) — c = 0 → 0 and c = 1 → 1 exactly, and the mean over one matrix equals c to within 1/(N²·(Levels − 1)). Pixel = floor(P·Scale): feed UV with Scale = resolution (like Blue-noise-like Dither). Alpha untouched.",
  inputs: [
    colorPort("in", "In", [0.5, 0.5, 0.5, 1]),
    {
      id: "p",
      name: "Pixel",
      type: T("vec2"),
      defaultInput: { input: "uv0" },
      tooltip: "Coordinate in pixels (floor() is applied after Scale).",
    },
    floatPort("scale", "Scale", 256),
    floatPort("levels", "Levels", 4),
  ],
  outputs: [colorOut(), outPort("threshold", "Threshold", "float")],
  params: [
    enumParam(
      "size",
      "Matrix",
      [
        ["2", "2×2"],
        ["4", "4×4"],
        ["8", "8×8"],
      ],
      "4",
    ),
  ],
  targetNotes: NOTE,
  build: (c) => {
    const m = new M(c.b);
    const k = Math.log2(Number(c.param("size")) || 4) | 0;
    const n2 = 4 ** k;
    const px = m
      .w(c.in("p"))
      .mul(m.w(c.in("scale")))
      .floor();
    const th = bayerIndexIR(m, px.x, px.y, k).add(0.5).div(n2);
    const v = m.w(c.in("in"));
    const l1 = m.w(c.in("levels")).floor().max(2).sub(1);
    return { out: m.vec("vec4", rgbOf(v).clamp(0, 1).mul(l1).add(th).floor().div(l1), v.w).id, threshold: th.id };
  },
});
export const COLOR_MASK_DEFS: NodeDef[] = [replaceColorNode, colorMaskNode, lutNode, paletteSwapNode, bayerDitherNode];
