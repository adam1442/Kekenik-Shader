import { create } from "zustand";

/** Visibility of the dialogs (kept apart from `app/state.ts`, which belongs to the shell). */
interface ProUi {
  prefsOpen: boolean;
  welcomeOpen: boolean;
  snapshotsOpen: boolean;
  helpOpen: boolean;
  optReportOpen: boolean;
  benchOpen: boolean;
  /** Node id the Bake-to-Texture dialog is open for (null = closed). */
  bakeNode: string | null;
  set: (p: Partial<Omit<ProUi, "set">>) => void;
}
export const useProUi = create<ProUi>((set) => ({
  prefsOpen: false,
  welcomeOpen: false,
  snapshotsOpen: false,
  helpOpen: false,
  optReportOpen: false,
  benchOpen: false,
  bakeNode: null,
  set: (p) => set(p),
}));
