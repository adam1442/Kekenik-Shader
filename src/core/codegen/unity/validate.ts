import type { Graph } from "../../graph/types";
import { optionValue } from "../../profiles/canonical";
import { targetProfiles } from "../../profiles";
import type { ProfileProblem, TargetProfile } from "../../profiles/types";
import { BUILTIN_ENTRIES } from "../../engine/builtinEntries";
import { API_PREFIXES, API_WHITELIST } from "./data/api";
import { INCLUDE_WHITELIST } from "./data/includes";
import {
  ALPHATEST_PRAGMA,
  GI_PRAGMAS,
  DBUFFER_PRAGMA,
  LOD_FADE_PRAGMA,
  type LitKeywordPolicy,
  PASS_SETS,
  SPRITE_2D_PRAGMAS,
  URP_KEYWORDS,
  litExtraPragmas,
  litForwardPragmas,
  passSetKey,
} from "./data/keywords";
import { INC } from "./data/includes";
import { UNITY_TEX_DECL_RE, UNITY_TEX_SAMPLE_RE } from "./data/textureKinds";
import { litPolicyOf, resolveUnityOptions } from "./options";
import { type UnityTarget, unityTargetById } from "./data/targets";
import { IMPLICIT_NAMES, refNameProblem } from "./refNames";
import { findBlock, findFunctionBody, parseProperties, stripComments, stripStrings } from "./validateText";

interface ValidateCtx {
  profile: TargetProfile;
  target: UnityTarget;
  castShadows: boolean;
  instancing: boolean;
  /** Fog option (defaults to on when omitted). */
  fog?: boolean;
  /** Keyword-line policy of the surface options (see `litPolicyOf`). Default: every URP variant. */
  policy?: LitKeywordPolicy;
  /** 1 switches (all absent = off). Drive the per-pass pragma completeness rule. */
  flags?: ValidateFlags;
}

interface ValidateFlags {
  bakedGI?: boolean;
  metaPass?: boolean;
  motionVectors?: boolean;
  lodCrossFade?: boolean;
  decals?: boolean;
  exposeSurface?: boolean;
  clipCode?: boolean;
}

const P = (
  rule: string,
  severity: ProfileProblem["severity"],
  message: string,
  line?: number,
  manual?: string,
): ProfileProblem => ({
  rule: `unity.${rule}`,
  severity,
  message,
  ...(line ? { line } : {}),
  ...(manual ? { manual } : {}),
});
const lineOf = (text: string, idx: number): number => text.slice(0, idx).split("\n").length;
const DENY = [
  "CGPROGRAM",
  "ENDCG",
  "UnityCG.cginc",
  "tex2D(",
  "UNITY_MATRIX_MVP",
  "_Object2World",
  "#pragma surface",
  "UnityObjectToClipPos",
];

function braces(raw: string): ProfileProblem[] {
  const t = stripStrings(stripComments(raw));
  const out: ProfileProblem[] = [];
  for (const [o, c, n] of [
    ["{", "}", "braces"],
    ["(", ")", "parentheses"],
    ["[", "]", "brackets"],
  ] as const) {
    let d = 0;
    for (const ch of t) {
      if (ch === o) d++;
      else if (ch === c && --d < 0) break;
    }
    if (d !== 0) out.push(P("braces", "error", `Unbalanced ${n}`));
  }
  const stack: string[] = [];
  t.split("\n").forEach((l, i) => {
    const s = l.trim();
    if (/^#if(n?def)?\b/.test(s)) stack.push("if");
    else if (/^#endif\b/.test(s) && !stack.pop()) out.push(P("braces", "error", "#endif without #if", i + 1));
    if (s === "HLSLPROGRAM" || s === "HLSLINCLUDE") stack.push("hlsl");
    if (s === "ENDHLSL" && stack.pop() !== "hlsl")
      out.push(P("braces", "error", "ENDHLSL without matching HLSLPROGRAM/HLSLINCLUDE or unclosed #if", i + 1));
  });
  if (stack.length)
    out.push(P("braces", "error", `Unclosed ${stack[stack.length - 1] === "if" ? "#if" : "HLSLPROGRAM/HLSLINCLUDE"}`));
  if ((t.match(/\bSubShader\b/g) ?? []).length !== 1) out.push(P("braces", "error", "Expected exactly one SubShader"));
  return out;
}

function includes(raw: string): ProfileProblem[] {
  const out: ProfileProblem[] = [];
  const ok = new Set(INCLUDE_WHITELIST.map((i) => i.path));
  for (const m of raw.matchAll(/^\s*#include\s+"([^"]*)"(?![^\n]*Custom Function \(file\))/gm))
    if (!ok.has(m[1]!))
      out.push(
        P(
          "include-whitelist",
          "error",
          `Include "${m[1]}" is not in the verified URP include list`,
          lineOf(raw, m.index!),
        ),
      );
  return out;
}

let engineApi: Set<string> | undefined;
const engineNames = (): Set<string> => {
  if (!engineApi) {
    engineApi = new Set();
    for (const e of BUILTIN_ENTRIES) {
      const u = e.targets.unity;
      if (u && u.availability !== "unsupported")
        for (const id of (u.expr + " " + (u.helper ?? "")).match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) engineApi.add(id);
    }
  }
  return engineApi;
};

function api(raw: string): ProfileProblem[] {
  const code = stripStrings(stripComments(raw));
  const defined = new Set<string>();
  for (const m of code.matchAll(/#define\s+([A-Za-z_]\w*)/g)) defined.add(m[1]!);
  for (const m of code.matchAll(/\bstruct\s+([A-Za-z_]\w*)/g)) defined.add(m[1]!);
  for (const m of code.matchAll(/(?:^|\n)\s*(?:static\s+)?[A-Za-z_][\w<>]*\s+([A-Za-z_]\w*)\s*\(/g)) defined.add(m[1]!);
  const white = new Map(API_WHITELIST.map((e) => [e.name, e]));
  const out: ProfileProblem[] = [];
  const seen = new Set<string>();
  for (const m of code.matchAll(/\b[A-Za-z_][A-Za-z0-9_]*\b/g)) {
    const id = m[0];
    if (seen.has(id) || !API_PREFIXES.some((p) => id.startsWith(p)) || defined.has(id)) continue;
    seen.add(id);
    const e = white.get(id);
    if (e) {
      if (e.status === "K")
        out.push(
          P(
            "api-whitelist",
            "warning",
            `${id} is unverified-by-doc (manual check: ${e.check})`,
            lineOf(raw, m.index!),
            e.check,
          ),
        );
      continue;
    }
    if (engineNames().has(id)) {
      out.push(
        P(
          "api-whitelist",
          "warning",
          `${id} comes from an engine-built-in template and is unverified-by-doc`,
          lineOf(raw, m.index!),
          "unverified-api",
        ),
      );
      continue;
    }
    out.push(
      P(
        "api-whitelist",
        "error",
        `${id} is not defined in the file and not in the API whitelist`,
        lineOf(raw, m.index!),
      ),
    );
  }
  return out;
}

/** ShaderLab texture property types (2D plus the E9 kinds). */
const TEXTURE_PROP_TYPES: ReadonlySet<string> = new Set(["2D", "2DArray", "3D", "Cube"]);

function cbuffer(raw: string): ProfileProblem[] {
  const out: ProfileProblem[] = [];
  const code = stripComments(raw);
  const n = (code.match(/CBUFFER_START\(/g) ?? []).length;
  if (n !== 1) out.push(P("cbuffer-once", "error", `Expected exactly one CBUFFER, found ${n}`));
  const inc = findBlock(code, "HLSLINCLUDE");
  if (n >= 1 && !(inc && inc.includes("CBUFFER_START(UnityPerMaterial)")))
    out.push(P("cbuffer-once", "error", "The UnityPerMaterial CBUFFER must live in the shared HLSLINCLUDE block"));
  const cb = /CBUFFER_START\(UnityPerMaterial\)([\s\S]*?)CBUFFER_END/.exec(code)?.[1] ?? "";
  const members = [...cb.matchAll(/\b(?:float\d?|int|half\d?)\s+([A-Za-z_]\w*)\s*;/g)].map((m) => m[1]!);
  const props = parseProperties(code);
  const names = new Set(props.map((p) => p.name));
  const tex = new Set([...code.matchAll(new RegExp(`\\b(?:${UNITY_TEX_DECL_RE})\\((\\w+)\\)`, "g"))].map((m) => m[1]!));
  const exempt = new Set([
    "_Cull",
    "_ZWrite",
    "_ZTest",
    "_Color",
    "_EnableExternalAlpha",
    "_Surface",
    "_Blend",
    "_SrcBlend",
    "_DstBlend",
    "_AlphaClip",
  ]);
  for (const m of members) {
    const base = m.endsWith("_ST") ? m.slice(0, -3) : m;
    if (!names.has(base)) out.push(P("cbuffer-props", "error", `${m} is in the CBUFFER but not in Properties`));
    if (m.endsWith("_ST") && !tex.has(base)) out.push(P("cbuffer-props", "error", `${m} has no texture ${base}`));
  }
  for (const p of props) {
    if (TEXTURE_PROP_TYPES.has(p.type)) {
      if (!tex.has(p.name) && !exempt.has(p.name))
        out.push(
          P(
            "cbuffer-props",
            "error",
            `Texture ${p.name} is in Properties but not declared with a TEXTURE macro (TEXTURE2D / TEXTURE2D_ARRAY / TEXTURE3D / TEXTURECUBE)`,
          ),
        );
      const st = members.includes(`${p.name}_ST`);
      if (tex.has(p.name) && st === p.attrs.includes("[NoScaleOffset]"))
        out.push(
          P(
            "cbuffer-props",
            "error",
            `${p.name}: _ST must be declared iff Tiling/Offset is exposed (no [NoScaleOffset])`,
          ),
        );
    }
  }
  const body = code.replace(/Properties\s*\{[\s\S]*?\n\s*\}\s*\n\s*SubShader/, "SubShader");
  for (const p of props) {
    if (
      TEXTURE_PROP_TYPES.has(p.type) ||
      exempt.has(p.name) ||
      members.includes(p.name) ||
      /\[(Toggle\(|KeywordEnum\()/.test(p.attrs)
    )
      continue; // keyword properties are ShaderLab-only
    if (new RegExp(`\\b${p.name}\\b`).test(body))
      out.push(P("cbuffer-props", "error", `${p.name} is used in HLSL but not declared in the CBUFFER`));
  }
  return out;
}

function duplicates(raw: string): ProfileProblem[] {
  const code = stripComments(raw);
  const out: ProfileProblem[] = [];
  const dup = (what: string, xs: string[]): void => {
    const s = new Set<string>();
    for (const x of xs) {
      if (s.has(x)) out.push(P("duplicates", "error", `Duplicate ${what} "${x}"`));
      s.add(x);
    }
  };
  dup(
    "property",
    parseProperties(code).map((p) => p.name),
  );
  const cb = /CBUFFER_START\(UnityPerMaterial\)([\s\S]*?)CBUFFER_END/.exec(code)?.[1] ?? "";
  dup(
    "CBUFFER member",
    [...cb.matchAll(/\b(?:float\d?|int|half\d?)\s+([A-Za-z_]\w*)\s*;/g)].map((m) => m[1]!),
  );
  dup(
    "struct",
    [...code.matchAll(/\bstruct\s+(\w+)/g)].map((m) => m[1]!),
  );
  // Overloads (e.g. the `ks_mod` helper family) are legal HLSL: the identity is name + parameter list.
  dup(
    "function",
    [
      ...code.matchAll(
        /(?:^|\n)[ \t]*(?:static\s+)?(?:float\d?x?\d?|half\d?|int|void|bool|uint|Ks\w+|\w+Out)\s+([A-Za-z_]\w*)\s*\(([^;{)]*)\)\s*(?::\s*\w+\s*)?\n?\s*\{/g,
      ),
    ].map((m) => `${m[1]!}(${m[2]!.replace(/\s+/g, " ").trim()})`),
  );
  dup(
    "pass name",
    [...code.matchAll(/^\s*Name\s+"([^"]*)"/gm)].map((m) => m[1]!),
  );
  return out;
}

function passSet(raw: string, c: ValidateCtx): ProfileProblem[] {
  const out: ProfileProblem[] = [];
  const want = PASS_SETS[passSetKey(c.profile.id, c.profile.family)] ?? [];
  const have = [...raw.matchAll(/Name\s+"([^"]*)"\s*\n\s*Tags\s*\{\s*"LightMode"\s*=\s*"([^"]*)"/g)].map(
    (m) => `${m[1]}|${m[2]}`,
  );
  const on = (o: string | undefined): boolean =>
    o === undefined ||
    (o === "castShadows" ? c.castShadows : o === "meta" ? c.flags?.metaPass === true : c.flags?.motionVectors === true);
  for (const w of want) {
    const present = have.includes(`${w.name}|${w.lightMode}`);
    if (!on(w.optional)) {
      if (present) out.push(P("pass-set", "error", `${w.name} pass present although its option is off`));
      continue;
    }
    if (!present) out.push(P("pass-set", "error", `Missing pass ${w.name} (LightMode ${w.lightMode})`));
  }
  if (have.length !== want.filter((w) => on(w.optional)).length)
    out.push(P("pass-set", "error", `Unexpected pass count ${have.length}`));
  return out;
}

function pragmas(raw: string, c: ValidateCtx): ProfileProblem[] {
  const out: ProfileProblem[] = [];
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("#pragma"));
  let local = 0;
  for (const l of lines) {
    const [, kind, ...rest] = l.split(/\s+/);
    if (
      !kind ||
      !/^(target|vertex|fragment|multi_compile(_fog|_fragment|_vertex|_instancing)?|shader_feature_local(_fragment|_vertex)?)$/.test(
        kind,
      )
    ) {
      out.push(P("pragmas", "error", `Unknown pragma form: ${l}`));
      continue;
    }
    if (kind === "target" && !/^(3\.5|4\.5)$/.test(rest[0] ?? ""))
      out.push(P("pragmas", "error", `Unsupported shader target: ${l}`));
    if (/^(multi_compile|shader_feature)/.test(kind) && !/_fog$|_instancing$/.test(kind))
      for (const k of rest) {
        if (k.length > 63 || !/^[A-Z0-9_]+$/.test(k))
          out.push(P("pragmas", "error", `Invalid keyword name "${k}" (≤63 chars, [A-Z0-9_])`));
        if (kind.startsWith("shader_feature_local")) local++;
      }
    if (/^multi_compile(_fragment|_vertex)?$/.test(kind))
      for (const k of rest)
        if (k !== "_" && !URP_KEYWORDS.has(k))
          out.push(
            P("pragmas", "error", `User keyword "${k}" must use shader_feature_local, never multi_compile: ${l}`),
          );
  }
  if (local > 64) out.push(P("pragmas", "error", `More than 64 local keywords (${local})`));
  if (c.profile.family === "lit") {
    for (const need of [
      ...litForwardPragmas(c.target, c.instancing, c.fog !== false, c.policy),
      ...litExtraPragmas(c.flags ?? {}),
    ])
      if (!lines.includes(need))
        out.push(P("pragmas", "error", `Lit ForwardLit pass lacks "${need}" for Unity ${c.target.unity}`));
    const other = c.target.forwardPlusKeyword === "_FORWARD_PLUS" ? "_CLUSTER_LIGHT_LOOP" : "_FORWARD_PLUS";
    if (raw.includes(other)) out.push(P("pragmas", "error", `${other} must not appear for Unity ${c.target.unity}`));
    if (!c.target.softShadowQuality && raw.includes("_SHADOWS_SOFT_LOW"))
      out.push(P("pragmas", "error", "_SHADOWS_SOFT_LOW must not appear for Unity 2022.3"));
  }
  return out;
}

/** Per-pass pragma completeness : instancing, LOD cross-fade, runtime alpha-test, GI / decals / Meta / MotionVectors. */
function passBlocks(raw: string): Array<{ name: string; text: string }> {
  return raw
    .split(/^\s*Pass\s*$/m)
    .slice(1)
    .map((t) => ({ name: /Name\s+"([^"]*)"/.exec(t)?.[1] ?? "?", text: t }));
}
function passPragmas(raw: string, c: ValidateCtx): ProfileProblem[] {
  const out: ProfileProblem[] = [];
  const f = c.flags ?? {};
  const code = stripComments(raw);
  const blocks = passBlocks(code);
  for (const b of blocks) {
    const lines = b.text.split("\n").map((l) => l.trim());
    const has = (l: string): boolean => lines.includes(l);
    const need = (cond: boolean, line: string, why: string): void => {
      if (cond && !has(line)) out.push(P("pass-pragmas", "error", `Pass ${b.name} lacks "${line}" (${why})`));
      if (!cond && has(line))
        out.push(P("pass-pragmas", "error", `Pass ${b.name} has "${line}" although ${why} is off`));
    };
    need(c.instancing, "#pragma multi_compile_instancing", "GPU Instancing");
    need(f.lodCrossFade === true, LOD_FADE_PRAGMA, "LOD cross-fade");
    need(f.exposeSurface === true && f.clipCode === true, ALPHATEST_PRAGMA, "runtime Alpha Clip");
    if (b.name === "ForwardLit") {
      for (const g of GI_PRAGMAS) need(f.bakedGI === true, g, "Baked GI");
      need(f.decals === true, DBUFFER_PRAGMA, "DBuffer decals");
    } else
      for (const g of [...GI_PRAGMAS, DBUFFER_PRAGMA])
        if (has(g)) out.push(P("pass-pragmas", "error", `Pass ${b.name} must not carry ${g} (only ForwardLit does)`));
    if (b.name === "Meta" && !has("Cull Off")) out.push(P("pass-pragmas", "error", "Meta pass must use Cull Off"));
    if (b.name === "MotionVectors" && !has("ColorMask RG"))
      out.push(P("pass-pragmas", "error", "MotionVectors pass must use ColorMask RG"));
  }
  const inc = (path: string): boolean => code.includes(`#include "${path}"`);
  if (f.metaPass && !inc(INC.meta)) out.push(P("pass-pragmas", "error", "Meta pass needs MetaInput.hlsl"));
  if (f.motionVectors && !inc(INC.motion))
    out.push(P("pass-pragmas", "error", "MotionVectors pass needs MotionVectorsCommon.hlsl"));
  if (f.decals && !inc(INC.dbuffer)) out.push(P("pass-pragmas", "error", "DBuffer decals need DBuffer.hlsl"));
  if (!f.exposeSurface && /\[_(Src|Dst)Blend\]|\[_AlphaClip\]/.test(code))
    out.push(P("pass-pragmas", "error", "_SrcBlend/_DstBlend used although Expose surface options is off"));
  if (f.exposeSurface) {
    const AUX = ["ShadowCaster", "DepthOnly", "DepthNormals", "MotionVectors"];
    for (const b of blocks) {
      if (b.name === "Meta") continue;
      for (const need of AUX.includes(b.name)
        ? ["Cull [_Cull]"]
        : ["Blend [_SrcBlend] [_DstBlend]", "ZWrite [_ZWrite]", "Cull [_Cull]"])
        if (!b.text.includes(need))
          out.push(P("pass-pragmas", "error", `Expose surface options is on but pass ${b.name} lacks "${need}"`));
    }
  }
  return out;
}

function defineOrder(raw: string): ProfileProblem[] {
  const code = stripComments(raw);
  const inc = code.search(/^\s*#include\b/m);
  const out: ProfileProblem[] = [];
  for (const m of code.matchAll(
    /^\s*#define\s+(_SURFACE_TYPE_TRANSPARENT|_RECEIVE_SHADOWS_OFF|_SPECULARHIGHLIGHTS_OFF|_SPECULAR_COLOR|_ENVIRONMENTREFLECTIONS_OFF|_ALPHAPREMULTIPLY_ON)\b/gm,
  ))
    if (inc >= 0 && m.index! > inc)
      out.push(P("define-order", "error", `#define ${m[1]} must precede the first #include`, lineOf(code, m.index!)));
  return out;
}

function shaderlab(raw: string): ProfileProblem[] {
  const code = stripComments(raw);
  const out: ProfileProblem[] = [];
  if (!/^\s*Shader\s+"[^"\\]+"\s*\n\s*\{/m.test(code)) out.push(P("shaderlab", "error", 'Missing `Shader "name" {`'));
  for (const kw of ["Properties", "SubShader", "Fallback"])
    if (!new RegExp(`\\b${kw}\\b`).test(code)) out.push(P("shaderlab", "error", `Missing ${kw}`));
  if (!/Tags\s*\{[^}]*"RenderPipeline"="UniversalPipeline"/.test(code))
    out.push(P("shaderlab", "error", "SubShader Tags must contain RenderPipeline=UniversalPipeline"));
  for (const p of parseProperties(code))
    if (!p.valid) out.push(P("shaderlab", "error", `Invalid property line: ${p.raw.trim()}`));
  return out;
}

function sprite(raw: string, c: ValidateCtx): ProfileProblem[] {
  if (c.profile.family !== "sprite") return [];
  const out: ProfileProblem[] = [];
  if (!parseProperties(stripComments(raw)).some((p) => p.name === "_MainTex"))
    out.push(P("sprite", "error", "Sprite profiles need the _MainTex property"));
  const lines = raw.split("\n").map((l) => l.trim());
  for (const need of SPRITE_2D_PRAGMAS)
    if (!lines.includes(need)) out.push(P("sprite", "error", `Universal2D pass lacks "${need}"`));
  return out;
}

function vertexLod(raw: string): ProfileProblem[] {
  const code = stripComments(raw);
  const out: ProfileProblem[] = [];
  const names = ["KsVertexGraph", ...[...code.matchAll(/\b(\w+_vs)\s*\(/g)].map((m) => m[1]!)];
  for (const n of new Set(names)) {
    const body = findFunctionBody(code, n);
    if (body && new RegExp(`\\b(?:${UNITY_TEX_SAMPLE_RE})\\s*\\(`).test(body))
      out.push(
        P(
          "vertex-lod",
          "error",
          `${n} samples a texture without an explicit LOD (use the _LOD macro, e.g. SAMPLE_TEXTURE2D_LOD, in the vertex stage)`,
        ),
      );
  }
  return out;
}

function denylist(raw: string): ProfileProblem[] {
  const code = stripStrings(stripComments(raw));
  const out: ProfileProblem[] = [];
  for (const d of DENY)
    if (code.includes(d)) out.push(P("denylist", "error", `Built-in-RP leftover: ${d}`, lineOf(code, code.indexOf(d))));
  if (/\bfixed\d?\b/.test(code)) out.push(P("denylist", "error", "Built-in-RP leftover: fixed"));
  return out;
}

function refs(raw: string, c: ValidateCtx): ProfileProblem[] {
  const out: ProfileProblem[] = [];
  const seen = new Set<string>();
  const sprite = c.profile.family === "sprite";
  for (const p of parseProperties(stripComments(raw))) {
    if (seen.has(p.name)) out.push(P("ref-collision", "error", `Reference ${p.name} is declared twice`));
    seen.add(p.name);
    const implicit = IMPLICIT_NAMES.includes(p.name) || (sprite && p.name === "_MainTex");
    const bad = implicit ? undefined : refNameProblem(p.name, sprite);
    if (bad) out.push(P("ref-collision", "error", `Reference ${p.name} ${bad}`));
  }
  return out;
}

/** All Unity static validators over generated text. Pure. */
function validateUnity(text: string, c: ValidateCtx): ProfileProblem[] {
  return [
    ...braces(text),
    ...includes(text),
    ...api(text),
    ...cbuffer(text),
    ...duplicates(text),
    ...passSet(text, c),
    ...pragmas(text, c),
    ...passPragmas(text, c),
    ...defineOrder(text),
    ...shaderlab(text),
    ...sprite(text, c),
    ...vertexLod(text),
    ...denylist(text),
    ...refs(text, c),
  ];
}

export function validateUnityText(text: string, graph: Graph): ProfileProblem[] {
  const profile = targetProfiles.get(graph.profileId);
  if (!profile) return [];
  const gpu = graph.settings.gpuInstancing;
  const ro = resolveUnityOptions(profile, graph.settings, graph.name);
  return validateUnity(text, {
    profile,
    target: unityTargetById(graph.settings.unityVersion),
    flags: {
      bakedGI: ro.bakedGI,
      metaPass: ro.metaPass,
      motionVectors: ro.motionVectors,
      lodCrossFade: ro.lodCrossFade,
      decals: ro.decals,
      exposeSurface: ro.exposeSurface,
      clipCode: ro.clipCode,
    },
    castShadows:
      optionValue(profile.surfaceOptions, graph.settings, "castShadows") === true &&
      profile.surfaceOptions.some((o) => o.id === "castShadows"),
    instancing: gpu === undefined ? profile.family === "unlit" || profile.family === "lit" : gpu === true,
    fog: profile.surfaceOptions.some((o) => o.id === "fog")
      ? optionValue(profile.surfaceOptions, graph.settings, "fog") === true
      : false,
    policy: litPolicyOf(ro),
  });
}
