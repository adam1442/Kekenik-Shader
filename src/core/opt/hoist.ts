import { BUILTIN_INPUTS } from "../ir/inputs";
import type { ExprId, IRExpr, IRModule } from "../ir/types";
import { operandsOf, reachableMask } from "../ir/walk";

/** Built-in inputs the fragment stage receives through interpolators (the rest are uniforms / engine built-ins). */
export const VARYING_INPUTS: ReadonlySet<string> = new Set([
  "uv0",
  "uv1",
  "uv2",
  "uv3",
  "vertexColor",
  "position",
  "normal",
  "tangent",
  "bitangent",
  "viewDir",
]);

/**
 * Interpolated inputs whose fragment value is EXACTLY the barycentric blend of the per-vertex value, i.e. leaves an affine expression can
 * be moved through. Excluded: normal / tangent / bitangent / viewDir (the fragment stage renormalises the blend — not affine), and clip-space
 * position (perspective divide).
 */
const AFFINE_LEAVES: ReadonlySet<string> = new Set(["uv0", "uv1", "uv2", "uv3", "vertexColor", "position"]);

/** Inputs constant over a primitive (uniforms / engine values): "flat" leaves. */
const FLAT_INPUTS: ReadonlySet<string> = new Set(["time", "deltaTime", "smoothDeltaTime", "cameraPos"]);

/** Classification of a fragment expression for vertex hoisting. */
type AffClass = 0 | 1 | 2;
export const AFF_OTHER = 0,
  AFF_FLAT = 1,
  AFF_AFFINE = 2;

export interface AffineAnalysis {
  /** Per expression: AFF_FLAT (constant over the primitive), AFF_AFFINE (affine in ≥ 1 interpolated leaf) or AFF_OTHER. */
  cls: Uint8Array;
  /** Fragment-reachable mask. */
  mask: Uint8Array;
  /** Expression (transitively) contains at least one arithmetic operation. */
  hasOp: Uint8Array;
}

const isAffineLeaf = (input: string, space: string | undefined): boolean =>
  AFFINE_LEAVES.has(input) &&
  BUILTIN_INPUTS[input as keyof typeof BUILTIN_INPUTS].stage === "any" &&
  !(input === "position" && space === "clip");

/**
 * Affinity analysis . An expression may be evaluated per vertex and interpolated WITHOUT changing the image iff it is an
 * affine function of the interpolated leaves (f(Σλᵢvᵢ) = Σλᵢf(vᵢ) holds for every Σλᵢ = 1, which includes perspective-correct weights):
 *  - leaves: constants / uniforms / time are flat; uv0-3, vertex colour, position are affine;
 *  - sum / difference of affine terms, affine × flat, affine ÷ flat, negation, swizzle, construct, matmul(flat, affine), mix(a, b, flat t),
 *    dot(affine, flat), select(flat cond, affine, affine) stay affine;
 *  - affine × affine, normalize / sin / pow / fract / … of an affine value, comparisons, casts, derivatives, texture reads and calls are "other";
 *  - an operation whose operands are all flat is flat (sin(time) is flat), whatever the operation.
 */
export function analyzeAffine(m: IRModule): AffineAnalysis {
  const ex = m.main.exprs;
  const roots = m.outputs.filter((o) => o.stage === "fragment").map((o) => o.value);
  const mask = reachableMask(m.main, roots);
  const cls = new Uint8Array(ex.length);
  const hasOp = new Uint8Array(ex.length);
  const join = (ids: readonly ExprId[]): AffClass => {
    let r: AffClass = AFF_FLAT;
    for (const i of ids) {
      if (cls[i] === AFF_OTHER) return AFF_OTHER;
      if (cls[i] === AFF_AFFINE) r = AFF_AFFINE;
    }
    return r;
  };
  const allFlat = (ids: readonly ExprId[]): boolean => ids.every((i) => cls[i] === AFF_FLAT);
  ex.forEach((e, i) => {
    if (!mask[i]) return;
    const ops = operandsOf(e);
    let c: AffClass = AFF_OTHER;
    let arith = false;
    switch (e.op) {
      case "const":
      case "param":
      case "uniform":
        c = AFF_FLAT;
        break;
      case "input":
        c = isAffineLeaf(e.input, e.space) ? AFF_AFFINE : FLAT_INPUTS.has(e.input) ? AFF_FLAT : AFF_OTHER;
        break;
      case "swizzle":
        c = cls[e.src] as AffClass;
        break;
      case "construct":
        c = join(e.args);
        break;
      case "unary":
        c = e.kind === "neg" ? (cls[e.a] as AffClass) : allFlat(ops) ? AFF_FLAT : AFF_OTHER;
        arith = true;
        break;
      case "binary": {
        const a = cls[e.a],
          b = cls[e.b];
        arith = true;
        if (a === AFF_FLAT && b === AFF_FLAT) c = AFF_FLAT;
        else if (a === AFF_OTHER || b === AFF_OTHER) c = AFF_OTHER;
        else if (e.kind === "add" || e.kind === "sub") c = AFF_AFFINE;
        else if (e.kind === "mul") c = a === AFF_FLAT || b === AFF_FLAT ? AFF_AFFINE : AFF_OTHER;
        else if (e.kind === "div") c = b === AFF_FLAT ? AFF_AFFINE : AFF_OTHER;
        break;
      }
      case "matmul":
        c = allFlat(ops) ? AFF_FLAT : cls[e.a] === AFF_FLAT || cls[e.b] === AFF_FLAT ? join(ops) : AFF_OTHER;
        arith = true;
        break;
      case "intrinsic":
        arith = true;
        if (allFlat(ops)) c = AFF_FLAT;
        else if (e.fn === "mix" && cls[e.args[2]!] === AFF_FLAT) c = join(ops);
        else if (e.fn === "dot" && (cls[e.args[0]!] === AFF_FLAT || cls[e.args[1]!] === AFF_FLAT)) c = join(ops);
        break;
      case "select":
        c = cls[e.cond] === AFF_FLAT ? join([e.a, e.b]) : AFF_OTHER;
        arith = true;
        break;
      case "cast":
        c = cls[e.src] === AFF_FLAT ? AFF_FLAT : AFF_OTHER;
        break;
      default:
        c = AFF_OTHER;
    }
    cls[i] = c;
    hasOp[i] = arith || ops.some((o) => hasOp[o]) ? 1 : 0;
  });
  return { cls, mask, hasOp };
}

/** Types an interpolator can carry. */
const HOISTABLE_TYPES: ReadonlySet<string> = new Set(["float", "vec2", "vec3", "vec4"]);

/**
 * The maximal affine fragment expressions that contain at least one arithmetic op (candidates for vertex hoisting): affine values consumed
 * by a non-affine fragment expression or used as a fragment output. Analysis only — see `planHoist` for the cost-driven selection.
 */
export function findHoistCandidates(m: IRModule, an: AffineAnalysis = analyzeAffine(m)): ExprId[] {
  const ex = m.main.exprs;
  const { cls, mask, hasOp } = an;
  const escapes = new Set<ExprId>();
  for (const o of m.outputs) if (o.stage === "fragment" && cls[o.value] === AFF_AFFINE) escapes.add(o.value);
  ex.forEach((e, i) => {
    if (!mask[i] || cls[i] === AFF_AFFINE) return;
    for (const o of operandsOf(e)) if (cls[o] === AFF_AFFINE) escapes.add(o);
  });
  return [...escapes].filter((i) => hasOp[i] && HOISTABLE_TYPES.has(ex[i]!.ty)).sort((a, b) => a - b);
}

/**
 * The module as the FRAGMENT stage sees it after vertex hoisting: every hoisted expression becomes a free leaf (a varying read).
 * Cost / statistics code analyses this view for the fragment stage and the original module (plus the hoisted roots) for the vertex stage.
 */
export function fragmentView(m: IRModule): IRModule {
  const hoisted = new Set((m.hoist ?? []).filter((id) => m.main.exprs[id] !== undefined));
  if (hoisted.size === 0) return m;
  return {
    ...m,
    main: { exprs: m.main.exprs.map((e, i): IRExpr => (hoisted.has(i) ? { op: "param", ty: e.ty, index: 0 } : e)) },
  };
}
