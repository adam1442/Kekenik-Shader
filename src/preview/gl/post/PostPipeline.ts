import * as THREE from "three";
import { parseColor } from "@/core/values/color";
import type { PostSettings, ToneMap } from "./settings";
import { evToScale } from "./settings";

/**
 * HDR post pipeline of the preview . Order: scene → (MSAA resolve) → bloom → exposure → colour adjust → vignette →
 * tone map → sRGB → (FXAA). The scene target is HALF-FLOAT so emission / HDR colours > 1 survive until bloom + tone mapping.
 * Bloom is URP-style: soft-knee prefilter at half resolution, a 4-tap downsample chain, then an upsample chain mixed by "scatter".
 */
const VS = "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }";
const TONE_ID: Record<ToneMap, number> = { none: 0, reinhard: 1, aces: 2, agx: 3, neutral: 4 };

const PREFILTER = `
varying vec2 vUv; uniform sampler2D tSrc; uniform vec4 uThr; // x threshold, y knee, z clamp
void main() {
  vec3 c = min(texture2D(tSrc, vUv).rgb, vec3(uThr.z));
  float br = max(c.r, max(c.g, c.b));
  float rq = clamp(br - uThr.x + uThr.y, 0.0, 2.0 * uThr.y); rq = rq * rq / (4.0 * uThr.y + 1e-5);
  gl_FragColor = vec4(c * (max(rq, br - uThr.x) / max(br, 1e-5)), 1.0);
}`;
const DOWN = `
varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uTexel;
void main() {
  vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb
         + texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  gl_FragColor = vec4(c * 0.25, 1.0);
}`;
const UP = `
varying vec2 vUv; uniform sampler2D tHigh; uniform sampler2D tLow; uniform float uScatter; uniform vec2 uTexel;
void main() {
  vec3 low = (texture2D(tLow, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tLow, vUv + uTexel * vec2(1.0, -1.0)).rgb
            + texture2D(tLow, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tLow, vUv + uTexel * vec2(1.0, 1.0)).rgb) * 0.25;
  gl_FragColor = vec4(mix(texture2D(tHigh, vUv).rgb, low, uScatter), 1.0);
}`;
const COMPOSITE = `
varying vec2 vUv; uniform sampler2D tScene; uniform sampler2D tBloom; uniform vec4 uBloom; // rgb tint*intensity, w enabled
uniform vec4 uGrade; // x exposure scale, y contrast, z saturation, w vignette
uniform vec2 uMode;  // x tone map id, y sRGB encode 0|1
#include <tonemapping_pars_fragment>
vec3 srgbEncode(vec3 c) { return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }
void main() {
  vec4 s = texture2D(tScene, vUv);
  vec3 c = s.rgb;
  if (uBloom.w > 0.5) c += texture2D(tBloom, vUv).rgb * uBloom.rgb;
  c *= uGrade.x;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uGrade.z);
  c = (c - 0.18) * uGrade.y + 0.18;
  vec2 d = vUv - 0.5; c *= 1.0 - uGrade.w * smoothstep(0.25, 0.75, dot(d, d) * 2.0);
  c = max(c, vec3(0.0));
  int t = int(uMode.x + 0.5);
  if (t == 0) c = clamp(c, 0.0, 1.0);
  else if (t == 1) c = ReinhardToneMapping(c);
  else if (t == 2) c = ACESFilmicToneMapping(c);
  else if (t == 3) c = AgXToneMapping(c);
  else c = NeutralToneMapping(c);
  c = clamp(c, 0.0, 1.0);
  if (uMode.y > 0.5) c = srgbEncode(c);
  gl_FragColor = vec4(c, s.a);
}`;
const FXAA = `
varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uTexel;
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
void main() {
  vec4 m = texture2D(tSrc, vUv);
  float lM = luma(m.rgb);
  float lN = luma(texture2D(tSrc, vUv + vec2(0.0, uTexel.y)).rgb); float lS = luma(texture2D(tSrc, vUv - vec2(0.0, uTexel.y)).rgb);
  float lE = luma(texture2D(tSrc, vUv + vec2(uTexel.x, 0.0)).rgb); float lW = luma(texture2D(tSrc, vUv - vec2(uTexel.x, 0.0)).rgb);
  float lo = min(lM, min(min(lN, lS), min(lE, lW))); float hi = max(lM, max(max(lN, lS), max(lE, lW)));
  if (hi - lo < max(0.0312, hi * 0.125)) { gl_FragColor = m; return; }
  vec2 dir = vec2(lS - lN, lE - lW);
  float reduce = max((lN + lS + lE + lW) * 0.25 * 0.0625, 0.0078125);
  dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + reduce), -8.0, 8.0) * uTexel;
  vec4 a = 0.5 * (texture2D(tSrc, vUv + dir * (1.0 / 3.0 - 0.5)) + texture2D(tSrc, vUv + dir * (2.0 / 3.0 - 0.5)));
  vec4 b = a * 0.5 + 0.25 * (texture2D(tSrc, vUv + dir * -0.5) + texture2D(tSrc, vUv + dir * 0.5));
  float lB = luma(b.rgb);
  gl_FragColor = (lB < lo || lB > hi) ? a : b;
}`;

const quadMat = (fs: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial =>
  new THREE.ShaderMaterial({
    vertexShader: VS,
    fragmentShader: fs,
    uniforms,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  });

export interface PostFrame {
  w: number;
  h: number;
  settings: PostSettings;
  /** Encode linear → sRGB at the end (lit shading / linear-colour targets). */ srgb: boolean;
  /** Debug views bypass bloom + tone mapping. */ raw: boolean;
}

export class PostPipeline {
  private readonly quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly scene = new THREE.Scene();
  private sceneRt: THREE.WebGLRenderTarget | null = null;
  private ldrRt: THREE.WebGLRenderTarget | null = null;
  private chain: THREE.WebGLRenderTarget[] = [];
  private ups: THREE.WebGLRenderTarget[] = [];
  private key = "";
  private readonly mats = {
    pre: quadMat(PREFILTER, { tSrc: { value: null }, uThr: { value: new THREE.Vector4() } }),
    down: quadMat(DOWN, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } }),
    up: quadMat(UP, {
      tHigh: { value: null },
      tLow: { value: null },
      uScatter: { value: 0.7 },
      uTexel: { value: new THREE.Vector2() },
    }),
    comp: quadMat(COMPOSITE, {
      tScene: { value: null },
      tBloom: { value: null },
      uBloom: { value: new THREE.Vector4() },
      uGrade: { value: new THREE.Vector4() },
      uMode: { value: new THREE.Vector2() },
      toneMappingExposure: { value: 1 },
    }),
    fxaa: quadMat(FXAA, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } }),
  };
  /** Draw calls of the last frame per stage (tests assert that disabled stages cost nothing). */
  lastPasses: string[] = [];

  constructor() {
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  private rt(w: number, h: number, samples = 0, depth = false): THREE.WebGLRenderTarget {
    return new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: depth,
      samples,
      colorSpace: THREE.LinearSRGBColorSpace,
    });
  }

  private ensure(f: PostFrame): { w: number; h: number } {
    const s = f.settings;
    const w = Math.max(1, Math.round(f.w * s.renderScale)),
      h = Math.max(1, Math.round(f.h * s.renderScale));
    const levels = s.bloom && !f.raw ? s.bloomIterations : 0;
    const key = `${w}x${h}|${s.msaa}|${levels}|${s.fxaa}`;
    if (key === this.key) return { w, h };
    this.disposeTargets();
    this.key = key;
    this.sceneRt = this.rt(w, h, s.msaa, true);
    if (s.fxaa)
      this.ldrRt = new THREE.WebGLRenderTarget(w, h, {
        type: THREE.UnsignedByteType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: false,
      });
    let bw = Math.max(1, w >> 1),
      bh = Math.max(1, h >> 1);
    for (let i = 0; i < levels; i++) {
      this.chain.push(this.rt(bw, bh));
      if (i < levels - 1) this.ups.push(this.rt(bw, bh));
      bw = Math.max(1, bw >> 1);
      bh = Math.max(1, bh >> 1);
    }
    return { w, h };
  }

  private pass(
    r: THREE.WebGLRenderer,
    mat: THREE.ShaderMaterial,
    target: THREE.WebGLRenderTarget | null,
    name: string,
  ): void {
    this.quad.material = mat;
    r.setRenderTarget(target);
    r.render(this.scene, this.cam);
    this.lastPasses.push(name);
  }

  /** Render `scene` through the pipeline into `out` (null = the canvas). */
  render(
    r: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    f: PostFrame,
    out: THREE.WebGLRenderTarget | null = null,
  ): void {
    this.lastPasses = [];
    const s = f.settings;
    this.ensure(f);
    const prevTone = r.toneMapping;
    r.toneMapping = THREE.NoToneMapping;
    const autoClear = r.autoClear;
    try {
      r.setRenderTarget(this.sceneRt);
      r.setClearColor(0x000000, 0);
      r.clear(true, true, true);
      r.render(scene, camera);
      this.lastPasses.push("scene");
      const bloomOn = s.bloom && !f.raw && this.chain.length > 0;
      if (bloomOn) this.bloom(r, s);
      const u = this.mats.comp.uniforms;
      const tint = parseColor(s.bloomTint) ?? { r: 1, g: 1, b: 1, a: 1 };
      u.tScene!.value = this.sceneRt!.texture;
      u.tBloom!.value = bloomOn ? (this.ups[0]?.texture ?? this.chain[0]!.texture) : null;
      (u.uBloom!.value as THREE.Vector4).set(
        tint.r * s.bloomIntensity,
        tint.g * s.bloomIntensity,
        tint.b * s.bloomIntensity,
        bloomOn ? 1 : 0,
      );
      (u.uGrade!.value as THREE.Vector4).set(
        f.raw ? 1 : evToScale(s.exposure),
        f.raw ? 1 : s.contrast,
        f.raw ? 1 : s.saturation,
        f.raw ? 0 : s.vignette,
      );
      (u.uMode!.value as THREE.Vector2).set(f.raw ? 0 : TONE_ID[s.tonemap], f.srgb ? 1 : 0);
      if (s.fxaa && this.ldrRt) {
        this.pass(r, this.mats.comp, this.ldrRt, "composite");
        const fu = this.mats.fxaa.uniforms;
        fu.tSrc!.value = this.ldrRt.texture;
        (fu.uTexel!.value as THREE.Vector2).set(1 / this.ldrRt.width, 1 / this.ldrRt.height);
        this.pass(r, this.mats.fxaa, out, "fxaa");
      } else this.pass(r, this.mats.comp, out, "composite");
    } finally {
      r.toneMapping = prevTone;
      r.autoClear = autoClear;
      r.setRenderTarget(out);
    }
  }

  private bloom(r: THREE.WebGLRenderer, s: PostSettings): void {
    const pre = this.mats.pre.uniforms;
    pre.tSrc!.value = this.sceneRt!.texture;
    (pre.uThr!.value as THREE.Vector4).set(
      s.bloomThreshold,
      Math.max(1e-3, s.bloomKnee * s.bloomThreshold),
      s.bloomClamp,
      0,
    );
    this.pass(r, this.mats.pre, this.chain[0]!, "bloom-prefilter");
    const du = this.mats.down.uniforms;
    for (let i = 1; i < this.chain.length; i++) {
      du.tSrc!.value = this.chain[i - 1]!.texture;
      (du.uTexel!.value as THREE.Vector2).set(0.5 / this.chain[i - 1]!.width, 0.5 / this.chain[i - 1]!.height);
      this.pass(r, this.mats.down, this.chain[i]!, "bloom-down");
    }
    const uu = this.mats.up.uniforms;
    uu.uScatter!.value = s.bloomScatter;
    let low = this.chain[this.chain.length - 1]!;
    for (let i = this.chain.length - 2; i >= 0; i--) {
      uu.tHigh!.value = this.chain[i]!.texture;
      uu.tLow!.value = low.texture;
      (uu.uTexel!.value as THREE.Vector2).set(0.5 / low.width, 0.5 / low.height);
      this.pass(r, this.mats.up, this.ups[i]!, "bloom-up");
      low = this.ups[i]!;
    }
  }

  /** Last scene target (tests read HDR values from it). */
  get hdrTarget(): THREE.WebGLRenderTarget | null {
    return this.sceneRt;
  }

  private disposeTargets(): void {
    this.sceneRt?.dispose();
    this.ldrRt?.dispose();
    for (const t of [...this.chain, ...this.ups]) t.dispose();
    this.sceneRt = null;
    this.ldrRt = null;
    this.chain = [];
    this.ups = [];
    this.key = "";
  }

  dispose(): void {
    this.disposeTargets();
    for (const m of Object.values(this.mats)) m.dispose();
    this.quad.geometry.dispose();
  }
}
