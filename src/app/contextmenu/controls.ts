import { Braces, ClipboardPaste, Copy, RotateCcw } from "lucide-react";
import { SEP, type MenuItem } from "@/ui";
import { copyText, getBridge, pasteText, type ControlBridge } from "@/ui/controls";
import { setStatus } from "../state";
import { registerContextMenu, type ContextMenuProvider } from "./registry";

/** Every control scope (`data-ctx-scope`) the controls library can emit. */
const CONTROL_SCOPES = [
  "control.number",
  "control.int",
  "control.slider",
  "control.range",
  "control.vec",
  "control.angle",
  "control.xypad",
  "control.direction",
  "control.matrix",
  "control.color",
  "control.gradient",
  "control.curve",
  "control.curve.key",
  "control.curve.canvas",
  "control.levels",
  "control.text",
  "control.select",
  "control.combobox",
  "control.toggle",
  "control.checkbox",
  "control.chips",
  "control.texture",
  "control.shortcut",
] as const;

function findBridge(el: Element): ControlBridge | undefined {
  for (let e: Element | null = el; e; e = e.parentElement) {
    const b = getBridge(e);
    if (b) return b;
  }
  return undefined;
}

/** Generic provider: Copy value · Paste value · Reset to default · Copy as JSON (+ control-specific items). */
function buildControlMenu(bridge: ControlBridge): MenuItem[] {
  const locked = !!(bridge.disabled || bridge.readOnly);
  const items: MenuItem[] = [
    {
      label: "Copy value",
      icon: Copy,
      shortcut: "Mod+C",
      run: () => void copyText(bridge.copyText()).then(() => setStatus("Value copied")),
    },
    {
      label: "Paste value",
      icon: ClipboardPaste,
      shortcut: "Mod+V",
      disabled: locked || !bridge.paste,
      disabledReason: locked ? "This control is read-only" : "This control cannot be pasted into",
      run: () =>
        void pasteText().then((t) =>
          setStatus(bridge.paste?.(t) ? "Value pasted" : "Clipboard does not hold a valid value for this control"),
        ),
    },
    {
      label: "Reset to default",
      icon: RotateCcw,
      disabled: locked || !bridge.reset || !bridge.canReset?.(),
      disabledReason: bridge.reset ? "Already at the default value" : "No default value",
      run: () => bridge.reset?.(),
    },
    {
      label: "Copy as JSON",
      icon: Braces,
      run: () => void copyText(bridge.copyJson()).then(() => setStatus("JSON copied")),
    },
  ];
  const extra = bridge.extra?.() ?? [];
  if (extra.length) items.push(SEP, ...extra);
  return items;
}

const provider: ContextMenuProvider = (_t, _e, info) => {
  const b = findBridge(info.element);
  return b ? buildControlMenu(b) : [];
};

/** Registers all `control.*` scopes. Safe to call more than once. */
export function registerControlContextMenus(): void {
  for (const scope of CONTROL_SCOPES) registerContextMenu(scope, provider);
}
