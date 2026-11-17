import type { BuildContext, NodeDef, PortDef } from "../../registry/nodeDef";
import { T } from "../../types/generics";
import { floatVecOfSize, matrixOfDim } from "../../types/shaderType";
import type { ShaderType } from "../../types/shaderType";
import { baseNode, enumParam } from "../kit";
import { M, type V } from "./irm";

/**
 * Matrix operations built ONLY from existing IR ops (matmul against basis vectors extracts columns; construct re-assembles).
 * Convention: column-major storage, column-vector math (M·v). Entries are addressed a[row][col].
 */
const CAT = "Matrix";
const SIZES: Array<[string, string]> = [
  ["2", "2 × 2"],
  ["3", "3 × 3"],
  ["4", "4 × 4"],
];
const NOTE = {
  all: "Built from matmul (column extraction) + construct; no matrix intrinsics required, so it is identical on every target.",
};
const dimOf = (v: unknown): number => (v === "2" || v === 2 ? 2 : v === "4" || v === 4 ? 4 : 3);
const ident = (n: number): number[] => Array.from({ length: n * n }, (_, k) => (k % n === Math.floor(k / n) ? 1 : 0));
const vecTy = (n: number) => floatVecOfSize(n) as "vec2" | "vec3" | "vec4";
const inPort = (n: number): PortDef => ({ id: "m", name: "M", type: T(matrixOfDim(n)), default: ident(n) });

/** a[row][col] of a matrix expression. */
function entries(m: M, mat: V, n: number): V[][] {
  const cols: V[] = Array.from({ length: n }, (_, c) =>
    m.w(
      m.b.matmul(
        mat.id,
        m.b.constOf(
          vecTy(n),
          Array.from({ length: n }, (_, k) => (k === c ? 1 : 0)),
        ),
      ),
    ),
  );
  return Array.from({ length: n }, (_, r) => cols.map((col) => col.sw("xyzw"[r]!)));
}
const build = (m: M, a: V[][], n: number): V =>
  m.w(
    m.b.construct(
      matrixOfDim(n),
      Array.from({ length: n }, (_, c) => m.vec(vecTy(n), ...a.map((row) => row[c]!)).id),
    ),
  );

const minor = (a: V[][], i: number, j: number): V[][] =>
  a.filter((_, r) => r !== i).map((row) => row.filter((_, c) => c !== j));
function det(m: M, a: V[][]): V {
  if (a.length === 1) return a[0]![0]!;
  let acc: V | null = null;
  a[0]!.forEach((x, j) => {
    const term = x.mul(det(m, minor(a, 0, j)));
    acc = acc === null ? term : j % 2 === 0 ? acc.add(term) : acc.sub(term);
  });
  return acc!;
}

function matNode(
  id: string,
  name: string,
  syn: string[],
  desc: string,
  outputs: (n: number) => PortDef[],
  run: (m: M, a: V[][], n: number) => Record<string, V>,
): NodeDef {
  const ports = (n: number) => ({ inputs: [inPort(n)], outputs: outputs(n) });
  return baseNode({
    id,
    category: CAT,
    name,
    synonyms: syn,
    description: desc,
    inputs: ports(3).inputs,
    outputs: ports(3).outputs,
    params: [enumParam("size", "Size", SIZES, "3")],
    dynamicPorts: (node) => ports(dimOf(node.params.size)),
    targetNotes: NOTE,
    build: (c: BuildContext) => {
      const n = dimOf(c.param("size"));
      const m = new M(c.b);
      const out = run(m, entries(m, m.w(c.in("m")), n), n);
      return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.id]));
    },
  });
}
const matOut = (n: number): PortDef => ({ id: "out", name: "Out", type: T(matrixOfDim(n)) });
const f = (id: string, name: string): PortDef => ({ id, name, type: T("float") });

export const transposeNode = matNode(
  "matrixTranspose",
  "Matrix Transpose",
  ["transpose", "flip matrix", "mat transpose"],
  "Mᵀ: rows become columns (2×2, 3×3 or 4×4).",
  (n) => [matOut(n)],
  (m, a, n) => ({
    out: build(
      m,
      a[0]!.map((_, c) => a.map((row) => row[c]!)).map((row) => row),
      n,
    ),
  }),
);

export const determinantNode = matNode(
  "matrixDeterminant",
  "Matrix Determinant",
  ["determinant", "det", "mat determinant"],
  "det(M) by Laplace expansion (exact for 2×2 … 4×4). 0 means singular.",
  () => [f("out", "Out")],
  (m, a) => ({ out: det(m, a) }),
);

export const inverseNode = matNode(
  "matrixInverse",
  "Matrix Inverse",
  ["inverse", "invert matrix", "mat inverse"],
  "M⁻¹ = adj(M) / det(M). SINGULAR matrices (det exactly 0) are degenerate: Out = identity and Valid = 0 (Valid = 1 otherwise). Near-singular matrices give large but finite values; no tolerance is applied.",
  (n) => [matOut(n), f("valid", "Valid"), f("det", "Determinant")],
  (m, a, n) => {
    const d = det(m, a);
    const ok = d.ne(0);
    const inv = m.sel(ok, m.f(1).div(m.sel(ok, d, 1)), 0);
    const rows = a.map((_, i) =>
      a.map((_, j) => {
        const cof = det(m, minor(a, j, i));
        const v = (i + j) % 2 === 0 ? cof : cof.neg();
        return m.sel(ok, v.mul(inv), i === j ? 1 : 0);
      }),
    );
    return { out: build(m, rows, n), valid: m.sel(ok, 1, 0), det: d };
  },
);

export const matrixColumnsNode: NodeDef = (() => {
  const outs = (n: number): PortDef[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `c${i}`,
      name: `Column ${i}`,
      type: T(floatVecOfSize(n) as ShaderType),
    }));
  const ports = (n: number) => ({ inputs: [inPort(n)], outputs: outs(n) });
  return baseNode({
    id: "matrixColumns",
    category: CAT,
    name: "Matrix Columns",
    synonyms: ["split matrix", "matrix split", "get column", "matrix basis vectors"],
    description: "Splits a matrix into its column vectors (M·eᵢ). Column-major, column-vector convention.",
    inputs: ports(3).inputs,
    outputs: ports(3).outputs,
    params: [enumParam("size", "Size", SIZES, "3")],
    dynamicPorts: (node) => ports(dimOf(node.params.size)),
    targetNotes: NOTE,
    build: (c) => {
      const n = dimOf(c.param("size"));
      const m = new M(c.b);
      const mat = m.w(c.in("m"));
      return Object.fromEntries(
        Array.from({ length: n }, (_, i) => [
          `c${i}`,
          c.b.matmul(
            mat.id,
            c.b.constOf(
              vecTy(n),
              Array.from({ length: n }, (_, k) => (k === i ? 1 : 0)),
            ),
          ),
        ]),
      );
    },
  });
})();
