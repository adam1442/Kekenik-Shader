import type { MenuItem } from "@/ui";
import { SEP } from "@/ui";

/**
 * Context-menu scope registry.
 *
 * DOM contract: any element may carry `data-ctx-scope="graph.canvas"` (+ optional `data-ctx-id`).
 * The NEAREST ancestor scope wins. Menus never merge unless the provider returns `inherit: true`,
 * in which case resolution continues upward and the parent's items are appended.
 * Editable text fields without their own scope resolve to the built-in `text-input` scope.
 */
interface ContextMenuInfo {
  scope: string;
  /** Value of `data-ctx-id` on the scope element, if any. */
  id: string | null;
  /** The element that carries data-ctx-scope. */
  element: Element;
}

type ContextMenuResult = MenuItem[] | { items: MenuItem[]; inherit?: boolean };
export type ContextMenuProvider = (target: Element, event: MouseEvent, info: ContextMenuInfo) => ContextMenuResult;

export interface ResolvedContextMenu {
  items: MenuItem[];
  /** Scopes that contributed, nearest first. */
  scopes: string[];
}

const providers = new Map<string, ContextMenuProvider>();

export const TEXT_INPUT_SCOPE = "text-input";

/** Register a provider for a scope. Returns an unregister function. */
export function registerContextMenu(scope: string, provider: ContextMenuProvider): () => void {
  providers.set(scope, provider);
  return () => {
    if (providers.get(scope) === provider) providers.delete(scope);
  };
}

export function hasContextMenu(scope: string): boolean {
  return providers.has(scope);
}

export function listContextScopes(): string[] {
  return Array.from(providers.keys());
}

const TEXT_TYPES = new Set(["", "text", "search", "number", "email", "password", "url", "tel"]);

function isEditableTextElement(el: Element): boolean {
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return TEXT_TYPES.has(el.type);
  return el instanceof HTMLElement && el.getAttribute("contenteditable") === "true";
}

/**
 * Resolve the menu for a right-click target. Returns null when no registered scope applies
 * (the caller then lets the native browser menu through).
 */
export function resolveContextMenu(target: Element, event: MouseEvent): ResolvedContextMenu | null {
  const items: MenuItem[] = [];
  const scopes: string[] = [];
  let el: Element | null = target;
  while (el) {
    let scope: string | null = el.getAttribute("data-ctx-scope");
    if (!scope && isEditableTextElement(el)) scope = TEXT_INPUT_SCOPE;
    if (scope) {
      const provider = providers.get(scope);
      if (!provider) break; // unregistered nearest scope: no custom menu, and no leak from parents
      const raw = provider(target, event, { scope, id: el.getAttribute("data-ctx-id"), element: el });
      const res = Array.isArray(raw) ? { items: raw, inherit: false } : raw;
      if (items.length && res.items.length) items.push(SEP);
      items.push(...res.items);
      scopes.push(scope);
      if (!res.inherit) break;
    }
    el = el.parentElement;
  }
  return scopes.length ? { items, scopes } : null;
}
