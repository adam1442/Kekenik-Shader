import { Clipboard, Copy, MousePointerSquareDashed, Scissors } from "lucide-react";
import type { MenuItem } from "@/ui";
import { registerContextMenu, TEXT_INPUT_SCOPE } from "./registry";

type TextEl = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

function selectionText(el: TextEl): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const s = el.selectionStart ?? 0;
    const e = el.selectionEnd ?? 0;
    return el.value.slice(Math.min(s, e), Math.max(s, e));
  }
  return window.getSelection()?.toString() ?? "";
}

function isReadOnly(el: TextEl): boolean {
  return (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && (el.readOnly || el.disabled);
}

function insertText(el: TextEl, text: string): void {
  el.focus();
  // execCommand keeps the native undo stack and fires input events React listens to.
  if (document.execCommand("insertText", false, text)) return;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.setRangeText(text, el.selectionStart ?? 0, el.selectionEnd ?? 0, "end");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

async function paste(el: TextEl): Promise<void> {
  try {
    const text = await navigator.clipboard.readText();
    insertText(el, text);
  } catch {
    el.focus();
    document.execCommand("paste");
  }
}

function doCopy(el: TextEl, cut: boolean): void {
  const text = selectionText(el);
  el.focus();
  if (!document.execCommand(cut ? "cut" : "copy") && text) {
    void navigator.clipboard?.writeText(text).catch(() => undefined);
    if (cut) insertText(el, "");
  }
}

/** Built-in native-like Cut / Copy / Paste / Select all menu for editable text fields. */
export function registerTextInputContextMenu(): () => void {
  return registerContextMenu(TEXT_INPUT_SCOPE, (target): MenuItem[] => {
    const el = target.closest("input,textarea,[contenteditable='true']") as TextEl | null;
    if (!el) return [];
    const hasSel = selectionText(el).length > 0;
    const ro = isReadOnly(el);
    const isPassword = el instanceof HTMLInputElement && el.type === "password";
    return [
      {
        label: "Cut",
        icon: Scissors,
        shortcut: "Mod+X",
        disabled: !hasSel || ro || isPassword,
        run: () => doCopy(el, true),
      },
      { label: "Copy", icon: Copy, shortcut: "Mod+C", disabled: !hasSel || isPassword, run: () => doCopy(el, false) },
      { label: "Paste", icon: Clipboard, shortcut: "Mod+V", disabled: ro, run: () => void paste(el) },
      { separator: true },
      {
        label: "Select all",
        icon: MousePointerSquareDashed,
        shortcut: "Mod+A",
        run: () => {
          el.focus();
          if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.select();
          else document.execCommand("selectAll");
        },
      },
    ];
  });
}
