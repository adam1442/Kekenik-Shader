import type { KeyboardEvent, ReactNode } from "react";
import { cx } from "./util/cx";
import type { IconType } from "./Button";

interface TabItem {
  id: string;
  label: string;
  icon?: IconType;
  badge?: ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  variant?: "underline" | "pill";
  className?: string;
}

/** Accessible tab strip (arrow keys, Home/End). Panels are rendered by the caller. */
export function Tabs({ items, value, onChange, variant = "underline", className }: TabsProps) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const enabled = items.filter((i) => !i.disabled);
    const idx = enabled.findIndex((i) => i.id === value);
    let next = -1;
    if (e.key === "ArrowRight") next = (idx + 1) % enabled.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + enabled.length) % enabled.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = enabled.length - 1;
    if (next >= 0) {
      e.preventDefault();
      const list = e.currentTarget; // currentTarget is nulled after the handler returns
      onChange(enabled[next].id);
      requestAnimationFrame(() => {
        (list.querySelector('[aria-selected="true"]') as HTMLElement | null)?.focus();
      });
    }
  };
  return (
    <div
      data-kk="tabs"
      role="tablist"
      className={cx("kk-tabs", `kk-tabs--${variant}`, className)}
      onKeyDown={onKeyDown}
    >
      {items.map((t) => {
        const Icon = t.icon;
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            disabled={t.disabled}
            className={cx("kk-tab", selected && "is-selected")}
            onClick={() => onChange(t.id)}
          >
            {Icon && <Icon size={13} />}
            <span>{t.label}</span>
            {t.badge !== undefined && <span className="kk-tab__badge">{t.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}
