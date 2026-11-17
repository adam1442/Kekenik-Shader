import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Kbd, fuzzyFilter, fuzzyMatch, splitHighlight, cx } from "@/ui";
import { isCommandEnabled, runCommand, useCommands, type Command } from "../commands/registry";
import { useUi } from "../state";
import { useNodePrefs } from "@/ui/graph/prefs";
import { isNodeCommand, nodePaletteCommands, paletteResultsWithNodes } from "./paletteNodes";

const MAX_RESULTS = 60;

/** Fuzzy-search the command palette (Mod+K). */
export function paletteResults(commands: Command[], query: string) {
  return fuzzyFilter(commands, query, (c) => `${c.category} ${c.title}`).slice(0, MAX_RESULTS);
}

export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen);
  const setOpen = useUi((s) => s.setPalette);
  const commands = useCommands();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const restore = useRef<HTMLElement | null>(null);

  const favorites = useNodePrefs((s) => s.favorites);
  const recents = useNodePrefs((s) => s.recents);
  const nodes = useMemo(() => (open ? nodePaletteCommands(undefined, favorites) : []), [open, favorites]);
  const results = useMemo(
    () => (open ? paletteResultsWithNodes(commands, nodes, query, favorites, recents) : []),
    [open, commands, nodes, query, favorites, recents],
  );

  useEffect(() => {
    if (open) {
      restore.current = document.activeElement as HTMLElement | null;
      setQuery("");
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      restore.current?.focus?.();
    }
  }, [open]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const run = (c: Command | undefined) => {
    if (!c || !isCommandEnabled(c)) return;
    setOpen(false);
    window.setTimeout(() => runCommand(c.id), 0);
  };

  return (
    <div className="kk-palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div
        className="kk-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command Palette"
        data-kk="command-palette"
        data-overlay=""
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(results.length - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            run(results[active]?.item);
          }
        }}
      >
        <div className="kk-palette__input">
          <Search size={15} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command or a node name…"
            spellCheck={false}
            aria-label="Search commands"
          />
          <Kbd>Esc</Kbd>
        </div>
        <div className="kk-palette__list" ref={listRef} role="listbox">
          {results.length === 0 && <div className="kk-palette__empty">No matching commands</div>}
          {results.map(({ item: c }, i) => {
            const Icon = c.icon;
            const enabled = isCommandEnabled(c);
            const parts = splitHighlight(c.title, fuzzyMatch(query, c.title)?.indices ?? []);
            const pinned = isNodeCommand(c) && !query.trim();
            return (
              <div
                key={c.id}
                data-i={i}
                data-command-id={c.id}
                role="option"
                aria-selected={i === active}
                aria-disabled={!enabled}
                title={c.disabledReason}
                className={cx("kk-palette__item", i === active && "is-active", !enabled && "is-disabled")}
                onMouseMove={() => setActive(i)}
                onClick={() => run(c)}
              >
                <span className="kk-palette__icon">{Icon && <Icon size={14} />}</span>
                <span className="kk-palette__cat">
                  {pinned ? (favorites.includes(c.id.slice(9)) ? "★ Node" : "Recent node") : c.category}
                </span>
                <span className="kk-palette__title">
                  {parts.map((p, k) => (p.hit ? <mark key={k}>{p.text}</mark> : <span key={k}>{p.text}</span>))}
                </span>
                {c.disabledReason ? (
                  <span className="kk-palette__reason">{c.disabledReason}</span>
                ) : c.shortcut ? (
                  <Kbd shortcut={c.shortcut} />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
