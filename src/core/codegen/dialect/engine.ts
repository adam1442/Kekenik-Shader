import type { InputSyntax } from "./inputs";

/**
 * Engine intrinsics (`engine` IR op) of the portable backends (GLSL, WGSL, HLSL), resolved against the always-declared host frame block
 * (`ks_*` uniforms, see glsl/builtins). Unknown names → undefined (the dialect reports "unsupported"). The same names are documented
 * per target (Unity URP, Godot) in `core/engine/builtinMap.ts`.
 *
 * Light data (`ks.light.mainDirection / mainColor / ambientSH`) is HOST-SUPPLIED on the portable targets: the preview feeds it from the
 * Scene Simulation panel and a game integration from its own lights (Decision D-8d-2). Engine-only data (additional lights, depth /
 * colour textures, `ks.camera.nearFar`) is deliberately NOT resolved here.
 */
export function engineExpr(name: string, s: InputSyntax): string | undefined {
  const M = (a: string, b: string): string => s.mulM4V4(s.uni(a as never), s.uni(b as never));
  switch (name) {
    case "ks.matrix.objectToWorld":
      return s.uni("ks_Model");
    case "ks.matrix.worldToObject":
      return s.uni("ks_WorldToObject");
    case "ks.matrix.worldToView":
      return s.uni("ks_View");
    case "ks.matrix.viewToWorld":
      return s.uni("ks_ViewInverse");
    case "ks.matrix.viewToClip":
      return s.uni("ks_Projection");
    case "ks.matrix.clipToView":
      return s.uni("ks_ProjectionInverse");
    case "ks.matrix.worldToClip":
      return M("ks_Projection", "ks_View");
    case "ks.matrix.clipToWorld":
      return M("ks_ViewInverse", "ks_ProjectionInverse");
    case "ks.matrix.objectToClip":
      return s.mulM4V4(s.uni("ks_Projection"), M("ks_View", "ks_Model"));
    case "ks.matrix.clipToObject":
      return s.mulM4V4(s.uni("ks_WorldToObject"), M("ks_ViewInverse", "ks_ProjectionInverse"));
    case "ks.matrix.normalObjectToWorld":
      return s.uni("ks_NormalMatrix");
    case "ks.matrix.normalWorldToObject":
      return `transpose(${s.mat3(s.uni("ks_Model"))})`;
    case "ks.camera.params":
      return s.uni("ks_CameraParams");
    case "ks.screen.params":
      return s.uni("ks_ScreenParams");
    case "ks.fog.color":
      return s.uni("ks_FogColor");
    case "ks.fog.params":
      return s.uni("ks_FogParams");
    case "ks.light.mainDirection":
      return s.uni("ks_MainLightDir");
    case "ks.light.mainColor":
      return s.uni("ks_MainLightColor");
    case "ks.light.ambientSH":
      return s.uni("ks_AmbientColor");
    case "ks.light.mainShadow":
      return s.num(1);
    case "ks.sprite.rect":
      return s.uni("ks_SpriteRect");
    case "ks.sprite.info":
      return s.uni("ks_SpriteInfo");
    default:
      return undefined;
  }
}
