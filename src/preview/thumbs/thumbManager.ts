import { useShader } from "@/app/shaderStore";
import type { Graph } from "@/core";
import { getController } from "../controller";
import { usePreview } from "../previewStore";
import { structureSignature, thumbSkipReason } from "../logic/thumbGraph";
import { ThumbScheduler } from "./ThumbScheduler";
import { type ThumbEntry, ThumbRenderer } from "./thumbRenderer";
import { clamp } from "@/core/values/numeric";
import { ShaderHost } from "../engine/shaderHost";

const MIN_PX = 24;
const MAX_PX = 192;

/** Visible node-preview slots in the document (the canvas only mounts cards near the viewport, so "mounted" = "visible"). */
function visibleSlots(root: ParentNode = document): Array<{ id: string; el: HTMLElement }> {
  const out: Array<{ id: string; el: HTMLElement }> = [];
  root.querySelectorAll<HTMLElement>("[data-preview-slot]").forEach((el) => {
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (r.width < 6 || r.height < 6 || r.right < 0 || r.bottom < 0 || r.left > vw || r.top > vh) return;
    out.push({ id: el.getAttribute("data-preview-slot")!, el });
  });
  return out;
}

/** Canvas size for a slot: its on-screen size (which already includes the canvas zoom), × dpr, clamped. */
const thumbPixelSize = (cssW: number, cssH: number, dpr = window.devicePixelRatio || 1): { w: number; h: number } => ({
  w: clamp(Math.round(cssW * dpr), MIN_PX, MAX_PX),
  h: clamp(Math.round(cssH * dpr), MIN_PX, MAX_PX),
});

/**
 * Keeps node thumbnails up to date: scheduler (limits) + shared renderer + per-node compiled entries.
 * Structural graph edits recompile; property-only edits just re-push uniforms; time-dependent nodes refresh at ≤ 10 Hz.
 */
export class ThumbManager {
  readonly scheduler: ThumbScheduler;
  readonly renderer = new ThumbRenderer();
  private entries = new Map<string, ThumbEntry | null>();
  private sig = "";
  private graph: Graph | null = null;
  private propsSig = "";
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(scheduler = new ThumbScheduler()) {
    this.scheduler = scheduler;
  }

  start(intervalMs = 100): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), intervalMs);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private drop(id: string): void {
    this.entries.get(id)?.host.dispose();
    this.entries.delete(id);
  }

  /** Reconcile with the current graph (compile on structure change, uniforms on property change). */
  private syncGraph(): void {
    const g = useShader.getState().graph;
    if (g === this.graph) return;
    this.graph = g;
    const sig = g ? structureSignature(g) : "";
    if (sig !== this.sig) {
      this.sig = sig;
      for (const id of [...this.entries.keys()]) this.drop(id);
      this.scheduler.markDirty();
    } else if (g && JSON.stringify(g.properties) !== this.propsSig) {
      for (const e of this.entries.values()) if (e) this.renderer.refresh(e, g);
      this.scheduler.markDirty();
    }
    this.propsSig = g ? JSON.stringify(g.properties) : "";
  }

  /** One scheduling step (public for tests). `slots` default = the visible slots of the document. */
  tick(slots = visibleSlots(), now = performance.now()): number {
    this.syncGraph();
    const graph = this.graph;
    if (!graph) return 0;
    const dropped = this.scheduler.setVisible(slots.map((s) => s.id));
    dropped.forEach((id) => this.drop(id));
    const byId = new Map(slots.map((s) => [s.id, s.el]));
    for (const [id, el] of byId) if (!el.querySelector("canvas.kk-thumb")) this.scheduler.markDirty(id); // slot re-mounted
    const running = usePreview.getState().playing;
    let n = 0;
    for (const id of this.scheduler.pick(now, running)) {
      const el = byId.get(id);
      if (!el) continue;
      // Failures are isolated PER THUMBNAIL: an exception here used to abort the whole tick before `done(id)`, so the same two nodes were
      // picked again forever and every other thumbnail starved (notes defect 0, suspect g).
      try {
        let entry = this.entries.get(id);
        if (entry === undefined) {
          entry = this.renderer.compile(graph, id);
          this.entries.set(id, entry);
          if (entry) this.scheduler.setAnimated(id, entry.animated);
        }
        this.paint(el, entry, entry ? "" : thumbSkipReason(graph, id));
      } catch (e) {
        const failed: ThumbEntry = {
          host: new ShaderHost(),
          ok: false,
          animated: false,
          message: (e as Error).message || "Thumbnail failed",
        };
        this.entries.set(id, failed);
        try {
          this.paint(el, failed, "");
        } catch {
          /* the slot stays as it is; the queue must go on */
        }
      }
      this.scheduler.done(id, now);
      n++;
    }
    return n;
  }

  private paint(slot: HTMLElement, entry: ThumbEntry | null, skipReason = ""): void {
    let c = slot.querySelector<HTMLCanvasElement>("canvas.kk-thumb");
    if (!c) {
      c = document.createElement("canvas");
      c.className = "kk-thumb";
      slot.appendChild(c);
    }
    const r = slot.getBoundingClientRect();
    const { w, h } = thumbPixelSize(r.width, r.height);
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const time = getController()?.engine.clock.time ?? performance.now() / 1000;
    if (entry?.ok && this.renderer.render(entry, c, time)) {
      slot.dataset.thumb = "ok";
      slot.removeAttribute("title");
      return;
    }
    slot.dataset.thumb = entry && !entry.noPreview ? "error" : "none";
    ctx.fillStyle = "#15171b";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#6b7280";
    ctx.font = `${Math.round(h / 5)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(entry && !entry.noPreview ? "!" : "—", w / 2, h / 2);
    slot.title = entry ? `No preview: ${entry.message}` : skipReason || "This output type has no thumbnail";
  }

  dispose(): void {
    this.stop();
    for (const id of [...this.entries.keys()]) this.drop(id);
    this.renderer.dispose();
  }
}

let manager: ThumbManager | null = null;
export const getThumbManager = (): ThumbManager | null => manager;

/** Start the app-wide thumbnail loop (idempotent). */
export function startThumbnails(): ThumbManager {
  if (!manager) manager = new ThumbManager();
  manager.start();
  return manager;
}
