import type { NodeDef } from "../../registry/nodeDef";
import { baseNode, enumParam } from "../kit";
import { M, type V } from "../procedural/irm";
import { floatPort, outPort } from "../procedural/ports";
import { PORTABLE, SAMPLING_PARAM, TEX_NOTES, colorPort, fetch, lodPort, texPort, uvPort, vec3Port } from "./common";
import { heightToNormalNode } from "./heightNormal";
import {
  BLEND_MODES,
  NORMAL_FORMATS,
  type NormalBlendMode,
  type NormalFormat,
  blendNormals,
  normalFromGradient,
  normalStrength,
  unpackNormal,
} from "./normalMath";

const SPACE =
  "Tangent space: +X = +U, +Y = +V (green up, OpenGL), +Z out of the surface; flat = (0, 0, 1) = texel (0.5, 0.5, 1). Output is always a unit vector; a zero-length input returns the flat normal.";
const FORMAT = enumParam("format", "Format", NORMAL_FORMATS, "rgb");
const FLIP = { id: "flipGreen", label: "Flip green (DirectX)", control: "bool" as const, default: false };

const normalUnpackNode: NodeDef = baseNode({
  id: "normalUnpack",
  category: "Texture/Normal",
  name: "Normal Unpack",
  synonyms: ["decode normal", "unpack normal map", "normal from color", "dxt5nm"],
  description: `Decodes a normal-map texel to a unit tangent-space normal: RGB format n = rgb·2 − 1; DXT5nm uses (A, G) and rebuilds z = √(1 − x² − y²); BC5 uses (R, G) the same way. Flip green converts DirectX (green down) maps to OpenGL. ${SPACE} Output range: each component in [−1, 1].`,
  inputs: [colorPort("in", "In", [0.5, 0.5, 1, 1], "Texel of a LINEAR normal map.")],
  outputs: [outPort("out", "Normal", "vec3")],
  params: [FORMAT, FLIP],
  targetNotes: { all: PORTABLE.all + " Normal maps must be imported as linear (non-sRGB) data." },
  build: (c) => {
    const m = new M(c.b);
    return { out: unpackNormal(m, m.w(c.in("in")), c.param<NormalFormat>("format"), c.param("flipGreen") === true).id };
  },
});

const normalStrengthNode: NodeDef = baseNode({
  id: "normalStrength",
  category: "Texture/Normal",
  name: "Normal Strength",
  synonyms: ["bump strength", "normal intensity", "scale normal", "flatten normal"],
  description: `Scales the slope of a tangent-space normal: n' = normalize(n.xy·Strength, n.z). Strength 1 = unchanged, 0 = perfectly flat (0, 0, 1), 2 doubles the apparent relief, negative values invert bumps into dents. ${SPACE}`,
  inputs: [vec3Port("in", "Normal", [0, 0, 1]), floatPort("strength", "Strength", 1)],
  outputs: [outPort("out", "Out", "vec3")],
  targetNotes: { all: PORTABLE.all },
  build: (c) => {
    const m = new M(c.b);
    return { out: normalStrength(m, m.w(c.in("in")), m.w(c.in("strength"))).id };
  },
});

const normalBlendNode: NodeDef = baseNode({
  id: "normalBlend",
  category: "Texture/Normal",
  name: "Normal Blend",
  synonyms: ["combine normals", "detail normal", "rnm", "whiteout blend", "udn blend"],
  description: `Adds a Detail normal on top of a Base normal. Reoriented (RNM, most accurate: detail is rotated into the base's frame), Whiteout (xy added, z multiplied), UDN (xy added, base z) and Linear (normalised sum). Both inputs are normalised first. A flat detail returns the base and a flat base returns the detail for RNM and Whiteout (UDN rebuilds z from the summed slope, so it returns the detail only approximately). RNM with a base pointing straight down (undefined rotation) returns the detail. ${SPACE}`,
  inputs: [vec3Port("a", "Base", [0, 0, 1]), vec3Port("b", "Detail", [0, 0, 1])],
  outputs: [outPort("out", "Out", "vec3")],
  params: [enumParam("mode", "Mode", BLEND_MODES, "reorient")],
  targetNotes: { all: PORTABLE.all },
  build: (c) => {
    const m = new M(c.b);
    return { out: blendNormals(m, m.w(c.in("a")), m.w(c.in("b")), c.param<NormalBlendMode>("mode")).id };
  },
});

const normalFromTextureNode: NodeDef = baseNode({
  id: "normalFromTexture",
  category: "Texture/Normal",
  name: "Normal From Texture",
  synonyms: ["sample normal map", "normal map", "bump texture", "tangent normal sample"],
  description: `Samples a normal map and returns the unit tangent-space normal (decode + Strength in one node). ${SPACE} Use Normal Strength / Blend for further processing and Transform (Tangent → World) for lighting. Output range: components in [−1, 1].`,
  inputs: [texPort("tex", "Normal Map"), uvPort(), floatPort("strength", "Strength", 1), lodPort()],
  outputs: [outPort("out", "Normal", "vec3")],
  params: [SAMPLING_PARAM, FORMAT, FLIP],
  targetNotes: TEX_NOTES,
  build: (c) => {
    const m = new M(c.b);
    const n = unpackNormal(
      m,
      fetch(c, m, c.in("tex"), m.w(c.in("uv"))),
      c.param<NormalFormat>("format"),
      c.param("flipGreen") === true,
    );
    return { out: normalStrength(m, n, m.w(c.in("strength"))).id };
  },
});

const normalFromHeightNode: NodeDef = baseNode({
  id: "normalFromHeight",
  category: "Texture/Normal",
  name: "Normal From Height",
  synonyms: ["height map to normal", "bump to normal", "sobel normal", "heightmap normal"],
  description: `Builds a tangent-space normal from a height map by finite differences measured in TEXELS: n = normalize(−dh/dx·Strength, −dh/dy·Strength, 1), where dh/dx is the height change per texel along +U (central difference, or a 3×3 Sobel kernel that is smoother and 8-tap). Resolution independent for a given texel-space relief; Strength is the height scale in texel units. A constant height gives the flat normal; at the texture border the neighbours follow the sampler's wrap mode (Clamp ⇒ half the slope at the very edge, Repeat ⇒ seamless). ${SPACE}`,
  inputs: [texPort("tex", "Height Map"), uvPort(), floatPort("strength", "Strength", 8), lodPort()],
  outputs: [outPort("out", "Normal", "vec3"), outPort("height", "Height", "float")],
  params: [
    SAMPLING_PARAM,
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
    enumParam(
      "kernel",
      "Kernel",
      [
        ["central", "Central difference (4 taps)"],
        ["sobel", "Sobel 3×3 (8 taps)"],
      ],
      "central",
    ),
  ],
  targetNotes: TEX_NOTES,
  build: (c) => {
    const m = new M(c.b);
    const tex = c.in("tex"),
      uv = m.w(c.in("uv")),
      ch = c.param<string>("channel") || "r";
    const size = m.w(c.b.textureSize(tex));
    const inv = (v: V) => m.sel(v.gt(0), m.f(1).div(m.sel(v.gt(0), v, 1)), 0);
    const tx = inv(size.x),
      ty = inv(size.y);
    const h = (dx: number, dy: number): V => fetch(c, m, tex, uv.add(m.v2(tx.mul(dx), ty.mul(dy)))).sw(ch);
    let gx: V, gy: V;
    if (c.param("kernel") === "sobel") {
      gx = h(1, 1).add(h(1, 0).mul(2)).add(h(1, -1)).sub(h(-1, 1)).sub(h(-1, 0).mul(2)).sub(h(-1, -1)).div(8);
      gy = h(1, 1).add(h(0, 1).mul(2)).add(h(-1, 1)).sub(h(1, -1)).sub(h(0, -1).mul(2)).sub(h(-1, -1)).div(8);
    } else {
      gx = h(1, 0).sub(h(-1, 0)).mul(0.5);
      gy = h(0, 1).sub(h(0, -1)).mul(0.5);
    }
    const s = m.w(c.in("strength"));
    return { out: normalFromGradient(m, gx, gy, s).id, height: h(0, 0).id };
  },
});
export const NORMAL_DEFS: NodeDef[] = [
  normalUnpackNode,
  normalStrengthNode,
  normalBlendNode,
  normalFromTextureNode,
  normalFromHeightNode,
  heightToNormalNode,
];
