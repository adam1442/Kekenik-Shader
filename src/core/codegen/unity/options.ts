import type { ParamValue } from "../../graph/types";
import { optionValue } from "../../profiles/canonical";
import type { TargetProfile } from "../../profiles/types";
import { exposeKey } from "../../profiles/unity/options";
import {
  BLEND_FACTOR_VALUE,
  BLEND_MODES,
  BLEND_TABLE,
  type BlendMode,
  CULL_MODES,
  CULL_TEXT,
  type CullMode,
  EXPOSED_STATE_PROPS,
  QUEUE_OFFSET_RANGE,
  ZTEST_MODES,
  ZTEST_TEXT,
  type ZTestMode,
} from "./data/renderState";
import type { LitKeywordPolicy } from "./data/keywords";
import { type UnityTarget, unityTargetById } from "./data/targets";

/** Simple Lit = the mobile Blinn-Phong profile. */
export const isSimpleLit = (o: Pick<UnityOptions, "profile">): boolean => o.profile.id === "unity.urp.simple-lit";

/** Keyword-line policy of the Lit / Simple Lit forward pass for these options (single source for the emitter AND the validator). */
export const litPolicyOf = (o: UnityOptions): LitKeywordPolicy => ({
  additionalLights: o.additionalLights,
  receiveShadows: o.receiveShadows,
  softShadows: o.softShadows,
  environmentReflections: o.environmentReflections,
  simple: isSimpleLit(o),
});

export interface UnityOptions {
  profile: TargetProfile;
  target: UnityTarget;
  shaderName: string;
  shaderTarget: "3.5" | "4.5";
  instancing: boolean;
  blend: BlendMode;
  alphaClip: boolean;
  alphaToCoverage: boolean;
  cull: CullMode;
  zwrite: boolean;
  ztest: ZTestMode;
  queueOffset: number;
  castShadows: boolean;
  fog: boolean;
  receiveShadows: boolean;
  specularHighlights: boolean;
  environmentReflections: boolean;
  /** Additional-lights variant policy (O11): auto = every URP variant, else a fixed mode that removes variants. */
  additionalLights: "auto" | "off" | "vertex" | "pixel";
  softShadows: boolean;
  shPerVertex: boolean;
  doubleSided: "none" | "flip" | "mirror";
  softParticles: boolean;
  /** E3 — runtime surface options as material properties (`Blend [_SrcBlend] [_DstBlend]`, `ZWrite [_ZWrite]`, `Cull [_Cull]`, `_AlphaClip` → `_ALPHATEST_ON`). */
  exposeSurface: boolean;
  /** Clip statements exist in the shader: static Alpha Clip OR a runtime `_AlphaClip` toggle (exposeSurface on a profile that has Alpha Clip). */
  clipCode: boolean;
  /** E1 Lit extras (all false ⇒ output identical to 10d). */
  bakedGI: boolean;
  metaPass: boolean;
  motionVectors: boolean;
  lodCrossFade: boolean;
  decals: boolean;
  /** E2 VFX extras. */
  flipbook: boolean;
  cameraFade: boolean;
  distortion: boolean;
  expose: { cull: boolean; zwrite: boolean; ztest: boolean };
}

/** `Kekenik/<Name>`: `"` and `\` removed, `//` collapsed, leading/trailing `/` trimmed. */
export function sanitizeShaderName(raw: string): string {
  const s = raw
    .replace(/["\\]/g, "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\/{2,}/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .trim();
  return s || "Kekenik/Shader";
}
export const defaultShaderName = (graphName: string): string =>
  sanitizeShaderName(`Kekenik/${graphName.replace(/\//g, " ")}`);

const pick = <T extends string>(v: ParamValue, all: readonly T[], fallback: T): T =>
  typeof v === "string" && (all as readonly string[]).includes(v) ? (v as T) : fallback;

/** Resolve every Unity option from the graph settings (defaults of the profile fill the gaps). Pure. */
export function resolveUnityOptions(
  profile: TargetProfile,
  settings: Readonly<Record<string, ParamValue>>,
  graphName: string,
): UnityOptions {
  const defs = profile.surfaceOptions;
  const has = (id: string): boolean => defs.some((d) => d.id === id);
  const val = (id: string): ParamValue => optionValue(defs, settings, id);
  const family = profile.family;
  const sprite = family === "sprite";
  const blend = pick(val("blend"), BLEND_MODES, sprite || family === "vfx" ? "alpha" : "opaque");
  const alphaClip = has("alphaClip") && val("alphaClip") === true;
  const zw = has("zwrite") ? val("zwrite") : "auto";
  const q = Number(has("queueOffset") ? val("queueOffset") : 0);
  const target = unityTargetById(settings.unityVersion);
  const flag = (id: string, def: boolean): boolean => (has(id) ? val(id) === true : def);
  const exposeSurface = has("exposeSurface") && val("exposeSurface") === true;
  return {
    profile,
    target,
    shaderName: sanitizeShaderName(
      typeof settings.shaderName === "string" && settings.shaderName.trim()
        ? settings.shaderName
        : defaultShaderName(graphName),
    ),
    shaderTarget: settings.shaderTarget === "4.5" ? "4.5" : "3.5",
    instancing:
      settings.gpuInstancing === undefined ? family === "unlit" || family === "lit" : settings.gpuInstancing === true,
    blend,
    alphaClip,
    alphaToCoverage: alphaClip && flag("alphaToCoverage", false),
    cull: sprite ? "off" : pick(has("cull") ? val("cull") : "back", CULL_MODES, "back"),
    zwrite: sprite ? false : zw === "on" ? true : zw === "off" ? false : BLEND_TABLE[blend].zwrite,
    ztest: pick(has("ztest") ? val("ztest") : "lequal", ZTEST_MODES, "lequal"),
    queueOffset: Math.min(
      QUEUE_OFFSET_RANGE.max,
      Math.max(QUEUE_OFFSET_RANGE.min, Number.isFinite(q) ? Math.round(q) : 0),
    ),
    castShadows: flag("castShadows", false),
    fog: flag("fog", false),
    receiveShadows: flag("receiveShadows", true),
    specularHighlights: flag("specularHighlights", true),
    environmentReflections: flag("environmentReflections", true),
    additionalLights: pick(
      has("additionalLights") ? val("additionalLights") : "auto",
      ["auto", "off", "vertex", "pixel"] as const,
      "auto",
    ),
    softShadows: flag("softShadows", true),
    shPerVertex: flag("shPerVertex", false),
    doubleSided: pick(has("doubleSided") ? val("doubleSided") : "none", ["none", "flip", "mirror"] as const, "none"),
    softParticles: flag("softParticles", false),
    exposeSurface,
    clipCode: alphaClip || (exposeSurface && has("alphaClip")),
    bakedGI: flag("bakedGI", false),
    metaPass: flag("metaPass", false),
    motionVectors: flag("motionVectors", false) && target.motionVectors,
    lodCrossFade: flag("lodCrossFade", false),
    decals: flag("decals", false),
    flipbook: flag("flipbook", false),
    cameraFade: flag("cameraFade", false),
    distortion: flag("distortion", false),
    expose: {
      cull: exposeSurface || (has("cull") && !sprite && settings[exposeKey("cull")] === true),
      zwrite: exposeSurface || (has("zwrite") && !sprite && settings[exposeKey("zwrite")] === true),
      ztest: has("ztest") && settings[exposeKey("ztest")] === true,
    },
  };
}

/** URP `_Blend` indices (Alpha 0, Premultiply 1, Additive 2, Multiply 3); Opaque reports 0. */
const BLEND_INDEX: Record<BlendMode, number> = { opaque: 0, alpha: 0, premultiply: 1, additive: 2, multiply: 3 };
export const isOpaque = (o: UnityOptions): boolean => o.blend === "opaque";
export const renderTypeOf = (o: UnityOptions): string =>
  isOpaque(o) && o.alphaClip ? "TransparentCutout" : BLEND_TABLE[o.blend].renderType;
export function queueOf(o: UnityOptions): string {
  const base = isOpaque(o) && o.alphaClip ? "AlphaTest" : BLEND_TABLE[o.blend].queue;
  return o.queueOffset === 0 ? base : `${base}${o.queueOffset > 0 ? "+" : "-"}${Math.abs(o.queueOffset)}`;
}

/** Render-state lines of the colour pass (ShaderLab text; the table of brief §5). */
export function renderStateLines(o: UnityOptions): string[] {
  const row = BLEND_TABLE[o.blend];
  const sprite = o.profile.family === "sprite" && row.blendSprite !== undefined;
  const lines = [
    o.exposeSurface
      ? sprite
        ? "Blend [_SrcBlend] [_DstBlend], One [_DstBlend]"
        : "Blend [_SrcBlend] [_DstBlend]"
      : sprite
        ? row.blendSprite!
        : row.blend,
  ];
  lines.push(o.expose.zwrite ? "ZWrite [_ZWrite]" : `ZWrite ${o.zwrite ? "On" : "Off"}`);
  lines.push(o.expose.ztest ? "ZTest [_ZTest]" : `ZTest ${ZTEST_TEXT[o.ztest]}`);
  lines.push(o.expose.cull ? "Cull [_Cull]" : CULL_TEXT[o.cull]);
  if (o.alphaToCoverage) lines.push("AlphaToMask On");
  return lines;
}

/** ShaderLab-only material properties for "Expose in Material". */
export function exposedStateProperties(o: UnityOptions): string[] {
  const out: string[] = [];
  if (o.exposeSurface) {
    const [src, dst] = BLEND_FACTOR_VALUE[o.blend];
    // `_Surface` / `_Blend` are informational (a shader cannot switch blend modes by itself); the state is driven by the four properties below.
    out.push(
      `[HideInInspector] _Surface("__surface", Float) = ${o.blend === "opaque" ? 0 : 1}`,
      `[HideInInspector] _Blend("__blend", Float) = ${BLEND_INDEX[o.blend]}`,
      `[Enum(UnityEngine.Rendering.BlendMode)] _SrcBlend("Src Blend", Float) = ${src}`,
      `[Enum(UnityEngine.Rendering.BlendMode)] _DstBlend("Dst Blend", Float) = ${dst}`,
    );
    if (o.profile.surfaceOptions.some((d) => d.id === "alphaClip"))
      out.push(`[Toggle(_ALPHATEST_ON)] _AlphaClip("Alpha Clip", Float) = ${o.alphaClip ? 1 : 0}`);
  }
  if (o.expose.cull) out.push(EXPOSED_STATE_PROPS.cull(o.cull));
  if (o.expose.zwrite) out.push(EXPOSED_STATE_PROPS.zwrite(o.zwrite));
  if (o.expose.ztest) out.push(EXPOSED_STATE_PROPS.ztest(o.ztest));
  return out;
}

/** Parse the render state back out of generated ShaderLab (first colour pass + SubShader tags) — used by round-trip tests. */
export function parseRenderState(text: string): {
  blend?: string;
  zwrite?: string;
  ztest?: string;
  cull?: string;
  renderType?: string;
  queue?: string;
  alphaToMask: boolean;
} {
  const m = (re: RegExp): string | undefined => re.exec(text)?.[1]?.trim();
  const r: ReturnType<typeof parseRenderState> = { alphaToMask: /^\s*AlphaToMask On\s*$/m.test(text) };
  const set = <K extends keyof typeof r>(k: K, v: string | undefined): void => {
    if (v !== undefined) (r as Record<string, unknown>)[k] = v;
  };
  set("blend", m(/^\s*(Blend [^\n]+)$/m));
  set("zwrite", m(/^\s*ZWrite ([^\n]+)$/m));
  set("ztest", m(/^\s*ZTest ([^\n]+)$/m));
  set("cull", m(/^\s*Cull ([^\n]+)$/m));
  set("renderType", m(/"RenderType"="([^"]+)"/));
  set("queue", m(/"Queue"="([^"]+)"/));
  return r;
}
