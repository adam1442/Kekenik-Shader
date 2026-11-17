import type { IconType } from "../Button";

/** A clickable menu entry (also used for submenu parents, checkboxes and radios). */
export interface MenuActionItem {
  id?: string;
  label: string;
  icon?: IconType;
  /** Canonical shortcut string ("Mod+K") – rendered platform-aware. */
  shortcut?: string;
  submenu?: MenuItem[];
  type?: "normal" | "checkbox" | "radio";
  checked?: boolean;
  disabled?: boolean;
  /** Tooltip explaining why the item is disabled . */
  disabledReason?: string;
  danger?: boolean;
  /** Keep the menu open after running. */
  keepOpen?: boolean;
  run?: () => void;
}

export interface MenuSeparator {
  separator: true;
}

export interface MenuGroupLabel {
  group: string;
}

export type MenuItem = MenuActionItem | MenuSeparator | MenuGroupLabel;

export const SEP: MenuSeparator = { separator: true };
export const groupLabel = (group: string): MenuGroupLabel => ({ group });

export const isSeparator = (i: MenuItem): i is MenuSeparator => "separator" in i;
export const isGroupLabel = (i: MenuItem): i is MenuGroupLabel => "group" in i;
export const isAction = (i: MenuItem): i is MenuActionItem => !isSeparator(i) && !isGroupLabel(i);

/** Items the keyboard can land on. */
export const isFocusable = (i: MenuItem): i is MenuActionItem => isAction(i) && !i.disabled;
