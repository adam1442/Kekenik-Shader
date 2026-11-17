import type { EmitCtx } from "./ctx";
import { clipLines, lodFadeLines } from "./clip";
import { cullLine, faceParam, fragmentPrologue, passText, pragmas, varyingsStruct, vertexEntry } from "./passes";

/**
 * Extra Lit passes . Both are written against the URP sources of 2022.3 / 6000.0 / 6000.3 (GitHub, checked when written)
 * and listed as `[verify]` in the manual checklist (`lit-meta`, `lit-motion-vectors`) — nothing here was compiled in Unity.
 */

/**
 * Meta pass: lets Unity bake this shader's albedo / emission into lightmaps and probes (`LightMode Meta`, `Cull Off`).
 * Same call sequence as URP's `UniversalVertexMeta` / `UniversalFragmentMeta`: `UnityMetaVertexPosition(positionOS, uv1, uv2)` + `UnityMetaFragment(MetaInput)`.
 * `EDITOR_VISUALIZATION` (scene-view albedo / emissive modes) is NOT compiled: it is a global editor keyword (limitation, documented).
 * Albedo mirrors `LitMetaPass.hlsl`: `diffuse + specular * roughness * 0.5` computed from metallic / smoothness.
 */
export function metaPass(ctx: EmitCtx): string {
  const g = ctx.gens.forward!;
  const [V, VERT, FRAG] = ["KsVaryingsMeta", "KsVertMeta", "KsFragMeta"];
  const vs = varyingsStruct(V, g, [], ctx);
  const vert = vertexEntry(ctx, VERT, V, g, [
    "output.positionCS = UnityMetaVertexPosition(vd.positionOS, a_uv1, a_uv2);",
  ]);
  const has = (id: string): boolean => ctx.fragmentBlocks.some((b) => b.id === id);
  const face = ctx.usesFace;
  const f = [`half4 ${FRAG}(${V} input${faceParam(face)}) : SV_Target`, "{"];
  for (const s of fragmentPrologue(ctx, vs.names, face)) f.push(`    ${s}`);
  f.push("    KsSurface s = KsSurface_forward();");
  if (ctx.o.clipCode) f.push(...clipLines(ctx));
  f.push(...lodFadeLines(ctx, "input.positionCS"));
  f.push(
    "    UnityMetaInput metaInput = (UnityMetaInput)0;",
    has("metallic") && has("smoothness")
      ? "    metaInput.Albedo = s.baseColor * ((1.0 - 0.04) * (1.0 - s.metallic)) + lerp(half3(0.04, 0.04, 0.04), s.baseColor, s.metallic) * ((1.0 - s.smoothness) * (1.0 - s.smoothness)) * 0.5;"
      : "    metaInput.Albedo = s.baseColor;",
    `    metaInput.Emission = ${has("emission") ? "s.emission" : "half3(0.0, 0.0, 0.0)"};`,
    "    return UnityMetaFragment(metaInput);",
    "}",
  );
  const pr = pragmas(ctx, [`#pragma vertex ${VERT}`, `#pragma fragment ${FRAG}`]);
  return passText("Meta", "Meta", ["Cull Off"], pr, [vs.text, vert, f.join("\n")]);
}

/**
 * MotionVectors pass (Unity 6 / URP 17+ only — `MotionVectorsCommon.hlsl`): object motion for TAA / motion blur / upscalers.
 * Mirrors `ObjectMotionVectors.hlsl`: current position unjittered, previous position through `unity_MotionVectorsParams` / `UNITY_PREV_MATRIX_M`.
 * Vertex displacement of the graph moves the current position only (like Shader Graph); `positionOld` comes from TEXCOORD4 (skinned meshes).
 */
export function motionVectorsPass(ctx: EmitCtx): string {
  const g = ctx.gens.alpha;
  const [V, VERT, FRAG] = ["KsVaryingsMotion", "KsVertMotion", "KsFragMotion"];
  const vs = varyingsStruct(V, g, ["float4 positionCSNoJitter", "float4 previousPositionCSNoJitter"], ctx);
  const clip = [
    "output.positionCS = TransformObjectToHClip(vd.positionOS);",
    "output.positionCSNoJitter = mul(_NonJitteredViewProjMatrix, mul(UNITY_MATRIX_M, float4(vd.positionOS, 1.0)));",
    "float4 prevPos = (unity_MotionVectorsParams.x == 1) ? float4(input.positionOld, 1.0) : float4(vd.positionOS, 1.0);",
    "output.previousPositionCSNoJitter = mul(_PrevViewProjMatrix, mul(UNITY_PREV_MATRIX_M, prevPos));",
  ];
  const f = [`float4 ${FRAG}(${V} input${faceParam(ctx.usesFace)}) : SV_Target`, "{"];
  for (const s of fragmentPrologue(ctx, vs.names, ctx.usesFace)) f.push(`    ${s}`);
  if (ctx.o.clipCode && g) f.push("    KsSurface s = KsSurface_alpha();", ...clipLines(ctx));
  f.push(
    ...lodFadeLines(ctx, "input.positionCS"),
    "    return float4(CalcNdcMotionVectorFromCsPositions(input.positionCSNoJitter, input.previousPositionCSNoJitter), 0.0, 0.0);",
    "}",
  );
  const pr = pragmas(ctx, [`#pragma vertex ${VERT}`, `#pragma fragment ${FRAG}`]);
  return passText("MotionVectors", "MotionVectors", ["ColorMask RG", "ZWrite On", cullLine(ctx)], pr, [
    vs.text,
    vertexEntry(ctx, VERT, V, g, clip),
    f.join("\n"),
  ]);
}
