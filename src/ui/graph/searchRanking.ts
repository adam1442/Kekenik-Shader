import { type BackendId, type NodeDef, type PortDef, type ShaderType, canConvert, getConversion } from "@/core";
import { fuzzyMatch } from "@/ui/util/fuzzy";
import { acceptsSource } from "./connect";

/** Pure ranking for the Add-Node search and the Node Library (fuzzy + synonyms + categories + recents + favorites + port filter). */
export interface PortFilter {
  /** Direction of the port the user dragged from. */
  dir: "in" | "out";
  /** Resolved type of that port. */
  type: ShaderType;
  /** Declared spec of the dragged INPUT (so generic inputs accept more); optional. */
  spec?: PortDef["type"];
}

export interface SearchResult {
  def: NodeDef;
  score: number;
  nameIdx: number[];
  via: "name" | "synonym" | "category" | "all";
  viaText?: string;
  /** Best compatible port of `def` when a PortFilter is active. */
  port?: PortDef;
  favorite: boolean;
  recent: boolean;
}

export interface SearchOptions {
  query: string;
  recents?: readonly string[];
  favorites?: readonly string[];
  filter?: PortFilter | null;
  limit?: number;
}

/** Nodes that cannot be created from the search (singletons / need a Blackboard or subgraph context). */
const NOT_SEARCHABLE: readonly string[] = ["masterOutput", "subgraph", "subgraphInputs", "subgraphOutputs", "property"];
export const isSearchable = (d: NodeDef): boolean => !d.structural && !NOT_SEARCHABLE.includes(d.id);

const lc = (s: string) => s.toLowerCase();

function textScore(
  q: string,
  text: string,
  base: { exact: number; prefix: number; word: number; sub: number; fuzzy: number },
): { score: number; idx: number[] } | null {
  const t = lc(text);
  if (t === q) return { score: base.exact, idx: range(0, text.length) };
  if (t.startsWith(q)) return { score: base.prefix + Math.max(0, 20 - (t.length - q.length)), idx: range(0, q.length) };
  const w = t.search(new RegExp(`[\\s_\\-/.]${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  if (w >= 0) return { score: base.word, idx: range(w + 1, q.length) };
  const s = t.indexOf(q);
  if (s >= 0) return { score: base.sub - Math.min(30, s), idx: range(s, q.length) };
  const f = q.length >= 2 ? fuzzyMatch(q, text) : null;
  return f ? { score: base.fuzzy + Math.min(60, f.score), idx: f.indices } : null;
}
const range = (a: number, n: number): number[] => Array.from({ length: n }, (_, i) => a + i);

/** Best port of `def` that a dragged port could connect to (exact type > implicit conversion > generic). */
export function compatiblePort(def: NodeDef, f: PortFilter): PortDef | undefined {
  const side = f.dir === "out" ? def.inputs : def.outputs;
  let best: PortDef | undefined;
  let bestRank = -1;
  for (const p of side) {
    let rank = -1;
    if (f.dir === "out") {
      if (!acceptsSource(p.type, f.type)) continue;
      rank =
        p.type.k === "type"
          ? p.type.type === f.type
            ? 3
            : getConversion(f.type, p.type.type).kind === "reinterpret"
              ? 2
              : 1
          : 2;
    } else {
      const spec = p.type;
      if (spec.k === "type") {
        if (f.spec ? !acceptsSource(f.spec, spec.type) : !canConvert(spec.type, f.type)) continue;
        rank = spec.type === f.type ? 3 : 1;
      } else rank = 2;
    }
    if (rank > bestRank) {
      best = p;
      bestRank = rank;
    }
  }
  return best;
}

export function searchNodes(defs: readonly NodeDef[], opt: SearchOptions): SearchResult[] {
  const q = lc(opt.query.trim().replace(/\s+/g, " "));
  const fav = new Set(opt.favorites ?? []);
  const rec = opt.recents ?? [];
  const out: SearchResult[] = [];
  for (const def of defs) {
    if (!isSearchable(def)) continue;
    let port: PortDef | undefined;
    if (opt.filter) {
      port = compatiblePort(def, opt.filter);
      if (!port) continue;
    }
    const favorite = fav.has(def.id);
    const ri = rec.indexOf(def.id);
    const boost =
      (favorite ? 60 : 0) +
      (ri >= 0 ? 40 - Math.min(30, ri * 3) : 0) +
      (port && opt.filter && port.type.k === "type" && port.type.type === opt.filter.type ? 25 : 0);
    const base = { def, nameIdx: [] as number[], favorite, recent: ri >= 0, ...(port ? { port } : {}) };
    if (!q) {
      out.push({ ...base, score: boost, via: "all" });
      continue;
    }
    let best: { score: number; via: SearchResult["via"]; idx: number[]; text?: string } | null = null;
    const n = textScore(q, def.name, { exact: 1000, prefix: 800, word: 700, sub: 600, fuzzy: 200 });
    if (n) best = { score: n.score, via: "name", idx: n.idx };
    for (const syn of def.synonyms) {
      const s = textScore(q, syn, { exact: 900, prefix: 650, word: 520, sub: 450, fuzzy: 120 });
      if (s && (!best || s.score > best.score)) best = { score: s.score, via: "synonym", idx: [], text: syn };
    }
    const c = lc(def.category);
    if (c.includes(q) && (!best || best.score < 150))
      best = { score: 150, via: "category", idx: [], text: def.category };
    if (!best) continue;
    out.push({
      ...base,
      nameIdx: best.via === "name" ? best.idx : [],
      score: best.score + boost,
      via: best.via,
      ...(best.text ? { viaText: best.text } : {}),
    });
  }
  out.sort(
    (a, b) =>
      b.score - a.score ||
      (!q ? a.def.category.localeCompare(b.def.category) : 0) ||
      a.def.name.localeCompare(b.def.name),
  );
  return opt.limit ? out.slice(0, opt.limit) : out;
}

/** "UV, Scale → Out" style signature. */
export function signature(def: NodeDef): string {
  const side = (ps: readonly PortDef[]) => ps.map((p) => p.name).join(", ") || "—";
  return `${side(def.inputs)} → ${side(def.outputs)}`;
}

const TARGET_BADGES: ReadonlyArray<{ id: Exclude<BackendId, "ir">; label: string }> = [
  { id: "glsl", label: "GLSL" },
  { id: "hlsl", label: "HLSL" },
  { id: "wgsl", label: "WGSL" },
  { id: "godot", label: "Godot" },
  { id: "unity", label: "Unity" },
];

export function targetAvailability(def: NodeDef): Array<{ id: string; label: string; ok: boolean }> {
  const list = def.targets?.backends;
  return TARGET_BADGES.map((t) => ({ ...t, ok: !list || list.includes(t.id) }));
}
