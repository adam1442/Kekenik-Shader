import { SPRITE_2D_PRAGMAS } from "../data/keywords";
import { renderStateLines } from "../options";
import type { EmitCtx } from "./ctx";
import { fragmentPrologue, passText, pragmas, varyingsStruct, vertexEntry } from "./passes";
import type { BuiltPasses } from "./sprite";
import { unlitForwardPass } from "./unlit";

/** Names the SpriteRenderer binds itself (main sprite + secondary textures); they are ordinary Blackboard textures with these references. */
const SPRITE_LIT_NOTE =
  "// Sprite Lit needs the 2D Renderer (Light2D). Name the normal / mask texture parameters _NormalMap / _MaskTex to receive the sprite's secondary textures.";

const CLIP_POS = ["output.positionCS = TransformObjectToHClip(vd.positionOS);"];

/** `Universal2D` pass: shape-light accumulation through `CombinedShapeLightShared` (same code path as URP's Sprite-Lit-Default). */
function lit2DPass(ctx: EmitCtx): string {
  const g = ctx.gens.forward!;
  const [V, VERT, FRAG] = ["KsVaryingsSprite", "KsVertSprite", "KsFragSprite"];
  const vs = varyingsStruct(V, g, ["float4 ksColor", "float2 ksUV", "float2 lightingUV"], ctx);
  const vert = vertexEntry(ctx, VERT, V, g, CLIP_POS, [
    "output.ksColor = a_color;",
    "output.ksUV = a_uv0;",
    "float4 clipVertex = output.positionCS / output.positionCS.w;",
    "output.lightingUV = ComputeScreenPos(clipVertex).xy;",
  ]);
  const f = [`half4 ${FRAG}(${V} input) : SV_Target`, "{"];
  for (const s of fragmentPrologue(ctx, vs.names, false)) f.push(`    ${s}`);
  f.push(
    "    KsSurface s = KsSurface_forward();",
    "    half4 main = half4(s.baseColor, s.alpha) * input.ksColor;",
    "    SurfaceData2D surfaceData;",
    "    InputData2D inputData;",
    "    InitializeSurfaceData(main.rgb, main.a, s.spriteMask, surfaceData);",
    "    InitializeInputData(input.ksUV, input.lightingUV, inputData);",
    "    return CombinedShapeLightShared(surfaceData, inputData);",
    "}",
  );
  const pr = pragmas(ctx, [`#pragma vertex ${VERT}`, `#pragma fragment ${FRAG}`, ...SPRITE_2D_PRAGMAS]);
  return passText("Sprite Lit 2D", "Universal2D", renderStateLines(ctx.o), pr, [vs.text, vert, f.join("\n")]);
}

/** `NormalsRendering` pass: the graph's tangent-space normal (+ sprite alpha) written to the 2D normals buffer. */
function normalsPass(ctx: EmitCtx): string {
  const g = ctx.gens.normals!;
  const [V, VERT, FRAG] = ["KsVaryingsSpriteNormals", "KsVertSpriteNormals", "KsFragSpriteNormals"];
  const vs = varyingsStruct(V, g, ["float4 ksColor", "float3 normalWS", "float3 tangentWS", "float3 bitangentWS"], ctx);
  const vert = vertexEntry(ctx, VERT, V, g, CLIP_POS, [
    "output.ksColor = a_color;",
    "output.normalWS = TransformObjectToWorldDir(float3(0.0, 0.0, -1.0));",
    "output.tangentWS = TransformObjectToWorldDir(vd.tangentOS.xyz);",
    "output.bitangentWS = cross(output.normalWS, output.tangentWS) * vd.tangentOS.w;",
  ]);
  const f = [`half4 ${FRAG}(${V} input) : SV_Target`, "{"];
  for (const s of fragmentPrologue(ctx, vs.names, false)) f.push(`    ${s}`);
  f.push(
    "    KsSurface s = KsSurface_normals();",
    "    half4 mainTex = half4(1.0, 1.0, 1.0, s.alpha) * input.ksColor;",
    "    return NormalsRenderingShared(mainTex, s.normalTS, input.tangentWS, input.bitangentWS, input.normalWS);",
    "}",
  );
  const pr = pragmas(ctx, [`#pragma vertex ${VERT}`, `#pragma fragment ${FRAG}`]);
  return passText("Sprite Normals", "NormalsRendering", renderStateLines(ctx.o), pr, [vs.text, vert, f.join("\n")]);
}

/** Sprite Lit: `Universal2D` (lit) + `NormalsRendering` + `UniversalForward` (unlit fallback for the Universal Renderer). */
export function spriteLitPasses(ctx: EmitCtx): BuiltPasses {
  return {
    passes: [
      lit2DPass(ctx),
      normalsPass(ctx),
      unlitForwardPass(ctx, { name: "Sprite Unlit Forward", lightMode: "UniversalForward", vertexColor: true }),
    ],
    extra: [],
    headerExtra: [
      "// Sprite shader: SpriteRenderer binds the sprite to _MainTex and its tint to vertex colour. Not SRP-Batcher compatible.",
      SPRITE_LIT_NOTE,
    ],
  };
}
