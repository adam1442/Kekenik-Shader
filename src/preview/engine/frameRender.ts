import type * as THREE from "three";
import { type CompileResult, type Graph, defaultProfileRegistry } from "@/core";
import { TARGET_CONVENTIONS } from "@/core/engine/targets";
import { backdropHex } from "../logic/backdrop";
import { parseColor } from "@/core/values/color";
import { resourcesUsedBy } from "../emulation";
import type { EmulationPass } from "../emulation/resources";
import type { PostPipeline } from "../gl/post/PostPipeline";
import type { PreviewPrefs } from "../previewStore";
import { effectiveTarget, getSim } from "../sceneSim";
import type { Environment } from "./environment";
import { lightRig, type Lighting } from "./lighting";
import { SHADOW_SIZE, type ShadowPass } from "./shadows";
import type { SceneProps } from "./sceneProps";
import type { ShaderBinding } from "./shaderBinding";
import { previewBlendOf } from "./surfaceState";

/** Linear RGB of the viewport backdrop (components are already linear). */
const backdropColor = (p: PreviewPrefs): [number, number, number] => {
  const c = parseColor(backdropHex(p.bg, p.bgColor)) ?? { r: 0, g: 0, b: 0, a: 1 };
  return [c.r, c.g, c.b];
};

export interface FrameDeps {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  post: PostPipeline;
  emu: EmulationPass;
  shadow: ShadowPass;
  props: SceneProps;
  /** Receivers / non-casters that must stay out of the shadow map (backdrop, overlays, floor). */
  noCast: () => THREE.Object3D[];
  /** World bounds of the casters (content + intersector). */
  casterBox: () => THREE.Box3;
  lighting: Lighting;
  env: Environment;
  camera: () => THREE.Camera;
  content: () => THREE.Object3D;
  hideForDepth: () => THREE.Object3D[];
  binding: () => ShaderBinding | null;
  result: () => CompileResult | null;
  graph: () => Graph | null;
  prefs: () => PreviewPrefs;
}

/** One frame of the preview: lighting uniforms → emulation resources (Scene Depth / Color) → HDR scene → post pipeline. */
export class FrameRenderer {
  constructor(private readonly d: FrameDeps) {}

  /** Key-light shadow map: rendered only when a lit shader or the shadow-catcher floor reads it (3D mode). */
  private shadowFrame(): {
    matrix: THREE.Matrix4;
    map: THREE.Texture | null;
    bias: number;
    softness: number;
    texel: number;
  } | null {
    const p = this.d.prefs();
    const wanted =
      p.shadows && p.mode === "3d" && (this.d.binding()?.uniform("ks_lit_D0") !== undefined || p.ground === "catcher");
    if (!wanted) return null;
    const rig = lightRig(p);
    this.d.shadow.render(this.d.renderer, this.d.scene, {
      dir: rig.dirs[0]!,
      box: this.d.casterBox(),
      hide: this.d.noCast(),
    });
    const f = {
      matrix: this.d.shadow.matrix,
      map: this.d.shadow.texture,
      bias: p.shadowBias,
      softness: p.shadowSoftness,
      texel: 1 / SHADOW_SIZE,
    };
    this.d.props.bindShadow(f.matrix, f.map, f.bias, f.softness, f.texel);
    return f;
  }

  updateLit(): void {
    const t = effectiveTarget(getSim());
    const sim = getSim();
    this.d.lighting.updateLit(this.d.binding(), this.d.prefs(), this.d.env, {
      godotBrdf: t === "godot",
      premultiplied: previewBlendOf(this.d.graph()?.settings.blend) === "premultiplied",
      shadow: this.shadowFrame(),
      fog: sim,
    });
  }

  /** Is the surface shaded (lit profile, or forced)? Decides the sRGB encode of the post pipeline. */
  get shaded(): boolean {
    if (!this.d.binding()?.uniform("ks_lit_D0")) return false;
    const lit = this.d.prefs().lit;
    return (
      lit === "lit" || (lit === "auto" && defaultProfileRegistry.get(this.d.graph()?.profileId ?? "")?.family === "lit")
    );
  }

  /** Emulation resources — rendered only when the compiled shader reads them. */
  prepareEmulation(w: number, h: number): void {
    const used = resourcesUsedBy(this.d.result()?.files.find((f) => f.path === "shader.frag")?.content ?? "");
    this.d.emu.render(this.d.renderer, this.d.scene, this.d.camera(), {
      w,
      h,
      depth: used.has("depth"),
      color: used.has("color"),
      normals: used.has("normals"),
      content: this.d.content(),
      contentOpaque: (this.d.graph()?.settings.blend ?? "opaque") === "opaque",
      hideForDepth: this.d.hideForDepth(),
      backdrop: backdropColor(this.d.prefs()),
    });
    this.d.emu.bind(this.d.binding());
  }

  /** scene → HDR target → bloom → grade → tone map → (sRGB) → (FXAA) into `out` (null = canvas). */
  renderScene(w: number, h: number, out: THREE.WebGLRenderTarget | null): void {
    const p = this.d.prefs();
    const raw = p.debugView !== "shader" && p.debugView !== "uv" && p.debugView !== "normals";
    const srgb = this.shaded || TARGET_CONVENTIONS[effectiveTarget(getSim())].linearColor;
    this.d.post.render(
      this.d.renderer,
      this.d.scene,
      this.d.camera(),
      { w, h, settings: p.post, srgb: srgb && !raw, raw },
      out,
    );
  }
}
