import type { ProfileProblem } from "../../profiles/types";
import { builtinsFor } from "./data/builtins";
import { GODOT_DEFINES } from "./data/builtinScopes";
import { FUNCTIONS, KEYWORDS, TYPE_NAMES } from "./data/language";
import { type FnInfo, lineOf } from "./validateText";

/**
 * Strict front-end checks that model what Godot's compiler rejects (rule ids `godot.*`):
 *  - godot.builtin-out-of-scope  built-in (non-global) read / written outside its processor function — the "Unknown identifier in expression" family
 *  - godot.unknown-function      call of a function that does not exist (HLSL-isms: frac / lerp / saturate / mul / fmod …)
 *  - godot.arity                 wrong argument count (built-in or user function)
 *  - godot.int-float-mix         no implicit int ↔ float conversion (`1 + 1.0`, `float x = 1;`, `pow(2, x)`)
 *  - godot.arg-type              argument type differs from the user-function parameter
 *  - godot.varying-int-needs-flat integer varyings must be `flat`
 *  - godot.reserved-name         a declared name collides with a type / keyword / built-in
 * `strictWarn` rules are only warnings. Pure text analysis: tokenizer → declaration tables → small expression typer.
 */
const err = (rule: string, message: string, line?: number): ProfileProblem => ({
  rule,
  severity: "error",
  message,
  ...(line !== undefined ? { line } : {}),
});

export const HLSL_ISMS: Readonly<Record<string, string>> = {
  frac: "fract",
  lerp: "mix",
  saturate: "clamp(x, 0.0, 1.0)",
  mul: "the * operator",
  fmod: "mod",
  rsqrt: "inversesqrt",
  atan2: "atan(y, x)",
  ddx: "dFdx",
  ddy: "dFdy",
  tex2D: "texture",
  tex2Dlod: "textureLod",
  float2: "vec2",
  float3: "vec3",
  float4: "vec4",
  half: "float",
  half2: "vec2",
  half3: "vec3",
  half4: "vec4",
  float2x2: "mat2",
  float3x3: "mat3",
  float4x4: "mat4",
  clip: "discard",
  rcp: "1.0 / x",
  texture2D: "texture",
  texture3D: "texture",
  textureCube: "texture",
  gl_FragCoord: "FRAGCOORD",
};

/** [min, max] argument counts of the built-in functions (docs shader_functions.html). */
const ARITY: Readonly<Record<string, [number, number]>> = {
  atan: [1, 2],
  pow: [2, 2],
  mod: [2, 2],
  modf: [2, 2],
  min: [2, 2],
  max: [2, 2],
  clamp: [3, 3],
  mix: [3, 3],
  step: [2, 2],
  smoothstep: [3, 3],
  distance: [2, 2],
  dot: [2, 2],
  cross: [2, 2],
  reflect: [2, 2],
  refract: [3, 3],
  faceforward: [3, 3],
  fma: [3, 3],
  matrixCompMult: [2, 2],
  outerProduct: [2, 2],
  lessThan: [2, 2],
  lessThanEqual: [2, 2],
  greaterThan: [2, 2],
  greaterThanEqual: [2, 2],
  equal: [2, 2],
  notEqual: [2, 2],
  texture: [2, 3],
  textureLod: [3, 3],
  textureGrad: [4, 4],
  textureSize: [2, 2],
  texelFetch: [3, 3],
  textureProj: [2, 3],
  textureProjLod: [3, 3],
};
const UNARY = [
  "radians", "degrees", "sin", "cos", "tan", "asin", "acos", "atanh", "sinh", "cosh", "tanh", "asinh", "acosh", "exp", "exp2", "log", "log2",
  "sqrt", "inversesqrt", "abs", "sign", "floor", "ceil", "round", "roundEven", "trunc", "fract", "isnan", "isinf", "length", "normalize",
  "transpose", "determinant", "inverse", "any", "all", "not", "dFdx", "dFdy", "fwidth",
];
for (const u of UNARY) (ARITY as Record<string, [number, number]>)[u] = [1, 1];
/** Functions that only exist for float / float vectors (an int argument has no overload). */
const FLOAT_ONLY = new Set([
  "radians", "degrees", "sin", "cos", "tan", "asin", "acos", "atan", "sinh", "cosh", "tanh", "asinh", "acosh", "atanh", "pow", "exp", "exp2", "log",
  "log2", "sqrt", "inversesqrt", "floor", "ceil", "round", "roundEven", "trunc", "fract", "mix", "step", "smoothstep", "length", "distance", "dot",
  "cross", "normalize", "reflect", "refract",
]);
/** genType functions whose scalar arguments must all have the same type. */
const SAME_SCALAR = new Set(["min", "max", "clamp", "mix", "pow", "mod", "step", "smoothstep", "atan"]);

/* ── tokenizer ─────────────────────────────────────────────────────────────────────────────────────────── */
interface Tok {
  t: "num" | "id" | "p";
  v: string;
  at: number;
}
const TOKEN = /\s+|(0[xX][0-9a-fA-F]+u?|(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?[uUfF]?)|([A-Za-z_]\w*)|(==|!=|<=|>=|&&|\|\||\+\+|--|<<=|>>=|<<|>>|[-+*/%&|^]=|[^\s])/g;
function tokenize(src: string, base: number): Tok[] {
  const out: Tok[] = [];
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(src))) {
    if (m[1] !== undefined) out.push({ t: "num", v: m[1], at: base + m.index });
    else if (m[2] !== undefined) out.push({ t: "id", v: m[2], at: base + m.index });
    else if (m[3] !== undefined) out.push({ t: "p", v: m[3], at: base + m.index });
  }
  return out;
}
const numType = (v: string): string =>
  /^0[xX]/.test(v) ? (/[uU]$/.test(v) ? "uint" : "int") : /[uU]$/.test(v) ? "uint" : /[.eEfF]/.test(v) ? "float" : "int";

/* ── types ─────────────────────────────────────────────────────────────────────────────────────────────── */
const SCALARS = ["float", "int", "uint", "bool"];
const isScalar = (t: string): boolean => SCALARS.includes(t);
const isVec = (t: string): boolean => /^[iub]?vec[234]$/.test(t);
const isMat = (t: string): boolean => /^mat[234]$/.test(t);
const dimOf = (t: string): number => Number(t.slice(-1));
const scalarOf = (t: string): string =>
  t.startsWith("ivec") ? "int" : t.startsWith("uvec") ? "uint" : t.startsWith("bvec") ? "bool" : "float";
const vecOf = (s: string, n: number): string =>
  n === 1 ? s : s === "float" ? `vec${n}` : s === "int" ? `ivec${n}` : s === "uint" ? `uvec${n}` : `bvec${n}`;
const Q = "?";

interface FnSig {
  name: string;
  returns: string;
  params: Array<{ ty: string; out: boolean }>;
}
const parseParams = (s: string): FnSig["params"] =>
  s
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const w = p.split(/\s+/).filter((x) => !["const", "lowp", "mediump", "highp", "precise"].includes(x));
      const q = w[0] === "in" || w[0] === "out" || w[0] === "inout" ? w.shift()! : "in";
      return { ty: w[0] ?? Q, out: q === "out" || q === "inout" };
    });

class Analyzer {
  readonly problems: ProfileProblem[] = [];
  private seen = new Set<string>();
  constructor(
    private readonly clean: string,
    private readonly type: string,
    private readonly fns: FnInfo[],
    private readonly globals: Map<string, string>,
    private readonly userFns: Map<string, FnSig[]>,
    private readonly known: Set<string>,
  ) {}

  private report(rule: string, msg: string, at: number): void {
    const line = lineOf(this.clean, at);
    const key = `${rule}|${line}|${msg}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.problems.push(err(rule, msg, line));
  }

  run(): void {
    for (const f of this.fns) this.analyzeFunction(f);
  }

  private analyzeFunction(f: FnInfo): void {
    const proc = f.name === "vertex" || f.name === "fragment" || (f.name === "light" && this.type === "spatial") ? f.name : undefined;
    const vars = new Map<string, string>(this.globals);
    if (proc) for (const b of builtinsFor(this.type, proc)) vars.set(b.name, b.type);
    for (const [i, p] of f.params.split(",").entries()) {
      void i;
      const w = p.trim().split(/\s+/).filter((x) => !["in", "out", "inout", "const", "lowp", "mediump", "highp", "precise"].includes(x));
      if (w.length >= 2) vars.set(w[1]!.replace(/\[.*$/, ""), w[1]!.includes("[") ? Q : w[0]!);
    }
    const toks = tokenize(f.body, f.open + 1);
    // locals: `TYPE name` anywhere (flat scope; a name declared with two types becomes unknown)
    for (let i = 0; i + 1 < toks.length; i++) {
      const a = toks[i]!;
      const b = toks[i + 1]!;
      const prev = toks[i - 1];
      if (a.t === "id" && b.t === "id" && TYPE_NAMES.includes(a.v) && !(prev && prev.v === ".")) {
        const arr = toks[i + 2]?.v === "[";
        const old = vars.get(b.v);
        vars.set(b.v, arr ? Q : old !== undefined && old !== a.v && !this.globals.has(b.v) ? Q : a.v);
        this.checkReserved(b, proc);
      }
    }
    new Parser(this, toks, vars, f).statements();
  }

  checkReserved(t: Tok, proc: string | undefined): void {
    void proc;
    if (TYPE_NAMES.includes(t.v) || KEYWORDS.includes(t.v))
      this.report("godot.reserved-name", `"${t.v}" is a Godot keyword / type and cannot be used as a name`, t.at);
  }

  checkCall(name: string, args: string[], at: number, hasUser: boolean): void {
    if (hasUser) return;
    const a = ARITY[name];
    if (a && (args.length < a[0] || args.length > a[1]))
      this.report("godot.arity", `${name}() takes ${a[0] === a[1] ? a[0] : `${a[0]}–${a[1]}`} argument(s), ${args.length} given`, at);
  }

  fnsNamed(n: string): FnSig[] {
    return this.userFns.get(n) ?? [];
  }
  isKnownFn(n: string): boolean {
    return this.known.has(n);
  }
  readonly rep = (rule: string, msg: string, at: number): void => this.report(rule, msg, at);
}

class Parser {
  private i = 0;
  constructor(
    private readonly a: Analyzer,
    private readonly toks: Tok[],
    private readonly vars: Map<string, string>,
    private readonly fn: FnInfo,
  ) {}

  private get cur(): Tok | undefined {
    return this.toks[this.i];
  }
  private is(v: string): boolean {
    return this.cur?.v === v && this.cur.t !== "num";
  }
  private eat(v: string): boolean {
    if (this.is(v)) {
      this.i++;
      return true;
    }
    return false;
  }

  statements(): void {
    while (this.i < this.toks.length) {
      const start = this.i;
      try {
        this.statement();
      } catch {
        // unparseable statement (macro, preprocessor leftovers …): skip to the next `;` without reporting
        while (this.i < this.toks.length && !this.is(";") && !this.is("}")) this.i++;
        this.eat(";");
      }
      if (this.i === start) this.i++;
    }
  }

  private statement(): void {
    const t = this.cur!;
    if (this.eat("{") || this.eat("}") || this.eat(";")) return;
    if (t.t === "p" && t.v === "#") {
      while (this.i < this.toks.length && this.toks[this.i]!.at < this.toks[this.i]!.at + 1 && !this.is(";")) this.i++;
      return;
    }
    if (t.t === "id") {
      if (t.v === "else") {
        this.i++;
        return;
      }
      if (t.v === "if" || t.v === "while" || t.v === "switch") {
        this.i++;
        this.eat("(");
        this.expr();
        this.eat(")");
        return;
      }
      if (t.v === "for") {
        this.i++;
        this.eat("(");
        if (!this.is(";")) this.simpleStatementBody();
        this.eat(";");
        if (!this.is(";")) this.expr();
        this.eat(";");
        if (!this.is(")")) this.expr();
        this.eat(")");
        return;
      }
      if (t.v === "do" || t.v === "break" || t.v === "continue" || t.v === "discard" || t.v === "case" || t.v === "default") {
        this.i++;
        while (this.i < this.toks.length && !this.is(";") && !this.is(":")) this.i++;
        this.i++;
        return;
      }
      if (t.v === "return") {
        this.i++;
        if (this.is(";")) {
          this.i++;
          return;
        }
        const ty = this.expr();
        this.check(this.fn.returns, ty, "return", t.at);
        this.eat(";");
        return;
      }
    }
    this.simpleStatementBody();
    this.eat(";");
  }

  /** Declaration(s) or an expression statement (no trailing `;`). */
  private simpleStatementBody(): void {
    let k = this.i;
    while (this.toks[k]?.t === "id" && ["const", "lowp", "mediump", "highp", "precise", "flat", "smooth"].includes(this.toks[k]!.v)) k++;
    const ty = this.toks[k];
    const nm = this.toks[k + 1];
    if (ty?.t === "id" && TYPE_NAMES.includes(ty.v) && nm?.t === "id" && this.toks[k - 1]?.v !== ".") {
      this.i = k + 1;
      for (;;) {
        const name = this.toks[this.i++]!;
        if (this.is("[")) {
          while (!this.is("]")) this.i++;
          this.i++;
          if (this.eat("=")) this.skipInit();
        } else if (this.eat("=")) {
          const rt = this.assign();
          this.check(ty.v, rt, `initialisation of ${name.v}`, name.at);
        }
        if (!this.eat(",")) break;
      }
      return;
    }
    this.expr();
  }

  private skipInit(): void {
    let d = 0;
    while (this.i < this.toks.length) {
      if (this.is("(") || this.is("{") || this.is("[")) d++;
      else if (this.is(")") || this.is("}") || this.is("]")) d--;
      else if ((this.is(",") || this.is(";")) && d <= 0) break;
      this.i++;
    }
  }

  private check(want: string, got: string, what: string, at: number): void {
    if (want === Q || got === Q || want === got) return;
    if (isScalar(want) && isScalar(got) && (want === "float" || got === "float") && want !== got)
      this.a.rep("godot.int-float-mix", `Invalid ${what}: cannot convert '${got}' to '${want}' (Godot has no implicit int ↔ float conversion — write 1.0 for a float)`, at);
    else if ((isScalar(want) || isVec(want) || isMat(want)) && (isScalar(got) || isVec(got) || isMat(got)))
      this.a.rep("godot.arg-type", `Invalid ${what}: '${got}' is not '${want}'`, at);
  }

  expr(): string {
    let t = this.assign();
    while (this.eat(",")) t = this.assign();
    return t;
  }

  private assign(): string {
    const lhsAt = this.cur?.at ?? 0;
    const l = this.ternary();
    const t = this.cur;
    if (t?.t === "p" && /^([-+*/%&|^]|<<|>>)?=$/.test(t.v) && t.v !== "==") {
      this.i++;
      const r = this.assign();
      if (t.v === "=") this.check(l, r, "assignment", lhsAt);
      else this.arith(t.v.slice(0, -1), l, r, t.at);
      return l;
    }
    return l;
  }

  private ternary(): string {
    const c = this.binary(1);
    if (this.eat("?")) {
      const at = this.cur?.at ?? 0;
      const a = this.assign();
      this.eat(":");
      const b = this.assign();
      if (a !== Q && b !== Q && a !== b && isScalar(a) && isScalar(b))
        this.a.rep("godot.int-float-mix", `Both branches of ?: must have the same type ('${a}' vs '${b}')`, at);
      void c;
      return a !== Q ? a : b;
    }
    return c;
  }

  private static readonly PREC: Record<string, number> = {
    "||": 1, "&&": 2, "|": 3, "^": 4, "&": 5, "==": 6, "!=": 6, "<": 7, ">": 7, "<=": 7, ">=": 7, "<<": 8, ">>": 8, "+": 9, "-": 9, "*": 10, "/": 10, "%": 10,
  };
  private binary(min: number): string {
    let l = this.unary();
    for (;;) {
      const t = this.cur;
      const p = t && t.t === "p" ? Parser.PREC[t.v] : undefined;
      if (t === undefined || p === undefined || p < min) return l;
      this.i++;
      const r = this.binary(p + 1);
      l = this.arith(t.v, l, r, t.at);
    }
  }

  private arith(op: string, a: string, b: string, at: number): string {
    const cmp = ["==", "!=", "<", ">", "<=", ">="].includes(op);
    const logic = op === "&&" || op === "||";
    if (logic) return "bool";
    let res = Q;
    if (a === Q || b === Q) return cmp ? "bool" : Q;
    const bad = (): void =>
      this.a.rep(
        isScalar(a) && isScalar(b) ? "godot.int-float-mix" : "godot.arg-type",
        `Invalid operands to '${op}': '${a}' and '${b}'${isScalar(a) && isScalar(b) ? " (Godot has no implicit int ↔ float conversion — write 1.0 for a float)" : ""}`,
        at,
      );
    if (isScalar(a) && isScalar(b)) {
      if (a !== b) bad();
      res = a;
    } else if (isVec(a) && isScalar(b)) {
      if (scalarOf(a) !== b) bad();
      res = a;
    } else if (isScalar(a) && isVec(b)) {
      if (scalarOf(b) !== a) bad();
      res = b;
    } else if (isVec(a) && isVec(b)) {
      if (a !== b) bad();
      res = a;
    } else if (isMat(a) && isVec(b)) res = b;
    else if (isVec(a) && isMat(b)) res = a;
    else if (isMat(a) && isMat(b)) res = a;
    else if (isMat(a) && b === "float") res = a;
    else if (a === "float" && isMat(b)) res = b;
    return cmp ? (isScalar(a) && isScalar(b) ? "bool" : isVec(a) ? "bool" : "bool") : res;
  }

  private unary(): string {
    const t = this.cur;
    if (t?.t === "p" && ["-", "+", "!", "~", "++", "--"].includes(t.v)) {
      this.i++;
      const o = this.unary();
      return t.v === "!" ? "bool" : o;
    }
    return this.postfix(this.primary());
  }

  private postfix(t0: string): string {
    let t = t0;
    for (;;) {
      if (this.eat(".")) {
        const m = this.toks[this.i++];
        if (!m) return Q;
        if (isVec(t) || isScalar(t)) {
          const n = /^[xyzwrgbastpq]{1,4}$/.test(m.v) ? m.v.length : 0;
          t = n ? vecOf(isVec(t) ? scalarOf(t) : t, n) : Q;
        } else t = Q;
      } else if (this.eat("[")) {
        this.expr();
        this.eat("]");
        t = isMat(t) ? `vec${dimOf(t)}` : isVec(t) ? scalarOf(t) : Q;
      } else if (this.is("++") || this.is("--")) this.i++;
      else return t;
    }
  }

  private args(): string[] {
    const out: string[] = [];
    if (this.eat(")")) return out;
    do out.push(this.assign());
    while (this.eat(","));
    this.eat(")");
    return out;
  }

  private primary(): string {
    const t = this.toks[this.i++];
    if (!t) return Q;
    if (t.t === "num") return numType(t.v);
    if (t.t === "p") {
      if (t.v === "(") {
        const e = this.expr();
        this.eat(")");
        return e;
      }
      throw new Error("syntax");
    }
    if (t.v === "true" || t.v === "false") return "bool";
    if (this.is("(")) {
      this.i++;
      return this.call(t);
    }
    return this.vars.get(t.v) ?? Q;
  }

  private call(t: Tok): string {
    const args = this.args();
    const name = t.v;
    if (TYPE_NAMES.includes(name)) return name;
    const users = this.a.fnsNamed(name);
    if (users.length === 1) {
      const sig = users[0]!;
      if (sig.params.length !== args.length)
        this.a.rep("godot.arity", `${name}() takes ${sig.params.length} argument(s), ${args.length} given`, t.at);
      else
        sig.params.forEach((p, k) => {
          if (!p.out) this.check(p.ty, args[k]!, `argument ${k + 1} of ${name}()`, t.at);
        });
      return sig.returns;
    }
    if (users.length > 1) return users[0]!.returns;
    if (!FUNCTIONS.includes(name)) return Q;
    this.a.checkCall(name, args, t.at, false);
    const known = args.filter((x) => x !== Q);
    if (FLOAT_ONLY.has(name))
      for (const x of args)
        if (x === "int" || x === "uint" || x === "ivec2" || x === "ivec3" || x === "ivec4")
          this.a.rep("godot.int-float-mix", `${name}() has no overload for '${x}' (use a float: 2.0 instead of 2, float(x) for variables)`, t.at);
    if (SAME_SCALAR.has(name)) {
      const sc = known.filter(isScalar);
      if (sc.length > 1 && sc.some((x) => x !== sc[0]))
        this.a.rep("godot.int-float-mix", `${name}() arguments mix ${[...new Set(sc)].join(" and ")} (no implicit conversion — write 1.0)`, t.at);
    }
    switch (name) {
      case "length": case "distance": case "dot": case "determinant": return "float";
      case "cross": return "vec3";
      case "any": case "all": case "isnan": case "isinf": return args[0] && isVec(args[0]) && name.startsWith("is") ? vecOf("bool", dimOf(args[0])) : "bool";
      case "texture": case "textureLod": case "textureGrad": case "textureProj": case "textureProjLod": case "texelFetch": return "vec4";
      case "textureSize": return "ivec2";
      case "step": return args[1] ?? Q;
      case "smoothstep": return args[2] ?? Q;
      case "min": case "max": return known.find(isVec) ?? known[0] ?? Q;
      case "lessThan": case "lessThanEqual": case "greaterThan": case "greaterThanEqual": case "equal": case "notEqual":
        return args[0] && isVec(args[0]) ? vecOf("bool", dimOf(args[0])) : Q;
      default:
        return args[0] ?? Q;
    }
  }
}

/** Run the strict checks. `clean` = comment-free source; `fns` = global functions. */
export function checkStrict(clean: string, type: string, fns: FnInfo[], out: ProfileProblem[]): void {
  const noPre = clean
    .split("\n")
    .map((l) => (l.trimStart().startsWith("#") ? " ".repeat(l.length) : l))
    .join("\n");
  const macros = new Map<string, string>();
  for (const m of clean.matchAll(/^\s*#\s*define\s+([A-Za-z_]\w*)/gm)) macros.set(m[1]!, Q);
  // global declarations (function bodies blanked)
  let top = noPre;
  for (const f of [...fns].sort((a, b) => b.open - a.open)) top = top.slice(0, f.open) + top.slice(f.open, f.close + 1).replace(/[^\n]/g, " ") + top.slice(f.close + 1);
  const globals = new Map<string, string>(macros);
  for (const m of top.matchAll(/\b(?:(?:uniform|varying|const|instance|global|flat|smooth|lowp|mediump|highp)\s+)*([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*(\[)?/g)) {
    if (TYPE_NAMES.includes(m[1]!) && !m[0].startsWith("void")) globals.set(m[2]!, m[3] ? Q : m[1]!);
  }
  for (const m of top.matchAll(/\bstruct\s+([A-Za-z_]\w*)/g)) globals.set(m[1]!, Q);
  const userFns = new Map<string, FnSig[]>();
  for (const f of fns) {
    const l = userFns.get(f.name) ?? [];
    l.push({ name: f.name, returns: f.returns, params: parseParams(f.params) });
    userFns.set(f.name, l);
  }
  const known = new Set<string>([...FUNCTIONS, ...TYPE_NAMES, ...userFns.keys(), ...macros.keys(), ...GODOT_DEFINES]);
  const an = new Analyzer(noPre, type, fns, globals, userFns, known);
  an.run();
  out.push(...an.problems);

  // varyings: integer varyings need `flat`
  for (const m of top.matchAll(/\bvarying\s+(?:(flat|smooth)\s+)?(uint|int|[iu]vec[234])\s+([A-Za-z_]\w*)/g))
    if (m[1] !== "flat")
      out.push(err("godot.varying-int-needs-flat", `Varying "${m[3]}" has an integer type (${m[2]}) and must be declared \`varying flat ${m[2]} ${m[3]};\``, lineOf(clean, m.index ?? 0)));

  // identifiers: builtins in helpers / global initialisers
  const processors = new Set(["vertex", "fragment", "light"]);
  const globalBuiltins = new Set(builtinsFor(type, "vertex").concat(builtinsFor(type, "fragment")).map((b) => b.name));
  const globalOnly = new Set(builtinsFor(type, "vertex").length ? [] : []);
  void globalOnly;
  const scoped = new Map<string, string[]>();
  for (const fnName of ["vertex", "fragment", "light"] as const)
    for (const b of builtinsFor(type, fnName)) {
      const l = scoped.get(b.name) ?? [];
      l.push(fnName);
      scoped.set(b.name, l);
    }
  const trueGlobals = new Set(
    (type === "spatial" ? builtinsFor(type, "global") : builtinsFor(type, "global")).map((b) => b.name),
  );
  void globalBuiltins;
  const declaredGlobal = new Set<string>();
  for (const m of top.matchAll(/\b(?:uniform|varying|const)\s+(?:[a-z_]+\s+)*[A-Za-z_]\w*\s+([A-Za-z_]\w*)/g)) declaredGlobal.add(m[1]!);
  const scan = (text: string, base: number, owner: string, params: string): void => {
    const local = new Set<string>(
      [...text.matchAll(/\b[A-Za-z_]\w*\s+([A-Z][A-Z0-9_]*)\s*[=;,\[)]/g)].map((m) => m[1]!).concat(params.split(",").map((p) => p.trim().split(/\s+/).pop() ?? "")),
    );
    for (const m of text.matchAll(/(^|[^.\w])([A-Z][A-Z0-9_]+)\b/g)) {
      const n = m[2]!;
      const where = scoped.get(n);
      if (!where || trueGlobals.has(n) || local.has(n) || declaredGlobal.has(n) || macros.has(n) || GODOT_DEFINES.includes(n)) continue;
      out.push(
        err(
          "godot.builtin-out-of-scope",
          `\`${n}\` exists only inside ${where.map((w) => `${w}()`).join(" / ")} — it is not visible in ${owner}. Pass it as a parameter or a varying`,
          lineOf(clean, base + (m.index ?? 0) + m[1]!.length),
        ),
      );
    }
  };
  for (const f of fns) if (!processors.has(f.name) || (f.name === "light" && type !== "spatial")) scan(f.body, f.open + 1, `helper function ${f.name}()`, f.params);
  scan(top, 0, "a global declaration", "");
}
