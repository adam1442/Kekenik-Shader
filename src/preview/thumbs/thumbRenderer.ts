import { effectiveTarget, getSim } from "../sceneSim";
import { createEmulation } from "../emulation";
import * as THREE from "three";
import { type CompileResult, type Graph, type Property, compileToGlsl } from "@/core";
import { toShaderGeometry } from "../engine/geometry";
import { type HostClock, setHostUniforms } from "../engine/overlays";
import { ShaderHost } from "../engine/shaderHost";
import { defaultTexture } from "../engine/textures";
import { patchOpaque, patchRangeIndicator, usesTime } from "../logic/glslPatch";
import { type ThumbKind, buildThumbGraph, isLightStageOnly } from "../logic/thumbGraph";

/** One node's compiled thumbnail shader. */
export interface ThumbEntry {
  host: ShaderHost;
  ok: boolean;
  animated: boolean;
  message: string;
  /** The node is legitimately not previewable here (e.g. a vertex-stage value): shown as the "no preview" glyph, not as an error. */
  noPreview?: boolean;
}

/** Output stage of a thumbnail fragment shader (see `ThumbRenderer.compile`). Pure text → text. */
function thumbFragment(fs: string, kind: ThumbKind, opts: { raw?: boolean }): string {
  if (opts.raw) return patchOpaque(fs);
  return kind === "color" ? fs : patchRangeIndicator(fs);
}

/**
 * ONE shared offscreen WebGL renderer for every node thumbnail (a node never owns a GL context).
 * A thumbnail shows the node's first output on a unit quad: float → grey, vec → rgb with a magenta-stripe range indicator
 * for values outside 0..1, colour as is.
 */
export class ThumbRenderer {
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, -1, 1);
  private mesh: THREE.Mesh | null = null;
  private readonly clock: HostClock = { time: 0, delta: 0.016 };

  private ensure(): THREE.WebGLRenderer | null {
    // The browser may have taken the context away (too many live contexts → the oldest is lost). Never keep drawing into a dead one.
    if (this.renderer?.getContext().isContextLost()) this.release();
    if (this.renderer) return this.renderer;
    try {
      const canvas = document.createElement("canvas");
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: true });
      this.renderer.setClearColor(0x15171b, 1);
      this.mesh = new THREE.Mesh(toShaderGeometry(new THREE.PlaneGeometry(1, 1)), new THREE.MeshBasicMaterial());
      this.mesh.frustumCulled = false;
      this.scene.add(this.mesh);
    } catch {
      this.renderer = null;
    }
    return this.renderer;
  }

  /**
   * Compile the thumbnail shader of `nodeId` (null when the node cannot be previewed). `raw` = exact colour for read-back (Bake to Texture, Sample
   * Browser cards): no out-of-range stripe overlay and an OPAQUE result (alpha 1; bakes only ever store 1 or 3 channels).
   */
  compile(
    graph: Graph,
    nodeId: string,
    opts: { raw?: boolean; texture?: (p: Property) => THREE.Texture } = {},
  ): ThumbEntry | null {
    const tg = buildThumbGraph(graph, nodeId);
    if (!tg) return null;
    const g: Graph = { ...tg.graph, settings: {} };
    const sim = getSim();
    const target = effectiveTarget(sim);
    const r = compileToGlsl(g, {
      glsl: {
        emulation: createEmulation(target, { depthTexture: sim.depthTexture, opaqueTexture: sim.opaqueTexture }),
      },
      isPreview: true,
      purpose: "preview",
      sceneTarget: target,
      hoist: "off",
      precision: "full",
      ignoreInterpolators: true,
    });
    const entry: ThumbEntry = { host: new ShaderHost(), ok: false, animated: false, message: "" };
    if (!r.ok) {
      const err = r.diagnostics.find((d) => d.severity === "error");
      entry.message = err?.message ?? "Cannot compile";
      if (err?.code === "E_STAGE_VIOLATION") {
        entry.noPreview = true;
        entry.message = "Vertex-stage value — it displaces geometry / reads vertex data and has no 2D thumbnail";
      }
      if (isLightStageOnly(g, r.diagnostics)) {
        entry.noPreview = true;
        entry.message = "Godot light()-stage value — evaluated once per light inside Godot; no thumbnail";
      }
      return entry;
    }
    const files = r.files.map((f) =>
      f.path === "shader.frag" ? { ...f, content: thumbFragment(f.content, tg.kind, opts) } : f,
    );
    const patched: CompileResult = { ...r, files };
    const out = entry.host.submit(patched, g, {
      lit: false,
      depthWrite: true,
      texture: opts.texture ?? ((p) => defaultTexture(p.textureDefault)),
    });
    entry.ok = out.kind === "swapped";
    entry.message = out.message;
    entry.animated = usesTime(...r.files.map((f) => f.content));
    return entry;
  }

  /** Re-push property values (no recompile). */
  refresh(entry: ThumbEntry, graph: Graph): void {
    if (entry.ok) entry.host.binding?.setProperties(graph.properties, (p) => defaultTexture(p.textureDefault));
  }

  /** Render the entry to `target` (a 2D canvas, already sized). Returns false when nothing could be drawn. */
  render(entry: ThumbEntry, target: HTMLCanvasElement, time: number): boolean {
    const r = this.ensure();
    const b = entry.host.binding;
    if (!r || !b || !this.mesh) return false;
    const w = Math.max(1, target.width);
    const h = Math.max(1, target.height);
    r.setSize(w, h, false);
    this.mesh.material = b.material;
    this.clock.time = time;
    this.camera.updateMatrixWorld(true);
    this.mesh.onBeforeRender = (_r, _s, cam, _g, mat) => setHostUniforms(mat, this.mesh!, cam, this.clock);
    r.render(this.scene, this.camera);
    const ctx = target.getContext("2d");
    if (!ctx) return false;
    ctx.drawImage(r.domElement, 0, 0, w, h);
    return true;
  }

  /** Free the GL context NOW (three's `dispose()` alone leaves it alive until GC, and live contexts are capped per page). */
  private release(): void {
    const r = this.renderer;
    this.renderer = null;
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    if (!r) return;
    r.dispose();
    r.forceContextLoss();
  }

  dispose(): void {
    this.release();
  }
}
