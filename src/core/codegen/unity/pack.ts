import { BACKEND_TRAITS } from "../../ir/traits";
import { BUILTIN_ENTRIES } from "../../engine/builtinEntries";
import { fillEngineTemplate } from "../../engine/template";
import type { IRExpr } from "../../ir/types";
import { isTextureType, type StorageType } from "../../types/shaderType";
import { HLSL_HELPERS, hlslSyntax } from "../hlsl/backend";
import { hlslDialect, hlslType } from "../hlsl/dialect";
import { cStyleWriteFunction } from "../dialect/cstyle";
import { type ExplicitUniform, type LangPack } from "../dialect/generate";
import type { InputSyntax } from "../dialect/inputs";
import { plain } from "../dialect/ops";
import {
  DEFAULT_DIALECT_OPTIONS,
  type Dialect,
  type RenderApi,
  type Text,
  UnsupportedError,
  samplerOf,
} from "../dialect/types";
import { UNITY_TEX_MACROS } from "./data/textureKinds";
import { UNITY_UNIFORM } from "./data/uniforms";
import { unityUniformRead } from "./properties";

/** State shared between the pack (while generating) and the assembler (afterwards). */
export interface UnityPackState {
  /** property id → final Unity reference name. */
  names: ReadonlyMap<string, string>;
  /** Final reference names of the material `Texture2D` properties: their sampler is `sampler<Name>` (E4: structured, no text post-process). */
  textureProps: Set<string>;
  /** Texture uniform names that expose Tiling/Offset (`_N_ST`). */
  stNames: Set<string>;
  /** Unity template identifiers used through `engine` ops (registered as unverified API names). */
  engineTemplates: Set<string>;
  engineHelpers: Set<string>;
  missingUniforms: Set<string>;
  /** Keyword IR uniform id (`kw:<id>`) → HLSL macro that holds its active value (see `emit/keywords.ts`). */
  keywordMacros: Map<string, string>;
}

export const newPackState = (names: ReadonlyMap<string, string>): UnityPackState => ({
  names,
  textureProps: new Set(),
  stNames: new Set(),
  engineTemplates: new Set(),
  engineHelpers: new Set(),
  missingUniforms: new Set(),
  keywordMacros: new Map(),
});

/** Unity dialect = the HLSL dialect with Unity texture macros; everything else (math, control flow, functions) is reused. */
function makeUnityDialect(st: UnityPackState): Dialect {
  return {
    ...hlslDialect,
    traits: BACKEND_TRAITS.unity,
    // E4: texture + sampler pairs use URP's portable macros; material textures pair with `sampler<Name>` (Unity binds it to the texture's import settings).
    samplerName: (tex) => (st.textureProps.has(tex) ? `sampler${tex}` : samplerOf(tex)),
    textureArgs: (tex, samp, ty) => [
      `${UNITY_TEX_MACROS[ty && isTextureType(ty) ? ty : "texture2D"].args}(${tex}, ${samp})`,
    ],
    writeFunction: cStyleWriteFunction(hlslType, (p) =>
      isTextureType(p.ty)
        ? `${UNITY_TEX_MACROS[p.ty].param}(${p.name}, ${samplerOf(p.name)})`
        : `${hlslType(p.ty)} ${p.name}`,
    ),
    // URP: `half` maps to min16float on mobile GPUs and to float on desktop GPUs (Unity docs), so it is the idiomatic spelling.
    halfType: (ty) =>
      ty === "float" ? "half" : ty === "vec2" ? "half2" : ty === "vec3" ? "half3" : ty === "vec4" ? "half4" : undefined,
    render(e: IRExpr, api: RenderApi): Text {
      if (e.op === "sample") {
        const tex = api.use(e.tex);
        const samp =
          e.samp !== undefined ? api.bare(e.samp) : st.textureProps.has(tex) ? `sampler${tex}` : samplerOf(tex);
        const kind = api.ty(e.tex);
        const m = UNITY_TEX_MACROS[isTextureType(kind) ? kind : "texture2D"];
        let uv = api.bare(e.uv);
        if (st.stNames.has(tex)) uv = `(${uv}) * ${tex}_ST.xy + ${tex}_ST.zw`;
        // Array textures take (uv, layer) as separate macro arguments.
        const coord = kind === "texture2DArray" ? `${api.use(e.uv)}.xy, ${api.use(e.uv)}.z` : uv;
        if (e.mode === "implicit") return plain(`${m.sample}(${tex}, ${samp}, ${coord})`);
        if (e.mode === "lod") return plain(`${m.sampleLod}(${tex}, ${samp}, ${coord}, ${api.bare(e.lod!)})`);
        throw new UnsupportedError("Gradient texture sampling (SampleGrad) is not part of the verified Unity API set");
      }
      return hlslDialect.render(e, api);
    },
  };
}

const syntax = (st: UnityPackState): InputSyntax => ({
  ...hlslSyntax(DEFAULT_DIALECT_OPTIONS),
  uni: (u) => {
    const t = UNITY_UNIFORM[u];
    if (t === undefined) {
      st.missingUniforms.add(u);
      return "0.0";
    }
    return t;
  },
  // E1: `KS_INSTANCE_ID` is declared by the include block when used (`unity_InstanceID` in instancing variants, 0 otherwise).
  instanceId: "KS_INSTANCE_ID",
});

/** Identifiers of a Unity template (for the unverified-API list). */
const identifiersOf = (code: string): string[] => [...new Set(code.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [])];

function engineFor(st: UnityPackState) {
  return (name: string, args?: readonly string[]): string | undefined => {
    const entry = BUILTIN_ENTRIES.find((e) => e.id === name);
    const u = entry?.targets.unity;
    if (!entry || !u || u.availability === "unsupported") return undefined;
    // Intrinsics with arguments (`ks.screen.sceneDepthRaw(uv)`, additional lights, …) need exactly as many argument texts as the template has.
    if (entry.args.length > 0 && (args?.length ?? 0) < entry.args.length) return undefined;
    for (const id of identifiersOf(u.expr)) st.engineTemplates.add(id);
    if (u.helper) st.engineHelpers.add(u.helper);
    return fillEngineTemplate(u.expr, args);
  };
}

export function makeUnityPack(st: UnityPackState): LangPack {
  return {
    dialect: makeUnityDialect(st),
    traits: BACKEND_TRAITS.unity,
    target: "unity",
    syntax: () => syntax(st),
    helpers: HLSL_HELPERS,
    reserved: [
      "ks_vertex_id",
      "ks_instance_id",
      "ks_front_facing",
      "KsAttributes",
      "KsVertexData",
      "KsSurface",
      "KsVertexGraph",
      "KsLoadAttributes",
      "input",
      "output",
      "main",
    ],
    uniformName: (id) => st.names.get(id) ?? st.keywordMacros.get(id),
    uniformExpr: (u: ExplicitUniform) => {
      const macro = st.keywordMacros.get(u.prop);
      return macro !== undefined && u.property.type === "bool"
        ? `(${macro} != 0)`
        : unityUniformRead(u.ty as StorageType, u.name);
    },
    engine: (name, _syntax, args) => engineFor(st)(name, args),
  };
}
export { hlslType };
