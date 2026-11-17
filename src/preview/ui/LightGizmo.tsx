import { type PointerEvent as RPointerEvent, useRef } from "react";
import { anglesToGizmo, gizmoToAngles } from "../logic/lightGizmo";
import { usePreview } from "../previewStore";

const R = 30;

/** Viewport light gizmo: drag the sun to aim the key light; double-click flips it behind the object. Shown for 3D lit previews. */
export function LightGizmo() {
  const az = usePreview((s) => s.lightAzimuth),
    el = usePreview((s) => s.lightElevation),
    mode = usePreview((s) => s.mode),
    set = usePreview((s) => s.set);
  const ref = useRef<HTMLDivElement>(null);
  if (mode !== "3d") return null;
  const p = anglesToGizmo(az, el);
  const aim = (e: RPointerEvent, front: boolean): void => {
    const r = ref.current!.getBoundingClientRect();
    const a = gizmoToAngles(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1, front);
    set({ lightAzimuth: a.azimuth, lightElevation: a.elevation });
  };
  return (
    <div
      ref={ref}
      className="kk-pv__gizmo"
      data-testid="light-gizmo"
      data-no-pan
      title="Drag to aim the key light · double-click to flip front / back"
      style={{ width: R * 2, height: R * 2 }}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        aim(e, p.front);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) aim(e, p.front);
      }}
      onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
      onDoubleClick={() => set({ lightAzimuth: az >= 0 ? 180 - az : -180 - az })}
    >
      <div
        className="kk-pv__gizmo-dot"
        data-front={p.front ? "1" : "0"}
        style={{ left: `${50 + p.x * 42}%`, top: `${50 + p.y * 42}%` }}
      />
    </div>
  );
}
