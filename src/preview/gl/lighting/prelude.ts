/**
 * PREVIEW LIGHTING PRELUDE — hand-written GLSL ES 3.00 strings, inserted before `main` of the generated fragment
 * shader. It reads the global `KsSurface ks_surf` declared by the GLSL backend (`surface: "preview"`) and returns LINEAR HDR radiance.
 * Tone mapping / exposure / sRGB happen in the post pipeline (`src/preview/gl/post`). Everything here is an APPROXIMATION of the
 * engines' shading (labelled so in the UI): Unity-like = Lambert + GGX / Smith-Schlick, Godot-like = Burley + Schlick-GGX.
 *
 * Collapsed to ONE line by `collapse` so generated line numbers (error mapping) stay valid; therefore no `//` comments inside.
 */
export const LIT_UNIFORM_NAMES = [
  "ks_lit_D0",
  "ks_lit_D1",
  "ks_lit_D2",
  "ks_lit_C0",
  "ks_lit_C1",
  "ks_lit_C2",
  "ks_lit_Env",
  "ks_lit_EnvI",
  "ks_lit_EnvRot",
  "ks_lit_EnvFlip",
  "ks_lit_Cam",
  "ks_lit_Cfg",
  "ks_lit_Cfg2",
  "ks_lit_ShadowMat",
  "ks_lit_ShadowMap",
  "ks_lit_Shadow",
  "ks_lit_Fog",
  "ks_lit_FogCol",
] as const;

/** Debug view ids understood by `ks_lit_Cfg.y` (0 = final shading). Kept in sync with `DEBUG_VIEW_IDS` in previewStore. */
export const SURFACE_DEBUG_ID = {
  final: 0,
  baseColor: 1,
  normalTS: 2,
  normalWS: 3,
  metallic: 4,
  smoothness: 5,
  occlusion: 6,
  emission: 7,
  alpha: 8,
  uv: 9,
  vertexColor: 10,
  sceneDepth: 11,
} as const;

const collapse = (src: string): string => src.replace(/\s*\n\s*/g, " ").trim();

const DECLS = `
uniform vec3 ks_lit_D0; uniform vec3 ks_lit_D1; uniform vec3 ks_lit_D2;
uniform vec3 ks_lit_C0; uniform vec3 ks_lit_C1; uniform vec3 ks_lit_C2;
uniform sampler2D ks_lit_Env; uniform float ks_lit_EnvI; uniform float ks_lit_EnvRot; uniform float ks_lit_EnvFlip; uniform vec3 ks_lit_Cam;
uniform vec4 ks_lit_Cfg; uniform vec4 ks_lit_Cfg2; uniform mat4 ks_lit_ShadowMat; uniform highp sampler2D ks_lit_ShadowMap; uniform vec4 ks_lit_Shadow;
uniform vec4 ks_lit_Fog; uniform vec3 ks_lit_FogCol;
in vec3 ks_lit_P; in vec3 ks_lit_N; in vec2 ks_lit_UV; in vec4 ks_lit_VC;
`;

const ENV = `
vec3 ks_lit_envSample(vec3 d, float lod) {
  float u = atan(d.z, d.x) / 6.2831853 + 0.5 + ks_lit_EnvRot;
  float v = asin(clamp(d.y, -1.0, 1.0)) / 3.14159265 + 0.5;
  if (ks_lit_EnvFlip > 0.5) v = 1.0 - v;
  return textureLod(ks_lit_Env, vec2(u, v), lod).rgb * ks_lit_EnvI;
}
`;

const NORMAL = `
vec3 ks_lit_mapNormal(vec3 N, vec3 p, vec2 uv, vec3 tn) {
  vec3 dp1 = dFdx(p); vec3 dp2 = dFdy(p); vec2 duv1 = dFdx(uv); vec2 duv2 = dFdy(uv);
  vec3 dp2perp = cross(dp2, N); vec3 dp1perp = cross(N, dp1);
  vec3 T = dp2perp * duv1.x + dp1perp * duv2.x; vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;
  vec3 Tn = normalize(T - N * dot(N, T) + vec3(1e-9, 0.0, 0.0)); vec3 Bn = cross(N, Tn);
  if (dot(Bn, B) < 0.0) Bn = -Bn;
  return normalize(mat3(Tn, Bn, N) * tn);
}
`;

const SHADOW = `
float ks_lit_shadowAt(vec3 P, vec3 N) {
  if (ks_lit_Cfg.z < 0.5) return 1.0;
  vec4 sp = ks_lit_ShadowMat * vec4(P + N * ks_lit_Shadow.x * 6.0, 1.0);
  vec3 c = sp.xyz / sp.w * 0.5 + 0.5;
  if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0) return 1.0;
  float sum = 0.0;
  for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) {
    float d = texture(ks_lit_ShadowMap, c.xy + vec2(float(i), float(j)) * ks_lit_Shadow.z * ks_lit_Shadow.y).r;
    sum += (c.z - ks_lit_Shadow.x > d) ? 0.0 : 1.0;
  }
  return sum / 9.0;
}
`;

const BRDF = `
vec3 ks_lit_direct(vec3 N, vec3 V, vec3 L, vec3 radiance, vec3 albedo, vec3 f0, float rough, float metal) {
  vec3 H = normalize(V + L);
  float NL = max(dot(N, L), 0.0); float NV = max(dot(N, V), 1e-4); float NH = max(dot(N, H), 0.0); float VH = max(dot(V, H), 0.0);
  float a = rough * rough; float a2 = a * a;
  float dd = NH * NH * (a2 - 1.0) + 1.0;
  float D = a2 / (3.14159265 * dd * dd + 1e-7);
  float k = ks_lit_Cfg.x > 0.5 ? a * 0.5 : (rough + 1.0) * (rough + 1.0) / 8.0;
  float G = (NL / (NL * (1.0 - k) + k)) * (NV / (NV * (1.0 - k) + k));
  vec3 F = f0 + (1.0 - f0) * pow(1.0 - VH, 5.0);
  vec3 spec = D * G * F / (4.0 * NL * NV + 1e-4);
  vec3 diffuse = albedo * (1.0 - metal) / 3.14159265;
  if (ks_lit_Cfg.x > 0.5) {
    float fd90 = 0.5 + 2.0 * VH * VH * rough;
    float fl = pow(1.0 - NL, 5.0); float fv = pow(1.0 - NV, 5.0);
    diffuse *= (1.0 + (fd90 - 1.0) * fl) * (1.0 + (fd90 - 1.0) * fv);
  }
  return (diffuse * (1.0 - F) + spec) * radiance * NL;
}
`;

const DEBUG = `
vec4 ks_lit_debug(int id, KsSurface s, vec3 N) {
  vec3 c = vec3(0.0);
  if (id == 1) c = s.baseColor;
  else if (id == 2) c = s.normalTS * 0.5 + 0.5;
  else if (id == 3) c = N * 0.5 + 0.5;
  else if (id == 4) c = vec3(s.metallic);
  else if (id == 5) c = vec3(s.smoothness);
  else if (id == 6) c = vec3(s.occlusion);
  else if (id == 7) c = s.emission;
  else if (id == 8) c = vec3(s.alpha);
  else if (id == 9) c = vec3(fract(ks_lit_UV), 0.0);
  else if (id == 10) c = ks_lit_VC.rgb;
  else if (id == 11) c = vec3(1.0 - clamp(distance(ks_lit_Cam, ks_lit_P) / 10.0, 0.0, 1.0));
  return vec4(c, 1.0);
}
`;

const FOG = `
vec3 ks_lit_fog(vec3 c) {
  int m = int(ks_lit_Fog.x + 0.5);
  if (m == 0) return c;
  float d = distance(ks_lit_Cam, ks_lit_P);
  float f = 1.0;
  if (m == 1) f = clamp((ks_lit_Fog.w - d) / max(ks_lit_Fog.w - ks_lit_Fog.z, 1e-4), 0.0, 1.0);
  else if (m == 2) f = exp(-ks_lit_Fog.y * d);
  else f = exp(-(ks_lit_Fog.y * d) * (ks_lit_Fog.y * d));
  return mix(ks_lit_FogCol, c, f);
}
`;

const SHADE = `
bool ks_lit_isUnlit(KsSurface s) { return ks_lit_Cfg2.x < -0.5 || (ks_lit_Cfg2.x < 0.5 && s.unlit > 0.5); }
vec4 ks_lit_shade0(KsSurface s) {
  vec3 N = normalize(ks_lit_N); if (!gl_FrontFacing) N = -N;
  if (s.hasNormal > 0.5) N = ks_lit_mapNormal(N, ks_lit_P, ks_lit_UV, normalize(s.normalTS));
  int dbg = int(ks_lit_Cfg.y + 0.5);
  if (dbg > 0) return ks_lit_debug(dbg, s, N);
  if (ks_lit_isUnlit(s)) return vec4(s.baseColor + s.emission, s.alpha);
  vec3 V = normalize(ks_lit_Cam - ks_lit_P);
  float metal = clamp(s.metallic, 0.0, 1.0);
  float rough = clamp(1.0 - s.smoothness, 0.045, 1.0);
  float occ = clamp(s.occlusion, 0.0, 1.0);
  vec3 f0 = mix(vec3(0.08 * clamp(s.specular, 0.0, 1.0)), s.baseColor, metal);
  float sh = ks_lit_shadowAt(ks_lit_P, N);
  vec3 col = ks_lit_direct(N, V, normalize(ks_lit_D0), ks_lit_C0 * sh, s.baseColor, f0, rough, metal)
           + ks_lit_direct(N, V, normalize(ks_lit_D1), ks_lit_C1, s.baseColor, f0, rough, metal)
           + ks_lit_direct(N, V, normalize(ks_lit_D2), ks_lit_C2, s.baseColor, f0, rough, metal);
  float NV = max(dot(N, V), 0.0);
  vec3 envBrdf = f0 * (1.0 - rough * 0.5) + (1.0 - f0) * pow(1.0 - NV, 5.0) * (1.0 - rough);
  vec3 irr = ks_lit_envSample(N, 6.0);
  vec3 refl = ks_lit_envSample(reflect(-V, N), rough * 6.0);
  col += (irr * s.baseColor * (1.0 - metal) * (1.0 - f0) + refl * envBrdf) * occ;
  vec3 L0 = normalize(ks_lit_D0);
  col += s.translucency * (1.0 - clamp(s.thickness, 0.0, 1.0)) * s.baseColor * ks_lit_C0 * sh * max(dot(-N, L0), 0.0);
  col += s.rim * pow(1.0 - NV, 4.0) * mix(vec3(1.0), s.baseColor, s.rimTint) * ks_lit_C0;
  col += s.emission;
  float a = s.alpha;
  if (ks_lit_Cfg.w > 0.5) col *= a;
  return vec4(col, a);
}
`;

const SHADE_FOG = `
vec4 ks_lit_shade(KsSurface s) {
  vec4 r = ks_lit_shade0(s);
  if (int(ks_lit_Cfg.y + 0.5) == 0 && !ks_lit_isUnlit(s)) r.rgb = ks_lit_fog(r.rgb);
  return r;
}
`;

/** Full fragment prelude (one line). */
export const FRAGMENT_PRELUDE: string = collapse(
  [DECLS, ENV, NORMAL, SHADOW, BRDF, DEBUG, FOG, SHADE, SHADE_FOG].join("\n"),
);

/** Vertex additions: declarations + the assignment appended to main. `pos` = the (displaced) object-space position expression. */
export const VERTEX_DECLS = "out vec3 ks_lit_P; out vec3 ks_lit_N; out vec2 ks_lit_UV; out vec4 ks_lit_VC;";
export const vertexTail = (pos: string): string =>
  `ks_lit_P = (ks_Model * vec4(${pos}, 1.0)).xyz; ks_lit_N = ks_NormalMatrix * a_normal; ks_lit_UV = a_uv0; ks_lit_VC = a_color;`;
