/** Include whitelist (Appendix A of the brief). `V` = verified in official docs/source, `K` = author knowledge (unverified-by-doc). */
export type FactStatus = "V" | "K";
const P = "Packages/com.unity.render-pipelines.universal/";
export const INCLUDE_WHITELIST: ReadonlyArray<{ path: string; status: FactStatus }> = [
  { path: `${P}ShaderLibrary/Core.hlsl`, status: "V" },
  { path: `${P}ShaderLibrary/Lighting.hlsl`, status: "V" },
  { path: `${P}ShaderLibrary/Shadows.hlsl`, status: "K" },
  { path: `${P}ShaderLibrary/DeclareDepthTexture.hlsl`, status: "K" },
  { path: `${P}ShaderLibrary/DeclareOpaqueTexture.hlsl`, status: "K" },
  { path: `${P}ShaderLibrary/DeclareNormalsTexture.hlsl`, status: "K" },
  { path: `${P}ShaderLibrary/MetaInput.hlsl`, status: "V" },
  { path: `${P}ShaderLibrary/DBuffer.hlsl`, status: "V" },
  { path: `${P}ShaderLibrary/MotionVectorsCommon.hlsl`, status: "V" },
  { path: `${P}Shaders/2D/Include/LightingUtility.hlsl`, status: "V" },
  { path: `${P}Shaders/2D/Include/CombinedShapeLightShared.hlsl`, status: "V" },
  { path: `${P}Shaders/2D/Include/NormalsRenderingShared.hlsl`, status: "V" },
  { path: `${P}Shaders/2D/Include/InputData2D.hlsl`, status: "V" },
  { path: `${P}Shaders/2D/Include/SurfaceData2D.hlsl`, status: "V" },
];
export const INC = {
  core: `${P}ShaderLibrary/Core.hlsl`,
  lighting: `${P}ShaderLibrary/Lighting.hlsl`,
  meta: `${P}ShaderLibrary/MetaInput.hlsl`,
  dbuffer: `${P}ShaderLibrary/DBuffer.hlsl`,
  motion: `${P}ShaderLibrary/MotionVectorsCommon.hlsl`,
  opaque: `${P}ShaderLibrary/DeclareOpaqueTexture.hlsl`,
  depth: `${P}ShaderLibrary/DeclareDepthTexture.hlsl`,
  normals: `${P}ShaderLibrary/DeclareNormalsTexture.hlsl`,
  lightingUtility2D: `${P}Shaders/2D/Include/LightingUtility.hlsl`,
  combined2D: `${P}Shaders/2D/Include/CombinedShapeLightShared.hlsl`,
  normals2D: `${P}Shaders/2D/Include/NormalsRenderingShared.hlsl`,
} as const;
