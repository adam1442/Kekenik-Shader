import { forwardRef, type ButtonHTMLAttributes, type ComponentType, type ReactNode } from "react";
import { cx } from "./util/cx";

export type IconType = ComponentType<{ size?: number | string; strokeWidth?: number | string; className?: string }>;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  icon?: IconType;
  children?: ReactNode;
}

/** Standard push button. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon: Icon, className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      data-kk="button"
      className={cx("kk-btn", `kk-btn--${variant}`, `kk-btn--${size}`, className)}
      {...rest}
    >
      {Icon && <Icon size={size === "sm" ? 12 : 14} strokeWidth={2} />}
      {children}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: IconType;
  /** Accessible label; also used as native tooltip fallback. */
  label: string;
  size?: "sm" | "md" | "lg";
  active?: boolean;
  variant?: "ghost" | "solid";
}

/** Square icon-only button. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, size = "md", active, variant = "ghost", className, type = "button", title, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      data-kk="icon-button"
      aria-label={label}
      aria-pressed={active}
      title={title ?? label}
      className={cx("kk-iconbtn", `kk-iconbtn--${size}`, `kk-iconbtn--${variant}`, active && "is-active", className)}
      {...rest}
    >
      <Icon size={size === "sm" ? 13 : size === "lg" ? 18 : 15} strokeWidth={1.9} />
    </button>
  );
});
