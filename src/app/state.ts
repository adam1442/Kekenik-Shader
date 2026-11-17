import { create } from "zustand";

/** Transient UI state: modals/palette visibility and the status-bar message. */
interface UiState {
  aboutOpen: boolean;
  shortcutsOpen: boolean;
  paletteOpen: boolean;
  saveLayoutOpen: boolean;
  setAbout: (v: boolean) => void;
  setShortcuts: (v: boolean) => void;
  setPalette: (v: boolean) => void;
  setSaveLayout: (v: boolean) => void;
}

export const useUi = create<UiState>((set) => ({
  aboutOpen: false,
  shortcutsOpen: false,
  paletteOpen: false,
  saveLayoutOpen: false,
  setAbout: (aboutOpen) => set({ aboutOpen }),
  setShortcuts: (shortcutsOpen) => set({ shortcutsOpen }),
  setPalette: (paletteOpen) => set({ paletteOpen }),
  setSaveLayout: (saveLayoutOpen) => set({ saveLayoutOpen }),
}));

interface StatusState {
  message: string;
  set: (message: string) => void;
}

let statusTimer: number | undefined;
const IDLE_MESSAGE = "Ready";

export const useStatus = create<StatusState>((set) => ({
  message: IDLE_MESSAGE,
  set: (message) => set({ message }),
}));

/** Show a message in the status bar; reverts to "Ready" after `ms`. */
export function setStatus(message: string, ms = 4000): void {
  window.clearTimeout(statusTimer);
  useStatus.getState().set(message);
  if (ms > 0) statusTimer = window.setTimeout(() => useStatus.getState().set(IDLE_MESSAGE), ms);
}
