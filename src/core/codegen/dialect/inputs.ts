import type { BuiltinInput } from "../../ir/inputs";
import type { Space } from "../../types/semantics";
import type { StorageType } from "../../types/shaderType";
import type { AttributeName, BuiltinUniformName } from "../glsl/builtins";
import { stripParens } from "./ops";

/**
 * How built-in IR inputs (`input` op) reach each stage.
 *  - uniform   : host uniform, same text in both stages (time, camera position)
 *  - constant  : literal, same text in both stages (tangent-space basis vectors)
 *  - attribute : vertex attribute read directly in the vertex stage, varying in the fragment stage
 *  - derived   : computed from attributes + matrices; a vertex-stage global filled in `main`, varying in the fragment stage
 *  - builtin   : built-in variable of ONE stage (gl_VertexID / gl_FrontFacing / ...)
 */
type InputCategory = "uniform" | "constant" | "attribute" | "derived" | "builtin";

export interface UseSet {
  attrs: Set<AttributeName>;
  uniforms: Set<BuiltinUniformName>;
}

export const newUseSet = (): UseSet => ({ attrs: new Set(), uniforms: new Set() });

export interface InputDesc {
  cat: InputCategory;
  ty: StorageType;
  /** Vertex stage: expression (given the object-space position expression `pos`). */
  vertex: (pos: string, use: UseSet) => string;
  /** The value depends on the (possibly displaced) vertex position. */
  usesPosition: boolean;
  /** Fragment stage: renormalise the interpolated varying (direction vectors). */
  normalizeInFragment?: boolean;
  /**
   * Per-fragment inputs: the varying carries ANOTHER input (e.g. the world position) and `finish` computes the
   * value in the fragment stage from the interpolated varying. Interpolating an already-normalised direction
   * (view direction) is wrong on large triangles; interpolating the position and normalising per pixel is exact.
   */
  via?: { input: BuiltinInput; space?: Space };
  finish?: (varying: string, use: UseSet) => string;
}

/** Stable identifier fragment for an input, e.g. `positionWorld`, `uv0`. */
export const inputSlug = (input: BuiltinInput, space?: Space): string =>
  space ? `${input}${space[0]!.toUpperCase()}${space.slice(1)}` : input;

/** Language spelling needed to describe built-in inputs (one description table serves GLSL, WGSL and HLSL). */
export interface InputSyntax {
  vec(n: 2 | 3 | 4): string;
  /** `vec3(a, b, c)`. */
  v3(a: string, b: string, c: string): string;
  /** `vec4(xyz, w)`. */
  v4(xyz: string, w: string): string;
  /** Identifier of the stage-global holding a vertex attribute. */
  attr(a: AttributeName): string;
  /** Read a host built-in uniform. */
  uni(u: BuiltinUniformName): string;
  mulM4V4(m: string, v: string): string;
  mulM3V3(m: string, v: string): string;
  /** Upper-left 3×3 of a mat4 expression (`m` is a plain name / member access, so it may be repeated). */
  mat3(m: string): string;
  normalize(x: string): string;
  cross(a: string, b: string): string;
  dot(a: string, b: string): string;
  /** Float literal. */
  num(v: number): string;
  /** Expression for `faceSign` / `vertexId` (registered as stage built-ins by the stage generator). */
  faceSign: string;
  vertexId: string;
  instanceId: string;
  /** v' = 1 - v at every UV input. */
  flipUvV: boolean;
  /** `x * s` for a float scalar `s`. */
  oneMinus: (x: string) => string;
}

const attrOf = (s: InputSyntax, use: UseSet, a: AttributeName): string => (use.attrs.add(a), s.attr(a));
const uni = (s: InputSyntax, use: UseSet, u: BuiltinUniformName): string => (use.uniforms.add(u), s.uni(u));

/** Right-associated chain `m0 * (m1 * (… * v))`. */
const chain = (s: InputSyntax, mats: string[], v: string): string => mats.reduceRight((acc, m) => s.mulM4V4(m, acc), v);

/** Describe a built-in input for the language of `s`. */
export function describeInputWith(s: InputSyntax, input: BuiltinInput, space?: Space): InputDesc {
  const worldPos = (pos: string, use: UseSet): string =>
    `${s.mulM4V4(uni(s, use, "ks_Model"), s.v4(pos, s.num(1)))}.xyz`;
  const toWorldDir = (base: string, use: UseSet): string =>
    s.normalize(s.mulM3V3(s.mat3(uni(s, use, "ks_Model")), base));
  const toViewDir = (world: string, use: UseSet): string =>
    s.normalize(s.mulM3V3(s.mat3(uni(s, use, "ks_View")), world));
  const normalWorld = (use: UseSet): string =>
    s.normalize(s.mulM3V3(uni(s, use, "ks_NormalMatrix"), attrOf(s, use, "a_normal")));
  const tangentObj = (use: UseSet): string => `${attrOf(s, use, "a_tangent")}.xyz`;
  const bitangentObj = (use: UseSet): string =>
    `(${s.cross(attrOf(s, use, "a_normal"), tangentObj(use))} * ${attrOf(s, use, "a_tangent")}.w)`;
  const viewDirWorld = (pos: string, use: UseSet): string =>
    s.normalize(`${uni(s, use, "ks_CameraPos")} - ${worldPos(pos, use)}`);
  const clip = (p: string, u: UseSet): string =>
    stripParens(chain(s, [uni(s, u, "ks_Projection"), uni(s, u, "ks_View"), uni(s, u, "ks_Model")], s.v4(p, s.num(1))));

  const noPos = (
    cat: InputCategory,
    ty: StorageType,
    f: (use: UseSet) => string,
    normalizeInFragment = false,
  ): InputDesc => ({
    cat,
    ty,
    vertex: (_pos, use) => f(use),
    usesPosition: false,
    ...(normalizeInFragment ? { normalizeInFragment } : {}),
  });
  const dirInput = (obj: (u: UseSet) => string, constant: string, sp: Space): InputDesc => {
    switch (sp) {
      case "tangent":
        return noPos("constant", "vec3", () => constant);
      case "object":
        return noPos("attribute", "vec3", obj, true);
      case "world":
        return noPos("derived", "vec3", (u) => toWorldDir(obj(u), u), true);
      case "view":
        return noPos("derived", "vec3", (u) => toViewDir(toWorldDir(obj(u), u), u), true);
      default:
        throw new Error(`Direction input is not available in ${sp} space`);
    }
  };
  const normalIn = (sp: Space): InputDesc => {
    if (sp === "tangent") return noPos("constant", "vec3", () => s.v3(s.num(0), s.num(0), s.num(1)));
    if (sp === "object") return noPos("attribute", "vec3", (u) => attrOf(s, u, "a_normal"), true);
    if (sp === "world") return noPos("derived", "vec3", normalWorld, true);
    if (sp === "view") return noPos("derived", "vec3", (u) => toViewDir(normalWorld(u), u), true);
    throw new Error(`normal is not available in ${sp} space`);
  };
  const viewDirIn = (sp: Space): InputDesc => {
    const perPixel = (finish: (toCamera: string, u: UseSet) => string): InputDesc => ({
      cat: "derived",
      ty: "vec3",
      usesPosition: true,
      vertex: viewDirWorld,
      via: { input: "position", space: "world" },
      finish: (v, u) => finish(`${uni(s, u, "ks_CameraPos")} - ${v}`, u),
    });
    switch (sp) {
      case "world":
        return perPixel((d) => s.normalize(d));
      case "object":
        return perPixel((d, u) => s.normalize(s.mulM3V3(s.mat3(uni(s, u, "ks_WorldToObject")), `(${d})`)));
      case "view":
        return perPixel((d, u) => s.normalize(s.mulM3V3(s.mat3(uni(s, u, "ks_View")), `(${d})`)));
      case "tangent":
        return {
          cat: "derived",
          ty: "vec3",
          usesPosition: true,
          normalizeInFragment: true,
          vertex: (p, u) => {
            const w = viewDirWorld(p, u);
            return s.v3(
              s.dot(w, toWorldDir(tangentObj(u), u)),
              s.dot(w, toWorldDir(bitangentObj(u), u)),
              s.dot(w, normalWorld(u)),
            );
          },
        };
      default:
        throw new Error(`viewDir is not available in ${sp} space`);
    }
  };
  const positionIn = (sp: Space): InputDesc => {
    const make = (cat: InputCategory, ty: StorageType, f: (pos: string, u: UseSet) => string): InputDesc => ({
      cat,
      ty,
      vertex: f,
      usesPosition: true,
    });
    switch (sp) {
      case "object":
        return make("attribute", "vec3", (p, u) => (attrOf(s, u, "a_position"), p));
      case "world":
        return make("derived", "vec3", worldPos);
      case "view":
        return make(
          "derived",
          "vec3",
          (p, u) => `${chain(s, [uni(s, u, "ks_View"), uni(s, u, "ks_Model")], s.v4(p, s.num(1)))}.xyz`,
        );
      default:
        return make("derived", "vec4", clip);
    }
  };
  const uv = (name: AttributeName): InputDesc =>
    noPos("attribute", "vec2", (u) => {
      const a = attrOf(s, u, name);
      return s.flipUvV ? `${s.vec(2)}(${a}.x, ${s.oneMinus(`${a}.y`)})` : a;
    });

  switch (input) {
    case "uv0":
    case "uv1":
    case "uv2":
    case "uv3":
      return uv(`a_${input}` as AttributeName);
    case "vertexColor":
      return noPos("attribute", "vec4", (u) => attrOf(s, u, "a_color"));
    case "position":
      return positionIn(space ?? "object");
    case "normal":
      return normalIn(space ?? "object");
    case "tangent":
      return dirInput(tangentObj, s.v3(s.num(1), s.num(0), s.num(0)), space ?? "object");
    case "bitangent":
      return dirInput(bitangentObj, s.v3(s.num(0), s.num(1), s.num(0)), space ?? "object");
    case "viewDir":
      return viewDirIn(space ?? "world");
    case "time":
      return noPos("uniform", "float", (u) => uni(s, u, "ks_Time"));
    case "deltaTime":
      return noPos("uniform", "float", (u) => uni(s, u, "ks_DeltaTime"));
    case "smoothDeltaTime":
      return noPos("uniform", "float", (u) => uni(s, u, "ks_SmoothDeltaTime"));
    case "cameraPos":
      return noPos("uniform", "vec3", (u) => uni(s, u, "ks_CameraPos"));
    case "screenPos":
      return { cat: "derived", ty: "vec4", vertex: clip, usesPosition: true };
    case "faceSign":
      return noPos("builtin", "float", () => s.faceSign);
    case "vertexId":
      return noPos("builtin", "int", () => s.vertexId);
    case "instanceId":
      return noPos("builtin", "int", () => s.instanceId);
  }
}
