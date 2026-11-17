import type { ProfileDef } from "../registry/profile";
import type { MasterBlock } from "../registry/profile";
import { predicateHolds } from "./canonical";
import type { EngineId, TargetProfile } from "./types";

/** Registry-level (IR) definition derived from a TargetProfile: block ids are the canonical ids. */
export function toProfileDef(tp: TargetProfile): ProfileDef {
  const masterBlocks: MasterBlock[] = tp.blocks.map((b) => ({
    id: b.id,
    label: b.label,
    type: b.type,
    stage: b.context,
    required: b.required,
    ...(b.defaultValue !== undefined ? { default: b.defaultValue } : {}),
    ...(b.tag ? { tag: b.tag } : {}),
    ...(b.shownWhen
      ? {
          shownWhen: {
            setting: b.shownWhen.option,
            equals: b.shownWhen.equals,
            default: tp.surfaceOptions.find((o) => o.id === b.shownWhen!.option)?.default ?? false,
          },
        }
      : {}),
  }));
  return { id: tp.id, name: tp.label, family: tp.family, stages: ["vertex", "fragment"], masterBlocks, settings: [] };
}

/** Registry of target profiles (data). registers the Godot profiles with `registerTargetProfile`. */
class TargetProfileRegistry {
  private readonly map = new Map<string, TargetProfile>();
  register(p: TargetProfile): void {
    if (this.map.has(p.id)) throw new Error(`Target profile "${p.id}" is already registered`);
    this.map.set(p.id, p);
  }
  get(id: string): TargetProfile | undefined {
    return this.map.get(id);
  }
  list(engine?: EngineId): TargetProfile[] {
    return [...this.map.values()].filter((p) => engine === undefined || p.engine === engine);
  }
}

export const targetProfiles = new TargetProfileRegistry();
export const registerTargetProfile = (p: TargetProfile): void => targetProfiles.register(p);

/** Blocks of a profile that are active under the given settings. */
export const activeBlocks = (
  tp: TargetProfile,
  settings: Readonly<Record<string, import("../graph/types").ParamValue>>,
) => tp.blocks.filter((b) => predicateHolds(b.shownWhen, tp.surfaceOptions, settings));
