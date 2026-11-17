/** How the portable `ks_*` host uniforms of the shared input descriptions are spelled in Unity URP. `undefined` = no Unity equivalent. */
export const UNITY_UNIFORM: Readonly<Record<string, string | undefined>> = {
  ks_Model: "unity_ObjectToWorld",
  ks_WorldToObject: "unity_WorldToObject",
  ks_View: "UNITY_MATRIX_V",
  ks_Projection: "UNITY_MATRIX_P",
  ks_ViewInverse: "UNITY_MATRIX_I_V",
  ks_ProjectionInverse: "UNITY_MATRIX_I_P",
  ks_NormalMatrix: "transpose((float3x3)unity_WorldToObject)",
  ks_CameraPos: "_WorldSpaceCameraPos",
  ks_CameraParams: "float4(_ProjectionParams.y, _ProjectionParams.z, unity_OrthoParams.w, unity_OrthoParams.y)",
  ks_ScreenParams: "_ScreenParams",
  ks_FogColor: "unity_FogColor",
  ks_FogParams: undefined,
  ks_MainLightDir: "_MainLightPosition.xyz",
  ks_MainLightColor: "_MainLightColor.rgb",
  ks_AmbientColor: undefined,
  ks_SpriteRect: undefined,
  ks_SpriteInfo: undefined,
  ks_Time: "_Time.y",
  ks_DeltaTime: "unity_DeltaTime.x",
  ks_SmoothDeltaTime: "unity_DeltaTime.z",
};
/** Fallback literal (typed zero) used with a warning when a uniform has no Unity equivalent. */
export const UNITY_UNIFORM_FALLBACK = "0.0";
