/**
 * Platform-aware keyboard shortcut helpers.
 * Canonical form: modifiers in order `Mod, Ctrl, Alt, Shift, Meta` then the key, joined by "+".
 * `Mod` = Ctrl on Windows/Linux, Cmd on macOS. Example: "Mod+Shift+K".
 */

export type Platform = "mac" | "other";

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "other";
  const p =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    "";
  return /mac|iphone|ipad/i.test(p) ? "mac" : "other";
}

interface ParsedShortcut {
  mod: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  key: string;
}

const KEY_ALIASES: Record<string, string> = {
  esc: "Escape",
  escape: "Escape",
  return: "Enter",
  enter: "Enter",
  del: "Delete",
  delete: "Delete",
  backspace: "Backspace",
  space: "Space",
  " ": "Space",
  tab: "Tab",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  arrowup: "ArrowUp",
  arrowdown: "ArrowDown",
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  plus: "+",
};

function normKey(k: string): string {
  const alias = KEY_ALIASES[k.toLowerCase()];
  if (alias) return alias;
  if (/^f\d{1,2}$/i.test(k)) return k.toUpperCase();
  return k.length === 1 ? k.toUpperCase() : k;
}

function parseShortcut(s: string): ParsedShortcut {
  const parts = s.split("+").map((p) => p.trim());
  // "Mod++" -> key is "+"
  let key = parts[parts.length - 1];
  if (key === "" && s.endsWith("+")) key = "+";
  const mods = new Set(parts.slice(0, -1).map((p) => p.toLowerCase()));
  return {
    mod: mods.has("mod") || mods.has("cmdorctrl"),
    ctrl: mods.has("ctrl") || mods.has("control"),
    alt: mods.has("alt") || mods.has("option"),
    shift: mods.has("shift"),
    meta: mods.has("meta") || mods.has("cmd") || mods.has("win"),
    key: normKey(key),
  };
}

function stringify(p: ParsedShortcut): string {
  const out: string[] = [];
  if (p.mod) out.push("Mod");
  if (p.ctrl) out.push("Ctrl");
  if (p.alt) out.push("Alt");
  if (p.shift) out.push("Shift");
  if (p.meta) out.push("Meta");
  out.push(p.key);
  return out.join("+");
}

export function normalizeShortcut(s: string): string {
  return stringify(parseShortcut(s));
}

/** True if the shortcut has Mod/Ctrl/Alt/Meta (i.e. is safe to fire while typing in a text field). */
export function hasCommandModifier(s: string): boolean {
  const p = parseShortcut(s);
  return p.mod || p.ctrl || p.alt || p.meta;
}

export interface KeyLike {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** Convert a keyboard event into its canonical shortcut string for the given platform. */
export function eventToShortcut(e: KeyLike, platform: Platform = detectPlatform()): string {
  const mac = platform === "mac";
  let key = e.key;
  if (e.code?.startsWith("Key")) key = e.code.slice(3);
  else if (e.code?.startsWith("Digit")) key = e.code.slice(5);
  if (key === "Control" || key === "Shift" || key === "Alt" || key === "Meta") key = "";
  return stringify({
    mod: mac ? e.metaKey : e.ctrlKey,
    ctrl: mac ? e.ctrlKey : false,
    alt: e.altKey,
    shift: e.shiftKey,
    meta: mac ? false : e.metaKey,
    key: normKey(key),
  });
}

const MAC_SYMBOLS: Record<string, string> = {
  Mod: "⌘",
  Ctrl: "⌃",
  Alt: "⌥",
  Shift: "⇧",
  Meta: "⌘",
  Enter: "↵",
  Escape: "Esc",
  Backspace: "⌫",
  Delete: "⌦",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

const PC_NAMES: Record<string, string> = {
  Mod: "Ctrl",
  Meta: "Win",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

/** Human-readable shortcut tokens (one per key chip). */
export function shortcutTokens(s: string, platform: Platform = detectPlatform()): string[] {
  const p = parseShortcut(s);
  const canonical = stringify(p).split("+");
  const keyToken = p.key;
  const tokens: string[] = [];
  for (let i = 0; i < canonical.length - 1; i++) tokens.push(canonical[i]);
  tokens.push(keyToken);
  const map = platform === "mac" ? MAC_SYMBOLS : PC_NAMES;
  return tokens.map((t) => map[t] ?? t);
}

export function formatShortcut(s: string, platform: Platform = detectPlatform()): string {
  const t = shortcutTokens(s, platform);
  return platform === "mac" ? t.join("") : t.join("+");
}
