import { baseNode, binaryIntrinsic, enumParam, fill, fvIn, outSame, unaryIntrinsic } from "../kit";

const CAT = "Math/Trigonometry";

export const sinNode = unaryIntrinsic("sin", "Sine", "sin", CAT, "Sine of an angle in radians.", ["sine"]);
export const cosNode = unaryIntrinsic("cos", "Cosine", "cos", CAT, "Cosine of an angle in radians.", ["cosine"]);
export const tanNode = unaryIntrinsic("tan", "Tangent", "tan", CAT, "Tangent of an angle in radians.", ["tangent"]);
export const asinNode = unaryIntrinsic("asin", "Arcsine", "asin", CAT, "Inverse sine; In must be within −1…1.", [
  "arcsin",
  "inverse sine",
]);
export const acosNode = unaryIntrinsic("acos", "Arccosine", "acos", CAT, "Inverse cosine; In must be within −1…1.", [
  "arccos",
  "inverse cosine",
]);
export const atanNode = unaryIntrinsic("atan", "Arctangent", "atan", CAT, "Inverse tangent (−π/2…π/2).", [
  "arctan",
  "inverse tangent",
]);

/** Argument order is (Y, X): atan2(Y, X) = angle of the point (X, Y). */
export const atan2Node = binaryIntrinsic(
  "atan2",
  "Arctangent 2",
  "atan2",
  CAT,
  "Angle of the point (X, Y) in radians (−π…π). Y comes first.",
  ["atan2", "angle", "arctan2"],
  [0, 1],
  ["Y", "X"],
);

export const expNode = baseNode({
  id: "exp",
  category: "Math/Exponential",
  name: "Exponential",
  synonyms: ["exp", "e^x", "2^x"],
  description: "e^In or 2^In.",
  params: [
    enumParam(
      "base",
      "Base",
      [
        ["e", "e"],
        ["2", "2"],
      ],
      "e",
    ),
  ],
  inputs: [fvIn("in", "In", 0)],
  outputs: [outSame("in")],
  build: (c) => ({ out: c.b.intrinsic(c.param<string>("base") === "2" ? "exp2" : "exp", [c.in("in")]) }),
});

export const logNode = baseNode({
  id: "log",
  category: "Math/Exponential",
  name: "Logarithm",
  synonyms: ["log", "ln", "log2", "log10"],
  description: "Natural, base-2 or base-10 logarithm (In must be > 0).",
  params: [
    enumParam(
      "base",
      "Base",
      [
        ["e", "e (natural)"],
        ["2", "2"],
        ["10", "10"],
      ],
      "e",
    ),
  ],
  inputs: [fvIn("in", "In", 1)],
  outputs: [outSame("in")],
  build: (c) => {
    const base = c.param<string>("base");
    if (base === "2") return { out: c.b.intrinsic("log2", [c.in("in")]) };
    if (base === "10")
      return { out: c.b.div(c.b.intrinsic("log", [c.in("in")]), fill(c, c.outType("out"), Math.LN10)) };
    return { out: c.b.intrinsic("log", [c.in("in")]) };
  },
});
