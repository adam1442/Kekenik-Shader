import { UNITY_TARGETS, type UnityTarget } from "./targets";

/** Surface-option inputs that remove keyword variants from the Lit / Simple Lit forward pass . All optional = full URP set. */
export interface LitKeywordPolicy {
  additionalLights?: "auto" | "off" | "vertex" | "pixel";
  receiveShadows?: boolean;
  softShadows?: boolean;
  environmentReflections?: boolean;
  /** Simple Lit samples no reflection probes. */
  simple?: boolean;
}

/**
 * Keyword pragmas of the Lit `ForwardLit` pass without fog / instancing (brief §6.3) — target-specific parts come from the `UnityTarget` object.
 * `policy` strips lines the surface options make useless; those are URP-driven global keywords, so they stay `multi_compile` (a
 * `shader_feature` would be stripped at build time when no material enables it). The user-facing option switches are plain `#define`s
 * (see `defineLines`) = zero variants.
 */
export function litKeywordPragmas(t: UnityTarget, policy: LitKeywordPolicy = {}): string[] {
  const shadows = policy.receiveShadows !== false;
  const al = policy.additionalLights ?? "auto";
  const reflect = policy.environmentReflections !== false && policy.simple !== true;
  const lines: Array<string | false> = [
    shadows && "#pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE _MAIN_LIGHT_SHADOWS_SCREEN",
    al === "auto"
      ? "#pragma multi_compile _ _ADDITIONAL_LIGHTS_VERTEX _ADDITIONAL_LIGHTS"
      : al === "vertex"
        ? "#pragma multi_compile _ _ADDITIONAL_LIGHTS_VERTEX"
        : al === "pixel" && "#pragma multi_compile _ _ADDITIONAL_LIGHTS",
    shadows && (al === "auto" || al === "pixel") && "#pragma multi_compile_fragment _ _ADDITIONAL_LIGHT_SHADOWS",
    reflect && "#pragma multi_compile_fragment _ _REFLECTION_PROBE_BLENDING",
    reflect && "#pragma multi_compile_fragment _ _REFLECTION_PROBE_BOX_PROJECTION",
    shadows &&
      policy.softShadows !== false &&
      (t.softShadowQuality
        ? "#pragma multi_compile_fragment _ _SHADOWS_SOFT _SHADOWS_SOFT_LOW _SHADOWS_SOFT_MEDIUM _SHADOWS_SOFT_HIGH"
        : "#pragma multi_compile_fragment _ _SHADOWS_SOFT"),
    "#pragma multi_compile_fragment _ _SCREEN_SPACE_OCCLUSION",
    "#pragma multi_compile_fragment _ _LIGHT_COOKIES",
    "#pragma multi_compile _ _LIGHT_LAYERS",
    `#pragma multi_compile _ ${t.forwardPlusKeyword}`,
  ];
  return lines.filter((l): l is string => typeof l === "string");
}

/** Complete pragma set of the Lit `ForwardLit` pass: keywords + `multi_compile_fog` (Fog option) + `multi_compile_instancing` (GPU Instancing). */
export const litForwardPragmas = (
  t: UnityTarget,
  instancing: boolean,
  fog = true,
  policy: LitKeywordPolicy = {},
): string[] => [
  ...litKeywordPragmas(t, policy),
  ...(fog ? ["#pragma multi_compile_fog"] : []),
  ...(instancing ? ["#pragma multi_compile_instancing"] : []),
];

/**
 * 1 (E1) — global-illumination / LOD / decal / runtime alpha-test pragmas. Copied from the URP `Lit.shader` of 2022.3, 6000.0 and
 * 6000.3 (GitHub `Unity-Technologies/Graphics`, checked when written). They are URP-owned global keywords ⇒ `multi_compile`, never `shader_feature`.
 */
export const GI_PRAGMAS: readonly string[] = [
  "#pragma multi_compile _ LIGHTMAP_SHADOW_MIXING",
  "#pragma multi_compile _ SHADOWS_SHADOWMASK",
  "#pragma multi_compile _ DIRLIGHTMAP_COMBINED",
  "#pragma multi_compile _ LIGHTMAP_ON",
];
export const LOD_FADE_PRAGMA = "#pragma multi_compile _ LOD_FADE_CROSSFADE";
export const DBUFFER_PRAGMA = "#pragma multi_compile_fragment _ _DBUFFER_MRT1 _DBUFFER_MRT2 _DBUFFER_MRT3";
/** Runtime Alpha Clip (E3): the material toggle `[Toggle(_ALPHATEST_ON)] _AlphaClip` — a LOCAL keyword, one directive in every pass. */
export const ALPHATEST_PRAGMA = "#pragma shader_feature_local_fragment _ALPHATEST_ON";

/** Switches that add pragma lines (the validator derives the required set from the same data). */
export interface LitExtraFlags {
  bakedGI?: boolean;
  decals?: boolean;
  lodCrossFade?: boolean;
}
export const litExtraPragmas = (f: LitExtraFlags): string[] => [
  ...(f.bakedGI ? GI_PRAGMAS : []),
  ...(f.decals ? [DBUFFER_PRAGMA] : []),
];

/** `Universal2D` pass pragmas (sprite profiles). */
export const SPRITE_2D_PRAGMAS: readonly string[] = [
  "#pragma multi_compile _ USE_SHAPE_LIGHT_TYPE_0",
  "#pragma multi_compile _ USE_SHAPE_LIGHT_TYPE_1",
  "#pragma multi_compile _ USE_SHAPE_LIGHT_TYPE_2",
  "#pragma multi_compile _ USE_SHAPE_LIGHT_TYPE_3",
  "#pragma multi_compile _ ETC1_EXTERNAL_ALPHA",
];

/** Pass names / LightModes per profile family (brief §6.2). */
export const PASS_SETS: Readonly<
  Record<
    string,
    ReadonlyArray<{ name: string; lightMode: string; optional?: "castShadows" | "meta" | "motionVectors" }>
  >
> = {
  unlit: [
    { name: "Unlit", lightMode: "UniversalForwardOnly" },
    { name: "ShadowCaster", lightMode: "ShadowCaster", optional: "castShadows" },
    { name: "DepthOnly", lightMode: "DepthOnly" },
    { name: "DepthNormals", lightMode: "DepthNormals" },
  ],
  lit: [
    { name: "ForwardLit", lightMode: "UniversalForwardOnly" },
    { name: "ShadowCaster", lightMode: "ShadowCaster", optional: "castShadows" },
    { name: "DepthOnly", lightMode: "DepthOnly" },
    { name: "DepthNormals", lightMode: "DepthNormals" },
    { name: "Meta", lightMode: "Meta", optional: "meta" },
    { name: "MotionVectors", lightMode: "MotionVectors", optional: "motionVectors" },
  ],
  "sprite-unlit": [
    { name: "Sprite Unlit 2D", lightMode: "Universal2D" },
    { name: "Sprite Unlit Forward", lightMode: "UniversalForward" },
  ],
  "sprite-lit": [
    { name: "Sprite Lit 2D", lightMode: "Universal2D" },
    { name: "Sprite Normals", lightMode: "NormalsRendering" },
    { name: "Sprite Unlit Forward", lightMode: "UniversalForward" },
  ],
  vfx: [{ name: "Unlit", lightMode: "UniversalForwardOnly" }],
};
export const passSetKey = (profileId: string, family: string): string =>
  family === "sprite"
    ? profileId.endsWith("lit") && !profileId.endsWith("unlit")
      ? "sprite-lit"
      : "sprite-unlit"
    : family;

/** Every keyword the generator itself emits (URP-owned). User keywords must never be `multi_compile`, so any other name on a `multi_compile*` line is an error. */
export const URP_KEYWORDS: ReadonlySet<string> = new Set(
  [
    ...UNITY_TARGETS.flatMap((t) => litKeywordPragmas(t)),
    ...SPRITE_2D_PRAGMAS,
    "#pragma multi_compile_vertex _ _CASTING_PUNCTUAL_LIGHT_SHADOW",
    "#pragma multi_compile_fragment _ _GBUFFER_NORMALS_OCT",
    ...GI_PRAGMAS,
    LOD_FADE_PRAGMA,
    DBUFFER_PRAGMA,
    "#pragma x _ALPHATEST_ON _SURFACE_TYPE_TRANSPARENT _RECEIVE_SHADOWS_OFF _SPECULARHIGHLIGHTS_OFF _ENVIRONMENTREFLECTIONS_OFF _ALPHAPREMULTIPLY_ON",
  ].flatMap((l) => l.replace(/^#pragma\s+\S+\s+/, "").split(/\s+/)),
);
