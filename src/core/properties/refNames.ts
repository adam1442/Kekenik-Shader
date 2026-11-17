import { type Keyword, type Property } from "./model";
import { REF_TARGETS, type RefTarget, isReservedName, targetReferenceName, uniquifyName } from "./names";

/**
 * Live validation of a property / keyword reference name against every export target.
 * The canonical name is what the user types (Unity style, `_MainTex`); `derived` is the spelling the target receives.
 */
type NameStatus = "ok" | "warn" | "error";

interface TargetNameCheck {
  target: RefTarget;
  /** What the exported shader / material will actually use. */
  derived: string;
  status: NameStatus;
  issues: string[];
}

export interface NameCheck {
  /** Worst status over all targets. */
  status: NameStatus;
  targets: TargetNameCheck[];
}

const RANK: Record<NameStatus, number> = { ok: 0, warn: 1, error: 2 };
const worse = (a: NameStatus, b: NameStatus): NameStatus => (RANK[b] > RANK[a] ? b : a);

export const TARGET_LABEL: Record<RefTarget, string> = {
  glsl: "GLSL",
  hlsl: "HLSL",
  wgsl: "WGSL",
  godot: "Godot",
  unity: "Unity",
};

/** Strip everything that is not an identifier character; guarantees a leading `_` and a non-empty result. */
export function sanitizeReferenceName(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, "");
  if (!cleaned) return "_Param";
  return cleaned.startsWith("_") ? cleaned : `_${cleaned}`;
}

/** Namespace of every referenced name: `taken` = canonical names of the OTHER properties and keywords. */
export function takenReferenceNames(
  properties: readonly Property[],
  keywords: readonly Keyword[],
  exceptId?: string,
): Set<string> {
  const out = new Set<string>();
  for (const p of properties) if (p.id !== exceptId) out.add(p.referenceName);
  for (const k of keywords) if (k.id !== exceptId) out.add(k.referenceName);
  return out;
}

/** A free canonical name derived from `wanted` (`_Tint`, `_Tint_2`, …). */
export const freeReferenceName = (wanted: string, taken: ReadonlySet<string>): string => uniquifyName(wanted, taken);

/**
 * Validate `name` for all targets.
 *  - errors: empty, illegal characters, digit first, collision with another item after per-target sanitising
 *  - warnings: convention (Unity `_PascalCase`, Godot snake_case), reserved word (auto-escaped on export), `__` in GLSL/WGSL
 * `others` = the OTHER items' canonical names.
 */
export function checkReferenceName(name: string, others: Iterable<string>): NameCheck {
  const otherList = [...others];
  const targets: TargetNameCheck[] = REF_TARGETS.map((target) => {
    const issues: string[] = [];
    let status: NameStatus = "ok";
    const flag = (s: NameStatus, msg: string) => {
      status = worse(status, s);
      issues.push(msg);
    };
    if (!name) flag("error", "Name is empty");
    if (/[^A-Za-z0-9_]/.test(name)) flag("error", "Only letters, digits and _ are allowed");
    if (/^[0-9]/.test(name)) flag("error", "A name cannot start with a digit");
    const derived = targetReferenceName(name || "_", target);
    if (name && isReservedName(name, target))
      flag("warn", `"${name}" is a reserved word in ${TARGET_LABEL[target]} — exported as "${derived}"`);
    if (name && isReservedName(derived.replace(/_$/, ""), target) && derived.endsWith("_"))
      flag("warn", `"${derived.slice(0, -1)}" is reserved in ${TARGET_LABEL[target]} — exported as "${derived}"`);
    if (target === "unity" && name && !/^_[A-Z][A-Za-z0-9]*$/.test(name))
      flag("warn", "Unity convention is _PascalCase (e.g. _MainTex)");
    if (target === "godot" && name && derived !== derived.toLowerCase()) flag("warn", "Godot uniforms are snake_case");
    if ((target === "glsl" || target === "wgsl") && name.includes("__"))
      flag("warn", `Double underscores are reserved in ${TARGET_LABEL[target]}`);
    if (name && otherList.some((o) => targetReferenceName(o, target) === derived))
      flag("error", `Collides with another name in ${TARGET_LABEL[target]} ("${derived}")`);
    return { target, derived, status, issues };
  });
  return { status: targets.reduce<NameStatus>((s, t) => worse(s, t.status), "ok"), targets };
}

/** Flatten the per-target issues into unique messages (for a single tooltip / helper text). */
export function nameCheckMessages(c: NameCheck): string[] {
  return [...new Set(c.targets.flatMap((t) => t.issues))];
}

/** Keyword spelling per target: Unity `_FEATURE_X` (upper snake, `shader_feature` convention), GLSL/HLSL `KS_FEATURE_X` macros, WGSL/Godot snake_case constants. */
export function keywordTargetName(canonical: string, target: RefTarget): string {
  const words = canonical
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  const base = words.length ? words : ["Feature"];
  switch (target) {
    case "unity":
      return `_${base.map((w) => w.toUpperCase()).join("_")}`;
    case "glsl":
    case "hlsl":
      return `KS_${base.map((w) => w.toUpperCase()).join("_")}`;
    default: {
      const out = base.map((w) => w.toLowerCase()).join("_");
      return /^[0-9]/.test(out) ? `k_${out}` : out;
    }
  }
}
