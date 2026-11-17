import { fuzzyMatch } from "../util/fuzzy";
import { isAction, isFocusable, type MenuActionItem, type MenuItem } from "./types";

/** Next focusable index moving in `dir` (wraps). `from` may be -1. Returns -1 if none. */
export function nextFocusable(items: MenuItem[], from: number, dir: 1 | -1): number {
  const n = items.length;
  if (n === 0) return -1;
  let i = from;
  for (let step = 0; step < n; step++) {
    i = (i + dir + n) % n;
    if (isFocusable(items[i])) return i;
  }
  return -1;
}

export function firstFocusable(items: MenuItem[]): number {
  return nextFocusable(items, -1, 1);
}

export function lastFocusable(items: MenuItem[]): number {
  return nextFocusable(items, items.length, -1);
}

/** Type-ahead: next focusable item after `from` whose label starts with `buffer` (wraps). */
export function typeAheadIndex(items: MenuItem[], from: number, buffer: string): number {
  const typed = buffer.toLowerCase();
  const n = items.length;
  // A single repeated char ("c", "cc", …) cycles through items starting with it;
  // a longer prefix is searched starting at the current item.
  const repeated = typed.length > 0 && [...typed].every((ch) => ch === typed[0]);
  const b = repeated ? typed[0] : typed;
  const start = repeated ? from + 1 : Math.max(from, 0);
  for (let k = 0; k < n; k++) {
    const i = (start + k + n) % n;
    const it = items[i];
    if (isFocusable(it) && it.label.toLowerCase().startsWith(b)) return i;
  }
  return -1;
}

export interface FlatEntry extends MenuActionItem {
  /** Breadcrumb of parent submenu labels. */
  path: string[];
}

/** Flatten submenus into leaf actions (used by the built-in menu search). */
function flattenLeaves(items: MenuItem[], path: string[] = []): FlatEntry[] {
  const out: FlatEntry[] = [];
  for (const it of items) {
    if (!isAction(it)) continue;
    if (it.submenu) out.push(...flattenLeaves(it.submenu, [...path, it.label]));
    else out.push({ ...it, path });
  }
  return out;
}

export function countLeaves(items: MenuItem[]): number {
  return flattenLeaves(items).length;
}

/** Fuzzy filter flattened leaves, best match first. */
export function searchMenu(items: MenuItem[], query: string): FlatEntry[] {
  const q = query.trim();
  const leaves = flattenLeaves(items);
  if (!q) return leaves;
  const scored: Array<{ e: FlatEntry; s: number; i: number }> = [];
  leaves.forEach((e, i) => {
    const r = fuzzyMatch(q, [...e.path, e.label].join(" "));
    if (r) scored.push({ e, s: r.score, i });
  });
  scored.sort((a, b) => b.s - a.s || a.i - b.i);
  return scored.map((x) => x.e);
}

/** Threshold above which menus show a search box. */
export const MENU_SEARCH_THRESHOLD = 12;
