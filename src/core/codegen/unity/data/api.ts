import type { FactStatus } from "./includes";

/**
 * API whitelist (Appendix B). Identifiers with the prefixes below that are neither defined in the generated file nor listed here are
 * errors; entries with status `K` ("unverified-by-doc") are reported as warnings that point at a manual check (`check`).
 */
export interface ApiEntry {
  name: string;
  status: FactStatus;
  check?: string;
}
const v = (...names: string[]): ApiEntry[] => names.map((name) => ({ name, status: "V" }));
const k = (check: string, ...names: string[]): ApiEntry[] => names.map((name) => ({ name, status: "K", check }));

export const API_PREFIXES: readonly string[] = [
  "UNITY_",
  "TRANSFORM_",
  "SAMPLE_",
  "TEXTURE",
  "SAMPLER",
  "CBUFFER",
  "GetVertex",
  "GetMain",
  "GetNormalized",
  "Transform",
  "Compute",
  "Mix",
  "Apply",
  "Pack",
  "Unpack",
  "Sample",
  "Load",
  "Initialize",
  "Normalize",
  "Linear",
  "Universal",
  "LIGHT_LOOP",
];

export const API_WHITELIST: readonly ApiEntry[] = [
  ...v(
    "TransformObjectToHClip",
    "TransformObjectToWorldDir",
    "ComputeScreenPos",
    "TRANSFORM_TEX",
    "TEXTURE2D",
    "SAMPLER",
    "SAMPLE_TEXTURE2D",
    "CBUFFER_START",
    "CBUFFER_END",
    "UNITY_VERTEX_INPUT_INSTANCE_ID",
    "UNITY_VERTEX_OUTPUT_STEREO",
    "UNITY_SETUP_INSTANCE_ID",
    "LIGHT_LOOP_BEGIN",
    "LIGHT_LOOP_END",
    "GetAdditionalLightsCount",
  ),
  ...k(
    "unverified-api",
    "TransformObjectToWorld",
    "TransformObjectToWorldNormal",
    "TransformWorldToHClip",
    "TransformWorldToShadowCoord",
    "TransformTangentToWorld",
    "GetVertexPositionInputs",
    "GetVertexNormalInputs",
    "GetOddNegativeScale",
    "GetWorldSpaceNormalizeViewDir",
    "GetNormalizedScreenSpaceUV",
    "NormalizeNormalPerPixel",
    "UNITY_TRANSFER_INSTANCE_ID",
    "UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO",
    "UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX",
    "UniversalFragmentPBR",
    "UniversalFragmentBlinnPhong",
    "InitializeInputDataFog",
    "ComputeFogFactor",
    "MixFog",
    "VertexLighting",
    "SampleSH",
    "ApplyShadowBias",
    "UNITY_REVERSED_Z",
    "UNITY_NEAR_CLIP_VALUE",
    "LinearEyeDepth",
    "SampleSceneDepth",
    "PackNormalOctQuadEncode",
    "PackFloat2To888",
    "UNITY_MATRIX_V",
    "UNITY_MATRIX_P",
    "UNITY_MATRIX_I_V",
    "UNITY_MATRIX_I_P",
    "UNITY_MATRIX_VP",
    "UNITY_MATRIX_I_VP",
    "UNITY_MATRIX_M",
    "UNITY_MATRIX_I_M",
  ),
  ...k("vertex-lod", "SAMPLE_TEXTURE2D_LOD"),
  // 1 (E1–E4). Present in the URP sources of 2022.3 / 6000.0 / 6000.3 (checked on GitHub when written) — still [K] until a Unity import confirms them.
  ...k("lit-gi", "SAMPLE_GI", "SAMPLE_SHADOWMASK", "DECLARE_LIGHTMAP_OR_SH", "OUTPUT_LIGHTMAP_UV", "OUTPUT_SH"),
  ...k("lit-meta", "UnityMetaVertexPosition", "UnityMetaFragment", "UnityMetaInput"),
  ...k("lit-motion-vectors", "UNITY_PREV_MATRIX_M", "CalcNdcMotionVectorFromCsPositions"),
  ...k("lit-decals", "ApplyDecalToSurfaceData"),
  ...k("lit-lod-crossfade", "LODFadeCrossFade"),
  ...k("instance-id", "UNITY_INSTANCING_ENABLED"),
  ...k("texture-params", "TEXTURE2D_PARAM", "TEXTURE2D_ARGS"),
  ...k("vfx-distortion", "SampleSceneColor"),
  // Scene Depth / Color / Normals / additional-light nodes (engine intrinsics with arguments).
  ...k("scene-intrinsics", "SampleSceneNormals", "GetAdditionalLight"),
  // 2 (E9): texture kinds. Names read from SRP-Core API/*.hlsl; unverified until a Unity import confirms them.
  ...k(
    "texture-kinds",
    "TEXTURE2D_ARRAY",
    "TEXTURE2D_ARRAY_PARAM",
    "TEXTURE2D_ARRAY_ARGS",
    "SAMPLE_TEXTURE2D_ARRAY",
    "SAMPLE_TEXTURE2D_ARRAY_LOD",
    "TEXTURE3D",
    "TEXTURE3D_PARAM",
    "TEXTURE3D_ARGS",
    "SAMPLE_TEXTURE3D",
    "SAMPLE_TEXTURE3D_LOD",
    "TEXTURECUBE",
    "TEXTURECUBE_PARAM",
    "TEXTURECUBE_ARGS",
    "SAMPLE_TEXTURECUBE",
    "SAMPLE_TEXTURECUBE_LOD",
  ),
  ...k("double-sided", "FRONT_FACE_TYPE", "FRONT_FACE_SEMANTIC", "IS_FRONT_VFACE"),
  ...k(
    "sprite-lit-63",
    "InitializeSurfaceData",
    "InitializeInputData",
    "CombinedShapeLightShared",
    "NormalsRenderingShared",
    "NormalsRenderingVertex",
    "NormalsRenderingFragment",
  ),
];

export const apiEntry = (name: string): ApiEntry | undefined => API_WHITELIST.find((e) => e.name === name);

/** Engine uniform names the generator may reference (not prefix-checked; listed for the docs). */
export const ENGINE_UNIFORMS: readonly string[] = [
  "_Time",
  "unity_DeltaTime",
  "_ProjectionParams",
  "_ScreenParams",
  "_ZBufferParams",
  "unity_OrthoParams",
  "_WorldSpaceCameraPos",
  "unity_ObjectToWorld",
  "unity_WorldToObject",
  "_MainLightPosition",
  "_MainLightColor",
  "_LightDirection",
  "_LightPosition",
  "unity_FogColor",
];

/** Names a user reference may never take (Appendix §7). */
export const RESERVED_ENGINE_NAMES: readonly string[] = [
  "_Time",
  "_SinTime",
  "_CosTime",
  "unity_DeltaTime",
  "_ProjectionParams",
  "_ScreenParams",
  "_ZBufferParams",
  "unity_OrthoParams",
  "_WorldSpaceCameraPos",
  "unity_ObjectToWorld",
  "unity_WorldToObject",
  "_MainLightPosition",
  "_MainLightColor",
  "_AdditionalLightsCount",
  "_CameraDepthTexture",
  "_CameraOpaqueTexture",
  "_LightDirection",
  "_LightPosition",
  "_ShadowBias",
];
