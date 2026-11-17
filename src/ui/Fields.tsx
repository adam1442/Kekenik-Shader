import { Search } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import { TextField } from "./controls/TextField";
import { cx } from "./util/cx";
import { shortcutTokens } from "./util/shortcut";

/* ── SearchField ─────────────────────────────────────────────────────── */
export interface SearchFieldProps {
  value: string;
  onChange: (v: string) => void;
  size?: "sm" | "md";
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  "aria-label"?: string;
}

/** Search input with icon and clear button (built on the controls TextField). Esc clears first, then bubbles. */
export function SearchField({
  value,
  onChange,
  size = "md",
  className,
  placeholder = "Search…",
  onKeyDown,
  autoFocus,
  ...rest
}: SearchFieldProps) {
  return (
    <TextField
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      prefix={<Search size={13} />}
      clearable
      bare
      autoFocus={autoFocus}
      density={size === "sm" ? "compact" : "regular"}
      aria-label={rest["aria-label"] ?? placeholder}
      className={cx("kk-search", `kk-search--${size}`, className)}
      onKeyDown={(e) => {
        if (e.key === "Escape" && value) {
          e.preventDefault();
          e.stopPropagation();
          onChange("");
          return;
        }
        onKeyDown?.(e);
      }}
    />
  );
}

/* ── Kbd ─────────────────────────────────────────────────────────────── */
export interface KbdProps {
  /** Canonical shortcut ("Mod+Shift+K") rendered platform-aware as separate chips. */
  shortcut?: string;
  children?: ReactNode;
  className?: string;
}

export function Kbd({ shortcut, children, className }: KbdProps) {
  if (shortcut) {
    return (
      <span data-kk="kbd" className={cx("kk-kbd-group", className)}>
        {shortcutTokens(shortcut).map((t, i) => (
          <kbd key={i} className="kk-kbd">
            {t}
          </kbd>
        ))}
      </span>
    );
  }
  return (
    <kbd data-kk="kbd" className={cx("kk-kbd", className)}>
      {children}
    </kbd>
  );
}

/* ── Badge ───────────────────────────────────────────────────────────── */
export interface BadgeProps {
  tone?: "neutral" | "accent" | "cyan" | "success" | "warning" | "danger" | "info";
  children: ReactNode;
  className?: string;
}

export function Badge({ tone = "neutral", children, className }: BadgeProps) {
  return (
    <span data-kk="badge" className={cx("kk-badge", `kk-badge--${tone}`, className)}>
      {children}
    </span>
  );
}
