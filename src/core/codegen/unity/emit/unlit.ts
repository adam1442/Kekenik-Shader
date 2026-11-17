import { BLEND_TABLE } from "../data/renderState";
import { renderStateLines } from "../options";
import { type EmitCtx } from "./ctx";
import { clipLines } from "./clip";
import { faceParam, fragmentPrologue, passText, pragmas, vertexEntry, varyingsStruct } from "./passes";

/** Unlit colour pass (also used by Sprite Unlit, VFX Unlit and the Sprite `UniversalForward` fallback via options). */
export function unlitForwardPass(
  ctx: EmitCtx,
  opts: {
    name?: string;
    lightMode?: string;
    vertexColor?: boolean;
    soft?: boolean;
    vfx?: boolean;
    pragma?: string[];
  } = {},
): string {
  const g = ctx.gens.forward!;
  const o = ctx.o;
  const id = (opts.name ?? "Unlit").replace(/[^A-Za-z0-9]/g, "");
  const [V, VERT, FRAG] = [`KsVaryings${id}`, `KsVert${id}`, `KsFrag${id}`];
  const fog = o.fog;
  const fb = opts.vfx ? ctx.flipbook : undefined;
  const fade = opts.vfx && o.cameraFade;
  const dist = opts.vfx && o.distortion;
  const ndc = opts.soft || fade || dist;
  const extras = [
    ...(fog ? ["float fogFactor"] : []),
    ...(opts.vertexColor ? ["float4 ksColor"] : []),
    ...(ndc ? ["float4 ksNDC"] : []),
    ...(fb ? ["float2 ksUV2", "float ksBlend"] : []),
  ];
  const vs = varyingsStruct(V, g, extras, ctx);
  const vert = vertexEntry(
    ctx,
    VERT,
    V,
    g,
    ["output.positionCS = TransformObjectToHClip(vd.positionOS);"],
    [
      ...(fog ? ["output.fogFactor = ComputeFogFactor(output.positionCS.z);"] : []),
      ...(opts.vertexColor ? ["output.ksColor = a_color;"] : []),
      ...(ndc ? ["output.ksNDC = GetVertexPositionInputs(vd.positionOS).positionNDC;"] : []),
      ...(fb ? ["output.ksUV2 = a_uv1;", "output.ksBlend = input.ksAnimBlend;"] : []),
    ],
  );
  const face = ctx.usesFace;
  const f = [`half4 ${FRAG}(${V} input${faceParam(face)}) : SV_Target`, "{"];
  for (const s of fragmentPrologue(ctx, vs.names, face)) f.push(`    ${s}`);
  f.push("    KsSurface s = KsSurface_forward();");
  // E2 flipbook: the graph runs a second time with the UV varying replaced by the next-frame UV (stream UV2), then both results are blended by AnimBlend.
  if (fb)
    f.push(
      `    ${fb.uvVarying} = input.ksUV2;`,
      "    KsSurface s2 = KsSurface_forward();",
      "    s.baseColor = lerp(s.baseColor, s2.baseColor, input.ksBlend);",
      "    s.alpha = lerp(s.alpha, s2.alpha, input.ksBlend);",
    );
  if (o.clipCode) f.push(...clipLines(ctx));
  f.push("    half4 col = half4(s.baseColor, s.alpha);");
  if (opts.vertexColor) f.push("    col *= input.ksColor;");
  if (dist)
    f.push(
      "    float2 ksScreenUV = input.ksNDC.xy / input.ksNDC.w;",
      "    float2 ksOffset = (s.baseColor.rg - 0.5) * 2.0 * _DistortionStrength * s.alpha;",
      "    col.rgb = SampleSceneColor(ksScreenUV + ksOffset);",
    );
  if (fade)
    f.push(
      "    col.a *= saturate((input.ksNDC.w - _CameraNearFadeDistance) / max(_CameraFarFadeDistance - _CameraNearFadeDistance, 1e-4));",
    );
  if (opts.soft)
    f.push(
      "    float2 screenUV = input.ksNDC.xy / input.ksNDC.w;",
      "    float sceneEye = LinearEyeDepth(SampleSceneDepth(screenUV), _ZBufferParams);",
      "    float fade = saturate((sceneEye - input.ksNDC.w - _SoftParticlesNearFadeDistance) / max(_SoftParticlesFarFadeDistance - _SoftParticlesNearFadeDistance, 1e-4));",
      "    col.a *= fade;",
    );
  const fix = BLEND_TABLE[o.blend].shader?.unlit;
  if (fix) f.push(`    ${fix.replace(/\{c\}/g, "col").replace(/\{a\}/g, "col.a")}`);
  if (fog) f.push("    col.rgb = MixFog(col.rgb, input.fogFactor);");
  f.push("    return col;", "}");
  const pr = pragmas(ctx, [`#pragma vertex ${VERT}`, `#pragma fragment ${FRAG}`, ...(opts.pragma ?? [])], fog);
  return passText(opts.name ?? "Unlit", opts.lightMode ?? "UniversalForwardOnly", renderStateLines(o), pr, [
    vs.text,
    vert,
    f.join("\n"),
  ]);
}
