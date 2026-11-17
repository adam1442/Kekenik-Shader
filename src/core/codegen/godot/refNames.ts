import type { Property } from "../../properties/model";
import { canonicalFromDisplayName, targetReferenceName } from "../../properties/names";
import type { ProfileProblem } from "../../profiles/types";
import { isReservedGodot } from "./data/language";

/** Godot uniform reference rules: `^[a-z_][a-z0-9_]*$`, not `__…`, never a keyword / type / built-in / function / hint / processor function, not `kek_*` (generated). */
const GODOT_REF_PATTERN = /^[a-z_][a-z0-9_]*$/;

function godotRefProblem(name: string): string | undefined {
  if (!GODOT_REF_PATTERN.test(name)) return "must match ^[a-z_][a-z0-9_]*$";
  if (name.startsWith("__")) return "must not start with two underscores";
  if (isReservedGodot(name)) return "is a Godot keyword, type, built-in, function, hint or processor-function name";
  if (name.startsWith("kek_")) return "the kek_ prefix is reserved for generated names";
  return undefined;
}

export interface RefResult {
  names: Map<string, string>;
  problems: ProfileProblem[];
}

/** Names a uniform of this property additionally owns (HDR intensity, tiling / offset). */
export const derivedNames = (p: Property, name: string): string[] => [
  ...((p.type === "color" || p.type === "color4") && p.hdr ? [`${name}_intensity`] : []),
  ...(p.type === "texture2D" && p.tilingOffset ? [`${name}_tiling`, `${name}_offset`] : []),
];

/**
 * Final reference name of every property (snake_case of the display name). A user-chosen Reference wins; an auto-derived one is repaired and
 * de-duplicated with `_2`, `_3` … in parameter order. Explicit collisions are `godot.ref-collision` errors.
 */
export function godotReferenceNames(properties: readonly Property[], extraTaken: readonly string[] = []): RefResult {
  const names = new Map<string, string>();
  const problems: ProfileProblem[] = [];
  const taken = new Set<string>(extraTaken);
  for (const p of properties) {
    const auto = p.referenceName === canonicalFromDisplayName(p.displayName);
    let name = targetReferenceName(p.referenceName, "godot");
    const bad = godotRefProblem(name);
    if (bad) {
      if (!auto)
        problems.push({
          rule: "godot.ref-collision",
          severity: "error",
          message: `Reference "${p.referenceName}" of "${p.displayName}" (→ ${name}) ${bad}`,
        });
      name = targetReferenceName(p.displayName, "godot");
      let guard = 0;
      while (godotRefProblem(name) && guard++ < 6)
        name = name.startsWith("kek_") ? name.slice(4) || "param" : `${name}_x`;
    }
    const clash = (n: string): boolean => taken.has(n) || derivedNames(p, n).some((d) => taken.has(d));
    if (clash(name)) {
      if (!auto)
        problems.push({
          rule: "godot.ref-collision",
          severity: "error",
          message: `Reference "${name}" of "${p.displayName}" is used by another parameter`,
        });
      let i = 2;
      while (clash(`${name}_${i}`) || godotRefProblem(`${name}_${i}`)) i++;
      name = `${name}_${i}`;
    }
    taken.add(name);
    for (const d of derivedNames(p, name)) taken.add(d);
    names.set(p.id, name);
  }
  return { names, problems };
}
