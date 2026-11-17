import { AlertTriangle, Box } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { EmptyState } from "@/ui";
import type { PanelProps } from "@/app/dock/panelRegistry";
import { importAndUse, useAsset as applyPreviewAsset } from "../actions";
import { ensureAssetsLoaded } from "../assets/assetStore";
import { usePrefs } from "@/app/prefs/preferences";
import { PreviewController } from "../controller";
import { usePreview } from "../previewStore";
import { BACKDROP_HEX } from "../logic/backdrop";
import { PreviewDrawer } from "./PreviewDrawer";
import { LightGizmo } from "./LightGizmo";
import { PreviewToolbar, TimeBar } from "./PreviewToolbar";

const hasPayload = (e: DragEvent) =>
  e.dataTransfer.types.includes("Files") || e.dataTransfer.types.includes("application/x-kk-asset");

/** CSS behind the (transparent) WebGL canvas: background modes, the 2D checker. */
function backgroundStyle(bg: string, color: string): React.CSSProperties {
  switch (bg) {
    case "dark":
      return { background: BACKDROP_HEX.dark };
    case "light":
      return { background: BACKDROP_HEX.light };
    case "solid":
      return { background: color };
    case "checker":
      return {
        backgroundColor: "#2a2d34",
        backgroundImage:
          "linear-gradient(45deg,#353943 25%,transparent 25%,transparent 75%,#353943 75%),linear-gradient(45deg,#353943 25%,transparent 25%,transparent 75%,#353943 75%)",
        backgroundSize: "24px 24px",
        backgroundPosition: "0 0,12px 12px",
      };
    case "environment":
      return { background: BACKDROP_HEX.environment };
    default:
      return { background: "radial-gradient(120% 90% at 50% 20%, #2a2e38 0%, #16181d 70%)" };
  }
}

export function PreviewPanel(_props: PanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const ctlRef = useRef<PreviewController | null>(null);
  const [failed, setFailed] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [over, setOver] = useState(false);
  const [time, setTime] = useState(0);
  const s = usePreview();

  useEffect(() => {
    const canvas = canvasRef.current!;
    let ctl: PreviewController;
    try {
      ctl = new PreviewController(canvas);
    } catch (e) {
      setFailed((e as Error).message || "WebGL2 could not be initialised");
      return;
    }
    ctlRef.current = ctl;
    void ensureAssetsLoaded();
    const fit = () => {
      const r = wrapRef.current!.getBoundingClientRect();
      if (r.width > 4 && r.height > 4) ctl.engine.resize(r.width, r.height);
    };
    const ro = new ResizeObserver(fit);
    ro.observe(wrapRef.current!);
    fit();
    let quality = usePrefs.getState().previewQuality;
    const offPrefs = usePrefs.subscribe((st) => {
      if (st.previewQuality !== quality) {
        quality = st.previewQuality;
        window.requestAnimationFrame(fit);
      }
    }); // quality applies live
    const clock = window.setInterval(() => setTime(ctl.engine.clock.time), 120);
    return () => {
      window.clearInterval(clock);
      offPrefs();
      ro.disconnect();
      ctl.dispose();
      ctlRef.current = null;
    };
  }, []);

  const onDrop = (e: DragEvent) => {
    setOver(false);
    if (!hasPayload(e)) return;
    e.preventDefault();
    const id = e.dataTransfer.getData("application/x-kk-asset");
    if (id) applyPreviewAsset(id);
    else if (e.dataTransfer.files.length) void importAndUse(Array.from(e.dataTransfer.files));
  };

  if (failed)
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Preview unavailable"
        description={`WebGL2 is required for the preview. ${failed}`}
      />
    );
  const c = s.compile;
  const lit = s.lit === "lit";
  return (
    <div className="kk-pv" data-kk="preview">
      <PreviewToolbar drawer={drawer} onDrawer={() => setDrawer((d) => !d)} />
      <div
        ref={wrapRef}
        className="kk-pv__viewport"
        data-ctx-scope="preview.viewport"
        style={backgroundStyle(s.mode === "2d" && s.bg === "gradient" ? "checker" : s.bg, s.bgColor)}
        onDragOver={(e) => {
          if (hasPayload(e)) {
            e.preventDefault();
            setOver(true);
          }
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <canvas
          ref={canvasRef}
          className="kk-pv__canvas"
          tabIndex={0}
          aria-label="Shader preview viewport"
          data-testid="preview-canvas"
          style={{ imageRendering: s.nearest && s.mode === "2d" ? "pixelated" : "auto" }}
        />
        {c.state === "error" && (
          <div className="kk-pv__banner is-error" role="alert" data-testid="preview-error">
            <AlertTriangle size={13} />{" "}
            <span>
              {c.programs > 0 ? "Showing the last good shader — " : ""}
              {c.message}
            </span>
          </div>
        )}
        {s.loadError && (
          <div className="kk-pv__banner is-warn" role="status">
            <AlertTriangle size={13} /> <span>{s.loadError}</span>
          </div>
        )}
        {c.state === "idle" && (
          <div className="kk-pv__hint">
            <Box size={14} /> Open a graph to see its shader here. Drop a model, image or .hdr to preview with it.
          </div>
        )}
        {s.stats && (
          <div className="kk-pv__stats" data-testid="preview-stats">
            {s.fps > 0 ? `${s.fps} fps` : "idle"} · compile {c.ms.toFixed(1)} ms · {c.programs} program
            {c.programs === 1 ? "" : "s"} · {c.uniformUpdates} uniform update{c.uniformUpdates === 1 ? "" : "s"}
            {s.modelInfo && s.mode === "3d" ? ` · ${s.modelInfo.triangles.toLocaleString()} tris` : ""}
          </div>
        )}
        {lit && (
          <div className="kk-pv__badge" title="GGX Cook-Torrance, 3 lights, image-based ambient, ACES-style tone map">
            Preview lighting approximates the target engine
          </div>
        )}
        <LightGizmo />
        {over && <div className="kk-pv__drop">Drop to import</div>}
      </div>
      <TimeBar time={time} onScrub={(t) => ctlRef.current?.engine.setTime(t)} />
      {drawer && <PreviewDrawer />}
    </div>
  );
}
