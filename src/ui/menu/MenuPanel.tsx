import { Check, ChevronRight } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { cx } from "../util/cx";
import { useOverlayRoot } from "../overlay/overlayRoot";
import { Kbd } from "../Fields";
import { splitHighlight, fuzzyMatch } from "../util/fuzzy";
import {
  countLeaves,
  firstFocusable,
  lastFocusable,
  nextFocusable,
  searchMenu,
  typeAheadIndex,
  MENU_SEARCH_THRESHOLD,
  type FlatEntry,
} from "./menuNav";
import { placeMenu, type Placement, type PlacementResult } from "./placement";
import { isAction, isGroupLabel, isSeparator, type MenuActionItem, type MenuItem } from "./types";

export interface MenuPanelProps {
  items: MenuItem[];
  placement: Placement;
  /** Close the whole menu tree. */
  onClose: () => void;
  /** Present on submenus: close only this panel and return focus to the parent. */
  onBack?: () => void;
  /** Menu-bar dropdowns: ←/→ with no submenu switches the sibling menu. */
  onSibling?: (dir: -1 | 1) => void;
  /** Change to focus this panel (submenus focus when this increments). */
  focusSignal?: number;
  ariaLabel?: string;
  /** Force search box on/off; default: on when >12 leaf items. */
  searchable?: boolean;
}

const HOVER_INTENT_MS = 140;
type Row = MenuItem | FlatEntry;

/** A single menu surface (root or submenu). Rendered in a body portal; positions itself in the viewport. */
export function MenuPanel({
  items,
  placement,
  onClose,
  onBack,
  onSibling,
  focusSignal = 1,
  ariaLabel,
  searchable,
}: MenuPanelProps) {
  const overlayRoot = useOverlayRoot();
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<PlacementResult | null>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const [openSub, setOpenSub] = useState<number | null>(null);
  const [subSignal, setSubSignal] = useState(0);
  const [subRect, setSubRect] = useState<DOMRect | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const typeBuf = useRef({ text: "", t: 0 });

  const hasSearch = searchable ?? countLeaves(items) > MENU_SEARCH_THRESHOLD;
  const searching = hasSearch && query.trim().length > 0;
  const rows: Row[] = useMemo(() => (searching ? searchMenu(items, query) : items), [items, query, searching]);

  // Position after layout so we know our real size; re-run when content size changes.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const prevMax = el.style.maxHeight;
    el.style.maxHeight = "";
    const r = el.getBoundingClientRect();
    el.style.maxHeight = prevMax;
    setPos(
      placeMenu(
        placement,
        { width: r.width, height: r.height },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, [placement, rows]);

  // Focus handling.
  useEffect(() => {
    if (focusSignal <= 0) return;
    (hasSearch ? searchRef.current : rootRef.current)?.focus({ preventScroll: true });
    // Submenus entered by keyboard highlight their first item; roots wait for a key/hover.
    if (onBack) setActive((a) => (a >= 0 ? a : firstFocusable(rows)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // `pos` matters: a visibility:hidden panel (before first placement) cannot take focus.
  }, [focusSignal, pos !== null]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Keep first result active while searching.
  const wasSearching = useRef(false);
  useEffect(() => {
    if (searching) setActive(firstFocusable(rows));
    else if (wasSearching.current) setActive(-1);
    wasSearching.current = searching;
    setOpenSub(null);
  }, [query, searching]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (active < 0) return;
    rootRef.current?.querySelector<HTMLElement>(`[data-row="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const activate = (i: number, viaKeyboard: boolean) => {
    const it = rows[i];
    if (!it || !isAction(it) || it.disabled) return;
    if (it.submenu && !searching) {
      const el = rootRef.current?.querySelector<HTMLElement>(`[data-row="${i}"]`);
      if (el) setSubRect(el.getBoundingClientRect());
      setOpenSub(i);
      if (viaKeyboard) setSubSignal((s) => s + 1);
      return;
    }
    it.run?.();
    if (!it.keepOpen) onClose();
  };

  const scheduleHover = (i: number) => {
    window.clearTimeout(timer.current);
    const it = rows[i];
    setActive(i);
    if (it && isAction(it) && it.submenu && !it.disabled && !searching) {
      timer.current = window.setTimeout(() => activate(i, false), HOVER_INTENT_MS);
    } else if (openSub !== null && openSub !== i) {
      timer.current = window.setTimeout(() => setOpenSub(null), HOVER_INTENT_MS);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const k = e.key;
    const stop = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (k === "ArrowDown") {
      stop();
      setActive(nextFocusable(rows, active, 1));
    } else if (k === "ArrowUp") {
      stop();
      setActive(nextFocusable(rows, active < 0 ? 0 : active, -1));
    } else if (k === "Home" && !hasSearch) {
      stop();
      setActive(firstFocusable(rows));
    } else if (k === "End" && !hasSearch) {
      stop();
      setActive(lastFocusable(rows));
    } else if (k === "ArrowRight") {
      const it = rows[active];
      if (it && isAction(it) && it.submenu && !it.disabled && !searching) {
        stop();
        activate(active, true);
      } else if (onSibling) {
        stop();
        onSibling(1);
      }
    } else if (k === "ArrowLeft") {
      if (onBack) {
        stop();
        onBack();
      } else if (onSibling) {
        stop();
        onSibling(-1);
      }
    } else if (k === "Enter" || (k === " " && !hasSearch)) {
      stop();
      if (active >= 0) activate(active, true);
    } else if (k === "Escape") {
      stop();
      if (onBack) onBack();
      else onClose();
    } else if (k === "Tab") {
      stop();
      onClose();
    } else if (!hasSearch && k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      stop();
      const now = Date.now();
      const b = typeBuf.current;
      b.text = now - b.t > 700 ? k : b.text + k;
      b.t = now;
      const idx = typeAheadIndex(rows, active, b.text);
      if (idx >= 0) setActive(idx);
    }
  };

  const style: React.CSSProperties = pos
    ? { left: pos.left, top: pos.top, maxHeight: pos.maxHeight, visibility: "visible" }
    : { left: 0, top: 0, visibility: "hidden" };

  const subItem = openSub !== null ? rows[openSub] : undefined;

  return createPortal(
    <>
      <div
        ref={rootRef}
        data-menu-panel=""
        data-overlay=""
        data-flipped-x={pos?.flippedX ? "1" : undefined}
        data-flipped-y={pos?.flippedY ? "1" : undefined}
        role="menu"
        aria-label={ariaLabel}
        tabIndex={-1}
        className="kk-menu"
        style={style}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => e.preventDefault()}
      >
        {hasSearch && (
          <div className="kk-menu__search">
            <input
              ref={searchRef}
              className="kk-menu__search-input"
              placeholder="Search actions…"
              value={query}
              spellCheck={false}
              aria-label="Search menu"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // Escape clears the query first.
                if (e.key === "Escape" && query) {
                  e.preventDefault();
                  e.stopPropagation();
                  setQuery("");
                }
              }}
            />
          </div>
        )}
        <div className="kk-menu__list">
          {rows.length === 0 && <div className="kk-menu__empty">No matching actions</div>}
          {rows.map((it, i) => {
            if (isSeparator(it)) return <div key={i} role="separator" className="kk-menu__sep" />;
            if (isGroupLabel(it))
              return (
                <div key={i} className="kk-menu__group">
                  {it.group}
                </div>
              );
            return (
              <MenuRow
                key={i}
                index={i}
                item={it}
                query={searching ? query : ""}
                active={active === i}
                open={openSub === i}
                onHover={() => scheduleHover(i)}
                onClick={() => activate(i, false)}
              />
            );
          })}
        </div>
      </div>
      {subItem && isAction(subItem) && subItem.submenu && subRect && (
        <MenuPanel
          items={subItem.submenu}
          placement={{ kind: "submenu", rect: subRect }}
          onClose={onClose}
          onBack={() => {
            setOpenSub(null);
            (hasSearch ? searchRef.current : rootRef.current)?.focus({ preventScroll: true });
          }}
          focusSignal={subSignal}
          ariaLabel={subItem.label}
        />
      )}
    </>,
    overlayRoot,
  );
}

function MenuRow({
  item,
  index,
  active,
  open,
  query,
  onHover,
  onClick,
}: {
  item: MenuActionItem & { path?: string[] };
  index: number;
  active: boolean;
  open: boolean;
  query: string;
  onHover: () => void;
  onClick: () => void;
}) {
  const Icon = item.icon;
  const role = item.type === "checkbox" ? "menuitemcheckbox" : item.type === "radio" ? "menuitemradio" : "menuitem";
  const agent = item.disabledReason?.match(/Agent \d+\w?/)?.[0];
  const label = item.path && item.path.length ? `${item.path.join(" › ")} › ${item.label}` : item.label;
  const parts = query ? splitHighlight(label, fuzzyMatch(query, label)?.indices ?? []) : [{ text: label, hit: false }];
  return (
    <div
      role={role}
      data-row={index}
      data-label={item.label}
      aria-checked={item.type && item.type !== "normal" ? !!item.checked : undefined}
      aria-disabled={item.disabled || undefined}
      aria-haspopup={item.submenu ? "menu" : undefined}
      aria-expanded={item.submenu ? open : undefined}
      title={item.disabled ? item.disabledReason : undefined}
      className={cx(
        "kk-menu__item",
        active && "is-active",
        open && "is-open",
        item.disabled && "is-disabled",
        item.danger && "is-danger",
      )}
      onMouseEnter={onHover}
      onMouseMove={() => !active && onHover()}
      onClick={onClick}
    >
      <span className="kk-menu__check">
        {item.type === "checkbox" && item.checked && <Check size={12} strokeWidth={2.6} />}
        {item.type === "radio" && item.checked && <span className="kk-menu__dot" />}
      </span>
      <span className="kk-menu__icon">{Icon && <Icon size={14} />}</span>
      <span className="kk-menu__label">
        {parts.map((p, k) => (p.hit ? <mark key={k}>{p.text}</mark> : <span key={k}>{p.text}</span>))}
      </span>
      {item.disabled && agent ? (
        <span className="kk-menu__agent">{agent}</span>
      ) : item.submenu ? (
        <ChevronRight size={13} className="kk-menu__chev" />
      ) : item.shortcut ? (
        <Kbd shortcut={item.shortcut} className="kk-menu__kbd" />
      ) : null}
    </div>
  );
}
