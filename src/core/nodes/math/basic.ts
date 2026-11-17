import { numeric, sameAs } from "../../types/generics";
import { baseNode, binaryIntrinsic, fill, fvIn, numIn, outSame, unaryIntrinsic } from "../kit";

const CAT = "Math/Basic";

export const subtractNode = baseNode({
  id: "subtract",
  category: CAT,
  name: "Subtract",
  synonyms: ["sub", "minus", "difference", "-"],
  description: "A − B (component-wise).",
  inputs: [numIn("a", "A", 0), numIn("b", "B", 0)],
  outputs: [{ id: "out", name: "Out", type: numeric("T") }],
  build: (c) => ({ out: c.b.sub(c.in("a"), c.in("b")) }),
});

export const divideNode = baseNode({
  id: "divide",
  category: CAT,
  name: "Divide",
  synonyms: ["div", "quotient", "/"],
  description: "A ÷ B (component-wise). Integer inputs divide as integers.",
  inputs: [numIn("a", "A", 1), numIn("b", "B", 1)],
  outputs: [{ id: "out", name: "Out", type: numeric("T") }],
  build: (c) => ({ out: c.b.div(c.in("a"), c.in("b")) }),
});

export const powerNode = binaryIntrinsic(
  "power",
  "Power",
  "pow",
  CAT,
  "A raised to the power B (A must be ≥ 0).",
  ["pow", "exponent", "^"],
  [2, 2],
);
export const sqrtNode = unaryIntrinsic("sqrt", "Square Root", "sqrt", CAT, "Square root.", ["sqrt", "root"]);
export const moduloNode = binaryIntrinsic(
  "modulo",
  "Modulo",
  "mod",
  CAT,
  "A − B·floor(A/B): the result has the sign of B (never truncated).",
  ["mod", "fmod", "remainder", "%"],
  [0, 1],
);

export const absNode = baseNode({
  id: "abs",
  category: CAT,
  name: "Absolute",
  synonyms: ["abs", "magnitude"],
  description: "Absolute value.",
  inputs: [numIn("in", "In", 0)],
  outputs: [{ id: "out", name: "Out", type: numeric("T") }],
  build: (c) => ({ out: c.b.intrinsic("abs", [c.in("in")]) }),
});

export const negateNode = baseNode({
  id: "negate",
  category: CAT,
  name: "Negate",
  synonyms: ["neg", "invert sign", "minus"],
  description: "−In.",
  inputs: [numIn("in", "In", 0)],
  outputs: [{ id: "out", name: "Out", type: numeric("T") }],
  build: (c) => ({ out: c.b.unary("neg", c.in("in")) }),
});

export const signNode = unaryIntrinsic("sign", "Sign", "sign", CAT, "−1, 0 or 1 according to the sign of In.", [
  "signum",
]);
export const floorNode = unaryIntrinsic("floor", "Floor", "floor", "Math/Round", "Largest integer ≤ In.", [
  "round down",
]);
export const ceilNode = unaryIntrinsic("ceil", "Ceiling", "ceil", "Math/Round", "Smallest integer ≥ In.", [
  "ceiling",
  "round up",
]);
export const roundNode = unaryIntrinsic(
  "round",
  "Round",
  "round",
  "Math/Round",
  "Nearest integer (exact .5 rounds up on every target).",
  ["nearest"],
);
export const fractNode = unaryIntrinsic("fract", "Fraction", "fract", "Math/Round", "In − floor(In).", [
  "frac",
  "fractional part",
]);
export const saturateNode = unaryIntrinsic(
  "saturate",
  "Saturate",
  "saturate",
  "Math/Range",
  "Clamps to the 0–1 range.",
  ["clamp01", "clamp 0 1"],
);

export const minNode = baseNode({
  id: "minimum",
  category: "Math/Range",
  name: "Minimum",
  synonyms: ["min", "smaller"],
  description: "The smaller of A and B (component-wise).",
  inputs: [numIn("a", "A", 0), numIn("b", "B", 0)],
  outputs: [{ id: "out", name: "Out", type: numeric("T") }],
  build: (c) => ({ out: c.b.intrinsic("min", [c.in("a"), c.in("b")]) }),
});

export const maxNode = baseNode({
  id: "maximum",
  category: "Math/Range",
  name: "Maximum",
  synonyms: ["max", "larger"],
  description: "The larger of A and B (component-wise).",
  inputs: [numIn("a", "A", 0), numIn("b", "B", 0)],
  outputs: [{ id: "out", name: "Out", type: numeric("T") }],
  build: (c) => ({ out: c.b.intrinsic("max", [c.in("a"), c.in("b")]) }),
});

export const clampNode = baseNode({
  id: "clamp",
  category: "Math/Range",
  name: "Clamp",
  synonyms: ["limit", "constrain"],
  description: "Limits In to the range [Min, Max].",
  inputs: [numIn("in", "In", 0), numIn("min", "Min", 0), numIn("max", "Max", 1)],
  outputs: [{ id: "out", name: "Out", type: numeric("T") }],
  build: (c) => ({ out: c.b.intrinsic("clamp", [c.in("in"), c.in("min"), c.in("max")]) }),
});

export const oneMinusNode = baseNode({
  id: "oneMinus",
  category: CAT,
  name: "One Minus",
  synonyms: ["1-x", "invert", "complement"],
  description: "1 − In.",
  inputs: [fvIn("in", "In", 0)],
  outputs: [outSame("in")],
  build: (c) => ({ out: c.b.sub(fill(c, c.outType("out"), 1), c.in("in")) }),
});

export const reciprocalNode = baseNode({
  id: "reciprocal",
  category: CAT,
  name: "Reciprocal",
  synonyms: ["1/x", "inverse"],
  description: "1 ÷ In.",
  inputs: [fvIn("in", "In", 1)],
  outputs: [{ id: "out", name: "Out", type: sameAs("in") }],
  build: (c) => ({ out: c.b.div(fill(c, c.outType("out"), 1), c.in("in")) }),
});
