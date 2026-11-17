import { Star } from "lucide-react";
import { type NodeDef, defaultNodeRegistry } from "@/core";
import { fuzzyFilter } from "@/ui";
import { getActiveDoc } from "@/ui/graph/graphStore";
import { isSearchable } from "@/ui/graph/searchRanking";
import { spawnQuickNode } from "../pro/quickNodes";
import type { Command } from "../commands/registry";

/** Category label of the synthetic "add this node" palette entries. */
const NODE_CATEGORY = "Add Node";
const NODE_ID_PREFIX = "node.add:";
export const isNodeCommand = (c: Command): boolean => c.id.startsWith(NODE_ID_PREFIX);

/** One synthetic palette command per placeable node definition (runs the same spawn path as the quick-node hotkeys). */
export function nodePaletteCommands(
  defs: readonly NodeDef[] = defaultNodeRegistry.list(),
  favorites: readonly string[] = [],
): Command[] {
  return defs.filter(isSearchable).map((d) => ({
    id: `${NODE_ID_PREFIX}${d.id}`,
    title: d.name,
    category: NODE_CATEGORY,
    ...(favorites.includes(d.id) ? { icon: Star } : {}),
    when: () => !!getActiveDoc(),
    run: () => void spawnQuickNode(d.id),
  }));
}

const MAX_COMMANDS = 50;
const MAX_NODES = 10;
const MAX_PINNED = 6;

/**
 * Palette ranking with nodes: an empty query lists favourite then recent nodes before the commands; a query ranks commands and
 * (at most `MAX_NODES`) node entries by the same fuzzy score. Pure — `nodes` is the output of `nodePaletteCommands`.
 */
export function paletteResultsWithNodes(
  commands: Command[],
  nodes: Command[],
  query: string,
  favorites: readonly string[],
  recents: readonly string[],
): Array<{ item: Command }> {
  const textOf = (c: Command): string => (isNodeCommand(c) ? c.title : `${c.category} ${c.title}`);
  if (!query.trim()) {
    const byId = new Map(nodes.map((n) => [n.id.slice(NODE_ID_PREFIX.length), n]));
    const pick = (ids: readonly string[]): Command[] =>
      ids
        .map((i) => byId.get(i))
        .filter((c): c is Command => !!c)
        .slice(0, MAX_PINNED);
    const pinned = [...new Set([...pick(favorites), ...pick(recents)])];
    return [...pinned, ...commands].slice(0, 60).map((item) => ({ item }));
  }
  const all = fuzzyFilter([...commands, ...nodes], query, textOf);
  const out: Array<{ item: Command; score: number }> = [];
  let nc = 0;
  let cc = 0;
  for (const r of all) {
    if (isNodeCommand(r.item)) {
      if (nc++ >= MAX_NODES) continue;
    } else if (cc++ >= MAX_COMMANDS) continue;
    out.push({ item: r.item, score: r.result.score });
  }
  return out;
}
