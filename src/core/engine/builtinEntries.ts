import type { BuiltinEntry, TargetImpl } from "./builtinMap";
import { LIGHT_STAGE_ENTRIES } from "./lightStageEntries";

/**
 * Data of the engine built-in mapping (see builtinMap.ts for the schema and `docs/SCENE_NODES.md` for the human table).
 * Spellings marked `verify: true` are the best knowledge of the API (URP / Godot 4 documentation) but have NOT been compiled
 * in an engine from this sandbox — the exporter and the manual Unity / Godot checklist confirm them.
 */
const S = (expr: string, o: Partial<TargetImpl> = {}): TargetImpl => ({ availability: "supported", expr, ...o });
const A = (expr: string, note: string, o: Partial<TargetImpl> = {}): TargetImpl => ({
  availability: "approximate",
  expr,
  note,
  ...o,
});
const X = (reason: string): TargetImpl => ({ availability: "unsupported", expr: "", reason });
const V = { verify: true } as const;

/** Host-frame uniform of the portable targets: GLSL / HLSL global `ks_*`, WGSL member of the `ks` frame block. */
const host = (
  glsl: string,
  wgslMember: string,
  o: Partial<TargetImpl> = {},
): Pick<BuiltinEntry["targets"], "glslPreview" | "wgsl" | "hlsl"> => ({
  glslPreview: S(glsl, o),
  wgsl: S(`ks.${wgslMember}`, o),
  hlsl: S(glsl, o),
});
const hostMat = (g: string, w: string, h: string): Pick<BuiltinEntry["targets"], "glslPreview" | "wgsl" | "hlsl"> => ({
  glslPreview: S(g),
  wgsl: S(w),
  hlsl: S(h),
});

const NO3D =
  "canvas_item is a 2D shader type: it has no 3D camera / projection (use CANVAS_MATRIX / SCREEN_MATRIX for 2D transforms).";
const NO_FRAG_LIGHT =
  "Godot exposes lights only inside light(); fragment() cannot read them — pass the value as a shader parameter.";
const NO_PORTABLE =
  "Engine-pipeline data: the portable targets have no such resource — use a property / texture you provide.";
const ENG = (u: string, g: string): { unity: TargetImpl; godotSpatial: TargetImpl; godotCanvas: TargetImpl } => ({
  unity: S(u, V),
  godotSpatial: S(g, V),
  godotCanvas: X("Not available in canvas_item."),
});
const GODOT_CAMERA_HELPER =
  "// Godot helper functions cannot read built-ins (INV_PROJECTION_MATRIX / PROJECTION_MATRIX exist only in vertex()/fragment()/light()):\n// the processor function passes them as arguments (see core/ir/lowerEngine.ts).\nvec4 ks_camera_params(mat4 inv_proj, mat4 proj) {\n  vec4 a = inv_proj * vec4(0.0, 0.0, 1.0, 1.0);\n  vec4 b = inv_proj * vec4(0.0, 0.0, 0.0, 1.0);\n  float n = -a.z / a.w;\n  float f = -b.z / b.w;\n  float ortho = step(0.5, proj[3][3]);\n  return vec4(min(n, f), max(n, f), ortho, ortho / max(abs(proj[1][1]), 1e-6));\n}";
/** Godot depth_texture helper: the Compatibility renderer stores standard-Z (0 = near), Forward+ / Mobile reversed-Z. [verify] */
const GODOT_SCENE_DEPTH_HELPER =
  "float ks_scene_depth(vec2 uv) {\n  float d = texture(depth_texture, uv).r;\n#if CURRENT_RENDERER == RENDERER_COMPATIBILITY\n  // Compatibility renderer: window-space standard-Z (0 = near). NOT converted — see docs/EXPORT_TARGETS.md.\n  return d;\n#else\n  return d;\n#endif\n}";
const portableNone = (): Pick<BuiltinEntry["targets"], "glslPreview" | "wgsl" | "hlsl"> => ({
  glslPreview: X(NO_PORTABLE),
  wgsl: X(NO_PORTABLE),
  hlsl: X(NO_PORTABLE),
});

export const BUILTIN_ENTRIES: BuiltinEntry[] = [
  /* ── matrices ──────────────────────────────────────────────────────────────────────────────────────────── */
  {
    id: "ks.matrix.objectToWorld",
    kind: "engine",
    ty: "mat4",
    args: [],
    doc: "Object → world matrix.",
    stage: "any",
    requires: [],
    targets: {
      ...hostMat("ks_Model", "ks.model", "ks_Model"),
      unity: S("UNITY_MATRIX_M"),
      godotSpatial: S("MODEL_MATRIX"),
      godotCanvas: A("MODEL_MATRIX", "canvas_item: only the vertex() function sees MODEL_MATRIX.", V),
    },
  },
  {
    id: "ks.matrix.worldToObject",
    kind: "engine",
    ty: "mat4",
    args: [],
    doc: "World → object matrix (inverse of the model matrix).",
    stage: "any",
    requires: [],
    targets: {
      ...hostMat("ks_WorldToObject", "ks.world_to_object", "ks_WorldToObject"),
      unity: S("UNITY_MATRIX_I_M"),
      godotSpatial: S("inverse(MODEL_MATRIX)", { note: "inverse() per use; cache it if used often." }),
      godotCanvas: X(NO3D),
    },
  },
  {
    id: "ks.matrix.worldToView",
    kind: "engine",
    ty: "mat4",
    args: [],
    doc: "World → view matrix.",
    stage: "any",
    requires: [],
    targets: {
      ...hostMat("ks_View", "ks.view", "ks_View"),
      unity: S("UNITY_MATRIX_V"),
      godotSpatial: S("VIEW_MATRIX"),
      godotCanvas: X(NO3D),
    },
  },
  {
    id: "ks.matrix.viewToWorld",
    kind: "engine",
    ty: "mat4",
    args: [],
    doc: "View → world matrix (the camera's transform).",
    stage: "any",
    requires: [],
    targets: {
      ...hostMat("ks_ViewInverse", "ks.view_inverse", "ks_ViewInverse"),
      unity: S("UNITY_MATRIX_I_V"),
      godotSpatial: S("INV_VIEW_MATRIX"),
      godotCanvas: X(NO3D),
    },
  },
  {
    id: "ks.matrix.viewToClip",
    kind: "engine",
    ty: "mat4",
    args: [],
    doc: "View → clip (projection) matrix.",
    stage: "any",
    requires: [],
    targets: {
      ...hostMat("ks_Projection", "ks.projection", "ks_Projection"),
      unity: S("UNITY_MATRIX_P", {
        note: "In URP use GetViewToHClipMatrix() when the camera is flipped for a render texture.",
      }),
      godotSpatial: S("PROJECTION_MATRIX"),
      godotCanvas: X(NO3D),
    },
  },
  {
    id: "ks.matrix.clipToView",
    kind: "engine",
    ty: "mat4",
    args: [],
    doc: "Clip → view matrix (inverse projection).",
    stage: "any",
    requires: [],
    targets: {
      ...hostMat("ks_ProjectionInverse", "ks.projection_inverse", "ks_ProjectionInverse"),
      unity: S("UNITY_MATRIX_I_P", V),
      godotSpatial: S("INV_PROJECTION_MATRIX"),
      godotCanvas: X(NO3D),
    },
  },
  {
    id: "ks.matrix.worldToClip",
    kind: "engine",
    ty: "mat4",
    args: [],
    doc: "World → clip (view-projection) matrix.",
    stage: "any",
    requires: [],
    targets: {
      ...hostMat("(ks_Projection * ks_View)", "(ks.projection * ks.view)", "mul(ks_Projection, ks_View)"),
      unity: S("UNITY_MATRIX_VP"),
      godotSpatial: S("(PROJECTION_MATRIX * VIEW_MATRIX)"),
      godotCanvas: X(NO3D),
    },
  },
  {
    id: "ks.matrix.clipToWorld",
    kind: "engine",
    ty: "mat4",
    args: [],
    doc: "Clip → world matrix (inverse view-projection).",
    stage: "any",
    requires: [],
    targets: {
      ...hostMat(
        "(ks_ViewInverse * ks_ProjectionInverse)",
        "(ks.view_inverse * ks.projection_inverse)",
        "mul(ks_ViewInverse, ks_ProjectionInverse)",
      ),
      unity: S("UNITY_MATRIX_I_VP", V),
      godotSpatial: S("(INV_VIEW_MATRIX * INV_PROJECTION_MATRIX)"),
      godotCanvas: X(NO3D),
    },
  },
  {
    id: "ks.matrix.objectToClip",
    kind: "engine",
    ty: "mat4",
    args: [],
    doc: "Object → clip (MVP) matrix.",
    stage: "any",
    requires: [],
    targets: {
      ...hostMat(
        "(ks_Projection * (ks_View * ks_Model))",
        "(ks.projection * (ks.view * ks.model))",
        "mul(ks_Projection, mul(ks_View, ks_Model))",
      ),
      unity: S("mul(UNITY_MATRIX_VP, UNITY_MATRIX_M)", { note: "UNITY_MATRIX_MVP is deprecated in SRP shaders." }),
      godotSpatial: S("(PROJECTION_MATRIX * VIEW_MATRIX * MODEL_MATRIX)"),
      godotCanvas: X(NO3D),
    },
  },
  {
    id: "ks.matrix.clipToObject",
    kind: "engine",
    ty: "mat4",
    args: [],
    doc: "Clip → object matrix (inverse MVP).",
    stage: "any",
    requires: [],
    targets: {
      ...hostMat(
        "(ks_WorldToObject * (ks_ViewInverse * ks_ProjectionInverse))",
        "(ks.world_to_object * (ks.view_inverse * ks.projection_inverse))",
        "mul(ks_WorldToObject, mul(ks_ViewInverse, ks_ProjectionInverse))",
      ),
      unity: S("mul(UNITY_MATRIX_I_M, UNITY_MATRIX_I_VP)", V),
      godotSpatial: S("(inverse(MODEL_MATRIX) * (INV_VIEW_MATRIX * INV_PROJECTION_MATRIX))"),
      godotCanvas: X(NO3D),
    },
  },
  {
    id: "ks.matrix.normalObjectToWorld",
    kind: "engine",
    ty: "mat3",
    args: [],
    doc: "Object → world normal matrix (inverse-transpose of the model matrix).",
    stage: "any",
    requires: [],
    targets: {
      ...hostMat("ks_NormalMatrix", "ks.normal_matrix", "ks_NormalMatrix"),
      unity: S("transpose((float3x3)UNITY_MATRIX_I_M)", {
        note: "Same as TransformObjectToWorldNormal() without the normalisation.",
      }),
      godotSpatial: S("mat3(MODEL_NORMAL_MATRIX)", V),
      godotCanvas: X(NO3D),
    },
  },
  {
    id: "ks.matrix.normalWorldToObject",
    kind: "engine",
    ty: "mat3",
    args: [],
    doc: "World → object normal matrix.",
    stage: "any",
    requires: [],
    targets: {
      ...hostMat(
        "transpose(mat3(ks_Model))",
        "transpose(mat3x3<f32>(ks.model[0].xyz, ks.model[1].xyz, ks.model[2].xyz))",
        "transpose((float3x3)ks_Model)",
      ),
      unity: S("transpose((float3x3)UNITY_MATRIX_M)"),
      godotSpatial: S("transpose(mat3(MODEL_MATRIX))"),
      godotCanvas: X(NO3D),
    },
  },

  /* ── camera / screen ───────────────────────────────────────────────────────────────────────────────────── */
  {
    id: "ks.camera.params",
    kind: "engine",
    ty: "vec4",
    args: [],
    doc: "Camera (near, far, isOrthographic 0|1, orthographic half-height in world units).",
    stage: "any",
    requires: [],
    targets: {
      ...host("ks_CameraParams", "camera_params"),
      unity: S("float4(_ProjectionParams.y, _ProjectionParams.z, unity_OrthoParams.w, unity_OrthoParams.y)", {
        verify: true,
        note: "unity_OrthoParams = (orthoSize·aspect, orthoSize, 0, isOrtho): y is the half-height. Confirm in the Frame Debugger.",
      }),
      godotSpatial: A(
        "ks_camera_params(INV_PROJECTION_MATRIX, PROJECTION_MATRIX)",
        "Godot has no near / far / ortho built-ins: the helper unprojects the depth planes with INV_PROJECTION_MATRIX and detects ortho from PROJECTION_MATRIX[3][3].",
        { verify: true, helper: GODOT_CAMERA_HELPER },
      ),
      godotCanvas: X(NO3D),
    },
  },
  {
    id: "ks.screen.params",
    kind: "engine",
    ty: "vec4",
    args: [],
    doc: "Render target (width, height, 1/width, 1/height) in pixels.",
    stage: "any",
    requires: [],
    targets: {
      ...host("ks_ScreenParams", "screen_params"),
      unity: S("float4(_ScreenParams.xy, 1.0 / _ScreenParams.xy)", {
        note: "_ScreenParams.zw is 1 + 1/size, hence the explicit reciprocal.",
      }),
      godotSpatial: S("vec4(VIEWPORT_SIZE, 1.0 / VIEWPORT_SIZE)"),
      godotCanvas: A(
        "vec4(1.0 / SCREEN_PIXEL_SIZE, SCREEN_PIXEL_SIZE)",
        "SCREEN_PIXEL_SIZE is the size of one screen pixel in UV units.",
        V,
      ),
    },
  },

  /* ── fog / lighting info ───────────────────────────────────────────────────────────────────────────────── */
  {
    id: "ks.fog.color",
    kind: "engine",
    ty: "vec4",
    args: [],
    doc: "Fog colour (rgb, linear).",
    stage: "any",
    requires: ["URP: Lighting ▸ Fog enabled"],
    targets: {
      ...host("ks_FogColor", "fog_color"),
      unity: S("unity_FogColor", {
        note: "Needs Lighting ▸ Environment ▸ Fog (the colour is set per camera / scene).",
      }),
      godotSpatial: X(
        "Godot applies Environment fog automatically after fragment(); its colour is not readable (use `render_mode fog_disabled` + a shader parameter).",
      ),
      godotCanvas: X("Godot has no fog in canvas_item."),
    },
  },
  {
    id: "ks.fog.params",
    kind: "engine",
    ty: "vec4",
    args: [],
    doc: "Fog (density, start, end, mode: 0 off | 1 linear | 2 exp | 3 exp2).",
    stage: "any",
    requires: ["URP: Lighting ▸ Fog enabled", "#pragma multi_compile_fog"],
    targets: {
      ...host("ks_FogParams", "fog_params"),
      unity: A(
        "float4(unity_FogParams.y * 0.693147, (1.0 - unity_FogParams.w) / unity_FogParams.z, -unity_FogParams.w / unity_FogParams.z, KS_FOG_MODE)",
        "Reconstructed from unity_FogParams (x = d/√ln2, y = d/ln2, z = −1/(end−start), w = end/(end−start)); the mode comes from the FOG_LINEAR / FOG_EXP / FOG_EXP2 keywords. Linear start / end are exact only in linear mode.",
        {
          verify: true,
          helper:
            "#if defined(FOG_LINEAR)\n#define KS_FOG_MODE 1.0\n#elif defined(FOG_EXP)\n#define KS_FOG_MODE 2.0\n#elif defined(FOG_EXP2)\n#define KS_FOG_MODE 3.0\n#else\n#define KS_FOG_MODE 0.0\n#endif",
        },
      ),
      godotSpatial: X(
        "Fog parameters are not readable in Godot shaders (fog is applied by the engine); pass them as parameters.",
      ),
      godotCanvas: X("Godot has no fog in canvas_item."),
    },
  },
  {
    id: "ks.light.mainDirection",
    kind: "engine",
    ty: "vec3",
    args: [],
    doc: "Unit world-space direction towards the main directional light.",
    stage: "any",
    requires: ["URP: a main directional light"],
    targets: {
      ...host("ks_MainLightDir", "main_light_dir", {
        note: "Host-supplied: the preview feeds it from Scene Simulation.",
      }),
      unity: S("GetMainLight().direction", {
        note: "Lighting.hlsl; include Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl.",
      }),
      godotSpatial: X(NO_FRAG_LIGHT),
      godotCanvas: X(NO_FRAG_LIGHT),
    },
  },
  {
    id: "ks.light.mainColor",
    kind: "engine",
    ty: "vec3",
    args: [],
    doc: "Linear HDR colour of the main directional light, intensity included.",
    stage: "any",
    requires: ["URP: a main directional light"],
    targets: {
      ...host("ks_MainLightColor", "main_light_color", {
        note: "Host-supplied: the preview feeds it from Scene Simulation.",
      }),
      unity: S("GetMainLight().color"),
      godotSpatial: X(NO_FRAG_LIGHT),
      godotCanvas: X(NO_FRAG_LIGHT),
    },
  },
  {
    id: "ks.light.mainShadow",
    kind: "engine",
    ty: "float",
    args: ["vec3"],
    doc: "Main-light shadow attenuation at a world position (1 = lit, 0 = fully shadowed).",
    stage: "fragment",
    requires: ["URP: main light shadows (keywords _MAIN_LIGHT_SHADOWS / _MAIN_LIGHT_SHADOWS_CASCADE)"],
    targets: {
      glslPreview: A("1.0", "The preview has no shadow maps: always 1 (fully lit).", {}),
      wgsl: A("1.0", "No shadow maps in the portable targets: always 1.", {}),
      hlsl: A("1.0", "No shadow maps in generic HLSL: always 1.", {}),
      unity: S("GetMainLight(TransformWorldToShadowCoord({0})).shadowAttenuation", {
        verify: true,
        helper: "#pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE _MAIN_LIGHT_SHADOWS_SCREEN",
        note: "Requires the shadow keywords; without them URP returns 1.",
      }),
      godotSpatial: X(NO_FRAG_LIGHT),
      godotCanvas: X(NO_FRAG_LIGHT),
    },
  },
  {
    id: "ks.light.ambientSH",
    kind: "engine",
    ty: "vec3",
    args: ["vec3"],
    doc: "Linear ambient irradiance for a world-space normal (spherical harmonics probe).",
    stage: "any",
    requires: ["Lighting ▸ Environment ▸ Ambient mode"],
    targets: {
      glslPreview: A(
        "ks_AmbientColor",
        "Flat ambient colour from Scene Simulation: the normal is ignored (no SH probe in the preview).",
        {},
      ),
      wgsl: A("ks.ambient_color", "Flat host-supplied ambient colour: the normal is ignored.", {}),
      hlsl: A("ks_AmbientColor", "Flat host-supplied ambient colour: the normal is ignored.", {}),
      unity: S("SampleSH({0})"),
      godotSpatial: X("AMBIENT_LIGHT is write-only in fragment(); pass a parameter."),
      godotCanvas: X(NO_FRAG_LIGHT),
    },
  },
  {
    id: "ks.light.reflectionProbe",
    kind: "engine",
    ty: "vec3",
    args: ["vec3", "float"],
    doc: "Reflection-probe / environment radiance for a world-space reflection vector and perceptual roughness 0…1.",
    stage: "fragment",
    requires: ["URP: reflection probes or a Skybox environment reflection"],
    targets: {
      glslPreview: X(
        "The preview has no reflection probe (use the lit approximation's environment or a cube / equirect texture property).",
      ),
      wgsl: X("No reflection probes in WGSL — provide a texture."),
      hlsl: X("No reflection probes in generic HLSL — provide a texture."),
      unity: S("GlossyEnvironmentReflection({0}, {1}, 1.0)", {
        verify: true,
        note: "URP 10–14 signature (reflectVector, perceptualRoughness, occlusion); URP 15+ also offers an overload taking positionWS and the normalised screen UV (needed for Forward+ probe blending).",
        urp: { min: 10 },
      }),
      godotSpatial: X(
        "Reflection probes are not readable in fragment() (they feed the built-in PBR); sample your own texture.",
      ),
      godotCanvas: X(NO3D),
    },
  },
  {
    id: "ks.light.additional.count",
    kind: "engine",
    ty: "float",
    args: [],
    doc: "Number of additional lights affecting the object.",
    stage: "any",
    requires: ["URP: Additional Lights (Per Pixel)"],
    targets: {
      ...portableNone(),
      unity: S("(float)GetAdditionalLightsCount()", V),
      godotSpatial: X(NO_FRAG_LIGHT),
      godotCanvas: X(NO_FRAG_LIGHT),
    },
  },
  {
    id: "ks.light.additional.direction",
    kind: "engine",
    ty: "vec3",
    args: ["vec3", "float"],
    doc: "Unit direction towards additional light #index from a world position.",
    stage: "any",
    requires: ["URP: Additional Lights (Per Pixel)"],
    targets: {
      ...portableNone(),
      unity: S("GetAdditionalLight((uint){1}, {0}).direction", V),
      godotSpatial: X(NO_FRAG_LIGHT),
      godotCanvas: X(NO_FRAG_LIGHT),
    },
  },
  {
    id: "ks.light.additional.color",
    kind: "engine",
    ty: "vec3",
    args: ["vec3", "float"],
    doc: "Colour of additional light #index.",
    stage: "any",
    requires: ["URP: Additional Lights (Per Pixel)"],
    targets: {
      ...portableNone(),
      unity: S("GetAdditionalLight((uint){1}, {0}).color", V),
      godotSpatial: X(NO_FRAG_LIGHT),
      godotCanvas: X(NO_FRAG_LIGHT),
    },
  },
  {
    id: "ks.light.additional.attenuation",
    kind: "engine",
    ty: "vec2",
    args: ["vec3", "float"],
    doc: "(distance attenuation, shadow attenuation) of additional light #index.",
    stage: "any",
    requires: ["URP: Additional Lights (Per Pixel)"],
    targets: {
      ...portableNone(),
      unity: S(
        "float2(GetAdditionalLight((uint){1}, {0}).distanceAttenuation, GetAdditionalLight((uint){1}, {0}).shadowAttenuation)",
        V,
      ),
      godotSpatial: X(NO_FRAG_LIGHT),
      godotCanvas: X(NO_FRAG_LIGHT),
    },
  },
  {
    id: "ks.screen.sceneDepthRaw",
    kind: "engine",
    ty: "float",
    args: ["vec2"],
    doc: "Raw camera depth at a screen UV.",
    stage: "fragment",
    requires: ["URP: Depth Texture enabled", "Godot: `uniform sampler2D depth_texture : hint_depth_texture;`"],
    targets: {
      ...portableNone(),
      ...ENG("SampleSceneDepth({0})", "ks_scene_depth({0})"),
      godotSpatial: S("ks_scene_depth({0})", {
        verify: true,
        helper: GODOT_SCENE_DEPTH_HELPER,
        note: "Compatibility renderer: depth is standard-Z (0 = near), Forward+ / Mobile: reversed-Z — the Raw output is not converted.",
      }),
      godotCanvas: X("depth_texture is a spatial-shader feature."),
    },
  },
  {
    id: "ks.screen.sceneColor",
    kind: "engine",
    ty: "vec3",
    args: ["vec2"],
    doc: "Opaque scene colour behind the object at a screen UV.",
    stage: "fragment",
    requires: ["URP: Opaque Texture enabled", "Godot: `uniform sampler2D screen_texture : hint_screen_texture;`"],
    targets: {
      ...portableNone(),
      unity: S("SampleSceneColor({0})", V),
      godotSpatial: S("textureLod(screen_texture, {0}, 0.0).rgb", V),
      godotCanvas: S("textureLod(screen_texture, {0}, 0.0).rgb", V),
    },
  },
  {
    id: "ks.screen.sceneNormals",
    kind: "engine",
    ty: "vec3",
    args: ["vec2"],
    doc: "World-space scene normals at a screen UV (needs a normals pre-pass).",
    stage: "fragment",
    requires: [
      "URP: ScriptableRenderPassInput.Normal (DepthNormals pre-pass, e.g. SSAO or a Renderer Feature)",
      "Godot: `uniform sampler2D normal_roughness_texture : hint_normal_roughness_texture;`",
    ],
    targets: {
      ...portableNone(),
      unity: S("SampleSceneNormals({0})", {
        verify: true,
        note: "DeclareNormalsTexture.hlsl (URP 12+); the result is world-space (URP) — confirm the encoding on your version.",
      }),
      godotSpatial: S("(INV_VIEW_MATRIX * vec4(texture(normal_roughness_texture, {0}).xyz * 2.0 - 1.0, 0.0)).xyz", {
        verify: true,
        note: "normal_roughness_texture stores VIEW-space normals (xyz) and roughness (w) in Godot 4.x — Forward+ only; octahedral packing was added in 4.3, check the version.",
      }),
      godotCanvas: X("normal_roughness_texture is a spatial-shader feature."),
    },
  },
  {
    id: "ks.camera.nearFar",
    kind: "engine",
    ty: "vec2",
    args: [],
    doc: "Camera near and far clip planes.",
    stage: "any",
    requires: [],
    targets: {
      ...portableNone(),
      unity: S("_ProjectionParams.yz"),
      godotSpatial: A("ks_camera_params(INV_PROJECTION_MATRIX, PROJECTION_MATRIX).xy", "See ks.camera.params (matrix-derived).", {
        verify: true,
        helper: GODOT_CAMERA_HELPER,
      }),
      godotCanvas: X(NO3D),
    },
  },

  /* ── sprite ────────────────────────────────────────────────────────────────────────────────────────────── */
  {
    id: "ks.sprite.rect",
    kind: "engine",
    ty: "vec4",
    args: [],
    doc: "Sprite rectangle inside its texture / atlas in UV units (x, y, width, height).",
    stage: "any",
    requires: ["Unity: add KekenikSpriteRect.cs (exported next to the shader) to the SpriteRenderer"],
    targets: {
      ...host("ks_SpriteRect", "sprite_rect"),
      unity: S("_KsSpriteRect", {
        verify: true,
        note: "Unity does not expose a sprite's atlas sub-rectangle to shaders. The export adds the hidden Vector property _KsSpriteRect (default 0,0,1,1 = full texture) and the helper KekenikSpriteRect.cs, which fills it from sprite.textureRect through a MaterialPropertyBlock. Without the script the full rectangle is used.",
      }),
      godotSpatial: A("vec4(0.0, 0.0, 1.0, 1.0)", "No atlas rectangle available — full rectangle; use a parameter.", V),
      godotCanvas: A(
        "vec4(0.0, 0.0, 1.0, 1.0)",
        "AtlasTexture regions are resolved by the engine before the shader sees UV: full rectangle returned; use a parameter for atlas-aware effects.",
        V,
      ),
    },
  },
  {
    id: "ks.sprite.info",
    kind: "engine",
    ty: "vec4",
    args: [],
    doc: "Sprite (width px, height px, pixels per unit, 0).",
    stage: "any",
    requires: ["Unity: the sprite texture must be declared as _MainTex"],
    targets: {
      ...host("ks_SpriteInfo", "sprite_info"),
      unity: A(
        "float4(_MainTex_TexelSize.zw, 100.0, 0.0)",
        "Size from _MainTex_TexelSize (declare Texture2D _MainTex + float4 _MainTex_TexelSize); pixels-per-unit is NOT exposed to shaders — 100 (the importer default) is assumed, use the Pixels Per Unit node with a property instead.",
        { verify: true },
      ),
      godotSpatial: X("Sprite data exists only in canvas_item shaders."),
      godotCanvas: A(
        "vec4(1.0 / TEXTURE_PIXEL_SIZE, 100.0, 0.0)",
        "Size from TEXTURE_PIXEL_SIZE; pixels-per-unit is not a shader value (100 assumed — use a property).",
        V,
      ),
    },
  },

  /* ── built-in inputs (IR `input` op) ───────────────────────────────────────────────────────────────────── */
  {
    id: "input:instanceId",
    kind: "input",
    ty: "int",
    args: [],
    doc: "Instance index of an instanced draw (0 otherwise).",
    stage: "vertex",
    requires: ["Unity: GPU instancing / SRP Batcher-compatible instanced draw"],
    targets: {
      glslPreview: S("gl_InstanceID"),
      wgsl: S("ks_instance_index"),
      hlsl: S("ks_instance_id"),
      unity: S("input.instanceID", { note: "uint instanceID : SV_InstanceID in the vertex input struct." }),
      godotSpatial: S("INSTANCE_ID"),
      godotCanvas: A("INSTANCE_ID", "canvas_item exposes INSTANCE_ID in vertex() only.", V),
    },
  },
  {
    id: "input:vertexId",
    kind: "input",
    ty: "int",
    args: [],
    doc: "Index of the vertex in the draw call.",
    stage: "vertex",
    requires: [],
    targets: {
      glslPreview: S("gl_VertexID"),
      wgsl: S("ks_vertex_index"),
      hlsl: S("ks_vertex_id"),
      unity: S("input.vertexID", { note: "uint vertexID : SV_VertexID" }),
      godotSpatial: S("VERTEX_ID"),
      godotCanvas: A("VERTEX_ID", "VERTEX_ID exists in canvas_item vertex().", V),
    },
  },
  {
    id: "input:faceSign",
    kind: "input",
    ty: "float",
    args: [],
    doc: "+1 for front faces, −1 for back faces.",
    stage: "fragment",
    requires: ["Double-sided material (Cull Off / Back)"],
    targets: {
      glslPreview: S("(gl_FrontFacing ? 1.0 : -1.0)"),
      wgsl: S("select(-1.0f, 1.0f, ks_front_facing)"),
      hlsl: S("(ks_front_facing ? 1.0 : -1.0)"),
      unity: S("(IS_FRONT_VFACE(input.cullFace, 1.0, -1.0))", {
        note: "FRONT_FACE_TYPE cullFace : FRONT_FACE_SEMANTIC in the fragment input (Core.hlsl).",
      }),
      godotSpatial: S("(FRONT_FACING ? 1.0 : -1.0)"),
      godotCanvas: X("canvas_item sprites are always front-facing."),
    },
  },
  {
    id: "input:cameraPos",
    kind: "input",
    ty: "vec3",
    args: [],
    doc: "Camera position in world space.",
    stage: "any",
    requires: [],
    targets: {
      glslPreview: S("ks_CameraPos"),
      wgsl: S("ks.camera_pos"),
      hlsl: S("ks_CameraPos"),
      unity: S("_WorldSpaceCameraPos"),
      godotSpatial: S("CAMERA_POSITION_WORLD"),
      godotCanvas: X(NO3D),
    },
  },
  {
    id: "input:screenPos",
    kind: "input",
    ty: "vec4",
    args: [],
    doc: "Clip-space position of the fragment (xy / w = NDC).",
    stage: "fragment",
    requires: [],
    targets: {
      glslPreview: S("(vertex clip position, interpolated)"),
      wgsl: S("(vertex clip position, interpolated)"),
      hlsl: S("(vertex clip position, interpolated)"),
      unity: S("input.positionCS", {
        note: "float4 positionCS : SV_POSITION is pixel coordinates in the fragment stage — pass the clip position in a TEXCOORD varying instead of reading SV_POSITION as clip space.",
      }),
      godotSpatial: A(
        "vec4(SCREEN_UV * 2.0 - 1.0, FRAGCOORD.z, 1.0)",
        "Built from SCREEN_UV and FRAGCOORD.z (w = 1: the perspective divide is already applied).",
        V,
      ),
      godotCanvas: A("vec4(SCREEN_UV * 2.0 - 1.0, 0.0, 1.0)", "2D: z = 0.", V),
    },
  },
  {
    id: "input:tangent",
    kind: "input",
    ty: "vec3",
    args: [],
    doc: "Mesh tangent (xyz); the handedness lives in the 4th component of the attribute.",
    stage: "any",
    requires: ["Mesh with tangents"],
    targets: {
      glslPreview: S("a_tangent.xyz"),
      wgsl: S("a_tangent.xyz"),
      hlsl: S("a_tangent.xyz"),
      unity: S("input.tangentOS.xyz"),
      godotSpatial: S("TANGENT"),
      godotCanvas: X("Sprites have no tangents."),
    },
  },
  {
    id: "input:bitangent",
    kind: "input",
    ty: "vec3",
    args: [],
    doc: "Mesh bitangent = cross(normal, tangent) · handedness.",
    stage: "any",
    requires: ["Mesh with tangents"],
    targets: {
      glslPreview: S("cross(a_normal, a_tangent.xyz) * a_tangent.w"),
      wgsl: S("cross(a_normal, a_tangent.xyz) * a_tangent.w"),
      hlsl: S("cross(a_normal, a_tangent.xyz) * a_tangent.w"),
      unity: S("cross(input.normalOS, input.tangentOS.xyz) * input.tangentOS.w * unity_WorldTransformParams.w", {
        note: "unity_WorldTransformParams.w is −1 for negatively scaled objects.",
      }),
      godotSpatial: S("BINORMAL"),
      godotCanvas: X("Sprites have no tangents."),
    },
  },

  /* ── compile-time constants (resolved while compiling, no runtime cost) ────────────────────────────────── */
  {
    id: "const:isReversedZ",
    kind: "compileTime",
    ty: "float",
    args: [],
    doc: "1 when the target stores depth reversed (1 = near).",
    stage: "any",
    requires: [],
    targets: {
      glslPreview: S("0"),
      wgsl: S("0", { note: "WebGPU hosts may choose reversed-Z: change the host contract if so." }),
      hlsl: S("0"),
      unity: A(
        "1",
        "Assumed true (D3D11/12, Metal, Vulkan, consoles). OpenGL ES 3 / WebGL builds are NOT reversed: the exporter may emit `UNITY_REVERSED_Z` instead.",
        V,
      ),
      godotSpatial: A("1", "True for Forward+ / Mobile; the Compatibility renderer is not reversed.", V),
      godotCanvas: X(NO3D),
    },
  },
  {
    id: "const:isYFlipped",
    kind: "compileTime",
    ty: "float",
    args: [],
    doc: "1 when NDC / render-target Y points down relative to OpenGL.",
    stage: "any",
    requires: [],
    targets: {
      glslPreview: S("0"),
      wgsl: S("0"),
      hlsl: S("0"),
      unity: A(
        "0",
        "Platform dependent: use _ProjectionParams.x < 0 / UNITY_UV_STARTS_AT_TOP at run time for render textures.",
        V,
      ),
      godotSpatial: A("1", "Vulkan renderers: NDC Y down.", V),
      godotCanvas: A("0", "2D screen coordinates already match the canvas.", V),
    },
  },
  {
    id: "const:isLinear",
    kind: "compileTime",
    ty: "float",
    args: [],
    doc: "1 when the target shades in linear colour space.",
    stage: "any",
    requires: [],
    targets: {
      glslPreview: S("0"),
      wgsl: S("0"),
      hlsl: S("0"),
      unity: A("1", "Assumes a Linear colour-space project (Player Settings); Gamma projects return 0 at run time.", V),
      godotSpatial: S("1", {
        note: "Godot 4 shades in linear space; use OUTPUT_IS_SRGB to detect direct sRGB output.",
      }),
      godotCanvas: A("1", "canvas_item colours are sRGB-encoded unless the viewport is HDR 2D.", V),
    },
  },
  {
    id: "const:isPreview",
    kind: "compileTime",
    ty: "float",
    args: [],
    doc: "1 when compiled for the Kekenik Shader preview viewport.",
    stage: "any",
    requires: [],
    targets: {
      glslPreview: S("1", { note: "1 in the preview viewport, 0 in an exported GLSL file." }),
      wgsl: S("0"),
      hlsl: S("0"),
      unity: S("0"),
      godotSpatial: S("0"),
      godotCanvas: S("0"),
    },
  },
  ...LIGHT_STAGE_ENTRIES,
];
