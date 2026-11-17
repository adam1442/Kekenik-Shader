/**
 * Safe numeric expression parser for typed input (NumberField & friends).
 * Hand-written tokenizer + recursive-descent parser — NO eval / new Function.
 *
 * Supports: + - * / % ^ (and **), unary +/-, parentheses, constants (pi, tau, e),
 * functions (sqrt, abs, sin, cos, tan, asin, acos, atan, exp, ln, log, log2, floor, ceil, round, sign,
 * min, max, pow, rad, deg, clamp), unit suffixes (45deg, 1rad, 50%), Persian/Arabic-Indic digits and separators.
 */

export interface ExprOptions {
  /** Unit of the field the text is typed into; a trailing occurrence of the same unit is a no-op ("5px" in a px field). */
  unit?: string;
  /** Native angle unit of the field. `45deg` → 45 in a "deg" field, 0.7854 in a "rad" field (default "rad"). */
  angleUnit?: "deg" | "rad";
  /** `50%` → 0.5 when "fraction"; identity when "percent" (default: field is expressed in percent). */
  percent?: "fraction" | "percent";
}

export type ExprResult = { ok: true; value: number } | { ok: false; error: string };

const MAX_DEPTH = 64;

/** Map Persian (۰-۹) and Arabic-Indic (٠-٩) digits and separators to ASCII, normalise operator glyphs. */
export function normalizeDigits(input: string, decimalComma = true): string {
  let s = "";
  for (const ch of input) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x06f0 && c <= 0x06f9) s += String(c - 0x06f0);
    else if (c >= 0x0660 && c <= 0x0669) s += String(c - 0x0660);
    else if (ch === "\u066b" || ch === "\u060c")
      s += "."; // Arabic decimal separator / Arabic comma
    else if (ch === "\u066c")
      s += ""; // Arabic thousands separator
    else if (ch === "\u00d7" || ch === "\u2217") s += "*";
    else if (ch === "\u00f7") s += "/";
    else if (ch === "\u2212" || ch === "\u2013") s += "-";
    else if (ch === "\u00a0" || ch === "\u200c" || ch === "\u200f" || ch === "\u200e") s += " ";
    else s += ch;
  }
  // "1,5" (single decimal comma, no function call syntax) → "1.5"
  if (decimalComma && !s.includes("(") && /^\s*[-+]?\d+,\d+\s*$/.test(s)) s = s.replace(",", ".");
  return s;
}

type Tok = { k: "num"; v: number } | { k: "id"; v: string } | { k: "op"; v: string };

function tokenize(src: string): Tok[] | string {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(src.slice(i));
      if (!m) return `Unexpected "${ch}"`;
      out.push({ k: "num", v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (ch === "*" && src[i + 1] === "*") {
      out.push({ k: "op", v: "^" });
      i += 2;
      continue;
    }
    if ("+-*/%^(),".includes(ch)) {
      out.push({ k: "op", v: ch });
      i++;
      continue;
    }
    if (/[A-Za-z_\u00b0%]/.test(ch)) {
      const m = /^[A-Za-z_\u00b0][A-Za-z_0-9\u00b0]*/.exec(src.slice(i));
      if (!m) return `Unexpected "${ch}"`;
      out.push({ k: "id", v: m[0] });
      i += m[0].length;
      continue;
    }
    return `Unexpected "${ch}"`;
  }
  return out;
}

const CONSTS: Record<string, number> = { pi: Math.PI, tau: Math.PI * 2, e: Math.E };
const FN1: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log10,
  log2: Math.log2,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sign: Math.sign,
  rad: (x) => (x * Math.PI) / 180,
  deg: (x) => (x * 180) / Math.PI,
};
const FNN: Record<string, (...a: number[]) => number> = {
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
  clamp: (x = 0, lo = 0, hi = 1) => Math.min(Math.max(x, lo), hi),
};

class Parser {
  private p = 0;
  constructor(
    private toks: Tok[],
    private opts: ExprOptions,
  ) {}

  parse(): number {
    const v = this.expr(0);
    if (this.p < this.toks.length) throw new Error(`Unexpected "${this.describe(this.toks[this.p]!)}"`);
    return v;
  }
  private describe(t: Tok): string {
    return String(t.v);
  }
  private peekOp(...ops: string[]): string | null {
    const t = this.toks[this.p];
    return t && t.k === "op" && ops.includes(t.v) ? t.v : null;
  }
  private expr(depth: number): number {
    if (depth > MAX_DEPTH) throw new Error("Expression too deeply nested");
    let v = this.term(depth);
    for (let op = this.peekOp("+", "-"); op; op = this.peekOp("+", "-")) {
      this.p++;
      const r = this.term(depth);
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  private term(depth: number): number {
    let v = this.unary(depth);
    for (let op = this.peekOp("*", "/", "%"); op; op = this.peekOp("*", "/", "%")) {
      this.p++;
      const r = this.unary(depth);
      v = op === "*" ? v * r : op === "/" ? v / r : v - r * Math.floor(v / r);
    }
    return v;
  }
  private unary(depth: number): number {
    if (depth > MAX_DEPTH) throw new Error("Expression too deeply nested");
    const op = this.peekOp("+", "-");
    if (op) {
      this.p++;
      const v = this.unary(depth + 1);
      return op === "-" ? -v : v;
    }
    return this.power(depth);
  }
  private power(depth: number): number {
    const base = this.postfix(depth);
    if (this.peekOp("^")) {
      this.p++;
      return Math.pow(base, this.unary(depth + 1)); // right-associative, binds tighter than unary minus on the left
    }
    return base;
  }
  private postfix(depth: number): number {
    let v = this.primary(depth);
    const t = this.toks[this.p];
    if (t && t.k === "id" && this.isUnit(t.v)) {
      this.p++;
      v = this.applyUnit(v, t.v);
    } else if (t && t.k === "op" && t.v === "%" && !this.startsOperand(this.toks[this.p + 1])) {
      this.p++;
      v = this.applyUnit(v, "%");
    }
    return v;
  }
  private startsOperand(t: Tok | undefined): boolean {
    return !!t && (t.k === "num" || t.k === "id" || (t.k === "op" && (t.v === "(" || t.v === "-" || t.v === "+")));
  }
  private isUnit(id: string): boolean {
    const l = id.toLowerCase();
    return l === "deg" || id === "\u00b0" || l === "rad" || (!!this.opts.unit && l === this.opts.unit.toLowerCase());
  }
  private applyUnit(v: number, unit: string): number {
    const l = unit.toLowerCase();
    const target = this.opts.angleUnit ?? "rad";
    if (l === "deg" || unit === "\u00b0") return target === "deg" ? v : (v * Math.PI) / 180;
    if (l === "rad") return target === "rad" ? v : (v * 180) / Math.PI;
    if (unit === "%" && this.opts.percent === "fraction") return v / 100;
    return v; // the field's own unit
  }
  private primary(depth: number): number {
    const t = this.toks[this.p++];
    if (!t) throw new Error("Unexpected end of expression");
    if (t.k === "num") return t.v;
    if (t.k === "op" && t.v === "(") {
      const v = this.expr(depth + 1);
      if (!this.peekOp(")")) throw new Error('Missing ")"');
      this.p++;
      return v;
    }
    if (t.k === "id") {
      const name = t.v.toLowerCase();
      if (this.peekOp("(")) {
        this.p++;
        const args: number[] = [];
        if (!this.peekOp(")")) {
          do {
            args.push(this.expr(depth + 1));
          } while (this.peekOp(",") && (this.p++, true));
        }
        if (!this.peekOp(")")) throw new Error('Missing ")"');
        this.p++;
        const f1 = FN1[name];
        if (f1) {
          if (args.length !== 1) throw new Error(`${name}() takes 1 argument`);
          return f1(args[0]!);
        }
        const fn = FNN[name];
        if (fn) {
          if (args.length === 0) throw new Error(`${name}() needs arguments`);
          return fn(...args);
        }
        throw new Error(`Unknown function "${t.v}"`);
      }
      if (name in CONSTS) return CONSTS[name]!;
      throw new Error(`Unknown name "${t.v}"`);
    }
    throw new Error(`Unexpected "${this.describe(t)}"`);
  }
}

/** Parse a typed numeric expression. Never throws. NaN / ±Infinity results are rejected. */
export function parseExpression(text: string, opts: ExprOptions = {}): ExprResult {
  const src = normalizeDigits(text).trim();
  if (src === "") return { ok: false, error: "Empty" };
  const toks = tokenize(src);
  if (typeof toks === "string") return { ok: false, error: toks };
  try {
    const value = new Parser(toks, opts).parse();
    if (!Number.isFinite(value)) return { ok: false, error: "Not a finite number" };
    return { ok: true, value: value === 0 ? 0 : value };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Invalid expression" };
  }
}
