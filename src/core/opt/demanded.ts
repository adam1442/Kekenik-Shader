import { INTRINSICS } from "../ir/intrinsics";
import type { ExprId, IRBody, IRExpr } from "../ir/types";
import { operandsOf } from "../ir/walk";
import { type StorageType, componentCount, floatVecOfSize } from "../types/shaderType";
import { mapOperands } from "./mapOperands";

export interface NarrowResult {
  body: IRBody;
  roots: ExprId[];
  /** New id → id of the expression it descends from. */
  origin: ExprId[];
  /** Number of expressions whose vector width was reduced. */
  narrowed: number;
}

const VEC = new Set(["vec2", "vec3", "vec4"]);
const CW_BINARY = new Set(["add", "sub", "mul", "div"]);
const full = (ty: StorageType): number => (1 << Math.max(1, componentCount(ty))) - 1;
const LETTERS = "xyzw";

/** Component-wise expression whose vector width can be reduced to the demanded components. */
function narrowable(e: IRExpr, ty: (id: ExprId) => StorageType): boolean {
  if (!VEC.has(e.ty)) return false;
  const opsOk = (ids: ExprId[]): boolean => ids.every((o) => ty(o) === e.ty || ty(o) === "float");
  switch (e.op) {
    case "binary":
      return CW_BINARY.has(e.kind) && opsOk([e.a, e.b]);
    case "unary":
      return e.kind === "neg";
    case "intrinsic":
      return INTRINSICS[e.fn].kind === "cw" && opsOk(e.args);
    case "select":
      return opsOk([e.a, e.b]) && ty(e.cond) === "bool";
    case "const":
      return true;
    default:
      return false;
  }
}

/**
 * Demanded-components pass : a BACKWARD analysis finds which components of every vector value are actually read
 * (through swizzles), then component-wise math (add/sub/mul/div/neg/cw intrinsics/select/const) is recomputed at the narrower width —
 * `vec4` math of which only `.x` survives becomes scalar math. Component-wise operations are independent per lane, so the result is
 * bit-identical. Non-component-wise users (dot, normalize, construct, calls, outputs, …) demand every component.
 */
export function narrowBody(src: IRBody, roots: readonly ExprId[]): NarrowResult {
  const ex = src.exprs;
  const ty = (id: ExprId): StorageType => ex[id]!.ty;
  const demand = new Uint16Array(ex.length);
  for (const r of roots) demand[r] = full(ty(r));
  for (let i = ex.length - 1; i >= 0; i--) {
    const d = demand[i]!;
    if (d === 0) continue;
    const e = ex[i]!;
    if (e.op === "swizzle") {
      let bits = 0;
      for (let k = 0; k < e.mask.length; k++) if (d & (1 << k)) bits |= 1 << LETTERS.indexOf(e.mask[k]!);
      demand[e.src] |= bits;
    } else if (narrowable(e, ty)) {
      for (const o of operandsOf(e)) demand[o] |= ty(o) === e.ty ? d : full(ty(o));
    } else {
      for (const o of operandsOf(e)) demand[o] |= full(ty(o));
    }
  }

  const out: IRExpr[] = [];
  const origin: ExprId[] = [];
  const hold: Array<{ id: ExprId; comps: number[] } | undefined> = new Array(ex.length);
  let narrowed = 0;
  const emit = (e: IRExpr, from: ExprId): ExprId => {
    out.push(e);
    origin.push(from);
    return out.length - 1;
  };
  const same = (a: number[], b: number[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);
  /** The components `wanted` (original indices, repetition allowed) of expression `o`, as an id in `out`. */
  const pickComps = (o: ExprId, wanted: number[], from: ExprId): ExprId => {
    const h = hold[o]!;
    if (same(h.comps, wanted)) return h.id;
    const idx = wanted.map((w) => h.comps.indexOf(w));
    if (h.comps.length === 1) return emit({ op: "construct", ty: floatVecOfSize(wanted.length), args: [h.id] }, from);
    return emit(
      { op: "swizzle", ty: floatVecOfSize(idx.length), src: h.id, mask: idx.map((k) => LETTERS[k]).join("") },
      from,
    );
  };
  const ident = (n: number): number[] => Array.from({ length: n }, (_, k) => k);

  for (let i = 0; i < ex.length; i++) {
    const e = ex[i]!;
    const d = demand[i]!;
    const n = Math.max(1, componentCount(e.ty));
    const fullMask = full(e.ty);
    if (d === 0) {
      hold[i] = { id: -1, comps: ident(n) };
      continue;
    } // unreachable: never referenced
    if (e.op === "swizzle") {
      const comps = ident(e.mask.length).filter((k) => d & (1 << k));
      const wanted = comps.map((k) => LETTERS.indexOf(e.mask[k]!));
      if (comps.length < e.mask.length) narrowed++;
      const srcHold = hold[e.src]!;
      // Whole swizzle kept → emit it as is (operand already mapped); partial → pick only the demanded source components.
      if (comps.length === e.mask.length && same(srcHold.comps, ident(componentCount(ex[e.src]!.ty))))
        hold[i] = {
          id: emit(
            mapOperands(e, () => srcHold.id),
            i,
          ),
          comps,
        };
      else hold[i] = { id: pickComps(e.src, wanted, i), comps };
      continue;
    }
    if (d !== fullMask && narrowable(e, ty)) {
      const comps = ident(n).filter((k) => d & (1 << k));
      const nty = floatVecOfSize(comps.length);
      narrowed++;
      if (e.op === "const")
        hold[i] = { id: emit({ op: "const", ty: nty, value: comps.map((k) => e.value[k]!) }, i), comps };
      else
        hold[i] = {
          id: emit(
            mapOperands({ ...e, ty: nty } as IRExpr, (o) =>
              ty(o) === e.ty ? pickComps(o, comps, i) : pickComps(o, [0], i),
            ),
            i,
          ),
          comps,
        };
      continue;
    }
    hold[i] = {
      id: emit(
        mapOperands(e, (o) => pickComps(o, ident(Math.max(1, componentCount(ty(o)))), i)),
        i,
      ),
      comps: ident(n),
    };
  }
  return { body: { exprs: out }, roots: roots.map((r) => hold[r]!.id), origin, narrowed };
}
