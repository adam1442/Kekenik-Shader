import type { ShaderType } from "@/core";

/**
 * Port visual language: one colour AND one shape per type so the graph stays readable without colour vision.
 * Pure data (also used by the wire renderer and the tests). CSS classes `kk-port--<shape>` draw the shapes.
 */
type PortShape = "circle" | "square" | "hex" | "diamond" | "grid" | "rect" | "tri" | "ring";
export type PortTypeKey = ShaderType | "generic";

export interface PortStyle {
  /** Solid colour (wires, glow, labels). */
  color: string;
  shape: PortShape;
  /** Optional CSS background for the dot (the `color` type uses a conic gradient). */
  fill?: string;
  /** Human label (tooltips). */
  label: string;
}

const CONIC = "conic-gradient(from 200deg, #ff5fa8, #ff9ad0, #ffb36b, #b08cff, #6fc8ff, #ff5fa8)";
const CONIC4 = "conic-gradient(from 200deg, #ff5fa8, #ff9ad0, #ffb36b, #b08cff, #6fc8ff, #ff5fa8)";

const PORT_STYLES: Readonly<Record<PortTypeKey, PortStyle>> = {
  float: { color: "#a3e635", shape: "circle", label: "Float" },
  int: { color: "#38bdf8", shape: "square", label: "Int" },
  bool: { color: "#ff7b6b", shape: "hex", label: "Bool" },
  vec2: { color: "#2dd4bf", shape: "diamond", label: "Vector 2" },
  vec3: { color: "#fbbf24", shape: "diamond", label: "Vector 3" },
  vec4: { color: "#fb923c", shape: "diamond", label: "Vector 4" },
  color: { color: "#f472b6", shape: "circle", fill: CONIC, label: "Color" },
  color4: { color: "#f472b6", shape: "ring", fill: CONIC4, label: "Color (RGBA)" },
  mat2: { color: "#a78bfa", shape: "grid", label: "Matrix 2×2" },
  mat3: { color: "#a78bfa", shape: "grid", label: "Matrix 3×3" },
  mat4: { color: "#a78bfa", shape: "grid", label: "Matrix 4×4" },
  texture2D: { color: "#e879f9", shape: "rect", label: "Texture 2D" },
  texture2DArray: { color: "#d946ef", shape: "rect", label: "Texture 2D Array" },
  texture3D: { color: "#c026d3", shape: "rect", label: "Texture 3D" },
  textureCube: { color: "#a21caf", shape: "rect", label: "Cubemap" },
  sampler: { color: "#94a3b8", shape: "tri", label: "Sampler" },
  generic: { color: "#8b93a7", shape: "ring", label: "Generic" },
};

export function portStyle(type: PortTypeKey | undefined): PortStyle {
  return PORT_STYLES[type ?? "generic"] ?? PORT_STYLES.generic;
}

/** Colour used for wires leaving / entering a port of this type. */
export const portColor = (type: PortTypeKey | undefined): string => portStyle(type).color;
