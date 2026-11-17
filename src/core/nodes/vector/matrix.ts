import { T } from "../../types/generics";
import type { PortDef } from "../../registry/nodeDef";
import { floatVecOfSize, matrixOfDim } from "../../types/shaderType";
import type { ShaderType } from "../../types/shaderType";
import { baseNode, enumParam } from "../kit";

const CAT = "Matrix";
const dimOf = (v: unknown): number => Math.min(4, Math.max(2, Number(v ?? 3) || 3));
const identityCol = (n: number, i: number): number[] => Array.from({ length: n }, (_, k) => (k === i ? 1 : 0));
const identity = (n: number): number[] =>
  Array.from({ length: n * n }, (_, k) => (k % n === Math.floor(k / n) ? 1 : 0));
const SIZES: Array<[string, string]> = [
  ["2", "2 × 2"],
  ["3", "3 × 3"],
  ["4", "4 × 4"],
];

export const constructMatrixNode = baseNode({
  id: "constructMatrix",
  category: CAT,
  name: "Construct Matrix",
  synonyms: ["matrix", "mat2", "mat3", "mat4", "float4x4"],
  description: "Builds a matrix from column vectors (column-major, column-vector convention: M·v).",
  params: [enumParam("size", "Size", SIZES, "3")],
  dynamicPorts: (node) => {
    const n = dimOf(node.params.size);
    const inputs: PortDef[] = Array.from({ length: n }, (_, i) => ({
      id: `c${i}`,
      name: `Column ${i}`,
      type: T(floatVecOfSize(n) as ShaderType),
      default: identityCol(n, i),
    }));
    return { inputs, outputs: [{ id: "out", name: "Out", type: T(matrixOfDim(n)) }] };
  },
  build: (c) => {
    const n = dimOf(c.param("size"));
    return {
      out: c.b.construct(
        matrixOfDim(n),
        Array.from({ length: n }, (_, i) => c.in(`c${i}`)),
      ),
    };
  },
});

export const matrixMultiplyNode = baseNode({
  id: "matrixMultiply",
  category: CAT,
  name: "Matrix Multiply",
  synonyms: ["mul", "transform vector", "matmul", "M*v"],
  description: "M · V (matrix times vector) or M · N (matrix times matrix); the vector is on the right.",
  params: [
    enumParam("size", "Size", SIZES, "3"),
    enumParam(
      "rhs",
      "Right side",
      [
        ["vector", "Vector"],
        ["matrix", "Matrix"],
      ],
      "vector",
    ),
  ],
  dynamicPorts: (node) => {
    const n = dimOf(node.params.size);
    const m = matrixOfDim(n) as ShaderType;
    const matrix = node.params.rhs === "matrix";
    const r: ShaderType = matrix ? m : (floatVecOfSize(n) as ShaderType);
    return {
      inputs: [
        { id: "m", name: "M", type: T(m), default: identity(n) },
        { id: "v", name: matrix ? "N" : "V", type: T(r), default: matrix ? identity(n) : identityCol(n, 0) },
      ],
      outputs: [{ id: "out", name: "Out", type: T(r) }],
    };
  },
  build: (c) => ({ out: c.b.matmul(c.in("m"), c.in("v")) }),
});
