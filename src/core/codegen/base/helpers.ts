/** A reusable function emitted on demand. `code` may contain several overloads. */
export interface HelperDef {
  id: string;
  /** Helper ids this helper calls (emitted first). */
  deps?: string[];
  code: string;
}

/**
 * On-demand helper-function registry: each helper is emitted at most once per shader, no matter how many
 * expressions request it, and in a stable order (dependencies first, otherwise alphabetical by id) so the output does not
 * depend on graph traversal order.
 */
export class HelperRegistry {
  private defs = new Map<string, HelperDef>();
  private wanted = new Set<string>();
  /** How many times each helper was requested (useful for tests / statistics). */
  readonly requests = new Map<string, number>();

  constructor(catalog: readonly HelperDef[]) {
    for (const d of catalog) this.defs.set(d.id, d);
  }

  /** Request a helper; returns its id. Throws for unknown ids (a backend bug, never user input). */
  need(id: string): string {
    if (!this.defs.has(id)) throw new Error(`Unknown helper "${id}"`);
    this.wanted.add(id);
    this.requests.set(id, (this.requests.get(id) ?? 0) + 1);
    return id;
  }

  get size(): number {
    return this.closure().length;
  }

  private closure(): string[] {
    const out: string[] = [];
    const state = new Map<string, 1 | 2>();
    const visit = (id: string): void => {
      if (state.get(id) === 2) return;
      if (state.get(id) === 1) throw new Error(`Helper dependency cycle at "${id}"`);
      state.set(id, 1);
      for (const d of [...(this.defs.get(id)!.deps ?? [])].sort()) visit(d);
      state.set(id, 2);
      out.push(id);
    };
    for (const id of [...this.wanted].sort()) visit(id);
    return out;
  }

  /** Helper source blocks in emission order. */
  emit(): string[] {
    return this.closure().map((id) => this.defs.get(id)!.code.trimEnd());
  }
}
