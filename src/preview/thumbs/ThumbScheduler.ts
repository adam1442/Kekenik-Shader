/**
 * Pure scheduling policy for node thumbnails (no DOM, no GL): which visible nodes get (re)rendered on this tick.
 *  - at most `maxPerTick` renders per tick (the pool limit),
 *  - dirty nodes first, then animated nodes whose `animatedIntervalMs` elapsed,
 *  - nodes that are not visible are dropped from the pool (and reported so their GPU resources can be freed),
 *  - the pool never holds more than `maxEntries` entries (least recently rendered are evicted first).
 */
export interface SchedulerOptions {
  maxPerTick: number;
  animatedIntervalMs: number;
  maxEntries: number;
}

const DEFAULT_SCHEDULER: SchedulerOptions = { maxPerTick: 2, animatedIntervalMs: 100, maxEntries: 48 };

interface Entry {
  id: string;
  dirty: boolean;
  animated: boolean;
  last: number;
  order: number;
}

export class ThumbScheduler {
  private entries = new Map<string, Entry>();
  private seq = 0;
  readonly opts: SchedulerOptions;
  /** Total renders handed out (tests assert the throttle against it). */
  picked = 0;

  constructor(opts: Partial<SchedulerOptions> = {}) {
    this.opts = { ...DEFAULT_SCHEDULER, ...opts };
  }

  get size(): number {
    return this.entries.size;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  /** Declare the visible node ids (in priority order). Returns ids that left the pool. */
  setVisible(ids: readonly string[]): string[] {
    const keep = new Set(ids);
    const dropped: string[] = [];
    for (const id of [...this.entries.keys()]) {
      if (!keep.has(id)) {
        this.entries.delete(id);
        dropped.push(id);
      }
    }
    for (const id of ids)
      if (!this.entries.has(id))
        this.entries.set(id, { id, dirty: true, animated: false, last: -Infinity, order: this.seq++ });
    // Enforce the pool cap: keep the first `maxEntries` ids of the priority order.
    if (this.entries.size > this.opts.maxEntries) {
      for (const id of ids.slice(this.opts.maxEntries)) {
        if (this.entries.delete(id)) dropped.push(id);
      }
    }
    return dropped;
  }

  markDirty(id?: string): void {
    if (id) {
      const e = this.entries.get(id);
      if (e) e.dirty = true;
    } else for (const e of this.entries.values()) e.dirty = true;
  }

  setAnimated(id: string, animated: boolean): void {
    const e = this.entries.get(id);
    if (e) e.animated = animated;
  }

  /** Ids to render now (≤ maxPerTick). Call `done(id)` after each render. */
  pick(now: number, animationRunning = true): string[] {
    const out: string[] = [];
    const list = [...this.entries.values()].sort((a, b) => a.order - b.order);
    for (const e of list) if (e.dirty && out.length < this.opts.maxPerTick) out.push(e.id);
    if (animationRunning) {
      const due = list
        .filter((e) => !e.dirty && e.animated && now - e.last >= this.opts.animatedIntervalMs)
        .sort((a, b) => a.last - b.last);
      for (const e of due) if (out.length < this.opts.maxPerTick) out.push(e.id);
    }
    this.picked += out.length;
    return out;
  }

  done(id: string, now: number): void {
    const e = this.entries.get(id);
    if (e) {
      e.dirty = false;
      e.last = now;
    }
  }
}
