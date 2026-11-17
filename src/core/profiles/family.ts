import { applyOperations } from "../graph/ops/apply";
import { ops } from "../graph/ops/make";
import type { GraphOp } from "../graph/ops/types";
import { DEF_MASTER, type Graph, type ParamValue } from "../graph/types";
import type { SceneTarget } from "../engine/targets";
import { planProfileSwitch } from "./switch";
import { targetProfiles } from "./registry";
import type { ProfileProblem, TargetProfile } from "./types";

/**
 * TARGET FAMILY : the ONE graph-level answer to "which engine / API am I authoring for?". Drives the Code panel's
 * default pane, the Export dialog preselection, the Problems scope, node availability chips and the Simulation panel's default target.
 * Stored as `graph.settings.targetFamily` for the portable families; for engine profiles the profile itself decides (a Godot profile can
 * never claim to be Unity). Old files (no setting) are migrated by derivation from `profileId` — no file-format change.
 */
export type TargetFamily = "unity" | "godot" | "glsl" | "wgsl" | "hlsl";
export const TARGET_FAMILIES: ReadonlyArray<{
  id: TargetFamily;
  label: string;
  short: string;
  backend: SceneTarget;
  hint: string;
}> = [
  {
    id: "unity",
    label: "Unity URP",
    short: "Unity",
    backend: "unity",
    hint: "ShaderLab + HLSL for the Universal Render Pipeline",
  },
  { id: "godot", label: "Godot 4", short: "Godot", backend: "godot", hint: "Godot Shading Language (.gdshader)" },
  { id: "glsl", label: "Web GLSL ES 3.00", short: "GLSL", backend: "glsl", hint: "WebGL2 / OpenGL ES 3.0" },
  { id: "wgsl", label: "WebGPU WGSL", short: "WGSL", backend: "wgsl", hint: "WebGPU" },
  { id: "hlsl", label: "D3D HLSL", short: "HLSL", backend: "hlsl", hint: "Generic Direct3D-style HLSL" },
];
const PORTABLE: readonly TargetFamily[] = ["glsl", "wgsl", "hlsl"];
const isTargetFamily = (v: unknown): v is TargetFamily => TARGET_FAMILIES.some((f) => f.id === v);

export function targetFamilyOf(g: Pick<Graph, "profileId" | "settings">): TargetFamily {
  if (g.profileId.startsWith("unity.")) return "unity";
  if (g.profileId.startsWith("godot.")) return "godot";
  const s = g.settings.targetFamily;
  return isTargetFamily(s) && PORTABLE.includes(s) ? s : "glsl";
}

export const backendOfFamily = (f: TargetFamily): SceneTarget => TARGET_FAMILIES.find((x) => x.id === f)!.backend;

/** The profile of the same KIND (unlit / lit / sprite / vfx) in another family. */
function profileForFamily(g: Pick<Graph, "profileId">, family: TargetFamily): string {
  if (PORTABLE.includes(family)) return "generic";
  const from = targetProfiles.get(g.profileId);
  const kind = from?.family ?? "unlit";
  const pick = (engine: TargetProfile["engine"]): string =>
    (
      targetProfiles.list(engine).find((p) => p.family === kind && !p.unavailableReason) ??
      targetProfiles.list(engine).find((p) => p.family === "lit") ??
      targetProfiles.list(engine)[0]!
    ).id;
  return family === "unity" ? pick("unity-urp") : pick("godot");
}

export interface TargetSwitchPlan {
  ops: GraphOp[];
  problems: ProfileProblem[];
  toProfile: string;
  family: TargetFamily;
}

/** Deterministic plan for changing the target family (one undoable transaction when committed). Never deletes a node. */
export function planTargetSwitch(g: Graph, family: TargetFamily): TargetSwitchPlan {
  const toProfile = profileForFamily(g, family);
  const settingOp = ops.setSettings({ targetFamily: PORTABLE.includes(family) ? family : null });
  const both = targetProfiles.get(g.profileId) && targetProfiles.get(toProfile);
  if (both) {
    const plan = planProfileSwitch(g, toProfile);
    return { ops: [...plan.ops, settingOp], problems: plan.problems, toProfile, family };
  }
  // Portable <-> engine (or portable <-> portable): `generic` has Color / AlphaClipThreshold / VertexOffset. Colour wires carry over.
  const list: GraphOp[] = [];
  const problems: ProfileProblem[] = [];
  const master = Object.values(g.nodes).find((n) => n.defId === DEF_MASTER);
  if (master && toProfile !== g.profileId) {
    const mapTo = (port: string): string | undefined =>
      toProfile === "generic"
        ? port === "baseColor"
          ? "Color"
          : undefined
        : port === "Color"
          ? "baseColor"
          : port === "AlphaClipThreshold"
            ? "alphaClipThreshold"
            : undefined;
    for (const e of Object.values(g.edges)) {
      if (e.to.node !== master.id) continue;
      const to = mapTo(e.to.port);
      list.push(ops.disconnect(e.id));
      const src = g.nodes[e.from.node];
      if (to) list.push(ops.connect(e.from, { node: master.id, port: to }));
      else
        problems.push({
          rule: "profile.block-dropped",
          severity: "warning",
          nodeId: e.from.node,
          message: `Block "${e.to.port}" does not exist in the ${family} target; the connection from node "${src?.label ?? src?.defId ?? e.from.node}" was removed`,
        });
    }
    const patch: Record<string, ParamValue | null> = {};
    const old = targetProfiles.get(g.profileId);
    for (const d of old?.surfaceOptions ?? []) if (g.settings[d.id] !== undefined) patch[d.id] = null;
    if (Object.keys(patch).length) list.push(ops.setSettings(patch));
    list.push(ops.setProfile(toProfile));
  }
  list.push(settingOp);
  // A connect that the new block cannot accept would fail the whole transaction: verify by a dry run and fall back to a plain disconnect.
  try {
    applyOperations(g, list);
  } catch {
    return { ops: list.filter((o) => o.type !== "connect"), problems, toProfile, family };
  }
  return { ops: list, problems, toProfile, family };
}
