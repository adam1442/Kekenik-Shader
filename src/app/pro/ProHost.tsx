import { useLayoutEffect } from "react";
import { installPreferences } from "../prefs/preferences";
import { HeatmapDriver } from "./HeatmapDriver";
import { HelpDialog } from "./HelpDialog";
import { BakeDialog } from "./BakeDialog";
import { BenchmarkDialog } from "./BenchmarkDialog";
import { OptReportDialog } from "./OptReportDialog";
import { PreferencesDialog } from "./PreferencesDialog";
import { installQuickNodes } from "./quickNodes";
import { startSession } from "./session";
import { SnapshotsDialog } from "./SnapshotsDialog";
import { WelcomeDialog } from "./WelcomeDialog";

/** Mounts the dialogs and starts the app-level services (preferences, quick-node hotkeys, autosave + crash recovery). */
export function ProHost() {
  useLayoutEffect(() => {
    installPreferences();
    const offKeys = installQuickNodes();
    const offSession = startSession();
    return () => {
      offKeys();
      offSession();
    };
  }, []);
  return (
    <>
      <PreferencesDialog />
      <WelcomeDialog />
      <SnapshotsDialog />
      <HelpDialog />
      <OptReportDialog />
      <BenchmarkDialog />
      <BakeDialog />
      <HeatmapDriver />
    </>
  );
}
