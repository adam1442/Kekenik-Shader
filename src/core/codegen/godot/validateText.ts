import { TYPE_NAMES } from "./data/language";

/** Text utilities of the Godot static validators: comment / string stripping (line structure preserved), function extraction, uniform parsing. */
const blank = (s: string): string => s.replace(/[^\n]/g, " ");

/** Comments and string contents replaced by spaces (newlines kept, so offsets and line numbers stay valid). */
export function cleanSource(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    const n = text[i + 1];
    if (c === "/" && n === "/") {
      const e = text.indexOf("\n", i);
      const end = e < 0 ? text.length : e;
      out += blank(text.slice(i, end));
      i = end;
      continue;
    }
    if (c === "/" && n === "*") {
      const e = text.indexOf("*/", i + 2);
      const end = e < 0 ? text.length : e + 2;
      out += blank(text.slice(i, end));
      i = end;
      continue;
    }
    if (c === '"') {
      const e = text.indexOf('"', i + 1);
      const end = e < 0 ? text.length : e + 1;
      out += `"${blank(text.slice(i + 1, Math.max(i + 1, end - 1)))}"`;
      i = end;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

export const lineOf = (text: string, index: number): number => {
  let n = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === "\n") n++;
  return n;
};

export interface FnInfo {
  name: string;
  returns: string;
  params: string;
  /** Offset of the opening / closing brace. */
  open: number;
  close: number;
  body: string;
  line: number;
}

/** Functions at global scope (depth 0). */
export function parseFunctions(clean: string): FnInfo[] {
  const out: FnInfo[] = [];
  const re = /(^|[;}\n])\s*([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) {
    const open = m.index + m[0].length - 1;
    if (depthAt(clean, open) !== 0) continue;
    let d = 0;
    let close = open;
    for (; close < clean.length; close++) {
      if (clean[close] === "{") d++;
      else if (clean[close] === "}" && --d === 0) break;
    }
    if (!["if", "for", "while", "switch", "else", "return"].includes(m[2]!))
      out.push({
        name: m[3]!,
        returns: m[2]!,
        params: m[4]!.trim(),
        open,
        close,
        body: clean.slice(open + 1, close),
        line: lineOf(clean, open),
      });
  }
  return out;
}

function depthAt(clean: string, index: number): number {
  let d = 0;
  for (let i = 0; i < index; i++) {
    if (clean[i] === "{") d++;
    else if (clean[i] === "}") d--;
  }
  return d;
}

export interface UniformInfo {
  qualifier: "uniform" | "instance" | "global";
  type: string;
  name: string;
  array: boolean;
  hints: string[];
  /** `=` appears before the `:` hint list. */
  defaultBeforeHints: boolean;
  hasDefault: boolean;
  line: number;
}

const splitTop = (s: string): string[] => {
  const out: string[] = [];
  let d = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") d++;
    else if (ch === ")") d--;
    if (ch === "," && d === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
};

/** Parse `uniform` / `instance uniform` / `global uniform` declarations (single statement each; hints are a top-level comma list). */
export function parseUniforms(clean: string): UniformInfo[] {
  const out: UniformInfo[] = [];
  const re =
    /(?:^|[;}\n])\s*(?:(instance|global)\s+)?uniform\s+([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*(\[[^\]]*\])?([^;]*);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) {
    const rest = m[5] ?? "";
    const colon = rest.indexOf(":");
    const eq = rest.search(/(^|[^=!<>])=($|[^=])/);
    const hintText = colon >= 0 ? rest.slice(colon + 1, eq > colon ? eq + 1 : undefined).replace(/=\s*$/, "") : "";
    out.push({
      qualifier: (m[1] as "instance" | "global" | undefined) ?? "uniform",
      type: m[2]!,
      name: m[3]!,
      array: !!m[4],
      hints: splitTop(hintText),
      defaultBeforeHints: colon >= 0 && eq >= 0 && eq < colon,
      hasDefault: eq >= 0,
      line: lineOf(clean, m.index + m[0].indexOf("uniform")),
    });
  }
  return out;
}

export interface VaryingInfo {
  name: string;
  type: string;
  depth: number;
  line: number;
}
export function parseVaryings(clean: string): VaryingInfo[] {
  const out: VaryingInfo[] = [];
  const re = /\bvarying\s+(?:(?:flat|smooth|lowp|mediump|highp)\s+)?([A-Za-z_]\w*)\s+([A-Za-z_]\w*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)))
    out.push({ type: m[1]!, name: m[2]!, depth: depthAt(clean, m.index), line: lineOf(clean, m.index) });
  return out;
}

export const hintName = (h: string): string => h.replace(/\(.*$/s, "").trim();
export const isTypeName = (t: string): boolean => TYPE_NAMES.includes(t);
