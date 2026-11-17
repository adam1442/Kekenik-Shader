import type { PortDef, ResolvedPorts } from "../../registry/nodeDef";
import { T } from "../../types/generics";

/** Shared port builders for the procedural library . */
export type Dim = 1 | 2 | 3;
export const parseDim = (v: unknown, fallback: Dim = 2): Dim =>
  v === "1" || v === 1 ? 1 : v === "3" || v === 3 ? 3 : v === "2" || v === 2 ? 2 : fallback;
export const DIM_OPTIONS_123: Array<[string, string]> = [
  ["1", "1D"],
  ["2", "2D"],
  ["3", "3D"],
];
export const DIM_OPTIONS_23: Array<[string, string]> = [
  ["2", "2D"],
  ["3", "3D"],
];

/** The coordinate input: float (1D, defaults to Time), vec2 (defaults to UV0) or vec3 (defaults to object-space Position). */
export function coordPort(dim: Dim, id = "p"): PortDef {
  if (dim === 1)
    return {
      id,
      name: "X",
      type: T("float"),
      defaultInput: { input: "time" },
      tooltip: "1D coordinate (defaults to Time).",
    };
  if (dim === 2)
    return {
      id,
      name: "P",
      type: T("vec2"),
      defaultInput: { input: "uv0" },
      tooltip: "2D coordinate (defaults to UV0).",
    };
  return {
    id,
    name: "P",
    type: T("vec3"),
    defaultInput: { input: "position", space: "object" },
    tooltip: "3D coordinate (defaults to object-space Position).",
  };
}

export const floatPort = (id: string, name: string, def: number, tooltip?: string): PortDef => ({
  id,
  name,
  type: T("float"),
  default: def,
  ...(tooltip ? { tooltip } : {}),
});
export const vec2Port = (id: string, name: string, def: [number, number], tooltip?: string): PortDef => ({
  id,
  name,
  type: T("vec2"),
  default: def,
  ...(tooltip ? { tooltip } : {}),
});
export const vec3Port = (id: string, name: string, def: [number, number, number], tooltip?: string): PortDef => ({
  id,
  name,
  type: T("vec3"),
  default: def,
  ...(tooltip ? { tooltip } : {}),
});
export const outPort = (
  id: string,
  name: string,
  type: "float" | "vec2" | "vec3" | "vec4" | "color" | "mat2" | "mat3" | "mat4",
): PortDef => ({ id, name, type: T(type) });

export const ports = (inputs: PortDef[], outputs: PortDef[]): ResolvedPorts => ({ inputs, outputs });
