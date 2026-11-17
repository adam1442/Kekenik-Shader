import * as THREE from "three";
import { type PrimitiveId, type PreviewMode } from "../previewStore";
import { type EmitterSettings, ParticleEmitter, allocQuadBuffers } from "../logic/emitter";
import { type SheetConfig, frameRect, spriteQuadSize } from "../logic/spriteSheet";
import { setSpriteContext } from "./sceneContext";
import { makePrimitive, makeSpriteGeometry, toShaderGeometry, updateSpriteFrame } from "./geometry";
import { assignSlot, meshesOf, normalizeModel } from "./modelLoader";
import { type HostClock, attachHostUniforms, setWireframe } from "./overlays";

export type ContentKind = "primitive" | "model" | "sprite" | "particles";

/** Everything that is shaded in the viewport: primitive, user model, sprite quad or particle billboards. */
export class ContentManager {
  readonly root = new THREE.Group();
  kind: ContentKind = "primitive";
  meshes: THREE.Mesh[] = [];
  /** 2D: source texels per world unit (the quad is 1 unit tall), used for pixel-perfect zoom. */
  texelsPerUnit = 256;
  readonly emitter = new ParticleEmitter();
  private modelWrap: THREE.Group | null = null;
  private spritePx: [number, number] = [1, 1];
  private particleGeo: THREE.BufferGeometry | null = null;
  private buffers = allocQuadBuffers(1);
  private sheet: SheetConfig = { cols: 1, rows: 1, fps: 12, loop: "loop" };
  private disposables: THREE.BufferGeometry[] = [];

  constructor(private readonly clock: HostClock) {}

  private clear(): void {
    this.root.clear();
    for (const g of this.disposables) g.dispose();
    this.disposables = [];
    this.meshes = [];
    this.modelWrap = null;
    this.particleGeo = null;
  }

  private add(geo: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(geo, material);
    attachHostUniforms(mesh, this.clock);
    mesh.frustumCulled = false;
    this.root.add(mesh);
    this.meshes.push(mesh);
    this.disposables.push(geo);
    return mesh;
  }

  setPrimitive(id: PrimitiveId, material: THREE.Material): void {
    this.clear();
    this.kind = "primitive";
    const src = makePrimitive(id);
    this.add(toShaderGeometry(src), material);
    src.dispose();
  }

  /** Make a parsed model shader-ready (renamed attributes, host uniforms) and normalise it to unit size. Done once per model. */
  prepareModel(root: THREE.Object3D): THREE.Group {
    for (const m of meshesOf(root)) {
      m.geometry = toShaderGeometry(m.geometry);
      m.frustumCulled = false;
      attachHostUniforms(m, this.clock);
    }
    return normalizeModel(root);
  }

  disposeModel(wrap: THREE.Object3D): void {
    wrap.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  }

  setModel(wrap: THREE.Group, material: THREE.Material, slot: number): void {
    this.clear();
    this.kind = "model";
    this.modelWrap = wrap;
    this.root.add(wrap);
    this.meshes = meshesOf(wrap);
    assignSlot(wrap, slot, material);
  }

  /** Sprite quad sized from the frame aspect (1 unit tall). `texW/texH` are the image size in pixels. */
  setSprite(texW: number, texH: number, sheet: SheetConfig, material: THREE.Material, time: number): void {
    this.clear();
    this.kind = "sprite";
    this.sheet = sheet;
    const [w, h] = spriteQuadSize(texW, texH, sheet, 1);
    this.texelsPerUnit = texH / Math.max(1, sheet.rows);
    this.spritePx = [texW / Math.max(1, sheet.cols), texH / Math.max(1, sheet.rows)];
    this.add(makeSpriteGeometry(w, h, sheet, time), material);
  }

  setSheet(sheet: SheetConfig): void {
    this.sheet = sheet;
  }

  setParticles(settings: EmitterSettings, material: THREE.Material): void {
    this.clear();
    this.kind = "particles";
    this.emitter.reset(settings);
    const max = Math.max(1, settings.maxParticles);
    this.buffers = allocQuadBuffers(max);
    const g = new THREE.BufferGeometry();
    const attr = (name: string, arr: Float32Array, n: number) =>
      g.setAttribute(name, new THREE.BufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage));
    attr("a_position", this.buffers.position, 3);
    attr("a_normal", this.buffers.normal, 3);
    attr("a_uv0", this.buffers.uv, 2);
    attr("a_color", this.buffers.color, 4);
    attr("a_uv1", this.buffers.uv1, 2);
    g.setIndex(new THREE.BufferAttribute(this.buffers.index, 1));
    g.setDrawRange(0, 0);
    this.particleGeo = g;
    this.add(g, material);
  }

  /** Swap the material of the content (model: respects the material slot). */
  setMaterial(material: THREE.Material, slot: number): void {
    if (this.kind === "model" && this.modelWrap) assignSlot(this.modelWrap, slot, material);
    else for (const m of this.meshes) m.material = material;
  }

  setWireframe(on: boolean): void {
    setWireframe(this.meshes, on);
  }

  /** Per-frame work: sprite-sheet frame, particle simulation + billboarding. `playing` pauses the simulation. */
  update(dt: number, time: number, camera: THREE.Camera, playing: boolean): void {
    if (this.kind === "sprite" && this.meshes[0]) {
      const f = updateSpriteFrame(this.meshes[0].geometry, this.sheet, time);
      const r = frameRect(this.sheet, f);
      setSpriteContext({ rect: [r.u, r.v, r.w, r.h], px: this.spritePx });
    } else setSpriteContext(null);
    if (this.kind === "particles" && this.particleGeo) {
      if (playing) this.emitter.step(dt);
      camera.updateMatrixWorld();
      const e = camera.matrixWorld.elements;
      const right: [number, number, number] = [e[0]!, e[1]!, e[2]!];
      const up: [number, number, number] = [e[4]!, e[5]!, e[6]!];
      const fwd: [number, number, number] = [-e[8]!, -e[9]!, -e[10]!];
      this.emitter.particles.sort(
        (a, b) =>
          b.pos[0] * fwd[0] +
          b.pos[1] * fwd[1] +
          b.pos[2] * fwd[2] -
          (a.pos[0] * fwd[0] + a.pos[1] * fwd[1] + a.pos[2] * fwd[2]),
      );
      this.emitter.fill(this.buffers, right, up, fwd);
      this.particleGeo.setDrawRange(0, this.buffers.count * 6);
      for (const n of ["a_position", "a_normal", "a_uv0", "a_color", "a_uv1"])
        (this.particleGeo.getAttribute(n) as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  /** World-space bounds used for framing and the floor grid. Particles frame a fixed emitter volume. */
  box(): THREE.Box3 {
    if (this.kind === "particles") {
      const s = this.emitter.settings;
      const h = Math.max(0.5, (s.speed * s.lifetime) / 2);
      return new THREE.Box3(new THREE.Vector3(-h * 0.6, 0, -h * 0.6), new THREE.Vector3(h * 0.6, h * 1.4, h * 0.6));
    }
    this.root.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(this.root);
  }

  /** Is anything animating by itself (sprite sheet / particles)? */
  get animated(): boolean {
    return this.kind === "particles" || (this.kind === "sprite" && this.sheet.cols * this.sheet.rows > 1);
  }

  static modeKind(mode: PreviewMode, hasModel: boolean): ContentKind {
    return mode === "vfx" ? "particles" : mode === "2d" ? "sprite" : hasModel ? "model" : "primitive";
  }

  dispose(): void {
    this.clear();
  }
}
