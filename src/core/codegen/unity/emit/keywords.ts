import type { Generated } from "../../dialect/generate";
import { keywordUniformId } from "../../../properties/keywords";
import type { Keyword, Property } from "../../../properties/model";
import { keywordTargetName } from "../../../properties/refNames";
import type { UnityPropertyOut } from "../properties";
import { URP_KEYWORDS } from "../data/keywords";
import { IMPLICIT_NAMES, refNameProblem } from "../refNames";

/**
 * User keywords (Blackboard Boolean / Enum keywords) as real Unity shader variants (brief §7):
 *   Boolean → `[Toggle(_KW)] _KW("Display", Float)` + `#pragma shader_feature_local _KW`
 *   Enum    → `[KeywordEnum(A,B)] _KW("Display", Float)` + `#pragma shader_feature_local _KW_A _KW_B`
 * The graph code reads the keyword through a macro (`KS_KW_<NAME>` = 0/1/entry index) so the compiler folds each variant;
 * no `#if` is ever placed inside expressions. `static` keywords stay baked at their default. [K: unverified-by-doc → manual check `keywords`]
 */
export interface UnityKeyword {
  id: string;
  /** IR uniform id (`kw:<id>`). */
  prop: string;
  display: string;
  kind: "boolean" | "enum";
  /** ShaderLab property name; for Enum keywords Unity derives the keyword names from it (`<PROP>_<ENTRY>`). */
  property: string;
  /** HLSL macro holding the active value. */
  macro: string;
  /** Keyword spellings in index order (Boolean: one). */
  keywords: string[];
  /** Entry labels as written inside `[KeywordEnum(...)]`. */
  entries: string[];
  default: number;
  category?: string;
  /** false ⇒ the keyword belongs to an existing Bool *property* (`Property.keyword`), whose ShaderLab line is emitted by `unityProperty`. */
  ownsProperty: boolean;
}

const MAX_KEYWORD = 63;
const upper = (s: string): string =>
  s
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

/** One keyword candidate: a Blackboard keyword or a Bool property flagged as a keyword. */
interface Source {
  id: string;
  prop: string;
  display: string;
  kind: "boolean" | "enum";
  ref: string;
  labels: string[];
  default: number;
  category?: string;
  ownsProperty: boolean;
  property?: string;
}

/**
 * Final names of every non-static keyword (Blackboard keywords first, then keyword-flagged Bool properties; stable by order).
 * `taken` = reference names already used by material properties. `propertyNames` maps property id → final Unity reference name.
 */
export function unityKeywords(
  keywords: readonly Keyword[],
  properties: readonly Property[],
  propertyNames: ReadonlyMap<string, string>,
): UnityKeyword[] {
  const used = new Set<string>([...propertyNames.values(), ...IMPLICIT_NAMES, "_MainTex"]);
  const sources: Source[] = [
    ...keywords
      .filter((k) => k.definition !== "static")
      .map((k): Source => ({
        id: k.id,
        prop: keywordUniformId(k.id),
        display: k.displayName,
        kind: k.kind,
        ref: k.referenceName,
        default: k.default,
        ownsProperty: true,
        labels: k.kind === "enum" ? (k.entries?.length ? k.entries : ["Entry 1", "Entry 2"]) : [],
        ...(k.category ? { category: k.category } : {}),
      })),
    ...properties
      .filter((p) => p.type === "bool" && p.keyword && p.keyword.definition !== "static" && propertyNames.has(p.id))
      .map((p): Source => ({
        id: p.id,
        prop: p.id,
        display: p.displayName,
        kind: "boolean",
        ref: p.referenceName,
        default: p.default === true || p.default === 1 ? 1 : 0,
        ownsProperty: false,
        labels: [],
        property: propertyNames.get(p.id)!,
      })),
  ];
  const out: UnityKeyword[] = [];
  for (const k of sources) {
    const rawTokens = k.labels.map((l, i) => upper(l) || `E${i}`);
    const root = keywordTargetName(k.ref, "unity");
    const tokensFor = (b: string): string[] => {
      const budget = Math.max(3, MAX_KEYWORD - b.length - 1);
      const t: string[] = [];
      rawTokens.forEach((r, i) => {
        let x = r.slice(0, budget);
        while (t.includes(x)) x = `${x.slice(0, Math.max(1, budget - String(i).length - 1))}_${i}`;
        t.push(x);
      });
      return t;
    };
    const clash = (b: string): boolean => {
      const names = k.kind === "enum" ? tokensFor(b).map((t) => `${b}_${t}`) : [b];
      return (
        !!refNameProblem(b, true) ||
        b.length > MAX_KEYWORD - 4 ||
        (k.ownsProperty && used.has(b)) ||
        names.some((n) => (n !== k.property && used.has(n)) || URP_KEYWORDS.has(n) || n.length > MAX_KEYWORD)
      );
    };
    let base = root;
    let guard = 0;
    while (clash(base) && guard < 50) base = `${root}_${++guard + 1}`;
    const entryTokens = k.kind === "enum" ? tokensFor(base) : [];
    if (k.ownsProperty) used.add(base);
    const keywordNames = k.kind === "enum" ? entryTokens.map((t) => `${base}_${t}`) : [base];
    for (const n of keywordNames) used.add(n);
    out.push({
      id: k.id,
      prop: k.prop,
      display: k.display,
      kind: k.kind,
      property: k.property ?? base,
      macro: `KS_KW${base}`,
      keywords: keywordNames,
      entries: entryTokens,
      default:
        k.kind === "boolean"
          ? k.default
            ? 1
            : 0
          : Math.min(Math.max(0, Math.round(k.default)), entryTokens.length - 1),
      ...(k.category ? { category: k.category } : {}),
      ownsProperty: k.ownsProperty,
    });
  }
  return out;
}

const label = (s: string): string =>
  s
    .replace(/["\\\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** ShaderLab line of a keyword (ShaderLab-only: it never appears in the CBUFFER). */
export function keywordProperty(k: UnityKeyword): UnityPropertyOut {
  const attr = k.kind === "boolean" ? `[Toggle(${k.keywords[0]})]` : `[KeywordEnum(${k.entries.join(",")})]`;
  const out: UnityPropertyOut = {
    lines: [`${attr} ${k.property}("${label(k.display)}", Float) = ${k.default}`],
    cbuffer: [],
    textures: [],
  };
  if (k.category) out.header = k.category.replace(/[^A-Za-z0-9 _.-]+/g, " ").trim();
  return out;
}

/** `#define` block that turns the active variant into a number (placed after the includes, before the CBUFFER). */
export function keywordMacroLines(ks: readonly UnityKeyword[]): string[] {
  if (!ks.length) return [];
  const l = [
    "// Keyword variants (shader_feature_local): the macro holds the active entry; the compiler folds the unused branches.",
  ];
  for (const k of ks) {
    if (k.kind === "boolean")
      l.push(`#if defined(${k.keywords[0]})`, `#define ${k.macro} 1`, "#else", `#define ${k.macro} 0`, "#endif");
    else {
      k.keywords.forEach((n, i) => {
        if (i > 0) l.push(`${i === 1 ? "#if" : "#elif"} defined(${n})`, `#define ${k.macro} ${i}`);
      });
      l.push("#else", `#define ${k.macro} 0`, "#endif");
    }
  }
  return l;
}

/** Keywords the graph actually reads (unused ones add no variants and no material property). */
export const usedKeywords = (all: readonly UnityKeyword[], usedProps: ReadonlySet<string>): UnityKeyword[] =>
  all.filter((k) => usedProps.has(k.prop));

/** `shader_feature_local[_fragment]` lines for every pass: all passes share the graph functions, so all need the same variants. */
export function keywordPragmas(ks: readonly UnityKeyword[], gens: readonly Generated[]): string[] {
  const vertexText = gens
    .flatMap((g) => [
      g.vertex.core.toString(),
      ...Object.values(g.vertex.slotExprs),
      ...g.functions.map((f) => f.toString()),
    ])
    .join("\n");
  return ks.map(
    (k) => `#pragma shader_feature_local${vertexText.includes(k.macro) ? "" : "_fragment"} ${k.keywords.join(" ")}`,
  );
}
