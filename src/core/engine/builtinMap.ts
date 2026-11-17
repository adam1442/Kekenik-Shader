import type { StorageType } from "../types/shaderType";
import { BUILTIN_ENTRIES } from "./builtinEntries";

/**
 * MACHINE-READABLE MAPPING of every engine built-in the node library uses → how each target spells it.
 * Consumers: the portable backends (`codegen/dialect/engine.ts` must resolve every GLSL / WGSL / HLSL entry that is not unsupported),
 * the Unity URP + Godot exporters, the Node Gallery / docs (`docs/SCENE_NODES.md`) and the tests.
 *
 * Template syntax: `{0}`, `{1}` … = the HLSL / GLSL expression of the n-th argument of the engine op. Everything else is literal target code.
 * `verify: true` = best knowledge of the engine API, not compiled from this sandbox — a human checklist item.
 */
export type MapTarget = "glslPreview" | "wgsl" | "hlsl" | "unity" | "godotSpatial" | "godotCanvas";
const MAP_TARGETS: readonly MapTarget[] = ["glslPreview", "wgsl", "hlsl", "unity", "godotSpatial", "godotCanvas"];
type Availability = "supported" | "approximate" | "unsupported";

export interface TargetImpl {
  availability: Availability;
  /** Expression template (empty for unsupported). */
  expr: string;
  /** Why the entry is unsupported (required then). */
  reason?: string;
  /** Why it is only approximate / usage caveat (required for approximate). */
  note?: string;
  /** Supporting declarations (functions, #defines, #pragmas) the exporter must emit once when the entry is used. */
  helper?: string;
  /** Not confirmed against the real engine. */
  verify?: boolean;
  /** URP major-version gate: `min` = first URP major version with this spelling. */
  urp?: { min: number; legacy?: string };
}

export interface BuiltinEntry {
  /** `ks.<domain>.<name>` = the `engine` IR op name; `input:<name>` = an IR `input`; `const:<name>` = a compile-time constant. */
  id: string;
  kind: "engine" | "input" | "compileTime";
  ty: StorageType;
  args: StorageType[];
  doc: string;
  /** Stage in which the value legally exists. */
  stage: "any" | "vertex" | "fragment" | "light";
  /** Engine features that must be on (shown by the nodes and the docs). */
  requires: string[];
  targets: Record<MapTarget, TargetImpl>;
}

const BUILTIN_MAP: readonly BuiltinEntry[] = BUILTIN_ENTRIES;
export const builtinById = (id: string): BuiltinEntry | undefined => BUILTIN_MAP.find((e) => e.id === id);

/** Placeholders `{n}` used by a template. */
const placeholdersOf = (expr: string): number[] => [...expr.matchAll(/\{(\d+)\}/g)].map((m) => Number(m[1]));

/** Problems of the table itself (empty = complete and well-formed). Used by the tests and the docs generator. */
export function validateBuiltinMap(map: readonly BuiltinEntry[] = BUILTIN_MAP): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  for (const e of map) {
    if (ids.has(e.id)) issues.push(`${e.id}: duplicate id`);
    ids.add(e.id);
    if (e.doc.length < 10) issues.push(`${e.id}: missing doc`);
    for (const t of MAP_TARGETS) {
      const impl = e.targets[t];
      if (!impl) {
        issues.push(`${e.id}/${t}: target missing`);
        continue;
      }
      if (impl.availability === "unsupported") {
        if (!impl.reason || impl.reason.length < 8) issues.push(`${e.id}/${t}: unsupported without a reason`);
        if (impl.expr) issues.push(`${e.id}/${t}: unsupported entry must not carry an expression`);
        continue;
      }
      if (!impl.expr) issues.push(`${e.id}/${t}: empty expression`);
      if (impl.availability === "approximate" && !(impl.note && impl.note.length >= 8))
        issues.push(`${e.id}/${t}: approximate without a note`);
      for (const n of placeholdersOf(impl.expr))
        if (n >= e.args.length)
          issues.push(`${e.id}/${t}: placeholder {${n}} but the op takes ${e.args.length} argument(s)`);
      const opens = (impl.expr.match(/\{/g) ?? []).length;
      if (opens !== placeholdersOf(impl.expr).length) issues.push(`${e.id}/${t}: stray "{" in the template`);
      const bal = [...impl.expr].reduce((d, ch) => (ch === "(" ? d + 1 : ch === ")" ? d - 1 : d), 0);
      if (bal !== 0) issues.push(`${e.id}/${t}: unbalanced parentheses`);
    }
  }
  return issues;
}

/** Number of entries a human still has to confirm against the real engine. */
export const verifyCount = (map: readonly BuiltinEntry[] = BUILTIN_MAP): number =>
  map.reduce((n, e) => n + MAP_TARGETS.filter((t) => e.targets[t].verify).length, 0);

/** Does `id` have a usable (non-unsupported) implementation on `target`? */
export const isAvailable = (id: string, target: MapTarget): boolean => {
  const e = builtinById(id);
  return !!e && e.targets[target].availability !== "unsupported";
};
