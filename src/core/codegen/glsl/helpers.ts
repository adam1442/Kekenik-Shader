import type { HelperDef } from "../base/helpers";
import { GLSL_IHASH_HELPERS } from "../base/ihashHelpers";

const overloads = (name: string, body: (t: string) => string): string =>
  ["float", "vec2", "vec3", "vec4"].map((t) => `${t} ${name}(${t} x) { return ${body(t)}; }`).join("\n");

/** On-demand helper functions of the GLSL backend (each emitted at most once per shader). */
export const GLSL_HELPERS: readonly HelperDef[] = [
  {
    id: "ks_round",
    code: `// Round half up: identical on every GPU (the built-in round() leaves exact .5 implementation-defined).\n${overloads("ks_round", () => "floor(x + 0.5)")}`,
  },
  {
    id: "ks_q1",
    code: `// fp16 emulation (preview debug mode): round to the nearest binary16 number.\nfloat ks_q1(float x) { return unpackHalf2x16(packHalf2x16(vec2(x, 0.0))).x; }`,
  },
  { id: "ks_q2", code: `vec2 ks_q2(vec2 x) { return unpackHalf2x16(packHalf2x16(x)); }` },
  {
    id: "ks_q3",
    deps: ["ks_q2"],
    code: `vec3 ks_q3(vec3 x) { return vec3(unpackHalf2x16(packHalf2x16(x.xy)), unpackHalf2x16(packHalf2x16(vec2(x.z, 0.0))).x); }`,
  },
  {
    id: "ks_q4",
    deps: ["ks_q2"],
    code: `vec4 ks_q4(vec4 x) { return vec4(unpackHalf2x16(packHalf2x16(x.xy)), unpackHalf2x16(packHalf2x16(x.zw))); }`,
  },
  ...GLSL_IHASH_HELPERS,
];
