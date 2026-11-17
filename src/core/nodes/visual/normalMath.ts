import type { M, V } from "../procedural/irm";
import { safeNormalize } from "./common";

/**
 * Normal-map maths . Conventions:
 *  - Tangent-space normals: +X = +U, +Y = +V ("green up", OpenGL), +Z = out of the surface. A flat normal is (0, 0, 1) = texel (0.5, 0.5, 1).
 *  - Every operation returns a UNIT vector, and the FLAT normal (0, 0, 1) for degenerate (zero-length) input — never NaN.
 *  - Normal maps are DATA: upload them as linear (non-sRGB) textures.
 */
export type NormalFormat = "rgb" | "ag" | "rg";
export const NORMAL_FORMATS: Array<[string, string]> = [
  ["rgb", "RGB (xyz)"],
  ["ag", "DXT5nm (x = A, y = G)"],
  ["rg", "Two-channel BC5 (x = R, y = G)"],
];

export const flatNormal = (m: M): V => m.k("vec3", 0, 0, 1);

/** Decode a normal texel (vec4 or vec3) according to the storage format; the result is normalised (flat on zero length). */
export function unpackNormal(m: M, texel: V, format: NormalFormat, flipGreen: boolean): V {
  const r = texel.sw("x"),
    g = texel.sw("y");
  let n: V;
  if (format === "rgb") n = m.v3(r.mul(2).sub(1), g.mul(2).sub(1), texel.sw("z").mul(2).sub(1));
  else {
    const x = (format === "ag" ? texel.sw("w") : r).mul(2).sub(1);
    const y = g.mul(2).sub(1);
    n = m.v3(x, y, m.f(1).sub(x.mul(x)).sub(y.mul(y)).max(0).sqrt());
  }
  if (flipGreen) n = m.v3(n.x, n.y.neg(), n.z);
  return safeNormalize(m, n, flatNormal(m));
}

/**
 * Tangent-space normal from a height gradient (dh/du, dh/dv): n = normalize(−gx·k, −gy·k, 1). Shared by Normal From Height (texture, texel
 * units) and Height To Normal (procedural, UV units). `flipGreen` negates Y (DirectX convention). The z component is 1, so the length is ≥ 1 and the
 * division can never be 0/0.
 */
export function normalFromGradient(m: M, gx: V, gy: V, k: V, flipGreen = false): V {
  const gyk = gy.neg().mul(k);
  const n = m.v3(gx.neg().mul(k), flipGreen ? gyk.neg() : gyk, 1);
  return n.mul(m.f(1).div(n.length()));
}

/** Scales the slope (xy) of a tangent-space normal. Strength 1 = unchanged, 0 = flat, < 0 inverts the bumps. */
export function normalStrength(m: M, n: V, strength: V): V {
  return safeNormalize(m, m.v3(n.x.mul(strength), n.y.mul(strength), n.z), flatNormal(m));
}

export type NormalBlendMode = "reorient" | "whiteout" | "udn" | "linear";
export const BLEND_MODES: Array<[string, string]> = [
  ["reorient", "Reoriented (RNM)"],
  ["whiteout", "Whiteout"],
  ["udn", "UDN"],
  ["linear", "Linear"],
];

/** Combine a detail normal B on top of a base normal A (both tangent space). */
export function blendNormals(m: M, a0: V, b0: V, mode: NormalBlendMode): V {
  const flat = flatNormal(m);
  const a = safeNormalize(m, a0, flat),
    b = safeNormalize(m, b0, flat);
  let r: V;
  if (mode === "whiteout") r = m.v3(a.x.add(b.x), a.y.add(b.y), a.z.mul(b.z));
  else if (mode === "udn") r = m.v3(a.x.add(b.x), a.y.add(b.y), a.z);
  else if (mode === "linear") r = a.add(b);
  else {
    // Reoriented Normal Mapping (Barré-Brisebois & Hill): t = a + (0,0,1), u = b·(−1,−1,1), r = t·(t·u)/t.z − u. a pointing straight down (t.z = 0) has no defined rotation → B is returned.
    const t = m.v3(a.x, a.y, a.z.add(1));
    const u = m.v3(b.x.neg(), b.y.neg(), b.z);
    const ok = t.z.gt(1e-5);
    const rn = t.mul(t.dot(u).div(m.sel(ok, t.z, 1))).sub(u);
    r = m.sel(ok, rn, b);
  }
  return safeNormalize(m, r, flat);
}
