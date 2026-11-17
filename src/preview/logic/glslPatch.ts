/**
 * Source-to-source patches applied to GENERATED GLSL before it is handed to the GPU. Every patch only appends text to
 * existing lines (never adds or removes a newline), so generated line numbers — and therefore the line → node table
 * used for error mapping — stay valid.
 */

import { FRAGMENT_PRELUDE, VERTEX_DECLS, vertexTail } from "../gl/lighting/prelude";

const FRAG_OUT = "ks_FragColor";

/** Remove `//` comments (generated shaders contain no block comments or `//` inside strings). */
export const stripGlslComments = (src: string): string => src.replace(/\/\/.*$/gm, "").replace(/[ \t]+$/gm, "");

/** Replace every `ks_FragColor = …` assignment target with `ks_Result` and declare it next to the output (idempotent: patches compose). */
function redirectOutput(fs: string): string {
  if (fs.includes("vec4 ks_Result;")) return fs;
  return fs
    .replace(`out vec4 ${FRAG_OUT};`, `vec4 ks_Result; out vec4 ${FRAG_OUT};`)
    .replace(new RegExp(`${FRAG_OUT}\\s*=\\s`, "g"), "ks_Result = ")
    .replace(new RegExp(`${FRAG_OUT}\\.`, "g"), "ks_Result.");
}

/** Append `tail` just before the closing brace of `main` (the last `}` of the file). */
function appendToMain(src: string, tail: string): string {
  const end = src.lastIndexOf("}");
  return src.slice(0, end) + tail + " " + src.slice(end);
}

const hasDecl = (src: string, re: RegExp): boolean => re.test(src);

/**
 * Preview surface wrapper (replaces the old colour-only `patchLit`): needs a shader compiled with `surface: "preview"` (declares
 * `KsSurface ks_surf`). Adds the lighting prelude + the position / normal / uv / colour varyings, and shades `ks_surf` at the end of main
 * (alpha comes from `ks_Result` so the soft-particle patch composes). Returns null when the shader has an unexpected shape.
 */
export function patchSurface(vs: string, fs: string): { vs: string; fs: string } | null {
  const m = /gl_Position\s*=\s*ks_Projection\s*\*\s*ks_View\s*\*\s*ks_Model\s*\*\s*vec4\(([^,]+),\s*1\.0\);/.exec(vs);
  if (!m || !/void main\(\)\s*\{/.test(vs) || !/void main\(\)\s*\{/.test(fs) || !fs.includes("KsSurface ks_surf"))
    return null;
  const decl: string[] = [];
  if (!hasDecl(vs, /\bin\s+vec3\s+a_normal\b/)) decl.push("layout(location = 1) in vec3 a_normal;");
  if (!hasDecl(vs, /\bin\s+vec2\s+a_uv0\b/)) decl.push("layout(location = 2) in vec2 a_uv0;");
  if (!hasDecl(vs, /\bin\s+vec4\s+a_color\b/)) decl.push("layout(location = 3) in vec4 a_color;");
  if (!hasDecl(vs, /\buniform\s+mat4\s+ks_Model\b/)) decl.push("uniform mat4 ks_Model;");
  if (!hasDecl(vs, /\buniform\s+mat3\s+ks_NormalMatrix\b/)) decl.push("uniform mat3 ks_NormalMatrix;");
  decl.push(VERTEX_DECLS);
  const vs2 = appendToMain(
    vs.replace(/void main\(\)\s*\{/, `${decl.join(" ")} void main() {`),
    vertexTail(m[1]!.trim()),
  );
  const fs2 = appendToMain(
    redirectOutput(fs).replace(/void main\(\)\s*\{/, `${FRAGMENT_PRELUDE} void main() {`),
    `ks_surf.alpha = ks_Result.a; ${FRAG_OUT} = ks_lit_shade(ks_surf);`,
  );
  return { vs: vs2, fs: fs2 };
}

/** Names of the uniforms the soft-particle patch adds (the engine sets them). */
export const SOFT_UNIFORMS = ["ks_soft_Depth", "ks_soft_Params", "ks_soft_Size"] as const;

const SOFT_FN = `
uniform highp sampler2D ks_soft_Depth; uniform vec4 ks_soft_Params; uniform vec2 ks_soft_Size;
float ks_soft_lin(float d) { if (ks_soft_Params.w > 0.5) return ks_soft_Params.x + d * (ks_soft_Params.y - ks_soft_Params.x); float z = d * 2.0 - 1.0; return 2.0 * ks_soft_Params.x * ks_soft_Params.y / (ks_soft_Params.y + ks_soft_Params.x - z * (ks_soft_Params.y - ks_soft_Params.x)); }
float ks_soft_fade() { float s = texture(ks_soft_Depth, gl_FragCoord.xy / ks_soft_Size).r; return clamp((ks_soft_lin(s) - ks_soft_lin(gl_FragCoord.z)) / max(ks_soft_Params.z, 1e-4), 0.0, 1.0); }
`.replace(/\n/g, " ");

/**
 * Soft particles: fade the fragment by its view-space distance to the opaque scene depth (`ks_soft_Depth`, ks_soft_Params =
 * near, far, fade distance). Premultiplied shaders scale rgb too. Apply BEFORE `patchSurface` (the surface wrapper reads `ks_Result`).
 */
export function patchSoft(fs: string, premultiplied: boolean): string | null {
  if (!/void main\(\)\s*\{/.test(fs)) return null;
  const scale = premultiplied ? "ks_Result *= ks_soft_f;" : "ks_Result.a *= ks_soft_f;";
  return appendToMain(
    redirectOutput(fs).replace(/void main\(\)\s*\{/, `${SOFT_FN} void main() {`),
    `float ks_soft_f = ks_soft_fade(); ${scale} ${FRAG_OUT} = ks_Result;`,
  );
}

/** Thumbnail output stage: opaque result; values outside 0..1 (or NaN) get a magenta diagonal-stripe overlay as range indicator. */
export function patchRangeIndicator(fs: string): string {
  const body =
    "vec3 ks_c = ks_Result.rgb; bool ks_oor = any(lessThan(ks_c, vec3(-0.0005))) || any(greaterThan(ks_c, vec3(1.0005))) || any(notEqual(ks_c, ks_c));" +
    " float ks_s = step(0.5, fract((gl_FragCoord.x + gl_FragCoord.y) * 0.1));" +
    ` ${FRAG_OUT} = vec4(ks_oor ? mix(clamp(ks_c, 0.0, 1.0), vec3(1.0, 0.0, 0.6), 0.5 * ks_s) : ks_c, 1.0);`;
  return appendToMain(redirectOutput(fs), body);
}

/**
 * Opaque output stage WITHOUT the range overlay: the exact RGB the graph produced, alpha forced to 1. Used wherever a thumbnail / bake is read back
 * as colour (Sample Browser cards, Bake to Texture). Without it the Swizzle that widens the value to a Vector 4 leaves the alpha at the value
 * itself (`float → xxxx`) or at 0 (`vec3 → xyzw`), and the 2-D canvas the image is drawn into un-premultiplies / drops the colour.
 */
export function patchOpaque(fs: string): string {
  return appendToMain(redirectOutput(fs), ` ${FRAG_OUT} = vec4(ks_Result.rgb, 1.0);`);
}

/** Does the shader read the clock (so its preview / thumbnail animates)? The `uniform float ks_Time;` declaration does not count. */
export const usesTime = (...sources: string[]): boolean =>
  /\bks_Time\b/.test(stripGlslComments(sources.join("\n")).replace(/uniform\s+float\s+ks_Time\s*;/g, ""));
