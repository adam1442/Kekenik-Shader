import { isReservedName } from "../../properties/names";
import { canonicalFromDisplayName } from "../../properties/names";
import type { Property } from "../../properties/model";
import type { ProfileProblem } from "../../profiles/types";
import { RESERVED_ENGINE_NAMES } from "./data/api";

/** Unity material reference-name rules (brief §7). */
const UNITY_REF_PATTERN = /^_[A-Za-z][A-Za-z0-9_]*$/;
const BAD_SUFFIX = ["_ST", "_TexelSize", "_HDR"] as const;
/** Implicit properties the generator may declare itself. */
export const IMPLICIT_NAMES: readonly string[] = [
  "_Color",
  "_EnableExternalAlpha",
  "_SoftParticlesNearFadeDistance",
  "_SoftParticlesFarFadeDistance",
  "_Cull",
  "_ZWrite",
  "_ZTest",
  "_KsSpriteRect",
];
/** Generated names that are reserved ONLY while the option that declares them is on (a user `_Cutoff` stays legal otherwise — it is the most common Unity name). */
export const SURFACE_RESERVED = ["_Surface", "_Blend", "_SrcBlend", "_DstBlend", "_AlphaClip", "_Cutoff"] as const;
export const VFX_RESERVED: Readonly<Record<string, readonly string[]>> = {
  cameraFade: ["_CameraNearFadeDistance", "_CameraFarFadeDistance"],
  distortion: ["_DistortionStrength"],
};

export function refNameProblem(name: string, sprite: boolean, reserved: readonly string[] = []): string | undefined {
  if (!UNITY_REF_PATTERN.test(name)) return "must match ^_[A-Za-z][A-Za-z0-9_]*$";
  if (name.startsWith("__")) return "must not start with two underscores";
  const suf = BAD_SUFFIX.find((s) => name.endsWith(s));
  if (suf) return `must not end with ${suf}`;
  if (isReservedName(name, "hlsl") || isReservedName(name.slice(1), "hlsl")) return "is an HLSL keyword";
  if (RESERVED_ENGINE_NAMES.includes(name)) return "collides with a Unity engine variable";
  if (!sprite && name === "_MainTex") return "_MainTex is reserved for sprite profiles";
  if (IMPLICIT_NAMES.includes(name) || reserved.includes(name)) return "collides with a generated property";
  return undefined;
}

const pascal = (s: string): string =>
  s
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");

export interface RefResult {
  names: Map<string, string>;
  problems: ProfileProblem[];
}

/**
 * Final Unity reference name of every property. A user-chosen Reference wins; an auto-derived one (still equal to the name derived from the
 * display name) is repaired and de-duplicated with `_2`, `_3` … (stable by parameter order). Explicit collisions are `unity.ref-collision` errors.
 */
export function unityReferenceNames(
  properties: readonly Property[],
  sprite: boolean,
  reserved: readonly string[] = [],
): RefResult {
  const names = new Map<string, string>();
  const problems: ProfileProblem[] = [];
  const taken = new Set<string>();
  for (const p of properties) {
    const auto = p.referenceName === canonicalFromDisplayName(p.displayName);
    let name = p.referenceName;
    const bad = refNameProblem(name, sprite, reserved);
    if (bad) {
      if (!auto)
        problems.push({
          rule: "unity.ref-collision",
          severity: "error",
          message: `Reference "${name}" of "${p.displayName}" ${bad}`,
        });
      name = `_${pascal(p.displayName) || "Param"}`;
      if (!/^_[A-Za-z]/.test(name)) name = `_P${name.slice(1)}`;
      let guard = 0;
      while (refNameProblem(name, sprite, reserved) && guard++ < 5) name = `${name}_x`;
    }
    const clash = (n: string): boolean => taken.has(n);
    if (clash(name)) {
      if (!auto)
        problems.push({
          rule: "unity.ref-collision",
          severity: "error",
          message: `Reference "${name}" of "${p.displayName}" is used by another parameter`,
        });
      let i = 2;
      while (clash(`${name}_${i}`) || refNameProblem(`${name}_${i}`, sprite, reserved)) i++;
      name = `${name}_${i}`;
    }
    taken.add(name);
    names.set(p.id, name);
  }
  return { names, problems };
}
