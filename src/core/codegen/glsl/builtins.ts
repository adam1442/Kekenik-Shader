/**
 * Host-provided names of the generated GLSL. The host (preview, game integration, tests) binds attributes by the
 * explicit `layout(location = N)` and sets the `ks_*` uniforms. All of them are documented in the shader header.
 */
export const BUILTIN_UNIFORMS = {
  ks_Model: { ty: "mat4", doc: "object → world matrix" },
  ks_View: { ty: "mat4", doc: "world → view matrix" },
  ks_Projection: { ty: "mat4", doc: "view → clip matrix" },
  ks_WorldToObject: { ty: "mat4", doc: "world → object matrix (inverse of ks_Model)" },
  ks_ViewInverse: { ty: "mat4", doc: "view → world matrix (inverse of ks_View)" },
  ks_NormalMatrix: { ty: "mat3", doc: "object → world normal matrix (inverse-transpose of ks_Model)" },
  ks_ProjectionInverse: { ty: "mat4", doc: "clip → view matrix (inverse of ks_Projection)" },
  ks_CameraPos: { ty: "vec3", doc: "camera position, world space" },
  ks_CameraParams: {
    ty: "vec4",
    doc: "camera (near, far, isOrthographic 0|1, orthographic half-height in world units)",
  },
  ks_ScreenParams: { ty: "vec4", doc: "render target (width, height, 1/width, 1/height) in pixels" },
  ks_FogColor: { ty: "vec4", doc: "fog colour (rgb, linear)" },
  ks_FogParams: { ty: "vec4", doc: "fog (density, start, end, mode: 0 off | 1 linear | 2 exp | 3 exp2)" },
  ks_MainLightDir: { ty: "vec3", doc: "unit world-space direction towards the main light" },
  ks_MainLightColor: { ty: "vec3", doc: "main light colour, linear HDR, intensity included" },
  ks_AmbientColor: { ty: "vec3", doc: "flat ambient light colour, linear HDR" },
  ks_SpriteRect: { ty: "vec4", doc: "sprite rectangle inside its texture / atlas in UV units (x, y, width, height)" },
  ks_SpriteInfo: { ty: "vec4", doc: "sprite (width px, height px, pixels per unit, 0)" },
  ks_Time: { ty: "float", doc: "elapsed time in seconds" },
  ks_DeltaTime: { ty: "float", doc: "last frame time in seconds" },
  ks_SmoothDeltaTime: { ty: "float", doc: "smoothed frame time in seconds" },
} as const;

export type BuiltinUniformName = keyof typeof BUILTIN_UNIFORMS;
export const BUILTIN_UNIFORM_ORDER = Object.keys(BUILTIN_UNIFORMS) as BuiltinUniformName[];

/** Vertex attributes (fixed locations). */
export const ATTRIBUTES = {
  a_position: { ty: "vec3", location: 0, doc: "object-space position" },
  a_normal: { ty: "vec3", location: 1, doc: "object-space normal" },
  a_uv0: { ty: "vec2", location: 2, doc: "UV channel 0" },
  a_color: { ty: "vec4", location: 3, doc: "vertex color" },
  a_tangent: { ty: "vec4", location: 4, doc: "object-space tangent (xyz) + handedness (w)" },
  a_uv1: { ty: "vec2", location: 5, doc: "UV channel 1" },
  a_uv2: { ty: "vec2", location: 6, doc: "UV channel 2" },
  a_uv3: { ty: "vec2", location: 7, doc: "UV channel 3" },
} as const;

export type AttributeName = keyof typeof ATTRIBUTES;
export const ATTRIBUTE_ORDER = Object.keys(ATTRIBUTES) as AttributeName[];
