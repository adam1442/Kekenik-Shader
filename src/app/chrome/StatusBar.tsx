import { storage } from "../lib/storage";
import { APP_NAME, APP_VERSION } from "../lib/version";
import { usePreview } from "@/preview/previewStore";
import { useStatus } from "../state";

/** Bottom status bar: messages on the left, live preview FPS (from the Preview engine) + version on the right. */
export function StatusBar() {
  const message = useStatus((s) => s.message);
  const fps = usePreview((s) => s.fps);
  return (
    <div className="kk-statusbar" data-ctx-scope="statusbar">
      <div className="kk-statusbar__left" role="status" aria-live="polite">
        <span className="kk-statusbar__dot" />
        <span className="kk-statusbar__msg">{message}</span>
      </div>
      <div className="kk-statusbar__right">
        {!storage.persistent && (
          <span className="kk-statusbar__item" title="Storage is unavailable; settings live in memory only">
            Memory-only storage
          </span>
        )}
        <span
          className="kk-statusbar__item"
          data-slot="fps"
          title="Preview frame rate (0 / — while the Preview panel is closed or idle)"
        >
          FPS {fps > 0 ? fps : "—"}
        </span>
        <span className="kk-statusbar__item">
          {APP_NAME} v{APP_VERSION}
        </span>
      </div>
    </div>
  );
}
