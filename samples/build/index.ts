/** Registry of sample modules (display order). Add new samples here — nothing else needs to change (index.json + tests are generated). */
import { SAMPLE_CATEGORIES, SAMPLE_DIFFICULTIES, type SampleIndex } from "@/core";
import { type Emitted, type SampleModule, emitSample } from "./emit";
import { SAMPLE_MODULES_3D } from "../3d";
import { SAMPLE_MODULES_2D } from "../2d";
import { SAMPLE_MODULES_VFX } from "../vfx";

const RANK = (m: SampleModule): number => SAMPLE_CATEGORIES.indexOf(m.meta.category) * 10 + SAMPLE_DIFFICULTIES.indexOf(m.meta.difficulty);
/** Display order = category, then the difficulty ladder (Beginner → Advanced); ties keep the registration order of the per-category lists (stable sort). */
export const SAMPLE_MODULES: readonly SampleModule[] = [...SAMPLE_MODULES_3D, ...SAMPLE_MODULES_2D, ...SAMPLE_MODULES_VFX].map((m, i) => ({ m, i })).sort((a, b) => RANK(a.m) - RANK(b.m) || a.i - b.i).map((x) => x.m);

export function emitAll(): { files: Emitted[]; index: SampleIndex } {
  const files = SAMPLE_MODULES.map(emitSample);
  const ids = new Set<string>();
  for (const f of files) { if (ids.has(f.entry.id)) throw new Error(`Duplicate sample id ${f.entry.id}`); ids.add(f.entry.id); }
  return { files, index: { format: "kekenik-samples", version: 1, samples: files.map((f) => f.entry) } };
}
