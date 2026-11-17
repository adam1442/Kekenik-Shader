import * as THREE from "three";
import type { UniformBinding } from "@/core";

type Sampler = NonNullable<UniformBinding["sampler"]>;

/** Three.js texture parameters of a Sampler State node (pure; unit-tested). `mips`: the filter reads mip levels. */
function samplerParams(s: Sampler): {
  min: THREE.TextureFilter;
  mag: THREE.MagnificationTextureFilter;
  wrap: THREE.Wrapping;
  mips: boolean;
} {
  const wrap =
    s.wrap === "clamp"
      ? THREE.ClampToEdgeWrapping
      : s.wrap === "mirror"
        ? THREE.MirroredRepeatWrapping
        : THREE.RepeatWrapping;
  if (s.filter === "point") return { min: THREE.NearestFilter, mag: THREE.NearestFilter, wrap, mips: false };
  if (s.filter === "trilinear")
    return { min: THREE.LinearMipmapLinearFilter, mag: THREE.LinearFilter, wrap, mips: true };
  return { min: THREE.LinearFilter, mag: THREE.LinearFilter, wrap, mips: false };
}

/**
 * The texture to bind when a Sampler State node is wired: a CLONE of `tex` carrying the requested filter / wrap (the clone shares the image;
 * the original — possibly the app-wide default texture or an asset used by other shaders — is never mutated). Clones are cached in `cache`
 * (owned by the binding, disposed with it), keyed by source texture + state.
 */
export function sampledVariant(tex: THREE.Texture, s: Sampler, cache: Map<string, THREE.Texture>): THREE.Texture {
  const key = `${tex.uuid}|${s.filter}|${s.wrap}`;
  let v = cache.get(key);
  if (!v) {
    const p = samplerParams(s);
    v = tex.clone();
    v.minFilter = p.min;
    v.magFilter = p.mag;
    v.wrapS = v.wrapT = p.wrap;
    v.generateMipmaps = p.mips;
    v.needsUpdate = true;
    cache.set(key, v);
  }
  return v;
}
