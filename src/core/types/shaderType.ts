/**
 * Kekenik Shader type system — port-level types.
 *
 * `ShaderType` is what the user sees on ports / wires. `color` (RGB, vec3 storage) and `color4` (RGBA,
 * vec4 storage) are vec3/vec4 carrying the *color semantic*. IR works on `StorageType` (colors erased).
 */
export const SHADER_TYPES = [
  "float",
  "int",
  "bool",
  "vec2",
  "vec3",
  "vec4",
  "color",
  "color4",
  "mat2",
  "mat3",
  "mat4",
  "texture2D",
  /** Added by 2 (E9): `texture2DArray` samples with (u, v, layer), `texture3D` with (u, v, w), `textureCube` with a direction. */
  "texture2DArray",
  "texture3D",
  "textureCube",
  "sampler",
] as const;

export type ShaderType = (typeof SHADER_TYPES)[number];

/** Types the IR / backends actually see (color semantics erased). */
export type StorageType = Exclude<ShaderType, "color" | "color4">;

export function isShaderType(v: unknown): v is ShaderType {
  return typeof v === "string" && (SHADER_TYPES as readonly string[]).includes(v);
}

/** Erase the color semantic: color → vec3, color4 → vec4. */
export function storageOf(t: ShaderType): StorageType {
  if (t === "color") return "vec3";
  if (t === "color4") return "vec4";
  return t;
}

export const isColor = (t: ShaderType): boolean => t === "color" || t === "color4";
export const isScalar = (t: ShaderType): boolean => t === "float" || t === "int" || t === "bool";
export const isMatrix = (t: ShaderType): boolean => t === "mat2" || t === "mat3" || t === "mat4";
export const isOpaque = (t: ShaderType): boolean => isTextureType(t) || t === "sampler";
/** Every texture kind (2D, 2D array, 3D, cube) — a sampler is not a texture. */
export function isTextureType(t: string): t is TextureType {
  return t === "texture2D" || t === "texture2DArray" || t === "texture3D" || t === "textureCube";
}
export type TextureType = "texture2D" | "texture2DArray" | "texture3D" | "textureCube";
/** Coordinate operand type of a `sample` on the given texture kind (array: xy + layer; 3D: uvw; cube: direction). */
export const sampleCoordType = (t: TextureType): "vec2" | "vec3" => (t === "texture2D" ? "vec2" : "vec3");
/** Derivative operand type of a gradient sample (the array layer has no derivative). */
export const sampleGradType = (t: TextureType): "vec2" | "vec3" =>
  t === "texture2D" || t === "texture2DArray" ? "vec2" : "vec3";
/** vec2 / vec3 / vec4 / color / color4. */
export const isVectorLike = (t: ShaderType): boolean => t === "vec2" || t === "vec3" || t === "vec4" || isColor(t);

/** Number of scalar components of a value-type; matrices count n*n; opaque types are 0. */
export function componentCount(t: ShaderType): number {
  switch (t) {
    case "float":
    case "int":
    case "bool":
      return 1;
    case "vec2":
      return 2;
    case "vec3":
    case "color":
      return 3;
    case "vec4":
    case "color4":
      return 4;
    case "mat2":
      return 4;
    case "mat3":
      return 9;
    case "mat4":
      return 16;
    default:
      return 0;
  }
}

/** Column count for matrices (2,3,4), 0 otherwise. */
export function matrixDim(t: ShaderType): number {
  return t === "mat2" ? 2 : t === "mat3" ? 3 : t === "mat4" ? 4 : 0;
}

/** Float vector storage type with `n` components (1 → float). */
export function floatVecOfSize(n: number): StorageType {
  if (n === 1) return "float";
  if (n === 2) return "vec2";
  if (n === 3) return "vec3";
  if (n === 4) return "vec4";
  throw new Error(`No float vector with ${n} components`);
}

/** Matrix type for a column count. */
export function matrixOfDim(n: number): StorageType {
  if (n === 2) return "mat2";
  if (n === 3) return "mat3";
  if (n === 4) return "mat4";
  throw new Error(`No matrix of dimension ${n}`);
}
