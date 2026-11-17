import { Check, ChevronDown, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { storage } from "@/app/lib/storage";
import { cx } from "../util/cx";
import type { IconType } from "../Button";
import { useBridge } from "./bridge";
import { Popover } from "./Popover";
import type { Density } from "./types";

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  icon?: IconType;
  description?: string;
  /** Group heading this option belongs to (options of the same group should be adjacent). */
  group?: string;
  disabled?: boolean;
  /** Extra text matched by search. */
  keywords?: string;
}

export interface SelectProps<T extends string = string> {
  value: T;
  options: SelectOption<T>[];
  onChange: (v: T) => void;
  onCommit?: (v: T) => void;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  mixed?: boolean;
  invalid?: boolean;
  message?: string;
  tooltip?: string;
  defaultValue?: T;
  density?: Density;
  /** Search box: `true`, `false`, or "auto" (default: on when more than 8 options). */
  searchable?: boolean | "auto";
  /** Show a clear (×) button; clearing calls onChange("" as T). */
  clearable?: boolean;
  /** Remember recently chosen values under this key (shown first when not searching). */
  recentsKey?: string;
  className?: string;
  "aria-label"?: string;
}

type Row<T extends string> = { kind: "group"; label: string } | { kind: "opt"; opt: SelectOption<T> };
const ROW_H = 26;
const ROW_H_DESC = 38;
const VIEW_ROWS = 9;

/** Subsequence/substring scoring: lower is better, null = no match. */
function matchScore(query: string, text: string): number | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  const i = t.indexOf(q);
  if (i >= 0) return i;
  let p = 0;
  for (const ch of t) if (ch === q[p] && ++p === q.length) return 100 + t.length;
  return null;
}

function loadRecents(key?: string): string[] {
  return key ? (storage.getJSON<string[]>(`select.recents.${key}`) ?? []) : [];
}

/**
 * Dropdown: searchable, grouped, icons, descriptions, type-ahead, keyboard-complete, virtualised, recents, clearable.
 * Renders in a portal Popover (never clipped by nodes/panels).
 */
export function Select<T extends string = string>(props: SelectProps<T>) {
  const {
    value,
    options,
    onChange,
    onCommit,
    placeholder = "Select…",
    disabled,
    readOnly,
    mixed,
    invalid,
    tooltip,
    density = "regular",
    clearable,
    className,
    recentsKey,
    defaultValue,
  } = props;
  const searchable = props.searchable === true || (props.searchable !== false && options.length > 8);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [scroll, setScroll] = useState(0);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const typeBuf = useRef({ s: "", t: 0 });
  const id = useId();
  const locked = disabled || readOnly;
  const current = options.find((o) => o.value === value);
  const Icon = current?.icon;
  const hasDesc = options.some((o) => o.description);
  const rowH = hasDesc ? ROW_H_DESC : ROW_H;

  const rows: Row<T>[] = useMemo(() => {
    const filtered = options
      .map((o) => ({ o, s: matchScore(query, `${o.label} ${o.keywords ?? ""} ${o.group ?? ""}`) }))
      .filter((x) => x.s !== null)
      .sort((a, b) => (query ? a.s! - b.s! : 0))
      .map((x) => x.o);
    const out: Row<T>[] = [];
    if (!query && recentsKey) {
      const rec = loadRecents(recentsKey)
        .map((v) => options.find((o) => o.value === v))
        .filter(Boolean) as SelectOption<T>[];
      if (rec.length) {
        out.push({ kind: "group", label: "Recent" });
        rec.slice(0, 3).forEach((opt) => out.push({ kind: "opt", opt }));
      }
    }
    let g: string | undefined | null = null;
    for (const o of filtered) {
      if (!query && o.group !== g) {
        g = o.group;
        if (g) out.push({ kind: "group", label: g });
      }
      out.push({ kind: "opt", opt: o });
    }
    return out;
  }, [options, query, recentsKey, open]);
  const optIdx = rows.map((r, i) => (r.kind === "opt" && !r.opt.disabled ? i : -1)).filter((i) => i >= 0);

  const close = (refocus = true) => {
    setOpen(false);
    setQuery("");
    if (refocus) btn.current?.focus();
  };
  const choose = (o: SelectOption<T>) => {
    if (o.disabled) return;
    if (recentsKey)
      storage.setJSON(
        `select.recents.${recentsKey}`,
        [o.value, ...loadRecents(recentsKey).filter((v) => v !== o.value)].slice(0, 6),
      );
    onChange(o.value);
    onCommit?.(o.value);
    close();
  };
  const openList = () => {
    if (locked) return;
    const i = rows.findIndex((r) => r.kind === "opt" && r.opt.value === value);
    setActive(i >= 0 ? i : (optIdx[0] ?? 0));
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    setActive((a) => (optIdx.includes(a) ? a : (optIdx[0] ?? 0)));
  }, [rows.length, open]);
  // Typing in the search box restarts the highlight at the best (first) match.
  useEffect(() => {
    if (open && query) setActive(optIdx[0] ?? 0);
  }, [query]);
  useEffect(() => {
    // keep the active row visible
    const el = list.current;
    if (!open || !el) return;
    const top = active * rowH;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + rowH > el.scrollTop + el.clientHeight) el.scrollTop = top + rowH - el.clientHeight;
  }, [active, open, rowH]);

  const move = (dir: 1 | -1 | "first" | "last") => {
    if (!optIdx.length) return;
    const pos = optIdx.indexOf(active);
    const next =
      dir === "first" ? 0 : dir === "last" ? optIdx.length - 1 : Math.min(optIdx.length - 1, Math.max(0, pos + dir));
    setActive(optIdx[next]!);
  };
  const onListKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Home") {
      e.preventDefault();
      move("first");
    } else if (e.key === "End") {
      e.preventDefault();
      move("last");
    } else if (e.key === "PageDown") {
      e.preventDefault();
      setActive(optIdx[Math.min(optIdx.length - 1, optIdx.indexOf(active) + VIEW_ROWS)] ?? active);
    } else if (e.key === "PageUp") {
      e.preventDefault();
      setActive(optIdx[Math.max(0, optIdx.indexOf(active) - VIEW_ROWS)] ?? active);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = rows[active];
      if (r?.kind === "opt") choose(r.opt);
    } else if (!searchable && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // type-ahead (non-searchable lists)
      const now = Date.now();
      typeBuf.current = {
        s: now - typeBuf.current.t > 700 ? e.key.toLowerCase() : typeBuf.current.s + e.key.toLowerCase(),
        t: now,
      };
      const hit = optIdx.find((i) =>
        (rows[i] as { opt: SelectOption<T> }).opt.label.toLowerCase().startsWith(typeBuf.current.s),
      );
      if (hit !== undefined) setActive(hit);
    }
  };

  const { ref, props: ctx } = useBridge<HTMLDivElement>({
    kind: "select",
    copyText: () => current?.label ?? String(value),
    copyJson: () => JSON.stringify(value),
    paste: (t) => {
      const o = options.find((x) => x.value === t.trim() || x.label === t.trim());
      if (!o || locked) return false;
      onChange(o.value);
      onCommit?.(o.value);
      return true;
    },
    reset:
      defaultValue !== undefined
        ? () => {
            onChange(defaultValue);
            onCommit?.(defaultValue);
          }
        : undefined,
    canReset: () => defaultValue !== undefined && defaultValue !== value,
    disabled,
    readOnly,
  });

  const total = rows.length * rowH;
  const start = Math.max(0, Math.floor(scroll / rowH) - 3);
  const end = Math.min(rows.length, start + VIEW_ROWS + 8);
  const label: ReactNode = mixed ? "\u2014" : (current?.label ?? placeholder);
  return (
    <div ref={ref} {...ctx} className={cx("kk-selectwrap", `kk-selectwrap--${density}`, className)}>
      <button
        ref={btn}
        type="button"
        data-kk="select"
        data-no-pan=""
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={props["aria-label"]}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        title={invalid ? props.message : tooltip}
        className={cx(
          "kk-select",
          `kk-select--${density}`,
          open && "is-open",
          invalid && "is-invalid",
          mixed && "is-mixed",
          readOnly && "is-readonly",
        )}
        onClick={() => (open ? close(false) : openList())}
        onKeyDown={(e) => {
          if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !open) {
            e.preventDefault();
            openList();
          }
        }}
      >
        {Icon && !mixed && <Icon size={13} />}
        <span className={cx("kk-select__value", (!current || mixed) && "is-placeholder")}>{label}</span>
        {clearable && value !== "" && !locked && (
          <span
            role="button"
            aria-label="Clear"
            className="kk-select__clear"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onChange("" as T);
              onCommit?.("" as T);
            }}
          >
            <X size={11} />
          </span>
        )}
        <ChevronDown size={13} className="kk-select__chev" />
      </button>
      <Popover
        open={open}
        anchor={btn.current}
        onClose={() => close()}
        ariaLabel={props["aria-label"] ?? "Options"}
        className="kk-selectpop"
        width={Math.max(btn.current?.offsetWidth ?? 160, 180)}
      >
        <div
          onKeyDown={onListKey}
          className="kk-selectpop__body"
          tabIndex={searchable ? -1 : 0}
          ref={(n) => {
            if (n && !searchable && open && document.activeElement === document.body) n.focus();
          }}
        >
          {searchable && (
            <div className="kk-selectpop__search">
              <input
                autoFocus
                className="kk-selectpop__input"
                value={query}
                placeholder="Search…"
                aria-label="Search options"
                spellCheck={false}
                dir="auto"
                onChange={(e) => {
                  setQuery(e.target.value);
                  setScroll(0);
                  if (list.current) list.current.scrollTop = 0;
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape" && query) {
                    e.preventDefault();
                    e.stopPropagation();
                    setQuery("");
                  }
                }}
              />
            </div>
          )}
          <div
            ref={list}
            id={id}
            role="listbox"
            aria-label="Options"
            className="kk-selectpop__list"
            style={{ maxHeight: rowH * VIEW_ROWS }}
            onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
          >
            {rows.length === 0 && <div className="kk-selectpop__empty">No matches</div>}
            <div style={{ height: total, position: "relative" }}>
              {rows.slice(start, end).map((r, k) => {
                const i = start + k;
                const style = { position: "absolute" as const, top: i * rowH, height: rowH, left: 0, right: 0 };
                if (r.kind === "group")
                  return (
                    <div key={`g${i}`} className="kk-selectpop__group" style={style} role="presentation">
                      {r.label}
                    </div>
                  );
                const o = r.opt;
                const OIcon = o.icon;
                const sel = !mixed && o.value === value;
                return (
                  <div
                    key={`o${i}`}
                    role="option"
                    aria-selected={sel}
                    aria-disabled={o.disabled || undefined}
                    data-label={o.label}
                    style={style}
                    className={cx(
                      "kk-selectpop__opt",
                      i === active && "is-active",
                      sel && "is-selected",
                      o.disabled && "is-disabled",
                    )}
                    onPointerMove={() => i !== active && setActive(i)}
                    onClick={() => choose(o)}
                  >
                    {OIcon && <OIcon size={13} />}
                    <span className="kk-selectpop__text">
                      <span className="kk-selectpop__label">{o.label}</span>
                      {o.description && <span className="kk-selectpop__desc">{o.description}</span>}
                    </span>
                    {sel && <Check size={12} className="kk-selectpop__check" />}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </Popover>
    </div>
  );
}

export interface ComboboxProps {
  value: string;
  suggestions: string[];
  onChange?: (v: string) => void;
  onCommit?: (v: string) => void;
  onCancel?: () => void;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  invalid?: boolean;
  validate?: (v: string) => string | null;
  density?: Density;
  mono?: boolean;
  className?: string;
  "aria-label"?: string;
}

/** Free text + suggestions (identifiers, semantic names). Enter commits the typed text or the highlighted suggestion. */
export function Combobox({
  value,
  suggestions,
  onChange,
  onCommit,
  onCancel,
  placeholder,
  disabled,
  readOnly,
  invalid,
  validate,
  density = "regular",
  mono,
  className,
  ...rest
}: ComboboxProps) {
  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const wrap = useRef<HTMLDivElement>(null);
  const focused = useRef(false);
  const id = useId();
  const started = useRef(value);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  const items = suggestions
    .map((s) => ({ s, sc: matchScore(draft, s) }))
    .filter((x) => x.sc !== null && x.s !== draft)
    .sort((a, b) => a.sc! - b.sc!)
    .map((x) => x.s)
    .slice(0, 50);
  const error = validate ? validate(draft) : null;
  const bad = invalid || error !== null;
  const commit = (v: string) => {
    if (validate && validate(v) !== null) {
      setDraft(started.current);
      return;
    }
    setDraft(v);
    setOpen(false);
    if (v !== started.current) {
      started.current = v;
      onCommit?.(v);
    }
  };
  const { ref, props: ctx } = useBridge({
    kind: "combobox",
    copyText: () => value,
    copyJson: () => JSON.stringify(value),
    disabled,
    readOnly,
  });
  return (
    <div
      ref={(n) => {
        (wrap as { current: HTMLDivElement | null }).current = n;
        (ref as { current: HTMLDivElement | null }).current = n;
      }}
      {...ctx}
      data-kk="combobox"
      data-no-pan=""
      className={cx(
        "kk-text kk-combo",
        `kk-text--${density}`,
        mono && "kk-text--mono",
        bad && "is-invalid",
        (disabled || readOnly) && "is-disabled",
        className,
      )}
      title={bad ? (error ?? undefined) : undefined}
    >
      <input
        className="kk-text__input"
        role="combobox"
        aria-expanded={open}
        aria-controls={id}
        aria-autocomplete="list"
        aria-label={rest["aria-label"]}
        aria-invalid={bad || undefined}
        dir="auto"
        value={draft}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        spellCheck={false}
        autoComplete="off"
        onFocus={() => {
          focused.current = true;
          started.current = value;
          setOpen(true);
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          onChange?.(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onBlur={() => {
          setTimeout(() => {
            if (!wrap.current?.contains(document.activeElement)) {
              focused.current = false;
              setOpen(false);
              commit(draft);
            }
          }, 0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(items.length - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(-1, a - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            commit(active >= 0 && items[active] ? items[active]! : draft);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            if (open) setOpen(false);
            else {
              setDraft(started.current);
              onChange?.(started.current);
              onCancel?.();
            }
          }
        }}
      />
      <Popover
        open={open && items.length > 0 && !disabled && !readOnly}
        anchor={wrap.current}
        onClose={() => setOpen(false)}
        autoFocus={false}
        trapFocus={false}
        className="kk-selectpop"
        width={wrap.current?.offsetWidth}
      >
        <div role="listbox" id={id} className="kk-selectpop__list" style={{ maxHeight: ROW_H * 8 }}>
          {items.map((s, i) => (
            <div
              key={s}
              role="option"
              aria-selected={i === active}
              className={cx("kk-selectpop__opt", i === active && "is-active")}
              style={{ height: ROW_H }}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => commit(s)}
            >
              <span className="kk-selectpop__label">{s}</span>
            </div>
          ))}
        </div>
      </Popover>
    </div>
  );
}
