import { Command, Hexagon } from "lucide-react";
import { useRef, useState } from "react";
import { Kbd, MenuPanel, useDismiss } from "@/ui";
import { runCommand } from "../commands/registry";
import { buildMenuBarMenu, MENU_BAR, type MenuBarId } from "../menus";
import { APP_NAME } from "../lib/version";

/** Top menu bar: File / Edit / View / Window / Help. Menus are built fresh on open so state is current. */
export function MenuBar() {
  const [open, setOpen] = useState<{ id: MenuBarId; rect: DOMRect } | null>(null);
  const refs = useRef<Partial<Record<MenuBarId, HTMLButtonElement | null>>>({});
  useDismiss(open !== null, () => setOpen(null));

  const openMenu = (id: MenuBarId) => {
    const el = refs.current[id];
    if (el) setOpen({ id, rect: el.getBoundingClientRect() });
  };

  const sibling = (dir: -1 | 1) => {
    if (!open) return;
    const i = MENU_BAR.findIndex((m) => m.id === open.id);
    openMenu(MENU_BAR[(i + dir + MENU_BAR.length) % MENU_BAR.length].id);
  };

  return (
    <div className="kk-menubar" role="menubar" data-ctx-scope="menubar.empty">
      <div className="kk-brand" aria-label={APP_NAME}>
        <Hexagon size={16} strokeWidth={2.2} className="kk-brand__mark" />
        <span className="kk-brand__name">{APP_NAME}</span>
      </div>
      {MENU_BAR.map((m) => (
        <button
          key={m.id}
          ref={(el) => {
            refs.current[m.id] = el;
          }}
          type="button"
          role="menuitem"
          data-menu-trigger=""
          data-menubar-id={m.id}
          aria-haspopup="menu"
          aria-expanded={open?.id === m.id}
          className={open?.id === m.id ? "kk-menubar__item is-open" : "kk-menubar__item"}
          onClick={() => (open?.id === m.id ? setOpen(null) : openMenu(m.id))}
          onMouseEnter={() => open && open.id !== m.id && openMenu(m.id)}
        >
          {m.label}
        </button>
      ))}
      <div className="kk-menubar__spacer" />
      <button
        type="button"
        className="kk-palette-btn"
        onClick={() => runCommand("app.commandPalette")}
        title="Command Palette"
      >
        <Command size={12} />
        <span>Search commands</span>
        <Kbd shortcut="Mod+K" />
      </button>
      <div className="kk-menubar__spacer" />
      {open && (
        <MenuPanel
          key={open.id}
          items={buildMenuBarMenu(open.id)}
          placement={{ kind: "dropdown", rect: open.rect }}
          onClose={() => setOpen(null)}
          onSibling={sibling}
          searchable={false}
          ariaLabel={open.id}
        />
      )}
    </div>
  );
}
