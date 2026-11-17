import { hlslType } from "../pack";
import type { Generated } from "../../dialect/generate";
import { CULL_TEXT } from "../data/renderState";
import { ALPHATEST_PRAGMA, LOD_FADE_PRAGMA } from "../data/keywords";
import { clipLines, lodFadeLines } from "./clip";
import { type EmitCtx, type SliceId, indent } from "./ctx";

/** Member declarations of a varyings struct (+ fixed extras), TEXCOORD indices assigned in order. */
export function varyingsStruct(
  name: string,
  g: Generated | undefined,
  extras: string[],
  ctx: EmitCtx,
): { text: string; names: string[] } {
  const lines = ["    float4 positionCS : SV_POSITION;"];
  let i = 0;
  const names: string[] = [];
  for (const v of g?.fragment.varyings ?? []) {
    lines.push(`    ${hlslType(v.ty)} ${v.name} : TEXCOORD${i++};`);
    names.push(v.name);
  }
  // An entry containing `{i}` is a complete, pre-formatted declaration (e.g. `DECLARE_LIGHTMAP_OR_SH(a, b, {i})`) and consumes one TEXCOORD index.
  for (const e of extras)
    lines.push(e.includes("{i}") ? `    ${e.replace(/\{i\}/g, String(i++))};` : `    ${e} : TEXCOORD${i++};`);
  if (ctx.o.instancing) lines.push("    UNITY_VERTEX_INPUT_INSTANCE_ID");
  lines.push("    UNITY_VERTEX_OUTPUT_STEREO");
  return { text: `struct ${name}\n{\n${lines.join("\n")}\n};`, names };
}

const stereoInit = (ctx: EmitCtx, v: string): string[] => [
  ...(ctx.o.instancing ? [`UNITY_SETUP_INSTANCE_ID(input);`, `UNITY_TRANSFER_INSTANCE_ID(input, ${v});`] : []),
  `UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(${v});`,
];

/** Vertex entry: loads attributes, runs the SHARED vertex graph, writes the position (via `clipLines`) and the slice's varyings. */
export function vertexEntry(
  ctx: EmitCtx,
  entry: string,
  vary: string,
  g: Generated | undefined,
  clipLines: string[],
  extra: string[] = [],
): string {
  const l = [`${vary} ${entry}(KsAttributes input)`, "{", `    ${vary} output = (${vary})0;`];
  for (const s of stereoInit(ctx, "output")) l.push(`    ${s}`);
  l.push("    KsLoadAttributes(input);", "    KsVertexData vd = KsVertexGraph();");
  const pos = g?.vertex.pos;
  if (pos && pos !== "a_position") l.push(`    float3 ${pos} = vd.positionOS;`);
  for (const c of clipLines) l.push(`    ${c}`);
  for (const v of g?.vertex.varyings ?? []) l.push(`    output.${v.name} = ${v.expr};`);
  for (const e of extra) l.push(`    ${e}`);
  l.push("    return output;", "}");
  return l.join("\n");
}

/** Fragment entry prologue: instancing/stereo setup, varyings → statics, optional face flag. */
export function fragmentPrologue(ctx: EmitCtx, names: string[], needsFace: boolean): string[] {
  const l = [
    ...(ctx.o.instancing ? ["UNITY_SETUP_INSTANCE_ID(input);"] : []),
    "UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(input);",
  ];
  for (const n of names) l.push(`${n} = input.${n};`);
  if (needsFace) l.push("ks_front_facing = IS_FRONT_VFACE(isFront, true, false);");
  return l;
}
export const faceParam = (needs: boolean): string => (needs ? ", FRONT_FACE_TYPE isFront : FRONT_FACE_SEMANTIC" : "");

/** Pragma set of one pass. `_ALPHATEST_ON` (runtime Alpha Clip) and `LOD_FADE_CROSSFADE` are repeated in EVERY pass; GI / decal lines are added by the Lit passes themselves. */
export function pragmas(ctx: EmitCtx, extra: string[] = [], fog = false): string[] {
  return [
    `#pragma target ${ctx.o.shaderTarget}`,
    ...extra,
    ...(fog ? ["#pragma multi_compile_fog"] : []),
    ...(ctx.o.instancing ? ["#pragma multi_compile_instancing"] : []),
    ...(ctx.o.exposeSurface && ctx.o.clipCode ? [ALPHATEST_PRAGMA] : []),
    ...(ctx.o.lodCrossFade ? [LOD_FADE_PRAGMA] : []),
    ...ctx.keywordPragmas,
  ];
}

export function passText(
  name: string,
  lightMode: string,
  state: string[],
  pragma: string[],
  bodyBlocks: string[],
): string {
  const l = [
    "Pass",
    "{",
    `    Name "${name}"`,
    `    Tags { "LightMode"="${lightMode}" }`,
    ...state.map((s) => `    ${s}`),
    "    HLSLPROGRAM",
    ...pragma.map((p) => `    ${p}`),
    "",
  ];
  l.push(indent(bodyBlocks.join("\n\n"), 1), "    ENDHLSL", "}");
  return l.join("\n");
}

export const cullLine = (ctx: EmitCtx): string => (ctx.o.expose.cull ? "Cull [_Cull]" : CULL_TEXT[ctx.o.cull]);

/** Alpha-slice fragment: evaluates alpha + threshold, clips, returns 0 (ShadowCaster / DepthOnly). */
function alphaFragment(ctx: EmitCtx, entry: string, vary: string, names: string[], slice: SliceId): string {
  const face = ctx.usesFace;
  const l = [`half4 ${entry}(${vary} input${faceParam(face)}) : SV_Target`, "{"];
  for (const s of fragmentPrologue(ctx, names, face)) l.push(`    ${s}`);
  if (ctx.o.clipCode && ctx.gens[slice]) l.push(`    KsSurface s = KsSurface_${slice}();`, ...clipLines(ctx));
  l.push(...lodFadeLines(ctx, "input.positionCS"));
  l.push("    return 0;", "}");
  return l.join("\n");
}

export function shadowCasterPass(ctx: EmitCtx): string {
  const g = ctx.gens.alpha;
  const vs = varyingsStruct("KsVaryingsShadow", g, [], ctx);
  const clip = [
    "float3 positionWS = TransformObjectToWorld(vd.positionOS);",
    "float3 normalWS = TransformObjectToWorldNormal(vd.normalOS);",
    "#if _CASTING_PUNCTUAL_LIGHT_SHADOW",
    "float3 lightDirectionWS = normalize(_LightPosition - positionWS);",
    "#else",
    "float3 lightDirectionWS = _LightDirection;",
    "#endif",
    "float4 shadowCS = TransformWorldToHClip(ApplyShadowBias(positionWS, normalWS, lightDirectionWS));",
    "#if UNITY_REVERSED_Z",
    "shadowCS.z = min(shadowCS.z, UNITY_NEAR_CLIP_VALUE);",
    "#else",
    "shadowCS.z = max(shadowCS.z, UNITY_NEAR_CLIP_VALUE);",
    "#endif",
    "output.positionCS = shadowCS;",
  ];
  const body = [
    "float3 _LightDirection;",
    "float3 _LightPosition;",
    vs.text,
    vertexEntry(ctx, "KsVertShadow", "KsVaryingsShadow", g, clip),
    alphaFragment(ctx, "KsFragShadow", "KsVaryingsShadow", vs.names, "alpha"),
  ];
  const pr = pragmas(ctx, [
    "#pragma vertex KsVertShadow",
    "#pragma fragment KsFragShadow",
    "#pragma multi_compile_vertex _ _CASTING_PUNCTUAL_LIGHT_SHADOW",
  ]);
  return passText(
    "ShadowCaster",
    "ShadowCaster",
    ["ZWrite On", "ZTest LEqual", "ColorMask 0", cullLine(ctx)],
    pr,
    body,
  );
}

export function depthOnlyPass(ctx: EmitCtx): string {
  const g = ctx.gens.alpha;
  const vs = varyingsStruct("KsVaryingsDepth", g, [], ctx);
  const body = [
    vs.text,
    vertexEntry(ctx, "KsVertDepth", "KsVaryingsDepth", g, [
      "output.positionCS = TransformObjectToHClip(vd.positionOS);",
    ]),
    alphaFragment(ctx, "KsFragDepth", "KsVaryingsDepth", vs.names, "alpha"),
  ];
  return passText(
    "DepthOnly",
    "DepthOnly",
    ["ZWrite On", "ColorMask 0", cullLine(ctx)],
    pragmas(ctx, ["#pragma vertex KsVertDepth", "#pragma fragment KsFragDepth"]),
    body,
  );
}

/** DepthNormals: world normal packed exactly like URP (octahedral when `_GBUFFER_NORMALS_OCT`). The Lit profile supplies `tsNormalLines`. */
export function depthNormalsPass(
  ctx: EmitCtx,
  normalExpr = "NormalizeNormalPerPixel(input.normalWS)",
  extraVary: string[] = [],
  extraVert: string[] = [],
): string {
  const g = ctx.gens.normals;
  const vs = varyingsStruct("KsVaryingsNormals", g, ["float3 normalWS", ...extraVary], ctx);
  const face = ctx.usesFace;
  const f = [`half4 KsFragNormals(KsVaryingsNormals input${faceParam(face)}) : SV_Target`, "{"];
  for (const s of fragmentPrologue(ctx, vs.names, face)) f.push(`    ${s}`);
  if (g) f.push("    KsSurface s = KsSurface_normals();");
  if (ctx.o.clipCode && g) f.push(...clipLines(ctx));
  f.push(...lodFadeLines(ctx, "input.positionCS"));
  f.push(
    `    float3 n = ${normalExpr};`,
    "#if defined(_GBUFFER_NORMALS_OCT)",
    "    float2 oct = PackNormalOctQuadEncode(normalize(n));",
    "    float2 rm = saturate(oct * 0.5 + 0.5);",
    "    half3 packed = PackFloat2To888(rm);",
    "    return half4(packed, 0.0);",
    "#else",
    "    return half4(n, 0.0);",
    "#endif",
    "}",
  );
  const vert = vertexEntry(
    ctx,
    "KsVertNormals",
    "KsVaryingsNormals",
    g,
    ["output.positionCS = TransformObjectToHClip(vd.positionOS);"],
    ["output.normalWS = TransformObjectToWorldNormal(vd.normalOS);", ...extraVert],
  );
  const pr = pragmas(ctx, [
    "#pragma vertex KsVertNormals",
    "#pragma fragment KsFragNormals",
    "#pragma multi_compile_fragment _ _GBUFFER_NORMALS_OCT",
  ]);
  return passText("DepthNormals", "DepthNormals", ["ZWrite On", cullLine(ctx)], pr, [vs.text, vert, f.join("\n")]);
}
