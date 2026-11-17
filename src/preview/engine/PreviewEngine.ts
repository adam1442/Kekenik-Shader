import * as THREE from "three";
import { type CompileResult, type Graph, type MaterialValues, type Property, effectiveProperties } from "@/core";
import type { HdrData } from "../assets/decode";
import { type PreviewPrefs, type ModelInfo, DEFAULT_PREFS } from "../previewStore";
import { usesTime } from "../logic/glslPatch";
import { CameraRig } from "./cameraRig";
import { ContentManager } from "./content";
import { Environment } from "./environment";
import { Lighting } from "./lighting";
import { summarize } from "./modelLoader";
import { syncSceneContext } from "./sceneContext";
import { type HostClock, DebugMaterials, Overlays, attachHostUniforms, makeBackdrop, syncBackdrop } from "./overlays";
import { ShaderHost, type SubmitOutcome } from "./shaderHost";
import { SoftDepth } from "./softDepth";
import { TextureSet, defaultTexture } from "./textures";
import { previewDpr } from "./previewQuality";
import { PostPipeline } from "../gl/post/PostPipeline";
import { EmulationPass } from "../emulation/resources";
import { FrameRenderer } from "./frameRender";
import { SceneProps } from "./sceneProps";
import { ShadowPass } from "./shadows";

/** The Three.js side of the Preview (renderer, scene, rig, content, lighting, shadows, props, post); knows nothing about React / zustand. */
export class PreviewEngine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly rig = new CameraRig();
  readonly host = new ShaderHost();
  readonly env = new Environment();
  readonly clock: HostClock = { time: 0, delta: 1 / 60 };
  readonly content: ContentManager;
  prefs: PreviewPrefs = DEFAULT_PREFS;
  playing = true;
  /** Frames rendered since creation (tests use it to prove the loop runs / idles). */
  frames = 0;
  onStats?: (fps: number) => void;
  modelInfo: ModelInfo | null = null;
  private readonly overlays = new Overlays();
  private readonly backdrop = makeBackdrop();
  private readonly lighting = new Lighting();
  private readonly soft = new SoftDepth();
  private readonly placeholder = new THREE.MeshBasicMaterial({ color: 0x2b2f38 });
  private readonly debug = new DebugMaterials();
  readonly post = new PostPipeline();
  private readonly emu = new EmulationPass();
  private readonly shadow = new ShadowPass();
  private readonly props = new SceneProps();
  private readonly frame: FrameRenderer;
  private modelRoot: THREE.Object3D | null = null;
  private modelWrap: THREE.Group | null = null;
  private readonly textures = new TextureSet();
  private result: CompileResult | null = null;
  private graph: Graph | null = null;
  private materialValues: MaterialValues = {};
  private timeDependent = false;
  private raf = 0;
  private last = 0;
  private dirty = true;
  private statFrames = 0;
  private statStart = 0;
  private builtKey = "";
  private size = { w: 1, h: 1 };
  private sized = false;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor(0x000000, 0);
    this.content = new ContentManager(this.clock);
    this.frame = new FrameRenderer({
      renderer: this.renderer,
      scene: this.scene,
      post: this.post,
      emu: this.emu,
      shadow: this.shadow,
      props: this.props,
      noCast: () => [this.overlays.group, this.backdrop.mesh, this.soft.floor],
      casterBox: () => this.props.casterBox(this.content.box()),
      lighting: this.lighting,
      env: this.env,
      camera: () => this.rig.camera,
      content: () => this.content.root,
      hideForDepth: () => [this.overlays.group, this.backdrop.mesh],
      binding: () => this.host.binding,
      result: () => this.result,
      graph: () => this.graph,
      prefs: () => this.prefs,
    });
    attachHostUniforms(this.backdrop.mesh, this.clock);
    this.lighting.addTo(this.scene);
    this.scene.add(this.backdrop.mesh, this.overlays.group, this.content.root, this.soft.floor, this.props.intersector);
    this.rig.hooks.onChange = () => this.invalidate();
    this.rig.hooks.onFrame = () => this.invalidate();
    this.rig.attach(canvas, () => this.content.box());
    this.setPrefs(DEFAULT_PREFS);
  }

  setPrefs(p: PreviewPrefs): void {
    const prev = this.prefs;
    this.prefs = p;
    const key = [
      p.mode,
      p.primitive,
      this.modelWrap ? "m" : "",
      p.materialSlot,
      p.debugView,
      JSON.stringify(p.sheet),
      p.mode === "vfx" ? JSON.stringify(p.emitter) : "",
    ].join("|");
    const rebuild = key !== this.builtKey;
    if (p.nearest !== prev.nearest) this.applyFilters();
    if (p.hdrAssetId !== prev.hdrAssetId) this.dirty = true;
    if (p.lit !== prev.lit || p.mode !== prev.mode) this.resubmit();
    if (rebuild) this.rebuild(p.mode !== prev.mode || !this.builtKey);
    else if (p.wireframe !== prev.wireframe) this.content.setWireframe(p.wireframe);
    if (p.fov !== prev.fov) {
      this.rig.persp.fov = p.fov;
      this.rig.persp.updateProjectionMatrix();
    }
    this.syncScene();
    this.invalidate();
  }

  /** Compile result of the graph → shader on screen (last good one stays on failure). */
  submit(result: CompileResult | null, graph: Graph | null): SubmitOutcome {
    this.result = result;
    this.graph = graph;
    return this.doSubmit();
  }

  private resubmit(): void {
    if (this.result) this.doSubmit();
  }
  private doSubmit(): SubmitOutcome {
    // Every preview shader carries the surface contract (`KsSurface ks_surf`); unlit profiles pass it through unchanged, lit ones are shaded.
    const lit = (this.result?.files.find((f) => f.path === "shader.frag")?.content ?? "").includes("KsSurface ks_surf");
    const out = this.host.submit(this.result, this.graph, {
      lit,
      depthWrite: this.prefs.mode === "3d",
      soft: this.wantsSoft,
      texture: (p) => this.textureFor(p),
      values: this.materialValues,
    });
    if (out.kind === "swapped") {
      const files = this.result?.files ?? [];
      this.timeDependent = usesTime(...files.map((f) => f.content));
      this.applyMaterial();
    }
    this.syncSoft();
    this.invalidate();
    return out;
  }

  /** Re-push property values without recompiling (used when only a texture binding changed). */
  refreshUniforms(): void {
    if (this.graph)
      this.host.binding?.setProperties(
        effectiveProperties(this.graph.properties, this.materialValues),
        (p) => this.textureFor(p),
        this.materialValues,
      );
    this.invalidate();
  }

  /** Material instance values (Material Inspector). Only pushes uniforms — never recompiles. */
  setMaterialValues(values: MaterialValues): void {
    if (values === this.materialValues) return;
    this.materialValues = values;
    this.refreshUniforms();
  }

  private textureFor(p: Property): THREE.Texture {
    return this.textures.forProperty(p);
  }

  setBoundTexture(propId: string, tex: THREE.Texture | null): void {
    this.textures.setBound(propId, tex);
    this.applyFilters();
    this.refreshUniforms();
  }

  setSpriteTexture(tex: THREE.Texture | null, w = 0, h = 0): void {
    this.textures.setSprite(tex, w, h);
    this.applyFilters();
    this.rebuild(true);
    this.refreshUniforms();
  }

  /** Install (or remove) a parsed user model; returns its summary. */
  setModelObject(root: THREE.Object3D | null, name = ""): ModelInfo | null {
    if (this.modelWrap) this.content.disposeModel(this.modelWrap);
    this.modelRoot = root;
    this.modelWrap = root ? this.content.prepareModel(root) : null;
    this.modelInfo = root ? summarize(root, name) : null;
    this.rebuild(true);
    return this.modelInfo;
  }

  setHdr(hdr: HdrData | null): void {
    this.env.setHdr(hdr);
    this.invalidate();
  }

  private applyFilters(): void {
    this.textures.applyFilters(this.prefs.nearest);
  }

  private effectiveMaterial(): THREE.Material {
    const view = this.prefs.debugView;
    if (view === "uv" || view === "normals") return this.debug.get(view);
    return this.host.binding?.material ?? this.placeholder;
  }

  private applyMaterial(): void {
    this.content.setMaterial(this.effectiveMaterial(), this.prefs.materialSlot);
  }

  private rebuild(reframe: boolean): void {
    const p = this.prefs;
    const mat = this.effectiveMaterial();
    this.rig.mode = p.mode === "2d" ? "2d" : "3d";
    if (p.mode === "vfx") this.content.setParticles(p.emitter, mat);
    else if (p.mode === "2d")
      this.content.setSprite(
        this.textures.sprite?.w ?? 256,
        this.textures.sprite?.h ?? 256,
        p.sheet,
        mat,
        this.clock.time,
      );
    else if (this.modelWrap) this.content.setModel(this.modelWrap, mat, p.materialSlot);
    else this.content.setPrimitive(p.primitive, mat);
    this.content.setWireframe(p.wireframe);
    this.builtKey = [
      p.mode,
      p.primitive,
      this.modelWrap ? "m" : "",
      p.materialSlot,
      p.debugView,
      JSON.stringify(p.sheet),
      p.mode === "vfx" ? JSON.stringify(p.emitter) : "",
    ].join("|");
    this.rig.setSize(this.size.w, this.size.h);
    if (reframe) this.rig.reset(this.content.box());
    this.invalidate();
  }

  private syncScene(): void {
    const p = this.prefs;
    const is3d = p.mode !== "2d";
    const box = this.content.box();
    this.overlays.update({
      grid: p.grid || p.ground === "grid",
      axes: p.axes,
      is3d,
      floorY: box.isEmpty() ? -0.5 : box.min.y,
    });
    this.env.preferHdr = p.envSource === "hdri";
    this.props.sync(p, this.soft.floor);
    this.lighting.sync(p);
    this.syncSoft();
    syncBackdrop(this.backdrop, p, this.env.active, is3d);
  }

  private updateLit(): void {
    this.frame.updateLit();
  }

  /** Soft particles apply to the VFX preview when the graph asks for them (profile setting `softParticles`). */
  private get wantsSoft(): boolean {
    return this.prefs.mode === "vfx" && this.graph?.settings.softParticles === true;
  }

  private syncSoft(): void {
    const box = this.content.box();
    this.soft.sync(this.wantsSoft || SceneProps.wantsFloor(this.prefs), box.isEmpty() ? 0 : box.min.y);
  }

  /** Depth pre-pass of the floor + uniforms for soft-wrapped shaders; `w × h` = the pixel size of the target about to be drawn. */
  private prepareSoft(w: number, h: number): void {
    if (!this.soft.active) return;
    this.soft.render(this.renderer, this.rig.camera, w, h);
    this.soft.bind(this.host.binding, this.rig.camera, Number(this.graph?.settings.softDistance ?? 0.5), w, h);
  }

  invalidate(): void {
    this.dirty = true;
  }
  get continuous(): boolean {
    return (
      this.playing &&
      (this.timeDependent || this.content.animated || (this.prefs.autoRotate && this.prefs.mode === "3d"))
    );
  }

  resize(w: number, h: number, dpr = previewDpr()): void {
    this.size = { w: Math.max(1, Math.floor(w)), h: Math.max(1, Math.floor(h)) };
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.size.w, this.size.h, false);
    this.rig.setSize(this.size.w, this.size.h);
    if (!this.sized) {
      // The engine is built before the panel is laid out: frame the content once the first real size is known.
      this.sized = true;
      this.rig.reset(this.content.box());
    }
    this.invalidate();
  }

  start(): void {
    if (this.raf) return;
    this.last = performance.now();
    this.statStart = this.last;
    const tick = (now: number) => {
      this.raf = requestAnimationFrame(tick);
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      const run = this.continuous;
      if (run || this.dirty) {
        if (run) this.clock.time += dt * this.prefs.speed;
        this.clock.delta = Math.max(1e-4, dt);
        if (this.prefs.autoRotate && this.playing && this.prefs.mode === "3d") this.rig.yaw += dt * 0.5;
        this.renderNow(dt * this.prefs.speed);
      }
      if (now - this.statStart > 500) {
        this.onStats?.(run ? Math.round((this.statFrames * 1000) / (now - this.statStart)) : 0);
        this.statFrames = 0;
        this.statStart = now;
      }
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  setTime(t: number): void {
    this.clock.time = t;
    this.invalidate();
  }

  /** Scene Simulation + SceneContext inputs of this frame (`w × h` = target about to be drawn; default: the drawing buffer). */
  private syncSceneContext(w?: number, h?: number): void {
    syncSceneContext(this.rig, this.content.root, this.prefs, w && h ? { w, h } : this.soft.bufferSize(this.renderer));
  }

  /** One full frame into `out` (null = canvas): scene context → rig / content → lighting + shadows → soft depth + emulation → HDR scene → post. */
  private drawFrame(w: number, h: number, out: THREE.WebGLRenderTarget | null, dt: number, playing: boolean): void {
    this.syncSceneContext(out ? w : undefined, out ? h : undefined);
    this.rig.update();
    this.content.update(dt, this.clock.time, this.rig.camera, playing);
    this.updateLit();
    this.prepareSoft(w, h);
    this.frame.prepareEmulation(w, h);
    this.frame.renderScene(w, h, out);
  }

  /** Render one frame now (the loop calls this; tests call it directly). */
  renderNow(dt = 0): void {
    this.dirty = false;
    const buf = this.soft.bufferSize(this.renderer);
    this.drawFrame(buf.w, buf.h, null, dt, this.playing);
    this.frames++;
    this.statFrames++;
  }

  /** Render at a fixed size into an offscreen target and return RGBA bytes (row 0 = bottom). */
  renderToPixels(w: number, h: number): Uint8Array {
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat });
    const prev = this.size;
    try {
      this.rig.setSize(w, h);
      this.drawFrame(w, h, rt, 0, false);
      const out = new Uint8Array(w * h * 4);
      this.renderer.readRenderTargetPixels(rt, 0, 0, w, h, out);
      return out;
    } finally {
      this.renderer.setRenderTarget(null);
      rt.dispose();
      this.rig.setSize(prev.w, prev.h);
      this.invalidate();
    }
  }

  frameContent(): void {
    this.rig.frame(this.content.box());
  }

  resetCamera(): void {
    this.rig.reset(this.content.box());
  }

  get hasModel(): boolean {
    return this.modelRoot !== null;
  }

  dispose(): void {
    this.stop();
    this.rig.hooks = {};
    this.host.dispose();
    this.content.dispose();
    if (this.modelWrap) this.content.disposeModel(this.modelWrap);
    this.textures.dispose();
    this.env.dispose();
    this.overlays.dispose();
    this.soft.dispose();
    this.post.dispose();
    this.emu.dispose();
    this.shadow.dispose();
    this.props.dispose();
    this.debug.dispose();
    this.placeholder.dispose();
    defaultTexture(undefined);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
