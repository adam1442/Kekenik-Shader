import { BLEND_TABLE } from "../data/renderState";
import { litExtraPragmas, litKeywordPragmas } from "../data/keywords";
import { clipLines, lodFadeLines } from "./clip";
import { isOpaque, isSimpleLit, litPolicyOf, renderStateLines } from "../options";
import type { EmitCtx } from "./ctx";
import {
  depthNormalsPass,
  depthOnlyPass,
  faceParam,
  fragmentPrologue,
  passText,
  pragmas,
  shadowCasterPass,
  varyingsStruct,
  vertexEntry,
} from "./passes";
import type { BuiltPasses } from "./sprite";
import { metaPass, motionVectorsPass } from "./litExtra";

/**
 * Lit profile v1 (S5): realtime main/additional lights, shadows, ambient SH, reflection probes through `UniversalFragmentPBR`.
 * Simple Lit : the same pass through `UniversalFragmentBlinnPhong` (no metallic / occlusion / probes) for mobile.
 * Deferred (documented): GBuffer / Meta / MotionVectors passes, lightmaps, shadowmask, APV, decals, LOD cross-fade, debug display.
 */
const LIT_V1_NOTE =
  "// Lit v1: realtime lighting only (no lightmaps, GBuffer, Meta, MotionVectors, decals). Requires a Universal Renderer (Forward / Forward+).";
/** Header note when any E1 extra is on (`bakedGI`, `metaPass`, `motionVectors`, `lodCrossFade`, `decals`). */
const litNote = (o: import("../options").UnityOptions): string => {
  const on = [
    o.bakedGI && "baked GI (lightmaps / SH / shadow mask)",
    o.metaPass && "Meta pass",
    o.motionVectors && "MotionVectors pass",
    o.lodCrossFade && "LOD cross-fade",
    o.decals && "DBuffer decals",
  ].filter(Boolean);
  return on.length
    ? `// Lit v1 + ${on.join(", ")}. Requires a Universal Renderer (Forward / Forward+); not generated: GBuffer (Deferred) pass, DOTS instancing, APV, Enlighten (dynamic lightmaps).`
    : LIT_V1_NOTE;
};

/** Shared HLSL helpers (declared once in the HLSLINCLUDE block, used by ForwardLit and DepthNormals). */
function litHelpers(ctx: EmitCtx): string[] {
  const h = [
    "float3 KsTangentToWorldNormal(float3 normalTS, float3 normalWS, float4 tangentWS)",
    "{",
    "    float sgn = tangentWS.w * GetOddNegativeScale();",
    "    float3 bitangentWS = sgn * cross(normalWS, tangentWS.xyz);",
    "    return TransformTangentToWorld(normalTS, half3x3(tangentWS.xyz, bitangentWS, normalWS));",
    "}",
    "",
  ];
  if (ctx.o.doubleSided !== "none") {
    h.push(
      "// Double-sided normals: only back faces are modified (Cull must be Off).",
      "float3 KsFaceNormalTS(float3 normalTS, bool isFront)",
      "{",
      "    if (!isFront)",
      "    {",
      ctx.o.doubleSided === "flip" ? "        normalTS = -normalTS;" : "        normalTS.z = -normalTS.z;",
      "    }",
      "    return normalTS;",
      "}",
      "",
    );
  }
  return h;
}

/** Tangent-space normal after the optional double-sided fix-up (`s` = KsSurface). */
const faceAwareNormalTS = (ctx: EmitCtx): string =>
  ctx.o.doubleSided === "none" ? "s.normalTS" : "KsFaceNormalTS(s.normalTS, ks_front_facing)";
/** World-space normal used by the DepthNormals pass (same maths as ForwardLit). */
const litDepthNormalExpr = (ctx: EmitCtx): string =>
  `NormalizeNormalPerPixel(KsTangentToWorldNormal(${faceAwareNormalTS(ctx)}, input.normalWS, input.tangentWS))`;

function forwardLitPass(ctx: EmitCtx): string {
  const g = ctx.gens.forward!;
  const o = ctx.o;
  const [V, VERT, FRAG] = ["KsVaryingsLit", "KsVertLit", "KsFragLit"];
  const simple = isSimpleLit(o);
  const vs = varyingsStruct(
    V,
    g,
    [
      "float3 positionWS",
      "float3 normalWS",
      "float4 tangentWS",
      ...(o.fog ? ["float fogFactor"] : []),
      "float3 vertexLight",
      ...(o.bakedGI
        ? ["DECLARE_LIGHTMAP_OR_SH(staticLightmapUV, vertexSH, {i})"]
        : o.shPerVertex
          ? ["float3 vertexSH"]
          : []),
    ],
    ctx,
  );
  const vert = vertexEntry(
    ctx,
    VERT,
    V,
    g,
    [
      "VertexPositionInputs vpi = GetVertexPositionInputs(vd.positionOS);",
      "VertexNormalInputs vni = GetVertexNormalInputs(vd.normalOS, vd.tangentOS);",
      "output.positionCS = vpi.positionCS;",
    ],
    [
      "output.positionWS = vpi.positionWS;",
      "output.normalWS = vni.normalWS;",
      "output.tangentWS = float4(vni.tangentWS, vd.tangentOS.w);",
      ...(o.fog ? ["output.fogFactor = ComputeFogFactor(vpi.positionCS.z);"] : []),
      ...(o.bakedGI
        ? [
            "OUTPUT_LIGHTMAP_UV(a_uv1, unity_LightmapST, output.staticLightmapUV);",
            "OUTPUT_SH(output.normalWS.xyz, output.vertexSH);",
          ]
        : o.shPerVertex
          ? ["output.vertexSH = SampleSH(vni.normalWS);"]
          : []),
      "#ifdef _ADDITIONAL_LIGHTS_VERTEX",
      "output.vertexLight = VertexLighting(vpi.positionWS, vni.normalWS);",
      "#endif",
    ],
  );
  const face = ctx.usesFace;
  const f = [`half4 ${FRAG}(${V} input${faceParam(face)}) : SV_Target`, "{"];
  for (const s of fragmentPrologue(ctx, vs.names, face)) f.push(`    ${s}`);
  f.push("    KsSurface s = KsSurface_forward();");
  if (o.clipCode) f.push(...clipLines(ctx));
  f.push(...lodFadeLines(ctx, "input.positionCS"));
  f.push(
    "    SurfaceData surfaceData = (SurfaceData)0;",
    "    surfaceData.albedo = s.baseColor;",
    `    surfaceData.alpha = ${isOpaque(o) ? "1.0" : "s.alpha"};`,
    ...(simple
      ? [
          "    surfaceData.metallic = 0.0;",
          "    surfaceData.smoothness = s.smoothness;",
          "    surfaceData.occlusion = 1.0;",
          "    surfaceData.emission = s.emission;",
          "    surfaceData.specular = half3(s.specular, s.specular, s.specular);",
        ]
      : [
          "    surfaceData.metallic = s.metallic;",
          "    surfaceData.smoothness = s.smoothness;",
          "    surfaceData.occlusion = s.occlusion;",
          "    surfaceData.emission = s.emission;",
          "    surfaceData.specular = 0.0;",
          "    surfaceData.clearCoatMask = 0.0;",
          "    surfaceData.clearCoatSmoothness = 1.0;",
        ]),
    `    surfaceData.normalTS = ${faceAwareNormalTS(ctx)};`,
    "    InputData inputData = (InputData)0;",
    "    inputData.positionWS = input.positionWS;",
    "    inputData.positionCS = input.positionCS;",
    "    inputData.normalWS = NormalizeNormalPerPixel(KsTangentToWorldNormal(surfaceData.normalTS, input.normalWS, input.tangentWS));",
    "    inputData.viewDirectionWS = GetWorldSpaceNormalizeViewDir(input.positionWS);",
    "    inputData.shadowCoord = TransformWorldToShadowCoord(input.positionWS);",
    o.fog
      ? "    inputData.fogCoord = InitializeInputDataFog(float4(input.positionWS, 1.0), input.fogFactor);"
      : "    inputData.fogCoord = 0.0;",
    "#ifdef _ADDITIONAL_LIGHTS_VERTEX",
    "    inputData.vertexLighting = input.vertexLight;",
    "#else",
    "    inputData.vertexLighting = half3(0.0, 0.0, 0.0);",
    "#endif",
    ...(o.decals
      ? ["#if defined(_DBUFFER)", "    ApplyDecalToSurfaceData(input.positionCS, surfaceData, inputData);", "#endif"]
      : []),
    o.bakedGI
      ? "    inputData.bakedGI = SAMPLE_GI(input.staticLightmapUV, input.vertexSH, inputData.normalWS);"
      : o.shPerVertex
        ? "    inputData.bakedGI = input.vertexSH;"
        : "    inputData.bakedGI = SampleSH(inputData.normalWS);",
    "    inputData.normalizedScreenSpaceUV = GetNormalizedScreenSpaceUV(input.positionCS);",
    o.bakedGI
      ? "    inputData.shadowMask = SAMPLE_SHADOWMASK(input.staticLightmapUV);"
      : "    inputData.shadowMask = half4(1.0, 1.0, 1.0, 1.0);",
  );
  // Translucency (Kekenik portable term; URP Lit has none): back light of the MAIN light added as emission. Same formula as the preview and Godot BACKLIGHT.
  if (ctx.fragmentBlocks.some((b) => b.id === "translucency")) {
    const thin = ctx.fragmentBlocks.some((b) => b.id === "thickness") ? " * (1.0 - saturate(s.thickness))" : "";
    f.push(
      "    Light ksMainLight = GetMainLight(inputData.shadowCoord);",
      `    surfaceData.emission += s.translucency${thin} * s.baseColor * ksMainLight.color * (ksMainLight.distanceAttenuation * ksMainLight.shadowAttenuation) * saturate(dot(-inputData.normalWS, ksMainLight.direction));`,
    );
  }
  f.push(
    simple
      ? "    half4 col = UniversalFragmentBlinnPhong(inputData, surfaceData);"
      : "    half4 col = UniversalFragmentPBR(inputData, surfaceData);",
  );
  const fix = BLEND_TABLE[o.blend].shader?.lit;
  if (fix && !fix.startsWith("#")) f.push(`    ${fix.replace(/\{c\}/g, "col").replace(/\{a\}/g, "col.a")}`);
  if (o.fog) f.push("    col.rgb = MixFog(col.rgb, inputData.fogCoord);");
  f.push("    return col;", "}");
  const pr = pragmas(
    ctx,
    [
      `#pragma vertex ${VERT}`,
      `#pragma fragment ${FRAG}`,
      ...litKeywordPragmas(o.target, litPolicyOf(o)),
      ...litExtraPragmas(o),
    ],
    o.fog,
  );
  return passText("ForwardLit", "UniversalForwardOnly", renderStateLines(o), pr, [vs.text, vert, f.join("\n")]);
}

/** Lit pass set (brief §6.2): ForwardLit · ShadowCaster (Cast Shadows) · DepthOnly · DepthNormals (tangent-space normal → world, like ForwardLit). */
export function litPasses(ctx: EmitCtx): BuiltPasses {
  const tangent = "output.tangentWS = float4(TransformObjectToWorldDir(vd.tangentOS.xyz), vd.tangentOS.w);";
  return {
    passes: [
      forwardLitPass(ctx),
      ...(ctx.o.castShadows ? [shadowCasterPass(ctx)] : []),
      depthOnlyPass(ctx),
      depthNormalsPass(ctx, litDepthNormalExpr(ctx), ["float4 tangentWS"], [tangent]),
      ...(ctx.o.metaPass ? [metaPass(ctx)] : []),
      ...(ctx.o.motionVectors ? [motionVectorsPass(ctx)] : []),
    ],
    extra: litHelpers(ctx),
    headerExtra: [litNote(ctx.o)],
  };
}
