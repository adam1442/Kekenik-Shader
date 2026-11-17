import type { ProfileProblem } from "../../profiles/types";
import { STENCIL_COMPARES, STENCIL_FLAGS, STENCIL_REF_MAX } from "./data/stencil";
import { type GodotTarget, featureAvailable, gateById } from "./data/versions";
import { lineOf } from "./validateText";

const err = (message: string, line?: number): ProfileProblem => ({
  rule: "godot.stencil-mode",
  severity: "error",
  message,
  ...(line !== undefined ? { line } : {}),
});

/**
 * godot.stencil-mode : at most ONE `stencil_mode …;` statement, spatial shaders only, known flags / compare operators
 * (no duplicates, ≤ 1 compare), an optional integer reference 0–255, and the 4.5 version gate when the target is known.
 */
export function checkStencil(
  clean: string,
  type: string,
  target: GodotTarget | undefined,
  out: ProfileProblem[],
): void {
  const all = [...clean.matchAll(/(^|[\s;}])stencil_mode\b([^;]*);/g)];
  if (all.length === 0) {
    if (/\bstencil_mode\b/.test(clean)) out.push(err("`stencil_mode` must be a statement ending with `;`"));
    return;
  }
  if (all.length > 1) out.push(err("stencil_mode must be ONE statement listing every flag, comma-separated"));
  for (const m of all) {
    const line = lineOf(clean, m.index ?? 0);
    if (type !== "spatial") out.push(err("stencil_mode exists only in spatial shaders", line));
    if (target && !featureAvailable("stencil_mode", target.version))
      out.push(
        err(`stencil_mode needs Godot ≥ ${gateById("stencil_mode")?.since}; the target is ${target.version}`, line),
      );
    const items = m[2]!.split(",").map((s) => s.trim());
    if (items.some((s) => s === "")) {
      out.push(err("stencil_mode has an empty list entry", line));
      continue;
    }
    const seen = new Set<string>();
    let compares = 0,
      refs = 0;
    for (const it of items) {
      if (/^\d+$/.test(it)) {
        refs++;
        if (Number(it) > STENCIL_REF_MAX)
          out.push(err(`stencil reference ${it} is out of range 0–${STENCIL_REF_MAX}`, line));
      } else if ((STENCIL_COMPARES as readonly string[]).includes(it)) compares++;
      else if (!(STENCIL_FLAGS as readonly string[]).includes(it))
        out.push(err(`Unknown stencil_mode entry "${it}"`, line));
      if (seen.has(it)) out.push(err(`stencil_mode entry "${it}" is listed twice`, line));
      seen.add(it);
    }
    if (compares > 1) out.push(err("stencil_mode lists more than one compare_* operator", line));
    if (refs > 1) out.push(err("stencil_mode lists more than one reference value", line));
    if (!items.some((s) => (STENCIL_FLAGS as readonly string[]).includes(s)))
      out.push(err("stencil_mode needs at least one of read / write / write_if_depth_fail", line));
  }
}
