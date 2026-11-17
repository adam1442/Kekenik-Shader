import { T } from "../../types/generics";
import { baseNode, binaryIntrinsic, fvIn, outSame } from "../kit";

const CAT = "Math/Vector";

export const dotNode = baseNode({
  id: "dot",
  category: CAT,
  name: "Dot Product",
  synonyms: ["dot", "inner product", "scalar product"],
  description: "A · B.",
  inputs: [fvIn("a", "A", 0), fvIn("b", "B", 0)],
  outputs: [{ id: "out", name: "Out", type: T("float") }],
  build: (c) => ({ out: c.b.intrinsic("dot", [c.in("a"), c.in("b")]) }),
});

export const crossNode = baseNode({
  id: "cross",
  category: CAT,
  name: "Cross Product",
  synonyms: ["cross", "vector product", "perpendicular"],
  description: "A × B (3D only).",
  inputs: [
    { id: "a", name: "A", type: T("vec3"), default: [1, 0, 0] },
    { id: "b", name: "B", type: T("vec3"), default: [0, 1, 0] },
  ],
  outputs: [{ id: "out", name: "Out", type: T("vec3") }],
  build: (c) => ({ out: c.b.intrinsic("cross", [c.in("a"), c.in("b")]) }),
});

export const normalizeNode = baseNode({
  id: "normalize",
  category: CAT,
  name: "Normalize",
  synonyms: ["unit vector", "direction"],
  description: "Scales the vector to length 1 (a zero vector is undefined).",
  inputs: [fvIn("in", "In", 1)],
  outputs: [outSame("in")],
  build: (c) => ({ out: c.b.intrinsic("normalize", [c.in("in")]) }),
});

export const lengthNode = baseNode({
  id: "length",
  category: CAT,
  name: "Length",
  synonyms: ["magnitude", "norm"],
  description: "Length of the vector.",
  inputs: [fvIn("in", "In", 0)],
  outputs: [{ id: "out", name: "Out", type: T("float") }],
  build: (c) => ({ out: c.b.intrinsic("length", [c.in("in")]) }),
});

export const distanceNode = baseNode({
  id: "distance",
  category: CAT,
  name: "Distance",
  synonyms: ["dist"],
  description: "Distance between points A and B.",
  inputs: [fvIn("a", "A", 0), fvIn("b", "B", 0)],
  outputs: [{ id: "out", name: "Out", type: T("float") }],
  build: (c) => ({ out: c.b.intrinsic("distance", [c.in("a"), c.in("b")]) }),
});

export const reflectNode = binaryIntrinsic(
  "reflect",
  "Reflection",
  "reflect",
  CAT,
  "Reflects the incident vector around the (normalized) normal.",
  ["reflect", "bounce"],
  [0, 0],
  ["Incident", "Normal"],
);
