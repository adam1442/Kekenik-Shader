/**
 * Static checks for generated HLSL. HLSL cannot be compiled in a browser (no maintained DXC-WASM build installs in the
 * sandbox), so these checks are NOT a compiler: they verify what the typed IR lets us guarantee —
 *  1. balanced `() [] {}` (comments stripped),
 *  2. every identifier is declared before use (types, globals, parameters, locals; scoping is deliberately lenient),
 *  3. every called function / method is a declared function or on the intrinsic whitelist,
 *  4. `cbuffer` members are packed exactly as the HLSL packing rules say (offsets are annotated by the generator and
 *     re-derived here by an independent slot-based algorithm),
 *  5. both entry points exist.
 * Every HLSL test built on this is reported as "static-only".
 */
export interface StaticIssue {
  line: number;
  message: string;
}

const KEYWORDS = new Set([
  "if",
  "else",
  "for",
  "while",
  "do",
  "return",
  "discard",
  "struct",
  "cbuffer",
  "static",
  "const",
  "out",
  "in",
  "inout",
  "true",
  "false",
  "register",
  "break",
  "continue",
  "uniform",
]);
const TYPES = new Set([
  "float",
  "int",
  "bool",
  "uint",
  "void",
  "float2",
  "float3",
  "float4",
  "float2x2",
  "float3x3",
  "float4x4",
  "min16float",
  "min16float2",
  "min16float3",
  "min16float4",
  "Texture2D",
  "Texture2DArray",
  "Texture3D",
  "TextureCube",
  "SamplerState",
]);
const HLSL_INTRINSIC_WHITELIST: ReadonlySet<string> = new Set([
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "atan2",
  "pow",
  "exp",
  "exp2",
  "log",
  "log2",
  "sqrt",
  "rsqrt",
  "abs",
  "sign",
  "floor",
  "ceil",
  "frac",
  "trunc",
  "min",
  "max",
  "clamp",
  "saturate",
  "lerp",
  "step",
  "smoothstep",
  "radians",
  "degrees",
  "dot",
  "cross",
  "normalize",
  "length",
  "distance",
  "reflect",
  "refract",
  "mul",
  "transpose",
  "sincos",
  "ddx",
  "ddy",
  "fwidth",
  "asfloat",
  "ks_mod",
  "ks_round",
  "asuint",
  "ks_pcg",
  "ks_fbits",
  "ks_hfin",
  "ks_ihash1",
  "ks_ihash2",
  "ks_ihash3",
  "ks_ihash4",
]);
const METHODS = new Set(["Sample", "SampleLevel", "SampleGrad", "GetDimensions"]);

/** Replace comments and preprocessor lines by spaces (keeps line numbers). Only `#pragma pack_matrix(column_major)` is emitted. */
const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length))
    .replace(/^[ \t]*#[^\n]*/gm, (m) => " ".repeat(m.length));

function checkDirectives(src: string): StaticIssue[] {
  const issues: StaticIssue[] = [];
  src.split("\n").forEach((l, i) => {
    if (/^\s*#/.test(l) && !/^\s*#pragma pack_matrix\(column_major\)\s*$/.test(l))
      issues.push({ line: i + 1, message: `Unexpected preprocessor directive: ${l.trim()}` });
  });
  return issues;
}

interface Tok {
  t: string;
  line: number;
}

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  const re =
    /[A-Za-z_][A-Za-z0-9_]*|0[xX][0-9a-fA-F]+[uU]?|(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?[fFuU]?|==|!=|<=|>=|&&|\|\||[{}()[\];,:?.=<>!+\-*/%&|^~]/g;
  src.split("\n").forEach((text, i) => {
    for (const m of text.matchAll(re)) out.push({ t: m[0], line: i + 1 });
  });
  return out;
}

const isIdent = (t: string): boolean => /^[A-Za-z_]/.test(t);

/** Balanced brackets. */
function checkBalanced(src: string): StaticIssue[] {
  const issues: StaticIssue[] = [];
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  const stack: Tok[] = [];
  for (const tok of tokenize(stripComments(src))) {
    if ("([{".includes(tok.t)) stack.push(tok);
    else if (pairs[tok.t]) {
      const open = stack.pop();
      if (!open || open.t !== pairs[tok.t]) issues.push({ line: tok.line, message: `Unbalanced "${tok.t}"` });
    }
  }
  for (const o of stack) issues.push({ line: o.line, message: `Unclosed "${o.t}"` });
  return issues;
}

/** Declared-before-use and intrinsic whitelist. */
function checkDeclarations(src: string): StaticIssue[] {
  const toks = tokenize(stripComments(src));
  const issues: StaticIssue[] = [];
  const declared = new Set<string>();
  const types = new Set(TYPES);
  let ternary = 0; // open `?` awaiting its `:` — any other `:` introduces a semantic / register
  for (let i = 0; i < toks.length; i++) {
    const tk = toks[i]!;
    const t = tk.t;
    const prev = toks[i - 1]?.t;
    const next = toks[i + 1]?.t;
    if (!isIdent(t)) {
      if (t === "?") ternary++;
      else if (t === ":") {
        if (ternary > 0) ternary--;
        else {
          i++; // the semantic name (or `register`)
          if (toks[i]?.t === "register") while (i < toks.length && toks[i]!.t !== ")") i++;
        }
      } else if (t === ";" || t === "{" || t === "}") ternary = 0;
      continue;
    }
    if (t === "struct" && next && isIdent(next)) {
      types.add(next);
      declared.add(next);
      i++;
      continue;
    }
    if (t === "cbuffer") {
      declared.add(next ?? "");
      i++;
      continue;
    }
    if (prev === ".") {
      if (next === "(" && !METHODS.has(t))
        issues.push({ line: tk.line, message: `Method "${t}" is not on the whitelist (${[...METHODS].join(", ")})` });
      continue;
    }
    if (KEYWORDS.has(t) || types.has(t)) {
      // `<type> <name>` declares <name>
      if (types.has(t) && next && isIdent(next) && !types.has(next) && !KEYWORDS.has(next)) {
        declared.add(next);
        i++;
      }
      continue;
    }
    if (declared.has(t) || HLSL_INTRINSIC_WHITELIST.has(t)) continue;
    issues.push({
      line: tk.line,
      message:
        next === "("
          ? `Call to unknown function "${t}" (not declared, not on the intrinsic whitelist)`
          : `Identifier "${t}" is used before it is declared`,
    });
  }
  for (const entry of ["VSMain", "PSMain"])
    if (!declared.has(entry)) issues.push({ line: 1, message: `Entry point ${entry} is missing` });
  return issues;
}

/** Slot-based (4-byte units) re-derivation of the cbuffer packing, compared with the `// offset N` annotations. */
function checkCbufferPacking(src: string): StaticIssue[] {
  const issues: StaticIssue[] = [];
  const lines = src.split("\n");
  const slots: Record<string, (reg: number, slot: number) => { reg: number; slot: number; used: number }> = {};
  const vec = (n: number) => (reg: number, slot: number) =>
    slot + n > 4 ? { reg: reg + 1, slot: 0, used: n } : { reg, slot, used: n };
  const mat = (cols: number, rows: number) => (reg: number, slot: number) => {
    const r = slot === 0 ? reg : reg + 1;
    return { reg: r, slot: 0, used: (cols - 1) * 4 + rows };
  };
  Object.assign(slots, {
    float: vec(1),
    int: vec(1),
    bool: vec(1),
    uint: vec(1),
    float2: vec(2),
    float3: vec(3),
    float4: vec(4),
    float2x2: mat(2, 2),
    float3x3: mat(3, 3),
    float4x4: mat(4, 4),
  });
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*cbuffer\s+\w+/.test(lines[i]!)) continue;
    let reg = 0;
    let slot = 0;
    for (let j = i + 1; j < lines.length && !/^\s*}/.test(lines[j]!); j++) {
      const m = /^\s*(\w+)\s+(\w+);\s*\/\/\s*offset\s+(\d+)/.exec(lines[j]!);
      if (!m) continue;
      const place = slots[m[1]!];
      if (!place) {
        issues.push({ line: j + 1, message: `cbuffer member type ${m[1]} is not allowed` });
        continue;
      }
      const p = place(reg, slot);
      const offset = p.reg * 16 + p.slot * 4;
      if (offset !== Number(m[3]))
        issues.push({
          line: j + 1,
          message: `cbuffer member ${m[2]}: annotated offset ${m[3]} but HLSL packing gives ${offset}`,
        });
      const end = p.reg * 4 + p.slot + p.used; // in slots
      reg = Math.floor(end / 4);
      slot = end % 4;
    }
  }
  return issues;
}

/** All static checks. `ok` ⇔ no issues. */
export function checkHlsl(src: string): { ok: boolean; issues: StaticIssue[] } {
  const issues = [
    ...checkDirectives(src),
    ...checkBalanced(src),
    ...checkDeclarations(src),
    ...checkCbufferPacking(src),
  ];
  return { ok: issues.length === 0, issues };
}
