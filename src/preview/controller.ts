import { compilePreview } from "./logic/previewCompile";
import { useHalfEmulation } from "./logic/halfEmulation";
import { effectiveTarget, useSceneSim } from "./sceneSim";
import { useShader } from "@/app/shaderStore";
import { getMaterialValues, useMaterial } from "@/blackboard/materialStore";
import { type AssetMeta, getAssetBlob, getAssetMeta, useAssets } from "./assets/assetStore";
import { parseHdr } from "./assets/decode";
import { PreviewEngine } from "./engine/PreviewEngine";
import { parseModel } from "./engine/modelLoader";
import { textureFromBlob } from "./engine/textures";
import { getPrefs, usePreview } from "./previewStore";
import { clamp } from "@/core/values/numeric";

let active: PreviewController | null = null;

/**
 * What the controller remembers about a load request: the asset id, or `<id>#pending` while the asset's data is not in the store yet.
 * Pure (unit-tested): "asked for X while X was missing" and "asked for X after X arrived" must be different requests.
 */
const assetRequestStamp = (id: string | null, hasData: boolean): string | null =>
  id === null ? null : hasData ? id : `${id}#pending`;

interface LoadedAsset {
  meta: AssetMeta;
  blob: Blob;
}

/** The controller of the mounted Preview panel (commands, context menus and tests talk to it). */
export const getController = (): PreviewController | null => active;

/**
 * Glue between the engine and the app: debounced shader recompiles from `useShader`, preferences, asset loading
 * (models / sprites / HDR / bound textures) and runtime status for the UI.
 */
export class PreviewController {
  readonly engine: PreviewEngine;
  private offs: Array<() => void> = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Asset id each load slot was last asked for (model / sprite / hdr / `bound:<propId>`). */
  private requested = new Map<string, string | null>([
    ["model", null],
    ["sprite", null],
    ["hdr", null],
  ]);
  private tokens: Record<string, number> = {};
  private disposed = false;
  /** Debounce for graph → shader (ms). The graph store already coalesces edits; this absorbs bursts of store updates. */
  debounceMs = 80;

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new PreviewEngine(canvas);
    active = this;
    this.engine.onStats = (fps) => usePreview.getState().fps !== fps && usePreview.getState().setRuntime({ fps });
    this.engine.rig.hooks.onLightDrag = (da, de) => {
      const s = usePreview.getState();
      s.set({
        lightAzimuth: ((s.lightAzimuth + da + 540) % 360) - 180,
        lightElevation: clamp(s.lightElevation + de, -10, 89),
      });
    };
    this.engine.setPrefs(getPrefs());
    this.engine.playing = usePreview.getState().playing;
    this.offs.push(
      usePreview.subscribe((s, prev) => {
        this.engine.playing = s.playing;
        const prefsNow = getPrefs();
        const changed = (Object.keys(prefsNow) as Array<keyof typeof prefsNow>).some(
          (k) => prefsNow[k] !== (prev as unknown as Record<string, unknown>)[k],
        );
        if (changed) this.engine.setPrefs(prefsNow);
        this.syncAssets();
      }),
      useShader.subscribe((s, prev) => {
        if (s.result !== prev.result || s.graph !== prev.graph) this.schedule();
      }),
      // Scene Simulation: uniform-level changes just repaint; a different simulated target recompiles (compile-time constants).
      useHalfEmulation.subscribe((s, prev) => {
        if (s.on !== prev.on) this.schedule();
      }),
      useSceneSim.subscribe((s, prev) => {
        if (effectiveTarget(s) !== effectiveTarget(prev)) this.schedule();
        this.engine.invalidate();
      }),
      useAssets.subscribe(() => this.syncAssets()),
      // Material Inspector edits: uniform updates only, applied immediately (no debounce, no recompile).
      useMaterial.subscribe(() => this.engine.setMaterialValues(getMaterialValues())),
    );
    this.engine.start();
    this.compileNow();
    this.syncAssets();
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.compileNow(), this.debounceMs);
  }

  /** Compile + show the current shader immediately (also used by tests). */
  compileNow(): void {
    clearTimeout(this.timer);
    if (this.disposed) return;
    const { graph, emitOptions, keywordValues } = useShader.getState();
    // The viewport ALWAYS compiles its own variant (purpose "preview": active target family, emulated intrinsics). The export-view result
    // (`useShader.result`, availability against the GLSL export backend) must never decide what the viewport shows — root cause of defect 3.
    const result = compilePreview(graph, emitOptions, keywordValues);
    this.engine.setMaterialValues(getMaterialValues());
    const out = this.engine.submit(result, graph);
    const st = usePreview.getState();
    const gpu = result ? result.timings.total + out.ms : out.ms;
    // Problems panel + node badges: only the active target + profile (+ W_PREVIEW_NOT_EMULATED warnings), never other targets' errors.
    const compileDiags = (result?.diagnostics ?? []).filter(
      (d) => d.severity !== "info" && (d.code === "W_PREVIEW_NOT_EMULATED" || d.code === "E_NODE_UNSUPPORTED_TARGET"),
    );
    if (out.kind === "swapped" || out.kind === "uniforms") {
      st.setRuntime({
        gpuDiagnostics: compileDiags,
        compile: {
          state: "ok",
          ms: out.kind === "swapped" ? gpu : st.compile.ms,
          programs: this.engine.host.programs,
          uniformUpdates: this.engine.host.uniformUpdates,
          message: "",
        },
      });
    } else if (out.kind === "error") {
      st.setRuntime({
        gpuDiagnostics: [...compileDiags, ...out.diagnostics],
        compile: { ...st.compile, state: "error", ms: gpu, programs: this.engine.host.programs, message: out.message },
      });
    } else st.setRuntime({ gpuDiagnostics: [], compile: { ...st.compile, state: "idle", message: "" } });
  }

  /** Make the engine reflect the asset ids in the store (idempotent; async loads are token-guarded). */
  syncAssets(): void {
    if (this.disposed || !useAssets.getState().ready) return;
    const s = usePreview.getState();
    this.request("model", s.modelAssetId, (id) => this.loadModel(id));
    this.request("sprite", s.spriteAssetId, (id) => this.loadSprite(id));
    this.request("hdr", s.hdrAssetId, (id) => this.loadHdr(id));
    for (const [prop, id] of Object.entries(s.bindings))
      this.request(`bound:${prop}`, id, (x) => this.loadBound(prop, x));
  }

  private request(key: string, id: string | null, run: (id: string | null) => Promise<void>): void {
    // A binding can name an asset that is not in the store YET (opening a project / sample imports its embedded textures asynchronously).
    // That request must not count as "done": the stamp changes when the blob arrives, so the next store update loads it (fix.preview.late-asset-binding).
    const stamp = assetRequestStamp(id, getAssetBlob(id) !== undefined);
    if (this.requested.get(key) === stamp) return;
    this.requested.set(key, stamp);
    void run(id);
  }

  private blobOf(id: string | null): LoadedAsset | null {
    const meta = getAssetMeta(id);
    const blob = getAssetBlob(id);
    return meta && blob ? { meta, blob } : null;
  }

  /**
   * The one shape every asset load shares: a per-`key` token drops stale async results, a missing asset → `apply(null)`,
   * a decode failure → `fail(message)` (default: show it as the load error and keep what is on screen).
   */
  private async load<T>(
    key: string,
    id: string | null,
    decode: (a: LoadedAsset) => Promise<T>,
    apply: (value: T | null) => void,
    fail?: (message: string) => void,
  ): Promise<void> {
    const token = (this.tokens[key] = (this.tokens[key] ?? 0) + 1);
    const stale = () => token !== this.tokens[key] || this.disposed;
    const a = this.blobOf(id);
    if (stale()) return;
    if (!a) return apply(null);
    try {
      const value = await decode(a);
      if (!stale()) apply(value);
    } catch (e) {
      if (stale()) return;
      const message = `${a.meta.name}: ${(e as Error).message}`;
      (fail ?? ((m: string) => usePreview.getState().setRuntime({ loadError: m })))(message);
    }
  }

  private loadModel(id: string | null): Promise<void> {
    const rt = usePreview.getState().setRuntime;
    const clear = (loadError: string) => {
      this.engine.setModelObject(null);
      rt({ modelInfo: null, loadError });
    };
    return this.load(
      "model",
      id,
      async (a) => ({ root: await parseModel(a.meta.ext, await a.blob.arrayBuffer()), name: a.meta.name }),
      (m) => {
        if (!m) return clear(id ? "The model asset is missing" : "");
        const info = this.engine.setModelObject(m.root, m.name);
        rt({ modelInfo: info, loadError: "" });
        if (usePreview.getState().materialSlot >= (info?.materials.length ?? 0))
          usePreview.getState().set({ materialSlot: 0 });
      },
      clear,
    );
  }

  private loadSprite(id: string | null): Promise<void> {
    return this.load(
      "sprite",
      id,
      (a) => textureFromBlob(a.blob, usePreview.getState().nearest),
      (tex) => {
        const img = tex?.image as HTMLImageElement | undefined;
        this.engine.setSpriteTexture(tex, img?.naturalWidth, img?.naturalHeight);
        if (tex) usePreview.getState().setRuntime({ loadError: "" });
      },
    );
  }

  private loadHdr(id: string | null): Promise<void> {
    return this.load(
      "hdr",
      id,
      async (a) => parseHdr(await a.blob.arrayBuffer()),
      (hdr) => this.engine.setHdr(hdr),
    );
  }

  private loadBound(prop: string, id: string | null): Promise<void> {
    return this.load(
      `bound:${prop}`,
      id,
      (a) => textureFromBlob(a.blob, usePreview.getState().nearest),
      (tex) => this.engine.setBoundTexture(prop, tex),
    );
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    this.offs.forEach((f) => f());
    this.offs = [];
    this.engine.dispose();
    if (active === this) active = null;
    usePreview.getState().setRuntime({ gpuDiagnostics: [], fps: 0 });
  }
}
