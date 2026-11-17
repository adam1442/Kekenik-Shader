import { componentCount } from "../types/shaderType";
import { T, floatVec, numeric, sameAs } from "../types/generics";
import { defineNode } from "./define";
import { floatIn, numIn } from "./kit";

export const addNode = defineNode({
  id: "add",
  category: "Math/Basic",
  name: "Add",
  synonyms: ["plus", "sum", "+"],
  description: "A + B (component-wise).",
  inputs: [numIn("a", "A", 0), numIn("b", "B", 0)],
  outputs: [{ id: "out", name: "Out", type: numeric("T") }],
  build: (c) => ({ out: c.b.add(c.in("a"), c.in("b")) }),
});

export const multiplyNode = defineNode({
  id: "multiply",
  category: "Math/Basic",
  name: "Multiply",
  synonyms: ["mul", "times", "product", "*"],
  description: "A × B (component-wise).",
  inputs: [numIn("a", "A", 1), numIn("b", "B", 1)],
  outputs: [{ id: "out", name: "Out", type: numeric("T") }],
  build: (c) => ({ out: c.b.mul(c.in("a"), c.in("b")) }),
});

const comp = (name: string, id: string) => ({ id, name, type: T("float") });

export const splitNode = defineNode({
  id: "split",
  category: "Channel",
  name: "Split",
  synonyms: ["break", "decompose", "swizzle"],
  description: "Splits a vector into its components (missing components are 0).",
  inputs: [{ id: "in", name: "In", type: floatVec("T"), default: 0 }],
  outputs: [comp("R", "r"), comp("G", "g"), comp("B", "b"), comp("A", "a")],
  build: (c) => {
    const v = c.in("in");
    const n = componentCount(c.inType("in"));
    const pick = (i: number) => (i >= n ? c.b.float(0) : n === 1 ? v : c.b.swizzle(v, "xyzw"[i]!));
    return { r: pick(0), g: pick(1), b: pick(2), a: pick(3) };
  },
});

export const combineNode = defineNode({
  id: "combine",
  category: "Channel",
  name: "Combine",
  synonyms: ["compose", "make vector"],
  description: "Combines scalars into vectors.",
  inputs: [floatIn("r", "R"), floatIn("g", "G"), floatIn("b", "B"), floatIn("a", "A")],
  outputs: [
    { id: "rgba", name: "RGBA", type: T("vec4") },
    { id: "rgb", name: "RGB", type: T("vec3") },
    { id: "rg", name: "RG", type: T("vec2") },
  ],
  build: (c) => {
    const [r, g, b, a] = [c.in("r"), c.in("g"), c.in("b"), c.in("a")] as [number, number, number, number];
    return {
      rgba: c.b.construct("vec4", [r, g, b, a]),
      rgb: c.b.construct("vec3", [r, g, b]),
      rg: c.b.construct("vec2", [r, g]),
    };
  },
});

export const ddxNode = defineNode({
  id: "ddx",
  category: "Math/Derivative",
  name: "DDX",
  synonyms: ["dFdx", "derivative"],
  description: "Screen-space partial derivative along X (fragment stage only).",
  inputs: [{ id: "in", name: "In", type: floatVec("T"), default: 0 }],
  outputs: [{ id: "out", name: "Out", type: sameAs("in") }],
  build: (c) => ({ out: c.b.deriv("ddx", c.in("in")) }),
});
