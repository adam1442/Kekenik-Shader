import { strToU8, zipSync } from "fflate";
import type { Bundle } from "@/core";

/** Fixed DOS timestamp (noon, mid-year: valid in every time zone) → byte-identical zips for identical input. */
const FIXED_TIME = Date.UTC(1980, 5, 15, 12, 0, 0);
/** Deterministic zip of a bundle: sorted entries, `/` separators, fixed timestamps, unsafe paths refused. `fflate` lives outside `core/` (Decision D-9b-5). */
export function bundleToZip(b: Bundle, binaries: Readonly<Record<string, Uint8Array>> = {}): Uint8Array {
  const entries: Record<string, [Uint8Array, { level: 6; mtime: number }]> = {};
  for (const f of [...b.files].sort((x, y) => (x.path < y.path ? -1 : 1))) {
    if (f.path.startsWith("/") || f.path.split("/").includes("..") || f.path.includes("\\"))
      throw new Error(`Unsafe export path: ${f.path}`);
    entries[`${b.root}/${f.path}`] = [strToU8(f.content), { level: 6, mtime: FIXED_TIME }];
  }
  for (const [name, data] of Object.entries(binaries).sort(([x], [y]) => (x < y ? -1 : 1))) {
    if (name.includes("/") || name.includes("\\") || name.startsWith("."))
      throw new Error(`Unsafe texture file name: ${name}`);
    entries[`${b.root}/Textures/${name}`] = [data, { level: 0 as unknown as 6, mtime: FIXED_TIME }];
  }
  return zipSync(entries);
}
