/**
 * Shader-variant counting for generated ShaderLab . Pure text analysis of the `#pragma multi_compile* / shader_feature*`
 * lines of each `Pass`: the variants of a pass are the PRODUCT of the option counts of its directives; the shader total is the sum over passes.
 * Unity strips unused `shader_feature` variants at build time, so the number is an UPPER bound for `shader_feature` and exact for `multi_compile`.
 */
interface VariantDirective {
  kind: "multi_compile" | "shader_feature";
  keywords: string[];
  options: number;
  line: string;
}
interface VariantPass {
  name: string;
  directives: VariantDirective[];
  variants: number;
}
export interface VariantReport {
  passes: VariantPass[];
  total: number;
  limit: number;
  overLimit: boolean;
}

/** Warn above this many variants (summed over passes). Unity's own guidance: keep a shader well under a few hundred. */
const VARIANT_WARN_LIMIT = 256;

const DIRECTIVE =
  /^\s*#pragma\s+(multi_compile|shader_feature)(?:_(?:local|fragment|vertex|local_fragment|local_vertex|fog|instancing|fwdbase|fwdadd|shadowcaster|prepassfinal))*\s*(.*)$/;
/** Shortcut directives that expand to a fixed number of keywords. */
const SHORTCUT: Readonly<Record<string, number>> = { multi_compile_fog: 4, multi_compile_instancing: 2 };

function parseVariantDirective(line: string): VariantDirective | undefined {
  const m = DIRECTIVE.exec(line);
  if (!m) return undefined;
  const head = line.trim().split(/\s+/)[1]!;
  const tokens = m[2]!.trim().split(/\s+/).filter(Boolean);
  const kind = m[1] as VariantDirective["kind"];
  if (SHORTCUT[head] !== undefined) return { kind, keywords: [], options: SHORTCUT[head]!, line: line.trim() };
  if (tokens.length === 0) return undefined;
  const real = tokens.filter((t) => !/^_+$/.test(t));
  const hasBlank = real.length < tokens.length;
  // `shader_feature A` has an implicit "off"; a leading `_` (multi_compile) spells it out.
  const options = kind === "shader_feature" && !hasBlank ? real.length + 1 : Math.max(1, tokens.length);
  return { kind, keywords: real, options, line: line.trim() };
}

export function variantReport(shaderlab: string, limit = VARIANT_WARN_LIMIT): VariantReport {
  const passes: VariantPass[] = [];
  let cur: VariantPass | undefined;
  for (const line of shaderlab.split("\n")) {
    const name = /^\s*Name\s+"([^"]+)"/.exec(line);
    if (/^\s*Pass\s*$/.test(line)) {
      cur = { name: `Pass ${passes.length + 1}`, directives: [], variants: 1 };
      passes.push(cur);
      continue;
    }
    if (name && cur && cur.directives.length === 0) cur.name = name[1]!;
    const d = cur ? parseVariantDirective(line) : undefined;
    if (cur && d) {
      cur.directives.push(d);
      cur.variants *= d.options;
    }
  }
  const total = passes.reduce((s, p) => s + p.variants, 0);
  return { passes, total, limit, overLimit: total > limit };
}
