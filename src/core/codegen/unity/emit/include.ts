import { INC } from "../data/includes";
import type { Generated } from "../../dialect/generate";
import { ATTRIBUTE_ORDER } from "../../glsl/builtins";
import { HLSL_SEMANTIC } from "../../hlsl/text";
import { isOpaque, isSimpleLit } from "../options";
import { hlslType } from "../pack";
import { type EmitCtx, type SliceId, ATTR_MEMBER, ATTR_TYPE, isSpriteLit } from "./ctx";
import type { PropertySections } from "./sections";
import { keywordMacroLines } from "./keywords";
import { surfaceFunction, surfaceStruct } from "./surface";

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
/** Inline sampler state name `sampler_<Filter><Wrap>` [K, unverified-by-doc → manual check `sampler-state`]. */
export const unitySamplerName = (filter: string, wrap: string): string => `sampler_${cap(filter)}${cap(wrap)}`;
const SLICES: SliceId[] = ["forward", "alpha", "normals"];
const uniq = (xs: string[]): string[] => [...new Set(xs)];
/**
 * Graph functions of several pass generators share ONE HLSLINCLUDE block. Each generator numbers its locals independently, so the same
 * subgraph function arrives with different bodies — keep the first per signature (text before the body's `{`) instead of a text compare.
 */
const uniqFunctions = (xs: string[]): string[] => {
  const seen = new Set<string>();
  return xs.filter((f) => {
    const sig = f
      .slice(0, Math.max(0, f.indexOf("{")))
      .replace(/\s+/g, " ")
      .trim();
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });
};

/** `#define`s that must precede the includes (brief §4.5). */
function defineLines(ctx: EmitCtx): string[] {
  const o = ctx.o;
  const d: string[] = [];
  if (!isOpaque(o)) d.push("#define _SURFACE_TYPE_TRANSPARENT 1");
  if (ctx.tp.family === "lit") {
    if (!o.receiveShadows) d.push("#define _RECEIVE_SHADOWS_OFF");
    if (!o.specularHighlights) d.push("#define _SPECULARHIGHLIGHTS_OFF");
    // Simple Lit computes NO specular unless _SPECULAR_COLOR is defined: Specular Highlights off = the cheaper diffuse-only path.
    if (isSimpleLit(o) && o.specularHighlights) d.push("#define _SPECULAR_COLOR");
    if (!o.environmentReflections) d.push("#define _ENVIRONMENTREFLECTIONS_OFF");
    if (o.blend === "premultiply") d.push("#define _ALPHAPREMULTIPLY_ON");
  }
  return d;
}

function includeLines(ctx: EmitCtx): string[] {
  const l = [`#include "${INC.core}"`];
  if (ctx.tp.family === "lit") l.push(`#include "${INC.lighting}"`);
  else if (ctx.o.castShadows && ctx.tp.family === "unlit")
    l.push('#include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Shadows.hlsl"');
  if (ctx.tp.family === "lit") {
    if (ctx.o.metaPass) l.push(`#include "${INC.meta}"`);
    if (ctx.o.decals) l.push(`#include "${INC.dbuffer}"`);
    if (ctx.o.motionVectors) l.push(`#include "${INC.motion}"`);
  }
  const need = (inc: string): void => void (l.includes(`#include "${inc}"`) || l.push(`#include "${inc}"`));
  if (ctx.tp.family === "vfx" && ctx.o.softParticles) need(INC.depth);
  if (ctx.tp.family === "vfx" && ctx.o.distortion) need(INC.opaque);
  // Engine intrinsics used by the graph (Scene Depth / Scene Color / Scene Normals nodes, additional lights) pull in their URP include.
  const used = ctx.st.engineTemplates;
  if (used.has("SampleSceneDepth")) need(INC.depth);
  if (used.has("SampleSceneColor")) need(INC.opaque);
  if (used.has("SampleSceneNormals")) need(INC.normals);
  if (used.has("GetAdditionalLight") || used.has("GetAdditionalLightsCount")) need(INC.lighting);
  if (isSpriteLit(ctx.tp)) {
    // URP 2D lighting: shape-light declarations sit between LightingUtility.hlsl and the shared lighting includes (brief §6.4).
    l.push(`#include "${INC.lightingUtility2D}"`);
    for (let n = 0; n < 4; n++) l.push(`#if USE_SHAPE_LIGHT_TYPE_${n}`, `SHAPE_LIGHT(${n})`, "#endif");
    l.push(`#include "${INC.combined2D}"`, `#include "${INC.normals2D}"`);
  }
  return l;
}

const gensOf = (ctx: EmitCtx): Generated[] =>
  SLICES.map((s) => ctx.gens[s]).filter((g): g is Generated => g !== undefined);

/** The one shared `HLSLINCLUDE` block: defines → includes → CBUFFER → textures → structs → statics → graph functions. */
export function includeBlock(ctx: EmitCtx, sec: PropertySections, extra: string[] = []): string {
  const gens = gensOf(ctx);
  const out: string[] = [];
  out.push(...defineLines(ctx), ...includeLines(ctx), "");
  // E1: the Instance ID node. `unity_InstanceID` exists only in instancing variants (after UNITY_SETUP_INSTANCE_ID); other variants read 0.
  if (ctx.usesInstanceId)
    out.push(
      "#if defined(UNITY_INSTANCING_ENABLED)",
      "    #define KS_INSTANCE_ID ((int)unity_InstanceID)",
      "#else",
      "    #define KS_INSTANCE_ID 0",
      "#endif",
      "",
    );
  const kw = keywordMacroLines(ctx.keywords);
  if (kw.length) out.push(...kw, "");
  out.push("CBUFFER_START(UnityPerMaterial)", ...sec.cbuffer.map((c) => `    ${c}`), "CBUFFER_END", "");
  if (sec.textures.length) out.push(...sec.textures, "");
  const samplers = uniq(gens.flatMap((g) => g.samplers.map((s) => unitySamplerName(s.filter, s.wrap))));
  if (samplers.length) out.push(...samplers.map((n) => `SamplerState ${n};`), "");

  const attrs = ATTRIBUTE_ORDER.filter((a) => ctx.attrs.has(a));
  out.push("struct KsAttributes", "{");
  for (const a of attrs)
    out.push(`    ${ATTR_TYPE[a]} ${ATTR_MEMBER[a]} : ${HLSL_SEMANTIC[a as keyof typeof HLSL_SEMANTIC]};`);
  if (ctx.usesVertexId) out.push("    uint vertexID : SV_VertexID;");
  for (const m of ctx.extraAttrs) out.push(`    ${m}`);
  if (ctx.o.instancing) out.push("    UNITY_VERTEX_INPUT_INSTANCE_ID");
  out.push(
    "};",
    "",
    "struct KsVertexData",
    "{",
    "    float3 positionOS;",
    "    float3 normalOS;",
    "    float4 tangentOS;",
    "};",
    "",
    surfaceStruct(ctx),
    "",
  );

  out.push("// Stage inputs of the graph code (assigned at the start of every entry point).");
  for (const a of attrs) out.push(`static ${ATTR_TYPE[a]} ${a};`);
  if (ctx.usesVertexId) out.push("static int ks_vertex_id;");
  if (ctx.usesFace) out.push("static bool ks_front_facing;");
  const seen = new Map<string, string>();
  const stat = (name: string, ty: string): void => {
    if (seen.has(name)) return;
    seen.set(name, ty);
    out.push(`static ${ty} ${name};`);
  };
  for (const g of gens) {
    for (const v of g.fragment.varyings) stat(v.name, hlslType(v.ty));
    for (const x of g.vertex.st.globals.values()) stat(x.name, hlslType(x.ty));
  }
  out.push("");
  const helpers = uniq([...gens.flatMap((g) => g.helpers), ...ctx.st.engineHelpers]);
  if (helpers.length) out.push(...helpers.map((h) => h.trimEnd()), "");
  const fns = uniqFunctions(gens.flatMap((g) => g.functions.map((f) => f.toString().trimEnd())));
  if (fns.length) out.push(...fns.flatMap((f) => [f, ""]));
  out.push(...extra);

  out.push("void KsLoadAttributes(KsAttributes input)", "{");
  for (const a of attrs) out.push(`    ${a} = input.${ATTR_MEMBER[a]};`);
  if (ctx.usesVertexId) out.push("    ks_vertex_id = (int)input.vertexID;");
  out.push("}", "");

  const fw = ctx.gens.forward!;
  const vs = fw.vertex.slotExprs;
  out.push("KsVertexData KsVertexGraph()", "{");
  const core = fw.vertex.core.toString().trim();
  if (core) out.push(...core.split("\n").map((l) => `    ${l.trim() === "" ? "" : l}`));
  out.push(
    "    KsVertexData r;",
    `    r.positionOS = ${vs.positionOS ?? "a_position"};`,
    `    r.normalOS = ${vs.normalOS ?? "a_normal"};`,
  );
  out.push(
    `    r.tangentOS = ${vs.tangentOS ? `float4(${vs.tangentOS}, a_tangent.w)` : ctx.attrs.has("a_tangent") ? "a_tangent" : "float4(1.0, 0.0, 0.0, 1.0)"};`,
    "    return r;",
    "}",
    "",
  );
  for (const s of SLICES) if (ctx.gens[s]) out.push(surfaceFunction(ctx, s, ctx.gens[s]!), "");
  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}
