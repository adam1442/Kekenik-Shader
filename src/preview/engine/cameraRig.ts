import * as THREE from "three";
import type { CameraPresetId } from "../previewStore";
import { clamp } from "@/core/values/numeric";

const PRESETS: Record<CameraPresetId, [number, number]> = {
  front: [0, 0],
  back: [Math.PI, 0],
  left: [-Math.PI / 2, 0],
  right: [Math.PI / 2, 0],
  top: [0, Math.PI / 2 - 0.001],
  bottom: [0, -Math.PI / 2 + 0.001],
  iso: [Math.PI / 4, 0.55],
};

export interface RigHooks {
  /** Alt + left-drag changes the key-light direction (deltas in degrees). */
  onLightDrag?: (dAzimuth: number, dElevation: number) => void;
  onFrame?: () => void;
  onChange?: () => void;
}

/**
 * Camera control. 3D: turntable orbit (left drag), pan (middle / right / shift+left), dolly (wheel), F = frame, double-click = frame.
 * 2D: orthographic, pan (any drag), zoom to cursor (wheel); `pixelsPerUnit` gives pixel-perfect zoom levels.
 */
export class CameraRig {
  readonly persp = new THREE.PerspectiveCamera(40, 1, 0.01, 200);
  readonly ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -50, 50);
  mode: "3d" | "2d" = "3d";
  readonly target = new THREE.Vector3();
  yaw = 0.6;
  pitch = 0.25;
  distance = 2.6;
  /** 2D only: screen pixels per world unit and the pan (world units). */
  pixelsPerUnit = 300;
  pan2d = new THREE.Vector2();
  private size = { w: 1, h: 1 };
  private frameDistance = 2.6;
  private frameRadius = 0.5;
  hooks: RigHooks = {};
  private detach: (() => void) | null = null;

  /** Scene Simulation camera overrides (3D mode): orthographic projection and / or explicit clip planes. */
  sim: { ortho: boolean; halfHeight: number; near: number | null; far: number | null } = {
    ortho: false,
    halfHeight: 1.5,
    near: null,
    far: null,
  };

  get camera(): THREE.Camera {
    return this.mode === "2d" || this.sim.ortho ? this.ortho : this.persp;
  }

  setSize(w: number, h: number): void {
    this.size = { w: Math.max(1, w), h: Math.max(1, h) };
    this.update();
  }

  /** Apply the rig state to the active camera. */
  update(): void {
    if (this.mode === "3d") {
      const c = Math.cos(this.pitch);
      this.persp.aspect = this.size.w / this.size.h;
      this.persp.position.set(
        this.target.x + this.distance * Math.sin(this.yaw) * c,
        this.target.y + this.distance * Math.sin(this.pitch),
        this.target.z + this.distance * Math.cos(this.yaw) * c,
      );
      this.persp.near = Math.max(0.005, this.distance * 0.01);
      this.persp.far = Math.max(50, this.distance * 60);
      if (this.sim.near !== null) this.persp.near = this.sim.near;
      if (this.sim.far !== null) this.persp.far = Math.max(this.sim.far, this.persp.near + 1e-4);
      this.persp.lookAt(this.target);
      this.persp.updateProjectionMatrix();
      if (this.sim.ortho) {
        const hh = Math.max(1e-3, this.sim.halfHeight);
        const hw = hh * this.persp.aspect;
        Object.assign(this.ortho, {
          left: -hw,
          right: hw,
          top: hh,
          bottom: -hh,
          near: this.persp.near,
          far: this.persp.far,
        });
        this.ortho.position.copy(this.persp.position);
        this.ortho.quaternion.copy(this.persp.quaternion);
        this.ortho.updateProjectionMatrix();
      }
    } else {
      const halfW = this.size.w / 2 / this.pixelsPerUnit;
      const halfH = this.size.h / 2 / this.pixelsPerUnit;
      Object.assign(this.ortho, { left: -halfW, right: halfW, top: halfH, bottom: -halfH });
      this.ortho.position.set(this.pan2d.x, this.pan2d.y, 10);
      this.ortho.lookAt(this.pan2d.x, this.pan2d.y, 0);
      this.ortho.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld(true);
  }

  /** Fit a bounding sphere (3D) or rectangle (2D). */
  frame(box: THREE.Box3): void {
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    if (this.mode === "3d") {
      this.target.copy(sphere.center);
      this.frameRadius = Math.max(sphere.radius, 0.01);
      this.frameDistance = (this.frameRadius / Math.sin((this.persp.fov * Math.PI) / 360)) * 1.15;
      this.distance = this.frameDistance;
    } else {
      const sz = box.getSize(new THREE.Vector3());
      this.pan2d.set(sphere.center.x, sphere.center.y);
      this.pixelsPerUnit = Math.min(this.size.w / Math.max(sz.x, 1e-3), this.size.h / Math.max(sz.y, 1e-3)) * 0.82;
    }
    this.update();
    this.hooks.onFrame?.();
  }

  reset(box: THREE.Box3): void {
    this.yaw = 0.6;
    this.pitch = 0.25;
    this.frame(box);
  }

  preset(id: CameraPresetId): void {
    const [y, p] = PRESETS[id];
    this.yaw = y;
    this.pitch = p;
    this.distance = this.frameDistance;
    this.update();
    this.hooks.onChange?.();
  }

  /** Pixel-perfect zoom for 2D: one source texel = `scale` screen pixels (`texelsPerUnit` = source pixels per world unit). */
  setPixelScale(scale: number, texelsPerUnit: number): void {
    this.pixelsPerUnit = scale * texelsPerUnit;
    this.update();
    this.hooks.onChange?.();
  }

  /** Listen to pointer / wheel / keyboard events of the canvas. Returns a disposer (also stored internally). */
  attach(el: HTMLElement, getBox: () => THREE.Box3): () => void {
    this.detach?.();
    let drag: { x: number; y: number; mode: "orbit" | "pan" | "light" } | null = null;
    const onDown = (e: PointerEvent) => {
      el.focus({ preventScroll: true });
      const pan = e.button === 1 || e.button === 2 || (e.button === 0 && (e.shiftKey || this.mode === "2d"));
      drag = {
        x: e.clientX,
        y: e.clientY,
        mode: e.altKey && e.button === 0 && this.mode === "3d" ? "light" : pan ? "pan" : "orbit",
      };
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic events have no active pointer */
      }
      e.preventDefault();
    };
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      if (drag.mode === "light") this.hooks.onLightDrag?.(dx * 0.6, -dy * 0.6);
      else if (drag.mode === "orbit") {
        this.yaw -= dx * 0.008;
        this.pitch = clamp(this.pitch + dy * 0.008, -1.5, 1.5);
      } else if (this.mode === "2d") {
        this.pan2d.x -= dx / this.pixelsPerUnit;
        this.pan2d.y += dy / this.pixelsPerUnit;
      } else {
        const k = (2 * this.distance * Math.tan((this.persp.fov * Math.PI) / 360)) / this.size.h;
        const right = new THREE.Vector3().setFromMatrixColumn(this.persp.matrixWorld, 0);
        const up = new THREE.Vector3().setFromMatrixColumn(this.persp.matrixWorld, 1);
        this.target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
      }
      this.update();
      this.hooks.onChange?.();
    };
    const onUp = (e: PointerEvent) => {
      drag = null;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* not captured */
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const f = Math.exp(-e.deltaY * 0.0015);
      if (this.mode === "3d") this.distance = clamp(this.distance / f, this.frameRadius * 0.2, this.frameRadius * 60);
      else {
        const r = el.getBoundingClientRect();
        const sx = e.clientX - r.left - r.width / 2;
        const sy = e.clientY - r.top - r.height / 2;
        const before = [this.pan2d.x + sx / this.pixelsPerUnit, this.pan2d.y - sy / this.pixelsPerUnit];
        this.pixelsPerUnit = clamp(this.pixelsPerUnit * f, 8, 20000);
        this.pan2d.set(before[0]! - sx / this.pixelsPerUnit, before[1]! + sy / this.pixelsPerUnit);
      }
      this.update();
      this.hooks.onChange?.();
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "f" || e.key === "F") && !e.ctrlKey && !e.metaKey && !e.altKey) {
        this.frame(getBox());
        e.preventDefault();
      }
    };
    const onDbl = () => this.frame(getBox());
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("keydown", onKey);
    el.addEventListener("dblclick", onDbl);
    this.detach = () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("keydown", onKey);
      el.removeEventListener("dblclick", onDbl);
      this.detach = null;
    };
    return this.detach;
  }
}
