import type { StorageType } from "../../types/shaderType";

/** GLSL ES 3.00 spelling of an IR storage type. */
export function glslType(ty: StorageType): string {
  switch (ty) {
    case "float":
    case "int":
    case "bool":
    case "vec2":
    case "vec3":
    case "vec4":
    case "mat2":
    case "mat3":
    case "mat4":
      return ty;
    case "texture2D":
      return "sampler2D";
    case "texture2DArray":
      return "sampler2DArray";
    case "texture3D":
      return "sampler3D";
    case "textureCube":
      return "samplerCube";
    case "sampler":
      throw new Error(
        "GLSL has no separate sampler objects: sampler values cannot be used as function parameters or stored in variables",
      );
  }
}

export const GLSL_CTOR = { vec: (n: number) => `vec${n}`, mat: (n: number) => `mat${n}` } as const;
