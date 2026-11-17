import { formatFloat } from "../base/literals";
import type { InputSyntax } from "../dialect/inputs";
import { stripParens } from "../dialect/ops";

/** GLSL spelling for the built-in input table (`dialect/inputs.describeInputWith`). Attributes and uniforms are plain globals. */
export const glslSyntax: InputSyntax = {
  vec: (n) => `vec${n}`,
  v3: (a, b, c) => `vec3(${a}, ${b}, ${c})`,
  v4: (xyz, w) => `vec4(${xyz}, ${w})`,
  attr: (a) => a,
  uni: (u) => u,
  // Always parenthesised: callers append swizzles (`(M * v).xyz`).
  mulM4V4: (m, v) => `(${m} * ${v})`,
  mulM3V3: (m, v) => `(${m} * ${v})`,
  mat3: (m) => `mat3(${m})`,
  normalize: (x) => `normalize(${stripParens(x)})`,
  cross: (a, b) => `cross(${a}, ${b})`,
  dot: (a, b) => `dot(${a}, ${b})`,
  num: formatFloat,
  faceSign: "(gl_FrontFacing ? 1.0 : -1.0)",
  vertexId: "gl_VertexID",
  instanceId: "gl_InstanceID",
  flipUvV: false,
  oneMinus: (x) => `(1.0 - ${x})`,
};
