import { type Command, listCommands } from "@/app/commands/registry";
import { isEditableTarget } from "@/app/commands/keybindings";
import { defaultNodeRegistry } from "@/core";
import { addNodeAt, getCanvasApi } from "@/ui/graph/actions";
import { getActiveDoc, setSelection } from "@/ui/graph/graphStore";
import { useNodePrefs } from "@/ui/graph/prefs";
import { usePrefs } from "./../prefs/preferences";

/** Node definition id for a pressed key (case-insensitive, single character), or undefined (unknown key / unknown node). */
function resolveQuickNode(key: string, map: Record<string, string>): string | undefined {
  if (key.length !== 1) return undefined;
  const id = map[key.toLowerCase()] ?? map[key];
  return id && defaultNodeRegistry.get(id) ? id : undefined;
}

/** Quick-node keys that collide with a modifier-less command shortcut (the command would win in the keybinding layer). */
export function quickNodeConflicts(
  map: Record<string, string>,
  commands: readonly Command[] = listCommands(),
): Array<{ key: string; commandId: string }> {
  const out: Array<{ key: string; commandId: string }> = [];
  for (const k of Object.keys(map))
    for (const c of commands)
      if (c.shortcut && c.shortcut.toLowerCase() === k.toLowerCase()) out.push({ key: k, commandId: c.id });
  return out;
}

const overlayOpen = (): boolean => !!document.querySelector("[data-menu-panel],[aria-modal='true']");
const graphHasFocus = (): boolean => {
  const a = document.activeElement;
  return !a || a === document.body || !!a.closest(".kk-graph");
};

/** Pure decision used by the listener (testable): should this key event create a node, and which? */
function quickNodeForEvent(
  e: Pick<
    KeyboardEvent,
    "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "repeat" | "defaultPrevented" | "target"
  >,
  map: Record<string, string>,
  ctx: { editable: boolean; overlay: boolean; focusOk: boolean; hasDoc: boolean },
): string | undefined {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.repeat) return undefined;
  if (ctx.editable || ctx.overlay || !ctx.focusOk || !ctx.hasDoc) return undefined;
  return resolveQuickNode(e.key, map);
}

/** Create the node under the cursor and select it. */
export function spawnQuickNode(defId: string): string | null {
  const pos = getCanvasApi()?.cursorWorld() ?? { x: 0, y: 0 };
  const id = addNodeAt(defId, pos);
  if (id) {
    setSelection([id]);
    useNodePrefs.getState().addRecent(defId);
  }
  return id;
}

/** Window-level key listener (bubble phase: real commands registered with a capture listener win first). Returns a disposer. */
export function installQuickNodes(target: Window = window): () => void {
  const onKey = (e: KeyboardEvent) => {
    const id = quickNodeForEvent(e, usePrefs.getState().quickNodes, {
      editable: isEditableTarget(e.target),
      overlay: overlayOpen(),
      focusOk: graphHasFocus(),
      hasDoc: !!getActiveDoc(),
    });
    if (!id) return;
    if (spawnQuickNode(id)) e.preventDefault();
  };
  target.addEventListener("keydown", onKey);
  return () => target.removeEventListener("keydown", onKey);
}
