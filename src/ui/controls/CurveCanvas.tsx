import {
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  type KeyboardEvent,
  type PointerEvent as RPointerEvent,
} from "react";
import { addKey, moveKeys, removeKey, setTangent, sideOf, type Curve } from "@/core/values/curve";
import { clamp, snapToStep } from "@/core/values/numeric";
import { beginDrag } from "./useDrag";
import {
  frameView,
  gridTicks,
  handleScreenPos,
  hitTest,
  keysInRect,
  niceStep,
  panView,
  samplePolyline,
  slopeFromHandle,
  toCurve,
  toScreen,
  zoomView,
  type Hit,
  type Size,
  type View,
} from "./curveView";

export interface CurveCanvasApi {
  frameAll(): void;
  frameSelection(): void;
  /** Keys under the last context-menu / pointer position (for key context menus). */
  hit(): Hit;
}

export interface CurveCanvasProps {
  curves: Curve[];
  active: number;
  colors: string[];
  unit: boolean;
  snap: boolean;
  selection: number[];
  readOnly?: boolean;
  height?: number;
  onSelect: (sel: number[]) => void;
  /** Live edit of the active curve. */
  onEdit: (c: Curve) => void;
  /** End of a gesture (commit) — only when something changed. */
  onCommitEdit: () => void;
  onCancelEdit: (start: Curve) => void;
  apiRef?: { current: CurveCanvasApi | null };
  /** Called with the scope the next context menu should use. */
  onContextHit?: (h: Hit) => void;
  "aria-label"?: string;
}

const C = {
  bg: "#0e1117",
  grid: "rgba(255,255,255,0.05)",
  gridStrong: "rgba(255,255,255,0.11)",
  unit: "rgba(124,92,255,0.07)",
  text: "rgba(164,172,191,0.75)",
  accent: "#9b86ff",
  key: "#e8ebf3",
};

/** Canvas curve surface: draws grid/curves/keys/handles imperatively and handles all pointer interaction. */
export function CurveCanvas(p: CurveCanvasProps) {
  const { curves, active, unit, selection, readOnly } = p;
  const cvs = useRef<HTMLCanvasElement>(null);
  const view = useRef<View | null>(null);
  const size = useRef<Size>({ w: 300, h: p.height ?? 180 });
  const box = useRef<[number, number, number, number] | null>(null);
  const hover = useRef<Hit>(null);
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const L = useRef(p);
  L.current = p;
  const curve = curves[active]!;
  const sel = new Set(selection);

  const ensureView = (): View => (view.current ??= frameView(curve.keys, { unit }));
  const frameAll = () => {
    const pts = curves.flatMap((c) => c.keys);
    view.current = frameView(pts, { unit });
    bump();
  };
  const frameSelection = () => {
    const pts = L.current.selection.map((i) => curve.keys[i]!).filter(Boolean);
    view.current = pts.length ? frameView(pts, { pad: 0.4 }) : frameView(curve.keys, { unit });
    bump();
  };
  useEffect(() => {
    if (p.apiRef) p.apiRef.current = { frameAll, frameSelection, hit: () => hover.current };
  });

  const draw = () => {
    const c = cvs.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth || size.current.w;
    const h = c.clientHeight || size.current.h;
    size.current = { w, h };
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const v = ensureView();
    const s = size.current;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, w, h);
    // unit box
    const [ux0, uy0] = toScreen(v, s, 0, 1);
    const [ux1, uy1] = toScreen(v, s, 1, 0);
    ctx.fillStyle = C.unit;
    ctx.fillRect(ux0, uy0, ux1 - ux0, uy1 - uy0);
    // adaptive grid + labels
    ctx.font = "10px 'JetBrains Mono', ui-monospace, monospace";
    ctx.textBaseline = "top";
    for (const t of gridTicks(v.x0, v.x1, w, 56)) {
      const [x] = toScreen(v, s, t, 0);
      ctx.strokeStyle = t === 0 ? C.gridStrong : C.grid;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, h);
      ctx.stroke();
      ctx.fillStyle = C.text;
      ctx.textAlign = "left";
      ctx.fillText(String(t), x + 3, h - 13);
    }
    for (const val of gridTicks(v.y0, v.y1, h, 34)) {
      const [, y] = toScreen(v, s, 0, val);
      ctx.strokeStyle = val === 0 ? C.gridStrong : C.grid;
      ctx.beginPath();
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(w, Math.round(y) + 0.5);
      ctx.stroke();
      ctx.fillStyle = C.text;
      ctx.textAlign = "left";
      ctx.fillText(String(val), 3, y + 2);
    }
    // curves (inactive first, dimmed)
    const order = curves
      .map((_, i) => i)
      .filter((i) => i !== active)
      .concat(active);
    for (const ci of order) {
      const cur = curves[ci]!;
      if (cur.keys.length === 0) continue;
      const color = p.colors[ci] ?? C.accent;
      ctx.lineWidth = ci === active ? 2 : 1.25;
      ctx.globalAlpha = ci === active ? 1 : 0.5;
      ctx.strokeStyle = color;
      const [kx0] = toScreen(v, s, cur.keys[0]!.t, 0);
      const [kx1] = toScreen(v, s, cur.keys[cur.keys.length - 1]!.t, 0);
      const seg = (xa: number, xb: number, dashed: boolean) => {
        if (xb <= xa) return;
        const pts = samplePolyline(cur, v, s, Math.max(0, xa), Math.min(w, xb));
        ctx.setLineDash(dashed ? [4, 4] : []);
        ctx.globalAlpha = (ci === active ? 1 : 0.5) * (dashed ? 0.55 : 1);
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
      };
      seg(kx0, kx1, false);
      seg(0, kx0, cur.preWrap !== "clamp" ? true : false);
      seg(kx1, w, cur.postWrap !== "clamp" ? true : false);
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    // keys + handles of the active curve
    curve.keys.forEach((k, i) => {
      const [x, y] = toScreen(v, s, k.t, k.v);
      const selected = sel.has(i);
      if (selected) {
        for (const side of ["in", "out"] as const) {
          const m = sideOf(k, side);
          const [hx, hy] = handleScreenPos(v, s, curve, i, side);
          const draggable = m === "free";
          ctx.strokeStyle = draggable ? C.accent : "rgba(155,134,255,0.3)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(hx, hy);
          ctx.stroke();
          ctx.fillStyle = draggable ? C.accent : "rgba(155,134,255,0.35)";
          ctx.beginPath();
          ctx.arc(hx, hy, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.fillStyle = selected ? C.accent : C.key;
      ctx.strokeStyle = "#0e1117";
      ctx.lineWidth = 1.5;
      const hot = hover.current?.kind === "key" && hover.current.index === i;
      const r = selected || hot ? 5 : 4;
      ctx.beginPath();
      ctx.rect(x - r, y - r, r * 2, r * 2);
      ctx.fill();
      ctx.stroke();
    });
    if (box.current) {
      const [a, b, c2, d] = box.current;
      ctx.fillStyle = "rgba(124,92,255,0.12)";
      ctx.strokeStyle = C.accent;
      ctx.lineWidth = 1;
      ctx.fillRect(Math.min(a, c2), Math.min(b, d), Math.abs(c2 - a), Math.abs(d - b));
      ctx.strokeRect(Math.min(a, c2) + 0.5, Math.min(b, d) + 0.5, Math.abs(c2 - a), Math.abs(d - b));
    }
  };
  useLayoutEffect(draw);
  useEffect(() => {
    const c = cvs.current;
    if (!c || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(c);
    return () => ro.disconnect();
  });

  const local = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = cvs.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const gridStep = (axis: "x" | "y") => {
    const v = ensureView();
    return niceStep(axis === "x" ? v.x1 - v.x0 : v.y1 - v.y0, 8) / 5;
  };

  const onPointerDown = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (e.button === 2) return;
    const [px, py] = local(e);
    const v = ensureView();
    const s = size.current;
    cvs.current!.focus();
    const base = {
      clientX: e.clientX,
      clientY: e.clientY,
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      target: e.currentTarget,
    };
    // pan
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      e.preventDefault();
      let vv = v;
      beginDrag(base, {
        onMove: (m) => {
          vv = panView(vv, s, m.dx, m.dy);
          view.current = vv;
          draw();
        },
      });
      return;
    }
    if (e.button !== 0 || readOnly) return;
    const hit = hitTest(curve, v, s, sel, px, py);
    const start = curve;
    if (hit?.kind === "handle") {
      let changed = false;
      beginDrag(base, {
        threshold: 2,
        onMove: (m) => {
          const [mx, my] = local(m);
          L.current.onEdit(
            setTangent(
              L.current.curves[L.current.active]!,
              hit.index,
              hit.side,
              slopeFromHandle(ensureView(), size.current, start, hit.index, hit.side, mx, my),
            ),
          );
          changed = true;
        },
        onEnd: ({ active: a, cancelled }) => {
          if (!a) return;
          if (cancelled) L.current.onCancelEdit(start);
          else if (changed) L.current.onCommitEdit();
        },
      });
      return;
    }
    if (hit?.kind === "key") {
      let next = selection;
      if (e.shiftKey)
        next = selection.includes(hit.index) ? selection.filter((i) => i !== hit.index) : [...selection, hit.index];
      else if (!selection.includes(hit.index)) next = [hit.index];
      p.onSelect(next);
      const moving = next.includes(hit.index) ? next : [hit.index];
      const k0 = start.keys[hit.index]!;
      let changed = false;
      beginDrag(base, {
        threshold: 3,
        onMove: (m) => {
          const vv = ensureView();
          const ss = size.current;
          let dt = (m.totalDx / ss.w) * (vv.x1 - vv.x0);
          let dv = (-m.totalDy / ss.h) * (vv.y1 - vv.y0);
          if (m.event.shiftKey) {
            if (Math.abs(m.totalDx) > Math.abs(m.totalDy)) dv = 0;
            else dt = 0;
          }
          if (L.current.snap || m.event.ctrlKey || m.event.metaKey) {
            dt = snapToStep(k0.t + dt, gridStep("x")) - k0.t;
            dv = snapToStep(k0.v + dv, gridStep("y")) - k0.v;
          }
          L.current.onEdit(moveKeys(start, moving, dt, dv, { unit: L.current.unit }));
          changed = true;
        },
        onEnd: ({ active: a, cancelled }) => {
          if (!a) return;
          if (cancelled) L.current.onCancelEdit(start);
          else if (changed) L.current.onCommitEdit();
        },
      });
      return;
    }
    // box select
    const origin: [number, number] = [px, py];
    const had = e.shiftKey ? selection : [];
    beginDrag(base, {
      threshold: 3,
      onMove: (m) => {
        const [mx, my] = local(m);
        box.current = [origin[0], origin[1], mx, my];
        L.current.onSelect(
          Array.from(
            new Set([...had, ...keysInRect(start, ensureView(), size.current, origin[0], origin[1], mx, my)]),
          ).sort((a, b) => a - b),
        );
        draw();
      },
      onEnd: ({ active: a }) => {
        box.current = null;
        if (!a && !e.shiftKey) L.current.onSelect([]);
        draw();
      },
    });
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (readOnly) return;
    const [px, py] = local(e);
    const v = ensureView();
    if (hitTest(curve, v, size.current, sel, px, py)) return;
    const [t, val] = toCurve(v, size.current, px, py);
    const res = addKey(curve, t, val, { unit });
    p.onEdit(res.curve);
    p.onSelect([res.index]);
    p.onCommitEdit();
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const [px, py] = local(e);
    const f = Math.exp(e.deltaY * 0.0015);
    view.current = zoomView(
      ensureView(),
      size.current,
      px,
      py,
      f,
      e.shiftKey ? "x" : e.altKey || e.ctrlKey ? "y" : "both",
    );
    draw();
  };
  useEffect(() => {
    const c = cvs.current;
    if (!c) return;
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
  });

  const onPointerMove = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (e.buttons) return;
    const [px, py] = local(e);
    const h = hitTest(curve, ensureView(), size.current, sel, px, py);
    const before = hover.current;
    hover.current = h;
    if (JSON.stringify(before) !== JSON.stringify(h)) {
      cvs.current!.style.cursor = h ? (h.kind === "handle" ? "crosshair" : "move") : "default";
      draw();
    }
  };

  /**
   * Decides `control.curve.key` vs `control.curve.canvas` from what is under the cursor. It must run BEFORE the global
   * context-menu host (document capture, stops propagation), so it is a native window-capture listener, not a React handler.
   */
  const prepareContextScope = (e: MouseEvent) => {
    const [px, py] = local(e);
    const h = hitTest(curve, ensureView(), size.current, sel, px, py);
    hover.current = h;
    p.onContextHit?.(h);
    if (h?.kind === "key" && !selection.includes(h.index)) p.onSelect([h.index]);
    cvs.current?.setAttribute("data-ctx-scope", h?.kind === "key" ? "control.curve.key" : "control.curve.canvas");
  };
  const ctxRef = useRef(prepareContextScope);
  ctxRef.current = prepareContextScope;
  useEffect(() => {
    const on = (e: MouseEvent) => {
      if (e.target === cvs.current) ctxRef.current(e);
    };
    window.addEventListener("contextmenu", on, true);
    return () => window.removeEventListener("contextmenu", on, true);
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLCanvasElement>) => {
    if (readOnly) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      let c = curve;
      for (const i of [...selection].sort((a, b) => b - a)) c = removeKey(c, i);
      p.onSelect([]);
      p.onEdit(c);
      p.onCommitEdit();
    } else if (e.key === "a" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      p.onSelect(curve.keys.map((_, i) => i));
    } else if (e.key === "a" || e.key === "Home") frameAll();
    else if (e.key === "f") frameSelection();
    else if (e.key.startsWith("Arrow") && selection.length) {
      e.preventDefault();
      const stepT = (e.shiftKey ? 0.1 : 1) * 0.01;
      const dt = e.key === "ArrowRight" ? stepT : e.key === "ArrowLeft" ? -stepT : 0;
      const dv = e.key === "ArrowUp" ? stepT : e.key === "ArrowDown" ? -stepT : 0;
      p.onEdit(moveKeys(curve, selection, dt, dv, { unit }));
      p.onCommitEdit();
    }
  };

  const bounded = (n: number) => clamp(n, 0, 1e9);
  void bounded;
  return (
    <canvas
      ref={cvs}
      className="kk-curvecanvas"
      style={{ height: p.height ?? 180 }}
      tabIndex={0}
      role="application"
      aria-label={p["aria-label"] ?? "Curve editor"}
      aria-description="Double-click to add a key, drag keys and handles, Delete removes, A frames all, F frames selection, wheel zooms, Alt-drag pans"
      data-ctx-scope="control.curve.canvas"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
    />
  );
}
