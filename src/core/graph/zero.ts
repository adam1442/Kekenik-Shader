import type { PortValue } from "./types";
import type { ShaderType } from "../types/shaderType";

/** The neutral inline value of a port type (undefined for matrices / textures / samplers, which have no inline form). */
export function zeroValue(type: ShaderType): PortValue | undefined {
  switch (type) {
    case "float":
    case "int":
      return 0;
    case "bool":
      return false;
    case "vec2":
      return [0, 0];
    case "vec3":
    case "color":
      return [0, 0, 0];
    case "vec4":
      return [0, 0, 0, 0];
    case "color4":
      return [0, 0, 0, 1];
    default:
      return undefined;
  }
}
