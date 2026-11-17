import type { MenuItem } from "@/ui";

/** Panels contribute body-menu extras (items above the window items) without the shell knowing about them. */
const extras = new Map<string, () => MenuItem[]>();
export const registerPanelExtras = (panelId: string, fn: () => MenuItem[]): void => void extras.set(panelId, fn);
export const getPanelExtras = (panelId: string): MenuItem[] | undefined => extras.get(panelId)?.();
