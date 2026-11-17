import { eventToShortcut, hasCommandModifier, normalizeShortcut, type Platform } from "@/ui";
import { isCommandEnabled, listCommands, type Command } from "./registry";

const TEXT_INPUT_TYPES = new Set(["", "text", "search", "number", "email", "password", "url", "tel"]);

/** True when keyboard focus is inside something the user types text into. */
export function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  if (t instanceof HTMLTextAreaElement) return true;
  if (t instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(t.type);
  return false;
}

/** Commands that stay active while a modal/menu is open. */
const ALWAYS_ALLOWED = new Set(["app.commandPalette"]);

function overlayOpen(): boolean {
  return !!document.querySelector("[data-menu-panel],[aria-modal='true']");
}

/**
 * Resolve which command (if any) a keyboard event should trigger.
 * Rules: modifier-less shortcuts are disabled inside text fields; overlays block everything
 * except the palette toggle; disabled/unavailable commands never match.
 */
function resolveKeyEvent(e: KeyboardEvent, platform?: Platform, commands: Command[] = listCommands()): Command | null {
  const shortcut = eventToShortcut(e, platform);
  const bare = shortcut.split("+").pop();
  if (!bare || bare === "Shift" || bare === "Control" || bare === "Alt" || bare === "Meta") return null;
  if (isEditableTarget(e.target) && !hasCommandModifier(shortcut)) return null;
  for (const c of commands) {
    if (!c.shortcut || normalizeShortcut(c.shortcut) !== shortcut) continue;
    if (!isCommandEnabled(c)) continue;
    if (overlayOpen() && !ALWAYS_ALLOWED.has(c.id)) continue;
    return c;
  }
  return null;
}

/** Install the global keybinding listener. Returns a disposer. */
export function installKeybindings(target: Window = window): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented) return;
    const cmd = resolveKeyEvent(e);
    if (!cmd) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      cmd.run!();
    } catch (err) {
      console.error(`[Kekenik Shader] command "${cmd.id}" failed`, err);
    }
  };
  target.addEventListener("keydown", onKey, true);
  return () => target.removeEventListener("keydown", onKey, true);
}
