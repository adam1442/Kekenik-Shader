import { T } from "../types/generics";
import { defineNode } from "./define";
import { floatIn } from "./kit";

export const floatNode = defineNode({
  id: "float",
  category: "Input/Basic",
  name: "Float",
  synonyms: ["number", "scalar", "constant"],
  description: "A constant scalar value.",
  inputs: [floatIn("x", "X")],
  outputs: [{ id: "out", name: "Out", type: T("float") }],
  build: (c) => ({ out: c.in("x") }),
});

export const vector2Node = defineNode({
  id: "vector2",
  category: "Input/Basic",
  name: "Vector 2",
  synonyms: ["vec2", "float2"],
  description: "Builds a 2-component vector.",
  inputs: [floatIn("x", "X"), floatIn("y", "Y")],
  outputs: [{ id: "out", name: "Out", type: T("vec2") }],
  build: (c) => ({ out: c.b.construct("vec2", [c.in("x"), c.in("y")]) }),
});

export const vector3Node = defineNode({
  id: "vector3",
  category: "Input/Basic",
  name: "Vector 3",
  synonyms: ["vec3", "float3"],
  description: "Builds a 3-component vector.",
  inputs: [floatIn("x", "X"), floatIn("y", "Y"), floatIn("z", "Z")],
  outputs: [{ id: "out", name: "Out", type: T("vec3") }],
  build: (c) => ({ out: c.b.construct("vec3", [c.in("x"), c.in("y"), c.in("z")]) }),
});

export const vector4Node = defineNode({
  id: "vector4",
  category: "Input/Basic",
  name: "Vector 4",
  synonyms: ["vec4", "float4"],
  description: "Builds a 4-component vector.",
  inputs: [floatIn("x", "X"), floatIn("y", "Y"), floatIn("z", "Z"), floatIn("w", "W")],
  outputs: [{ id: "out", name: "Out", type: T("vec4") }],
  build: (c) => ({ out: c.b.construct("vec4", [c.in("x"), c.in("y"), c.in("z"), c.in("w")]) }),
});

export const colorNode = defineNode({
  id: "color",
  category: "Input/Basic",
  name: "Color",
  synonyms: ["rgba", "tint"],
  description: "A constant RGBA color (HDR allowed).",
  params: [
    { id: "value", label: "Color", control: "color", default: [1, 1, 1, 1] },
    { id: "hdr", label: "HDR", control: "bool", default: false },
  ],
  outputs: [{ id: "out", name: "Out", type: T("color4"), tag: { semantic: "color" } }],
  build: (c) => {
    const v = c.param<number[]>("value");
    if (!Array.isArray(v) || v.length !== 4) c.fail("Color value must have 4 components (r, g, b, a)");
    return { out: c.b.constOf("vec4", v) };
  },
});
