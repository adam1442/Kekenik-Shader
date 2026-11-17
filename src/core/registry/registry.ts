import type { NodeDef } from "./nodeDef";
import type { ProfileDef } from "./profile";

const STABLE_ID_PATTERN = /^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)*$/;

/** Profile ids additionally allow `-` inside a segment (`unity.urp.sprite-unlit`). */
const PROFILE_ID_PATTERN = /^[a-z][A-Za-z0-9]*(-[A-Za-z0-9]+)*(\.[a-z][A-Za-z0-9]*(-[A-Za-z0-9]+)*)*$/;

/**
 * Id-keyed registry with the stable-id guarantee: ids are validated, can never be registered twice and
 * can never be re-pointed. Renames are expressed with `alias(oldId, newId)` so old graphs still load.
 */
class Registry<T extends { id: string }> {
  private items = new Map<string, T>();
  private aliases = new Map<string, string>();

  constructor(
    private kind: string,
    private pattern: RegExp = STABLE_ID_PATTERN,
  ) {}

  register(item: T): T {
    if (!this.pattern.test(item.id))
      throw new Error(`${this.kind} id "${item.id}" is invalid (pattern ${this.pattern})`);
    if (this.items.has(item.id) || this.aliases.has(item.id))
      throw new Error(`${this.kind} id "${item.id}" is already registered (ids are stable and unique)`);
    this.items.set(item.id, item);
    return item;
  }

  /** Make `oldId` resolve to `newId` (for renamed definitions). */
  alias(oldId: string, newId: string): void {
    if (this.items.has(oldId) || this.aliases.has(oldId))
      throw new Error(`${this.kind} id "${oldId}" is already taken`);
    if (!this.items.has(newId)) throw new Error(`Cannot alias "${oldId}" to unknown ${this.kind} "${newId}"`);
    this.aliases.set(oldId, newId);
  }

  resolveId(id: string): string {
    return this.aliases.get(id) ?? id;
  }

  get(id: string): T | undefined {
    return this.items.get(this.resolveId(id));
  }

  has(id: string): boolean {
    return this.items.has(this.resolveId(id));
  }

  list(): T[] {
    return [...this.items.values()];
  }

  ids(): string[] {
    return [...this.items.keys()];
  }
}

export class NodeRegistry extends Registry<NodeDef> {
  constructor() {
    super("node");
  }

  /** Simple ranked search over name / synonyms / category (used by the future node search UI). */
  search(query: string): NodeDef[] {
    const q = query.trim().toLowerCase();
    if (!q) return this.list().filter((d) => !d.structural);
    const scored: Array<[number, NodeDef]> = [];
    for (const d of this.list()) {
      if (d.structural) continue;
      const name = d.name.toLowerCase();
      let s = 0;
      if (name === q) s = 100;
      else if (name.startsWith(q)) s = 80;
      else if (name.includes(q)) s = 60;
      else if (d.synonyms.some((x) => x.toLowerCase() === q)) s = 90;
      else if (d.synonyms.some((x) => x.toLowerCase().startsWith(q))) s = 50;
      else if (d.synonyms.some((x) => x.toLowerCase().includes(q))) s = 40;
      else if (d.category.toLowerCase().includes(q)) s = 20;
      if (s) scored.push([s, d]);
    }
    return scored.sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name)).map(([, d]) => d);
  }
}

export class ProfileRegistry extends Registry<ProfileDef> {
  constructor() {
    super("profile", PROFILE_ID_PATTERN);
  }
}
