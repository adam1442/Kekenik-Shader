import type { BuiltinInput } from "../../ir/inputs";
import type { Space } from "../../types/semantics";
import { T } from "../../types/generics";
import { baseNode, enumParam } from "../kit";

const CAT = "Input/Geometry";
const DIR_SPACES: Array<[string, string]> = [
  ["object", "Object"],
  ["world", "World"],
  ["view", "View"],
  ["tangent", "Tangent"],
];

export function directionNode(
  id: string,
  name: string,
  input: BuiltinInput,
  def: Space,
  description: string,
  synonyms: string[],
) {
  return baseNode({
    id,
    category: CAT,
    name,
    synonyms,
    description,
    params: [enumParam("space", "Space", DIR_SPACES, def)],
    dynamicPorts: (node) => ({
      inputs: [],
      outputs: [
        {
          id: "out",
          name: "Out",
          type: T("vec3"),
          tag: { semantic: id === "normal" ? "normal" : "direction", space: String(node.params.space ?? def) as Space },
        },
      ],
    }),
    build: (c) => ({ out: c.b.input(input, c.param<string>("space") as Space) }),
  });
}

export const normalNode = directionNode(
  "normal",
  "Normal Vector",
  "normal",
  "object",
  "Surface normal in the chosen space (interpolated, normalized per pixel).",
  ["normal", "surface normal"],
);
export const viewDirectionNode = directionNode(
  "viewDirection",
  "View Direction",
  "viewDir",
  "world",
  "Unit vector from the surface towards the camera in the chosen space.",
  ["view dir", "eye vector", "camera direction"],
);

export const vertexColorNode = baseNode({
  id: "vertexColor",
  category: CAT,
  name: "Vertex Color",
  synonyms: ["vcolor", "mesh color", "vertex tint"],
  description: "Per-vertex color (RGBA) of the mesh, interpolated across the surface.",
  outputs: [
    { id: "rgba", name: "RGBA", type: T("color4"), tag: { semantic: "color" } },
    { id: "rgb", name: "RGB", type: T("color"), tag: { semantic: "color" } },
    { id: "a", name: "A", type: T("float") },
  ],
  build: (c) => {
    const v = c.b.input("vertexColor");
    return { rgba: v, rgb: c.b.swizzle(v, "xyz"), a: c.b.swizzle(v, "w") };
  },
});

export const screenPositionNode = baseNode({
  id: "screenPosition",
  category: CAT,
  name: "Screen Position",
  synonyms: ["screen uv", "fragcoord", "screen coordinates", "screen space", "viewport uv"],
  description:
    "Fragment-stage only. Raw = clip-space position (x, y, z, w) before the perspective divide. Normalized = xy / w remapped to 0–1 (screen UV; origin bottom-left, +Y up unless Origin = Top-left). NDC = xy / w in −1…1 (+Y up). Eye Depth = clip w = distance along the view axis in world units for a perspective camera (orthographic cameras: w = 1).",
  outputs: [
    { id: "normalized", name: "Normalized", type: T("vec2"), tag: { semantic: "uv" } },
    { id: "raw", name: "Raw", type: T("vec4") },
    { id: "ndc", name: "NDC", type: T("vec2") },
    { id: "eyeDepth", name: "Eye Depth", type: T("float") },
  ],
  params: [
    enumParam(
      "origin",
      "Origin",
      [
        ["bottomLeft", "Bottom-left (+Y up)"],
        ["topLeft", "Top-left (+Y down)"],
      ],
      "bottomLeft",
    ),
  ],
  stage: "fragment",
  targetNotes: {
    all: "Fragment stage only (clip-space position of the fragment). The preview and GLSL use bottom-left origin; choose Top-left to match image-space tools (V is flipped: y' = 1 − y).",
  },
  build: (c) => {
    const raw = c.b.input("screenPos");
    const ndc = c.b.div(c.b.swizzle(raw, "xy"), c.b.swizzle(raw, "w"));
    const uv = c.b.add(c.b.mul(ndc, c.b.float(0.5)), c.b.float(0.5));
    const flipped =
      c.param<string>("origin") === "topLeft"
        ? c.b.construct("vec2", [c.b.swizzle(uv, "x"), c.b.sub(c.b.float(1), c.b.swizzle(uv, "y"))])
        : uv;
    return { normalized: flipped, raw, ndc, eyeDepth: c.b.swizzle(raw, "w") };
  },
});
