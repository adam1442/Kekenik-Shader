/**
 * Generated-code lint . STATIC, text-level checks that flag waste the optimiser / emitters should never produce.
 * They never compile anything: HLSL / Unity / Godot are not compiled in the sandbox, so these rules are the cheap safety net that
 * runs on every golden. Each rule has positive + negative tests in `10d-lint`.
 */
type LintTarget = "glsl" | "hlsl" | "wgsl" | "godot" | "unity";
type LintRule =
  | "double-saturate"
  | "double-normalize"
  | "splat-constructor"
  | "self-cast"
  | "identity-arithmetic"
  | "clip-after-lighting";
interface LintIssue {
  rule: LintRule;
  line: number;
  text: string;
  message: string;
}

const ATOM = String.raw`[A-Za-z_][A-Za-z0-9_.]*|-?\d+(?:\.\d+)?(?:e[-+]?\d+)?f?`;
const VEC_CTOR: Record<LintTarget, RegExp> = {
  glsl: new RegExp(String.raw`\bvec([234])\(\s*(${ATOM})((?:\s*,\s*(?:${ATOM}))+)\s*\)`, "g"),
  godot: new RegExp(String.raw`\bvec([234])\(\s*(${ATOM})((?:\s*,\s*(?:${ATOM}))+)\s*\)`, "g"),
  hlsl: new RegExp(String.raw`\bfloat([234])\(\s*(${ATOM})((?:\s*,\s*(?:${ATOM}))+)\s*\)`, "g"),
  unity: new RegExp(String.raw`\bfloat([234])\(\s*(${ATOM})((?:\s*,\s*(?:${ATOM}))+)\s*\)`, "g"),
  wgsl: new RegExp(String.raw`\bvec([234])<f32>\(\s*(${ATOM})((?:\s*,\s*(?:${ATOM}))+)\s*\)`, "g"),
};
const SCALAR_NAME: Record<LintTarget, string> = {
  glsl: "float",
  godot: "float",
  hlsl: "float",
  unity: "float",
  wgsl: "f32",
};

const stripComments = (l: string): string => l.replace(/\/\/.*$/, "");

/** Lint one generated source text for a target. Deterministic; issues are in line order. */
export function lintGenerated(target: LintTarget, text: string): LintIssue[] {
  const out: LintIssue[] = [];
  const lines = text.split("\n");
  let firstClip = -1,
    firstLighting = -1;
  lines.forEach((raw, i) => {
    const l = stripComments(raw);
    const add = (rule: LintRule, message: string): void =>
      void out.push({ rule, line: i + 1, text: raw.trim(), message });
    if (
      /\bsaturate\(\s*saturate\(/.test(l) ||
      /\bclamp\(\s*clamp\(\s*[^,()]+,\s*0(?:\.0*)?f?,\s*1(?:\.0*)?f?\s*\)\s*,\s*0(?:\.0*)?f?,\s*1(?:\.0*)?f?\s*\)/.test(
        l,
      )
    )
      add("double-saturate", "saturate(saturate(x)) — the outer call is redundant");
    if (/\bnormalize\(\s*normalize\(/.test(l))
      add("double-normalize", "normalize(normalize(x)) — the outer call is redundant");
    for (const m of l.matchAll(VEC_CTOR[target])) {
      const args = [
        m[2]!,
        ...m[3]!
          .split(",")
          .slice(1)
          .map((s) => s.trim()),
      ];
      if (args.length === Number(m[1]) && args.every((a) => a === args[0]) && !/^-?\d/.test(args[0]!))
        add("splat-constructor", `${m[0]} — a single-argument broadcast is legal (${m[0].split("(")[0]}(${args[0]}))`);
    }
    const sn = SCALAR_NAME[target];
    if (
      new RegExp(String.raw`\b${sn}\(\s*${sn}\(`).test(l) ||
      ((target === "hlsl" || target === "unity") && /\(float\)\s*\(float\)/.test(l))
    )
      add("self-cast", `${sn}(${sn}(x)) — redundant cast`);
    if (/[*]\s*1\.0(?![\d.eE])/.test(l) || (/[+-]\s*0\.0(?![\d.eE])/.test(l) && !/e[+-]\s*0\.0/.test(l)))
      add("identity-arithmetic", "multiplication by 1.0 or addition of 0.0 — constant folding should have removed it");
    if (firstClip < 0 && /\b(clip|discard)\b/.test(l) && /\bclip\s*\(|\bdiscard\b/.test(l)) firstClip = i;
    if (firstLighting < 0 && /UniversalFragment(PBR|BlinnPhong)|LightingPhysicallyBased|\bLIGHT\b\s*=/.test(l))
      firstLighting = i;
  });
  if (target === "unity" && firstClip >= 0 && firstLighting >= 0 && firstClip > firstLighting) {
    out.push({
      rule: "clip-after-lighting",
      line: firstClip + 1,
      text: lines[firstClip]!.trim(),
      message:
        "alpha clip() runs after the lighting call — compute alpha and clip BEFORE lighting so clipped pixels skip it",
    });
  }
  return out.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
}

/** Summary by rule (for reports). */
export const lintSummary = (issues: readonly LintIssue[]): Record<string, number> =>
  issues.reduce<Record<string, number>>((acc, i) => ({ ...acc, [i.rule]: (acc[i.rule] ?? 0) + 1 }), {});

export {};
