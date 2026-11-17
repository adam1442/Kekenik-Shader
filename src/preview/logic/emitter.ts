/**
 * Small CPU particle emitter for the VFX preview. Pure and deterministic: all randomness comes from a seeded RNG
 * (`mulberry32`), so the same settings + seed + step sequence always produce identical particles (tested).
 */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface ColorStop {
  /** Life fraction 0..1. */
  t: number;
  rgba: [number, number, number, number];
}

export interface EmitterSettings {
  /** Particles per second. */
  rate: number;
  lifetime: number;
  /** ± fraction of the lifetime (0..1). */
  lifetimeVar: number;
  sizeStart: number;
  sizeEnd: number;
  speed: number;
  /** Cone half-angle in degrees around +Y. */
  spread: number;
  /** World acceleration (units/s²). */
  gravity: [number, number, number];
  maxParticles: number;
  seed: number;
  colorOverLife: ColorStop[];
}

export const DEFAULT_EMITTER: EmitterSettings = {
  rate: 40,
  lifetime: 1.6,
  lifetimeVar: 0.25,
  sizeStart: 0.35,
  sizeEnd: 0.05,
  speed: 1.4,
  spread: 28,
  gravity: [0, -0.4, 0],
  maxParticles: 400,
  seed: 1337,
  colorOverLife: [
    { t: 0, rgba: [1, 0.85, 0.35, 0] },
    { t: 0.12, rgba: [1, 0.55, 0.15, 1] },
    { t: 1, rgba: [0.35, 0.05, 0.5, 0] },
  ],
};

export interface Particle {
  pos: [number, number, number];
  vel: [number, number, number];
  age: number;
  life: number;
  rot: number;
}

/** Sample the color-over-life gradient (linear, stops sorted by t). */
function sampleColor(stops: readonly ColorStop[], t: number): [number, number, number, number] {
  if (stops.length === 0) return [1, 1, 1, 1];
  const s = [...stops].sort((a, b) => a.t - b.t);
  if (t <= s[0]!.t) return [...s[0]!.rgba];
  const last = s[s.length - 1]!;
  if (t >= last.t) return [...last.rgba];
  for (let i = 1; i < s.length; i++) {
    const b = s[i]!;
    if (t <= b.t) {
      const a = s[i - 1]!;
      const k = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
      return [0, 1, 2, 3].map((c) => a.rgba[c]! + (b.rgba[c]! - a.rgba[c]!) * k) as [number, number, number, number];
    }
  }
  return [...last.rgba];
}

export interface QuadBuffers {
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
  color: Float32Array;
  /** (age01, size) per vertex. */
  uv1: Float32Array;
  index: Uint32Array;
  /** Number of live particles written. */
  count: number;
}

export function allocQuadBuffers(max: number): QuadBuffers {
  return {
    position: new Float32Array(max * 12),
    normal: new Float32Array(max * 12),
    uv: new Float32Array(max * 8),
    color: new Float32Array(max * 16),
    uv1: new Float32Array(max * 8),
    index: Uint32Array.from({ length: max * 6 }, (_, i) => {
      const q = Math.floor(i / 6);
      return q * 4 + [0, 1, 2, 0, 2, 3][i % 6]!;
    }),
    count: 0,
  };
}

const CORNERS: Array<[number, number]> = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

export class ParticleEmitter {
  readonly particles: Particle[] = [];
  private rng: () => number;
  private acc = 0;
  /** Simulated seconds since the last reset. */
  time = 0;

  constructor(public settings: EmitterSettings = DEFAULT_EMITTER) {
    this.rng = mulberry32(settings.seed);
  }

  reset(settings?: EmitterSettings): void {
    if (settings) this.settings = settings;
    this.rng = mulberry32(this.settings.seed);
    this.particles.length = 0;
    this.acc = 0;
    this.time = 0;
  }

  private spawn(): Particle {
    const s = this.settings;
    const r = this.rng;
    const cone = (s.spread * Math.PI) / 180;
    const theta = r() * Math.PI * 2;
    const phi = Math.acos(1 - r() * (1 - Math.cos(cone))); // uniform on the cap
    const sp = s.speed * (0.75 + 0.5 * r());
    const dir: [number, number, number] = [
      Math.sin(phi) * Math.cos(theta),
      Math.cos(phi),
      Math.sin(phi) * Math.sin(theta),
    ];
    const life = Math.max(0.05, s.lifetime * (1 + (r() * 2 - 1) * s.lifetimeVar));
    return { pos: [0, 0, 0], vel: [dir[0] * sp, dir[1] * sp, dir[2] * sp], age: 0, life, rot: r() * Math.PI * 2 };
  }

  /** Advance the simulation by `dt` seconds (large steps are split so results do not depend on frame rate much). */
  step(dt: number): void {
    const maxStep = 1 / 30;
    let left = Math.max(0, Math.min(dt, 0.5));
    while (left > 1e-9) {
      const h = Math.min(maxStep, left);
      left -= h;
      this.time += h;
      const g = this.settings.gravity;
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i]!;
        p.age += h;
        if (p.age >= p.life) {
          this.particles.splice(i, 1);
          continue;
        }
        p.vel[0] += g[0] * h;
        p.vel[1] += g[1] * h;
        p.vel[2] += g[2] * h;
        p.pos[0] += p.vel[0] * h;
        p.pos[1] += p.vel[1] * h;
        p.pos[2] += p.vel[2] * h;
      }
      this.acc += this.settings.rate * h;
      while (this.acc >= 1) {
        this.acc -= 1;
        if (this.particles.length < this.settings.maxParticles) this.spawn_into();
      }
    }
  }

  private spawn_into(): void {
    this.particles.push(this.spawn());
  }

  /** Fill camera-facing quads (right / up are the camera's world axes, forward points from the camera into the scene). */
  fill(
    out: QuadBuffers,
    right: [number, number, number],
    up: [number, number, number],
    forward: [number, number, number],
  ): void {
    const s = this.settings;
    const n = Math.min(this.particles.length, s.maxParticles);
    for (let i = 0; i < n; i++) {
      const p = this.particles[i]!;
      const k = p.age / p.life;
      const size = (s.sizeStart + (s.sizeEnd - s.sizeStart) * k) * 0.5;
      const c = sampleColor(s.colorOverLife, k);
      const cr = Math.cos(p.rot);
      const sr = Math.sin(p.rot);
      for (let v = 0; v < 4; v++) {
        const [cx, cy] = CORNERS[v]!;
        const rx = (cx * cr - cy * sr) * size;
        const ry = (cx * sr + cy * cr) * size;
        const o = i * 12 + v * 3;
        for (let a = 0; a < 3; a++) {
          out.position[o + a] = p.pos[a]! + right[a]! * rx + up[a]! * ry;
          out.normal[o + a] = -forward[a]!;
        }
        out.uv[i * 8 + v * 2] = (cx + 1) / 2;
        out.uv[i * 8 + v * 2 + 1] = (cy + 1) / 2;
        out.uv1[i * 8 + v * 2] = k;
        out.uv1[i * 8 + v * 2 + 1] = size * 2;
        for (let a = 0; a < 4; a++) out.color[i * 16 + v * 4 + a] = c[a]!;
      }
    }
    out.count = n;
  }
}
