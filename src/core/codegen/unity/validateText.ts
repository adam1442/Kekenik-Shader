/** Small text utilities of the Unity static validators (comment/string stripping, block and function extraction, property parsing). */
export const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
export const stripStrings = (s: string): string =>
  s.replace(/"[^"\n]*"/g, (m) => `"${" ".repeat(Math.max(0, m.length - 2))}"`);

/** Text between `keyword` and its `ENDHLSL`. */
export function findBlock(code: string, keyword: string): string | undefined {
  const a = code.search(new RegExp(`^\\s*${keyword}\\b`, "m"));
  if (a < 0) return undefined;
  const b = code.indexOf("ENDHLSL", a);
  return b < 0 ? undefined : code.slice(a, b);
}

/** Body of the first function called `name` (brace matching). */
export function findFunctionBody(code: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}\\s*\\([^;{)]*\\)\\s*(?::\\s*\\w+\\s*)?\\n?\\s*\\{`).exec(code);
  if (!m) return undefined;
  let d = 0;
  for (let i = m.index + m[0].length - 1; i < code.length; i++) {
    if (code[i] === "{") d++;
    else if (code[i] === "}" && --d === 0) return code.slice(m.index, i + 1);
  }
  return undefined;
}

export interface ParsedProperty {
  name: string;
  type: string;
  attrs: string;
  raw: string;
  valid: boolean;
}
const PROP =
  /^((?:\s*\[[^\]\n]*\])*)\s*(_[A-Za-z]\w*)\s*\(\s*"([^"\n]*)"\s*,\s*(Float|Integer|Vector|Color|2DArray|2D|3D|Cube|Range\(\s*-?[\d.]+\s*,\s*-?[\d.]+\s*\))\s*\)\s*=\s*(.+?)\s*$/;
const NUM = /^-?\d+(\.\d+)?(e-?\d+)?$/i;
const VEC = /^\(\s*-?[\d.e-]+(\s*,\s*-?[\d.e-]+){3}\s*\)$/i;
const TEX = /^"[A-Za-z]*"\s*\{\s*\}$/;

/** Property lines of the `Properties { … }` block. Lines that look like a property but do not match the grammar are returned with `valid: false`. */
export function parseProperties(code: string): ParsedProperty[] {
  const m = /\bProperties\s*\n?\s*\{([\s\S]*?)\n\s*\}\s*\n\s*SubShader/.exec(code);
  if (!m) return [];
  const out: ParsedProperty[] = [];
  for (const raw of m[1]!.split("\n")) {
    if (!raw.trim()) continue;
    const line = raw.replace(/^\s*\[Header\([^)]*\)\]\s*/, "");
    const p = PROP.exec(line);
    if (!p) {
      out.push({ name: /(_[A-Za-z]\w*)/.exec(line)?.[1] ?? "?", type: "?", attrs: "", raw, valid: false });
      continue;
    }
    const [, attrs, name, , type, def] = p as unknown as [string, string, string, string, string, string];
    const t = type.startsWith("Range") ? "Range" : type;
    const ok =
      t === "Float" || t === "Integer" || t === "Range"
        ? NUM.test(def)
        : t === "Vector" || t === "Color"
          ? VEC.test(def)
          : TEX.test(def);
    out.push({ name, type: t, attrs: attrs.trim(), raw, valid: ok });
  }
  return out;
}
