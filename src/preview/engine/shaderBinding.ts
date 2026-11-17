import * as THREE from "three";
import { DEFAULT_ST, type MaterialValues, type Property, type UniformBinding } from "@/core";
import { sampledVariant } from "./samplerState";
import { SOFT_UNIFORMS } from "../logic/glslPatch";
import { LIT_UNIFORM_NAMES } from "../gl/lighting/prelude";
import { COLOR_TEX, DEPTH_TEX, NORMALS_TEX } from "../emulation/table";
import type { FaceSide } from "./surfaceState";

export type BlendSetting = "opaque" | "alpha" | "additive" | "premultiplied";

export interface MaterialSettings {
  blend: BlendSetting;
  /** Faces drawn: front (cull back, default), back (cull front) or both (cull off). */
  side: FaceSide;
  /** Write depth for transparent materials (true for single 3D objects, false for sprites / particles). */
  depthWrite: boolean;
  /** The fragment shader was wrapped by the soft-particle patch (needs the `ks_soft_*` uniforms). */
  soft?: boolean;
}

/** Number of components of a GLSL storage type. */
const COMPONENTS: Record<string, number> = { float: 1, int: 1, bool: 1, vec2: 2, vec3: 3, vec4: 4 };

/** JS value to feed a uniform of storage type `ty` from a property default (pure; tested). */
function uniformValue(ty: string, value: Property["default"]): number | number[] {
  const n = COMPONENTS[ty] ?? 1;
  if (ty === "bool") return value ? 1 : 0;
  if (ty === "int")
    return Math.round(typeof value === "number" ? value : Array.isArray(value) ? (value[0] ?? 0) : value ? 1 : 0);
  if (n === 1) return typeof value === "number" ? value : Array.isArray(value) ? (value[0] ?? 0) : value ? 1 : 0;
  const arr = Array.isArray(value) ? value : typeof value === "number" ? [value, value, value, value] : [];
  const fillAlpha = n === 4 ? 1 : 0;
  return Array.from({ length: n }, (_, i) => arr[i] ?? (i === 3 ? fillAlpha : 0));
}

function applyBlend(m: THREE.Material, s: MaterialSettings): void {
  m.transparent = s.blend !== "opaque";
  m.depthWrite = s.blend === "opaque" ? true : s.depthWrite;
  m.side = s.side === "both" ? THREE.DoubleSide : s.side === "back" ? THREE.BackSide : THREE.FrontSide;
  m.premultipliedAlpha = false;
  switch (s.blend) {
    case "additive":
      m.blending = THREE.AdditiveBlending;
      break;
    case "premultiplied":
      m.blending = THREE.CustomBlending;
      m.blendEquation = THREE.AddEquation;
      m.blendSrc = THREE.OneFactor;
      m.blendDst = THREE.OneMinusSrcAlphaFactor;
      m.blendSrcAlpha = THREE.OneFactor;
      m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
      break;
    case "alpha":
      m.blending = THREE.NormalBlending;
      break;
    default:
      m.blending = THREE.NoBlending;
  }
  m.needsUpdate = true;
}

/**
 * Three.js prepends its own `#define` lines to RawShaderMaterial sources, so a `#version` line inside the source would no
 * longer be first. The version line is blanked (keeping every line number) and `glslVersion: GLSL3` makes Three emit it.
 */
const asGlsl3 = (src: string): string => src.replace(/^#version 300 es[^\n]*/, "");

const SCALAR_LIT = new Set<string>(["ks_lit_EnvI", "ks_lit_EnvRot", "ks_lit_EnvFlip"]);
function litInitial(name: string): unknown {
  if (name === "ks_lit_Env" || name === "ks_lit_ShadowMap") return null;
  if (name === "ks_lit_Cfg" || name === "ks_lit_Cfg2" || name === "ks_lit_Shadow" || name === "ks_lit_Fog")
    return new THREE.Vector4();
  if (name === "ks_lit_ShadowMat") return new THREE.Matrix4();
  return SCALAR_LIT.has(name) ? 0 : new THREE.Vector3();
}

const defaultAttributeValues = {
  a_uv0: [0, 0],
  a_uv1: [0, 0],
  a_uv2: [0, 0],
  a_uv3: [0, 0],
  a_color: [1, 1, 1, 1],
  a_tangent: [1, 0, 0, 1],
};

/** A RawShaderMaterial built from generated GLSL ES 3.00 plus the table that maps properties to uniforms. */
export class ShaderBinding {
  readonly material: THREE.RawShaderMaterial;
  private readonly byProp = new Map<string, UniformBinding>();
  /** Sampler-State clones of bound textures (see `sampledVariant`). */
  private readonly sampled = new Map<string, THREE.Texture>();

  constructor(
    vertex: string,
    fragment: string,
    bindings: readonly UniformBinding[],
    settings: MaterialSettings,
    lit: boolean,
  ) {
    const uniforms: Record<string, THREE.IUniform> = {
      ks_Model: { value: new THREE.Matrix4() },
      ks_View: { value: new THREE.Matrix4() },
      ks_Projection: { value: new THREE.Matrix4() },
      ks_WorldToObject: { value: new THREE.Matrix4() },
      ks_ViewInverse: { value: new THREE.Matrix4() },
      ks_NormalMatrix: { value: new THREE.Matrix3() },
      ks_CameraPos: { value: new THREE.Vector3() },
      ks_Time: { value: 0 },
      ks_DeltaTime: { value: 0.016 },
      ks_SmoothDeltaTime: { value: 0.016 },
      ks_ProjectionInverse: { value: new THREE.Matrix4() },
      ks_CameraParams: { value: new THREE.Vector4(0.1, 100, 0, 0) },
      ks_ScreenParams: { value: new THREE.Vector4(1, 1, 1, 1) },
      ks_FogColor: { value: new THREE.Vector4(0, 0, 0, 1) },
      ks_FogParams: { value: new THREE.Vector4(0, 0, 100, 0) },
      ks_MainLightDir: { value: new THREE.Vector3(0, 1, 0) },
      ks_MainLightColor: { value: new THREE.Vector3(1, 1, 1) },
      ks_AmbientColor: { value: new THREE.Vector3(0.03, 0.03, 0.04) },
      ks_SpriteRect: { value: new THREE.Vector4(0, 0, 1, 1) },
      ks_SpriteInfo: { value: new THREE.Vector4(1, 1, 100, 0) },
    };
    if (settings.soft)
      for (const n of SOFT_UNIFORMS)
        uniforms[n] = {
          value:
            n === "ks_soft_Depth"
              ? null
              : n === "ks_soft_Size"
                ? new THREE.Vector2(1, 1)
                : new THREE.Vector4(0.1, 100, 0.5, 0),
        };
    if (lit) for (const n of LIT_UNIFORM_NAMES) uniforms[n] = { value: litInitial(n) };
    for (const n of [DEPTH_TEX, COLOR_TEX, NORMALS_TEX]) if (fragment.includes(n)) uniforms[n] = { value: null }; // preview emulation resources (src/preview/emulation)
    for (const b of bindings) {
      this.byProp.set(b.propId, b);
      uniforms[b.name] = { value: b.ty === "texture2D" ? null : uniformValue(b.ty, null) };
    }
    this.material = new THREE.RawShaderMaterial({
      vertexShader: asGlsl3(vertex),
      fragmentShader: asGlsl3(fragment),
      uniforms,
      glslVersion: THREE.GLSL3,
    });
    (this.material as unknown as { defaultAttributeValues: unknown }).defaultAttributeValues = defaultAttributeValues;
    applyBlend(this.material, settings);
  }

  /**
   * Same program, new binding table. The generated GLSL does not change when only a Sampler State node's filter / wrap is edited (the sampler is
   * the host's job), so `ShaderHost.submit` reuses the binding — without this the texture kept the OLD sampler until the shader text changed.
   */
  updateBindings(bindings: readonly UniformBinding[]): void {
    for (const b of bindings)
      if (this.byProp.has(b.propId) && this.material.uniforms[b.name]) this.byProp.set(b.propId, b);
  }

  uniform(name: string): THREE.IUniform | undefined {
    return this.material.uniforms[name];
  }

  /**
   * Push property values (and textures) into the uniforms — never recompiles. `values` are the Material-panel overrides: only the Tiling / Offset
   * entries (`<prop>#st`, see `stKey`) are read from it here (the property values themselves arrive through `props`).
   * A texture sampled through a Sampler State node is bound as a clone carrying that node's filter / wrap (R8).
   */
  setProperties(
    props: readonly Property[],
    texture: (p: Property) => THREE.Texture | null,
    values: MaterialValues = {},
  ): void {
    for (const p of props) {
      const b = this.byProp.get(p.id);
      const u = b ? this.material.uniforms[b.name] : undefined;
      if (!b || !u) continue;
      if (b.ty !== "texture2D") {
        u.value = uniformValue(b.ty, p.default);
        continue;
      }
      const tex = texture(p);
      u.value = tex && b.sampler ? sampledVariant(tex, b.sampler, this.sampled) : tex;
    }
    for (const [propId, b] of this.byProp) {
      const u = propId.endsWith("#st") ? this.material.uniforms[b.name] : undefined;
      if (u) u.value = uniformValue("vec4", (values[propId] as number[] | undefined) ?? [...DEFAULT_ST]);
    }
    this.material.uniformsNeedUpdate = true;
  }

  dispose(): void {
    for (const t of this.sampled.values()) t.dispose();
    this.sampled.clear();
    this.material.dispose();
  }
}
