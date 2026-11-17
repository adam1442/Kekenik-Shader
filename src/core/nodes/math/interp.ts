import { floatVec, T } from "../../types/generics";
import { baseNode, fvIn, outSame } from "../kit";

const CAT = "Math/Interpolation";

export const lerpNode = baseNode({
  id: "lerp",
  category: CAT,
  name: "Lerp",
  synonyms: ["mix", "blend", "interpolate"],
  description: "A + (B − A)·T — linear interpolation.",
  inputs: [fvIn("a", "A", 0), fvIn("b", "B", 1), fvIn("t", "T", 0.5)],
  outputs: [outSame("a")],
  build: (c) => ({ out: c.b.intrinsic("mix", [c.in("a"), c.in("b"), c.in("t")]) }),
});

export const inverseLerpNode = baseNode({
  id: "inverseLerp",
  category: CAT,
  name: "Inverse Lerp",
  synonyms: ["unlerp", "normalize range", "inverse mix"],
  description: "(T − A) ÷ (B − A): where T lies between A and B (0 at A, 1 at B).",
  inputs: [fvIn("a", "A", 0), fvIn("b", "B", 1), fvIn("t", "T", 0.5)],
  outputs: [outSame("a")],
  build: (c) => ({ out: c.b.div(c.b.sub(c.in("t"), c.in("a")), c.b.sub(c.in("b"), c.in("a"))) }),
});

export const remapNode = baseNode({
  id: "remap",
  category: CAT,
  name: "Remap",
  synonyms: ["map range", "rescale", "convert range"],
  description: "Maps In from [In Min, In Max] to [Out Min, Out Max].",
  inputs: [
    fvIn("in", "In", 0),
    { id: "inMin", name: "In Min", type: T("float"), default: -1 },
    { id: "inMax", name: "In Max", type: T("float"), default: 1 },
    { id: "outMin", name: "Out Min", type: T("float"), default: 0 },
    { id: "outMax", name: "Out Max", type: T("float"), default: 1 },
  ],
  outputs: [outSame("in")],
  build: (c) => {
    const t = c.b.div(c.b.sub(c.in("in"), c.in("inMin")), c.b.sub(c.in("inMax"), c.in("inMin")));
    return { out: c.b.add(c.in("outMin"), c.b.mul(t, c.b.sub(c.in("outMax"), c.in("outMin")))) };
  },
});

export const stepNode = baseNode({
  id: "step",
  category: CAT,
  name: "Step",
  synonyms: ["threshold", "edge"],
  description: "0 where In < Edge, otherwise 1.",
  inputs: [fvIn("edge", "Edge", 0.5), fvIn("in", "In", 0)],
  outputs: [outSame("in")],
  build: (c) => ({ out: c.b.intrinsic("step", [c.in("edge"), c.in("in")]) }),
});

export const smoothstepNode = baseNode({
  id: "smoothstep",
  category: CAT,
  name: "Smoothstep",
  synonyms: ["smooth step", "hermite", "ease"],
  description: "Smooth 0→1 transition (3t²−2t³) as In goes from Edge 1 to Edge 2.",
  inputs: [
    fvIn("edge1", "Edge 1", 0),
    fvIn("edge2", "Edge 2", 1),
    { id: "in", name: "In", type: floatVec("T"), default: 0.5 },
  ],
  outputs: [outSame("in")],
  build: (c) => ({ out: c.b.intrinsic("smoothstep", [c.in("edge1"), c.in("edge2"), c.in("in")]) }),
});
