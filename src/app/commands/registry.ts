import { useSyncExternalStore } from "react";
import { normalizeShortcut, type IconType } from "@/ui";

/**
 * Command registry — single source of truth for every user-invokable action.
 * Menus, toolbar, palette and keybindings all read from here.
 */
export interface Command {
  /** Stable dotted id, e.g. "view.resetLayout". */
  id: string;
  title: string;
  category: string;
  icon?: IconType;
  /** Canonical shortcut ("Mod+Shift+K"). */
  shortcut?: string;
  /** Shortcuts only conflict inside the same key scope (default "global"). */
  keyScope?: string;
  /** Dynamic availability. */
  when?: () => boolean;
  /** If set, the command is shown but disabled with this tooltip. */
  disabledReason?: string;
  run?: () => void;
}

export interface KeybindingConflict {
  shortcut: string;
  keyScope: string;
  commandIds: string[];
}

const commands = new Map<string, Command>();
const listeners = new Set<() => void>();
let version = 0;

function bump() {
  version++;
  listeners.forEach((l) => l());
}

/** Register (or replace) a command. Returns an unregister function. */
export function registerCommand(cmd: Command): () => void {
  commands.set(cmd.id, cmd);
  bump();
  return () => {
    if (commands.get(cmd.id) === cmd) {
      commands.delete(cmd.id);
      bump();
    }
  };
}

/** User keybinding overrides (command id → shortcut; "" = unbound). Applied by `getCommand` / `listCommands`, so every consumer sees them. */
const overrides = new Map<string, string>();

export function setShortcutOverrides(map: Record<string, string>): void {
  overrides.clear();
  for (const [id, sc] of Object.entries(map)) overrides.set(id, sc);
  bump();
}
export const getShortcutOverrides = (): Record<string, string> => Object.fromEntries(overrides);

const effective = (c: Command): Command => {
  const o = overrides.get(c.id);
  if (o === undefined) return c;
  const { shortcut: _drop, ...rest } = c;
  void _drop;
  return o ? { ...rest, shortcut: o } : rest;
};

/** The command exactly as registered (default shortcut), for the keybinding editor. */
export const getDefaultCommand = (id: string): Command | undefined => commands.get(id);

export function getCommand(id: string): Command | undefined {
  const c = commands.get(id);
  return c ? effective(c) : undefined;
}

export function listCommands(): Command[] {
  return Array.from(commands.values(), effective);
}

export function isCommandEnabled(cmd: Command): boolean {
  if (cmd.disabledReason || !cmd.run) return false;
  try {
    return cmd.when ? cmd.when() : true;
  } catch {
    return false;
  }
}

/** Run a command by id. Returns true if it executed. */
export function runCommand(id: string): boolean {
  const cmd = commands.get(id);
  if (!cmd || !isCommandEnabled(cmd)) return false;
  try {
    cmd.run!();
  } catch (err) {
    console.error(`[Kekenik Shader] command "${id}" failed`, err);
    return false;
  }
  return true;
}

/** Detect commands sharing the same shortcut inside the same key scope. */
export function findKeybindingConflicts(list: Command[] = listCommands()): KeybindingConflict[] {
  const groups = new Map<string, KeybindingConflict>();
  for (const c of list) {
    if (!c.shortcut) continue;
    const shortcut = normalizeShortcut(c.shortcut);
    const keyScope = c.keyScope ?? "global";
    const key = `${keyScope}|${shortcut}`;
    const g = groups.get(key) ?? { shortcut, keyScope, commandIds: [] };
    g.commandIds.push(c.id);
    groups.set(key, g);
  }
  return Array.from(groups.values()).filter((g) => g.commandIds.length > 1);
}

function subscribeCommands(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** React hook: re-renders when commands are (un)registered. */
export function useCommands(): Command[] {
  useSyncExternalStore(subscribeCommands, () => version);
  return listCommands();
}
