import type { IRModule } from "../../../ir/types";
import { type UnityPropertyOut, unityProperty } from "../properties";
import { keywordProperty } from "./keywords";
import { exposedStateProperties } from "../options";
import type { EmitCtx, UnityEmitOptions } from "./ctx";

/** Hidden Vector property fed by the exported `KekenikSpriteRect.cs` helper (E5). */
export const SPRITE_RECT_PROP = "_KsSpriteRect";

export interface PropertySections {
  /** Full ShaderLab `Properties {}` body lines (already attribute-prefixed, headers merged). */
  lines: string[];
  cbuffer: string[];
  textures: string[];
  /** Names of properties declared in HLSL (CBUFFER + textures) — consumed by the validators' contract. */
  declared: string[];
}

/** Everything that becomes a material property: exposed graph parameters, used hidden ones, profile-implied ones, render-state-only ones. */
export function buildPropertySections(ctx: EmitCtx, eo: UnityEmitOptions, module: IRModule): PropertySections {
  const used = new Set(module.uniforms.map((u) => u.prop));
  const lines: string[] = [];
  const cbuffer: string[] = [];
  const textures: string[] = [];
  const declared: string[] = [];
  let lastHeader = "";
  const take = (o: UnityPropertyOut): void => {
    const first = o.lines.length ? 0 : -1;
    o.lines.forEach((l, i) => {
      if (i === first && o.header && o.header !== lastHeader) {
        lines.push(`[Header(${o.header})] ${l}`);
        lastHeader = o.header;
      } else lines.push(l);
    });
    cbuffer.push(...o.cbuffer);
    textures.push(...o.textures);
  };
  for (const p of eo.properties) {
    if (!p.exposed && !used.has(p.id)) continue;
    const name = ctx.st.names.get(p.id)!;
    take(
      unityProperty(p, name, { keyword: ctx.keywords.find((k) => k.prop === p.id && !k.ownsProperty)?.keywords[0] }),
    );
    declared.push(name);
    if (p.type === "texture2D" && p.tilingOffset) ctx.st.stNames.add(name);
  }
  for (const k of ctx.keywords) if (k.ownsProperty) take(keywordProperty(k));
  if (ctx.tp.family === "sprite" && !declared.includes("_MainTex")) {
    lines.push('[MainTexture] [NoScaleOffset] _MainTex("Sprite Texture", 2D) = "white" {}');
    textures.push("TEXTURE2D(_MainTex);", "SAMPLER(sampler_MainTex);");
    declared.push("_MainTex");
  }
  if (ctx.tp.family === "sprite")
    lines.push(
      '[HideInInspector] _Color("Tint", Color) = (1,1,1,1)',
      '[HideInInspector] _EnableExternalAlpha("Enable External Alpha", Float) = 0',
    );
  if (ctx.tp.family === "vfx" && ctx.o.softParticles) {
    lines.push(
      '_SoftParticlesNearFadeDistance("Soft Particles Near Fade", Float) = 0',
      '_SoftParticlesFarFadeDistance("Soft Particles Far Fade", Float) = 1',
    );
    cbuffer.push("float _SoftParticlesNearFadeDistance;", "float _SoftParticlesFarFadeDistance;");
    declared.push("_SoftParticlesNearFadeDistance", "_SoftParticlesFarFadeDistance");
  }
  lines.push(...exposedStateProperties(ctx.o));
  const add = (line: string, cb: string, name: string): void => {
    lines.push(line);
    cbuffer.push(cb);
    declared.push(name);
  };
  if (ctx.cutoffProp) add('_Cutoff("Alpha Clip Threshold", Range(0, 1)) = 0.5', "float _Cutoff;", "_Cutoff");
  if (ctx.tp.family === "vfx" && ctx.o.cameraFade) {
    add(
      '_CameraNearFadeDistance("Camera Near Fade Distance", Float) = 1',
      "float _CameraNearFadeDistance;",
      "_CameraNearFadeDistance",
    );
    add(
      '_CameraFarFadeDistance("Camera Far Fade Distance", Float) = 2',
      "float _CameraFarFadeDistance;",
      "_CameraFarFadeDistance",
    );
  }
  if (ctx.tp.family === "vfx" && ctx.o.distortion)
    add(
      '_DistortionStrength("Distortion Strength", Range(0, 0.2)) = 0.03',
      "float _DistortionStrength;",
      "_DistortionStrength",
    );
  if (ctx.implied.spriteRect)
    add(
      '[HideInInspector] [PerRendererData] _KsSpriteRect("Sprite Rect (KekenikSpriteRect.cs)", Vector) = (0, 0, 1, 1)',
      `float4 ${SPRITE_RECT_PROP};`,
      SPRITE_RECT_PROP,
    );
  return { lines, cbuffer, textures, declared };
}
