import { Lock } from "lucide-react";
import { defaultProfileRegistry, masterEntries, masterNodeIdOf, planBlockVisibility } from "@/core";
import { SEP, groupLabel, type MenuItem } from "@/ui";
import { commit, getGraph } from "./graphStore";

/** Master node id of the active graph (the Master Output cannot be deleted, so it always exists in a normal graph). */
export const masterNodeId = (): string | undefined => masterNodeIdOf(getGraph());

/** Add (`visible`) or remove an optional master block as ONE undoable transaction (removing disconnects its wire; the source node stays). */
export function setMasterBlockVisible(blockId: string, visible: boolean): boolean {
  const g = getGraph();
  const profile = defaultProfileRegistry.get(g.profileId);
  if (!profile) return false;
  const plan = planBlockVisibility(g, profile, blockId, visible);
  if (!plan.ok || plan.ops.length === 0) return false;
  const label = profile.masterBlocks.find((b) => b.id === blockId)?.label ?? blockId;
  return commit(`${visible ? "Add" : "Remove"} block ${label}`, plan.ops);
}

/** Checkbox items of one context (`Vertex` / `Fragment`): checked = block is in the stack. Required blocks are locked. */
function masterBlockItems(context: string): MenuItem[] {
  const g = getGraph();
  const profile = defaultProfileRegistry.get(g.profileId);
  if (!profile) return [];
  return masterEntries(g, profile)
    .filter((e) => e.context === context)
    .map((e): MenuItem => ({
      label: e.block.label + (e.active ? "" : " (off)"),
      type: "checkbox",
      checked: !e.hidden || e.connected,
      ...(e.block.required
        ? { icon: Lock, disabled: true, disabledReason: "Required block — it cannot be removed" }
        : {}),
      run: () => void setMasterBlockVisible(e.block.id, e.hidden && !e.connected),
    }));
}

/** `graph.master` menu body: right-click on a context header ⇒ that context's blocks; on the stack body ⇒ one submenu per context. */
export function masterMenuItems(ctxId: string | null, nodeItems: MenuItem[]): MenuItem[] {
  const g = getGraph();
  const profile = defaultProfileRegistry.get(g.profileId);
  const contexts = [...new Set(profile ? masterEntries(g, profile).map((e) => e.context) : [])];
  const only = ctxId?.startsWith("ctx:") ? ctxId.slice(4) : undefined;
  const blocks: MenuItem[] = only
    ? [groupLabel(`${only} blocks`), ...masterBlockItems(only)]
    : contexts.map((c): MenuItem => ({ label: `${c} blocks`, submenu: masterBlockItems(c) }));
  return blocks.length ? [...blocks, SEP, ...nodeItems] : nodeItems;
}
