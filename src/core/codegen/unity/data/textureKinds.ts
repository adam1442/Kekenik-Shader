import type { TextureType } from "../../../types/shaderType";

/**
 * URP / SRP-Core texture macro families per texture kind . Names follow `com.unity.render-pipelines.core/ShaderLibrary/API/*.hlsl`
 * (TEXTURE2D_ARRAY, TEXTURE3D, TEXTURECUBE and their `_PARAM` / `_ARGS` / `SAMPLE_*` / `SAMPLE_*_LOD` forms). All new names are `[K]` in the API
 * whitelist (manual check `texture-kinds`): not compiled in Unity from this sandbox.
 */
export interface UnityTexMacros {
  /** `TEXTURE2D` … declaration macro (one argument). */
  decl: string;
  param: string;
  args: string;
  sample: string;
  sampleLod: string;
  /** ShaderLab property type keyword. */
  shaderLab: "2D" | "2DArray" | "3D" | "Cube";
}

export const UNITY_TEX_MACROS: Readonly<Record<TextureType, UnityTexMacros>> = {
  texture2D: {
    decl: "TEXTURE2D",
    param: "TEXTURE2D_PARAM",
    args: "TEXTURE2D_ARGS",
    sample: "SAMPLE_TEXTURE2D",
    sampleLod: "SAMPLE_TEXTURE2D_LOD",
    shaderLab: "2D",
  },
  texture2DArray: {
    decl: "TEXTURE2D_ARRAY",
    param: "TEXTURE2D_ARRAY_PARAM",
    args: "TEXTURE2D_ARRAY_ARGS",
    sample: "SAMPLE_TEXTURE2D_ARRAY",
    sampleLod: "SAMPLE_TEXTURE2D_ARRAY_LOD",
    shaderLab: "2DArray",
  },
  texture3D: {
    decl: "TEXTURE3D",
    param: "TEXTURE3D_PARAM",
    args: "TEXTURE3D_ARGS",
    sample: "SAMPLE_TEXTURE3D",
    sampleLod: "SAMPLE_TEXTURE3D_LOD",
    shaderLab: "3D",
  },
  textureCube: {
    decl: "TEXTURECUBE",
    param: "TEXTURECUBE_PARAM",
    args: "TEXTURECUBE_ARGS",
    sample: "SAMPLE_TEXTURECUBE",
    sampleLod: "SAMPLE_TEXTURECUBE_LOD",
    shaderLab: "Cube",
  },
};

/** Declaration macro names as a regex alternation (validators): `TEXTURE2D|TEXTURE2D_ARRAY|TEXTURE3D|TEXTURECUBE`. */
export const UNITY_TEX_DECL_RE = Object.values(UNITY_TEX_MACROS)
  .map((m) => m.decl)
  .join("|");
/** Implicit-LOD sample macro names as a regex alternation. */
export const UNITY_TEX_SAMPLE_RE = Object.values(UNITY_TEX_MACROS)
  .map((m) => m.sample)
  .join("|");
