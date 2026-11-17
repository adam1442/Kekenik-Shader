import {
  type Edge,
  type Graph,
  type NodeDef,
  type NodeInstance,
  type NodeRegistry,
  type ParamSchema,
  type PortDef,
  type ProfileDef,
  type ProfileRegistry,
  DEF_MASTER,
  defaultNodeRegistry,
  defaultProfileRegistry,
  getNodePorts,
} from "@/core";
import { NODE_W_BASE, NODE_W_GENERIC, NODE_W_WIDE, type NodeLayout, computeLayout, structuralLayout } from "./layout";
import { type CollapseInfo, collapseInfo, isInternalEdge, proxyPoint } from "./groupCollapse";
import { type Bezier, bezierBounds, distanceToBezier, wireBezier } from "./wireGeometry";
import { type Pt, type Rect, rectsIntersect } from "./viewport";

/** Everything the canvas needs to know about one node, computed once per node/graph version (pure, no DOM). */
export interface SceneNode {
  node: NodeInstance;
  def: NodeDef | undefined;
  inputs: PortDef[];
  outputs: PortDef[];
  params: ParamSchema[];
  layout: NodeLayout;
}

export type PortDir = "in" | "out";
export interface PortHit {
  node: string;
  port: string;
  dir: PortDir;
}

type Deps = {
  properties: Graph["properties"];
  subgraphDefs: Graph["subgraphDefs"];
  profileId: string;
  settings: Graph["settings"];
};

export class SceneIndex {
  readonly nodes = new Map<string, SceneNode>();
  constructor(
    readonly graph: Graph,
    readonly deps: Deps,
    readonly scope?: string,
  ) {}

  get(id: string): SceneNode | undefined {
    return this.nodes.get(id);
  }

  private collapseCache: CollapseInfo | undefined;
  /** U11: what the collapsed groups of this graph hide (memoised per scene). */
  collapse(): CollapseInfo {
    return (this.collapseCache ??= collapseInfo(this.graph, (id) => this.rect(id)));
  }
  /** True when the node sits inside a collapsed group (not rendered, no ports, not hit-testable). */
  isHidden(id: string): boolean {
    return this.collapse().nodes.has(id);
  }

  /** World rectangle of a node (optionally displaced by a live drag offset). */
  rect(id: string, at?: Pt): Rect | null {
    const s = this.nodes.get(id);
    if (!s) return null;
    const p = at ?? s.node.position;
    return { x: p.x, y: p.y, w: s.layout.width, h: s.layout.height };
  }

  /** World position of a port. Unknown ports fall back to the node's header edge so stale wires still draw. */
  portPos(nodeId: string, dir: PortDir, portId: string, at?: Pt): Pt | null {
    const s = this.nodes.get(nodeId);
    if (!s) return null;
    const proxy = proxyPoint(this.collapse(), nodeId, dir);
    if (proxy) return proxy;
    const p = at ?? s.node.position;
    const slot = (dir === "out" ? s.layout.outputs : s.layout.inputs).find((q) => q.id === portId);
    if (slot) return { x: p.x + slot.x, y: p.y + slot.y };
    return { x: p.x + (dir === "out" ? s.layout.width : 0), y: p.y + 16 };
  }

  edgeBezier(e: Edge, overrides?: ReadonlyMap<string, Pt>): Bezier | null {
    if (isInternalEdge(this.collapse(), e.from.node, e.to.node)) return null;
    const a = this.portPos(e.from.node, "out", e.from.port, overrides?.get(e.from.node));
    const b = this.portPos(e.to.node, "in", e.to.port, overrides?.get(e.to.node));
    return a && b ? wireBezier(a, b) : null;
  }

  /** Nearest port within `radius` world units (collapsed nodes expose no ports). */
  portAt(p: Pt, radius: number, overrides?: ReadonlyMap<string, Pt>, only?: PortDir): PortHit | null {
    let best: PortHit | null = null;
    let bestD = radius;
    for (const [id, s] of this.nodes) {
      if (s.layout.collapsed || this.isHidden(id)) continue;
      const at = overrides?.get(id) ?? s.node.position;
      if (
        p.x < at.x - radius - 4 ||
        p.x > at.x + s.layout.width + radius + 4 ||
        p.y < at.y - 4 ||
        p.y > at.y + s.layout.height + 4
      )
        continue;
      // U4: a wire dropped anywhere on the BODY of a reroute / portal connects to its port of the wanted direction.
      if (
        s.def?.structural &&
        p.x >= at.x &&
        p.x <= at.x + s.layout.width &&
        p.y >= at.y &&
        p.y <= at.y + s.layout.height
      ) {
        const dir: PortDir = only ?? "in";
        const slot = (dir === "out" ? s.layout.outputs : s.layout.inputs)[0];
        if (slot) {
          bestD = 0;
          best = { node: id, port: slot.id, dir };
          continue;
        }
      }
      for (const dir of ["in", "out"] as const) {
        if (only && only !== dir) continue;
        for (const slot of dir === "out" ? s.layout.outputs : s.layout.inputs) {
          const d = Math.hypot(at.x + slot.x - p.x, at.y + slot.y - p.y);
          if (d <= bestD) {
            bestD = d;
            best = { node: id, port: slot.id, dir };
          }
        }
      }
    }
    return best;
  }

  /** Edge under `p` (world), closest first; only edges whose bounds intersect `region` (if given) are tested. */
  wireAt(p: Pt, tolerance: number, overrides?: ReadonlyMap<string, Pt>): { edge: Edge; t: number } | null {
    let best: { edge: Edge; t: number } | null = null;
    let bestD = tolerance;
    for (const e of Object.values(this.graph.edges)) {
      const z = this.edgeBezier(e, overrides);
      if (!z) continue;
      const b = bezierBounds(z);
      if (p.x < b.x - tolerance || p.x > b.x + b.w + tolerance || p.y < b.y - tolerance || p.y > b.y + b.h + tolerance)
        continue;
      const r = distanceToBezier(z, p);
      if (r.dist <= bestD) {
        bestD = r.dist;
        best = { edge: e, t: r.t };
      }
    }
    return best;
  }

  /** Ids of nodes whose rectangle intersects `r` (culling / box select). */
  nodesIn(r: Rect, overrides?: ReadonlyMap<string, Pt>): string[] {
    const out: string[] = [];
    for (const [id, s] of this.nodes) {
      if (this.isHidden(id)) continue;
      const at = overrides?.get(id) ?? s.node.position;
      if (rectsIntersect(r, { x: at.x, y: at.y, w: s.layout.width, h: s.layout.height })) out.push(id);
    }
    return out;
  }
}

/** Node width depends on the DEFINITION only (never on connections) so wires don't jump when you connect something. */
function nodeWidthFor(inputs: readonly PortDef[], params: readonly ParamSchema[]): number {
  let w = NODE_W_BASE;
  for (const p of inputs) {
    const t = p.type;
    if (t.k === "generic") w = Math.max(w, NODE_W_GENERIC);
    else if (t.k === "type") {
      if (t.type === "vec2") w = Math.max(w, NODE_W_GENERIC);
      else if (t.type === "vec3" || t.type === "vec4" || t.type === "color" || t.type === "color4")
        w = Math.max(w, NODE_W_WIDE);
    }
  }
  for (const p of params) {
    if (p.control === "vector" || p.control === "color") w = Math.max(w, NODE_W_WIDE);
    else if (p.control === "string" || p.control === "enum") w = Math.max(w, NODE_W_GENERIC);
  }
  return w;
}

// `settings` matters because the Master Output's ports depend on surface options (shownWhen) and removed optional blocks.
const depsOf = (g: Graph): Deps => ({
  properties: g.properties,
  subgraphDefs: g.subgraphDefs,
  profileId: g.profileId,
  settings: g.settings,
});
const sameDeps = (a: Deps, b: Deps): boolean =>
  a.properties === b.properties &&
  a.subgraphDefs === b.subgraphDefs &&
  a.profileId === b.profileId &&
  a.settings === b.settings;

/**
 * Build (or incrementally update) the scene of a graph. Entries of nodes whose object identity did not change are
 * reused (graph operations preserve structural sharing), so a drag commit only recomputes the moved nodes.
 */
export function buildScene(
  graph: Graph,
  prev?: SceneIndex | null,
  registry: NodeRegistry = defaultNodeRegistry,
  profiles: ProfileRegistry = defaultProfileRegistry,
  scope?: string,
): SceneIndex {
  const deps = depsOf(graph);
  const reuse = prev && sameDeps(prev.deps, deps) && prev.scope === scope ? prev : null;
  const scene = new SceneIndex(graph, deps, scope);
  const profile = profiles.get(graph.profileId);
  // The Master Output also lists a removed block while it still has a wire, so its entry depends on the edge set.
  const edgesChanged = !!reuse && reuse.graph.edges !== graph.edges;
  for (const node of Object.values(graph.nodes)) {
    const old = reuse?.nodes.get(node.id);
    if (old && node.defId === DEF_MASTER && edgesChanged) {
      scene.nodes.set(node.id, makeSceneNode(graph, node, registry, profile, scope));
      continue;
    }
    if (old && old.node === node) {
      scene.nodes.set(node.id, old);
      continue;
    }
    if (
      old &&
      old.node.defId === node.defId &&
      old.node.values === node.values &&
      old.node.params === node.params &&
      old.node.collapsed === node.collapsed &&
      old.node.previewEnabled === node.previewEnabled
    ) {
      scene.nodes.set(node.id, { ...old, node });
      continue;
    }
    scene.nodes.set(node.id, makeSceneNode(graph, node, registry, profile, scope));
  }
  return scene;
}

/** Ports + geometry of ONE node (also used to place a freshly created node before it is committed). */
export function makeSceneNode(
  graph: Graph,
  node: NodeInstance,
  registry: NodeRegistry = defaultNodeRegistry,
  profile?: ProfileDef,
  scope?: string,
): SceneNode {
  const def = registry.get(node.defId);
  let inputs: PortDef[] = [],
    outputs: PortDef[] = [];
  if (def) {
    try {
      const r = getNodePorts(def, node, {
        graph,
        profile: profile ?? defaultProfileRegistry.get(graph.profileId),
        ...(scope === undefined ? {} : { scope }),
      });
      inputs = r.inputs;
      outputs = r.outputs;
    } catch {
      /* a broken dynamic-ports function must not take the canvas down */
    }
  }
  const params = def?.params ?? [];
  if (def?.structural)
    return { node, def, inputs, outputs, params: [], layout: structuralLayout(node, inputs, outputs) };
  // Port groups (Master Output: Vertex / Fragment) get one header row above their first port.
  const sectionBefore: Record<string, string> = {};
  let lastSection: string | undefined;
  for (const p of inputs)
    if (p.section !== undefined && p.section !== lastSection) sectionBefore[p.id] = lastSection = p.section;
  const layout = computeLayout({
    sectionBefore,
    inputs: inputs.map((p) => p.id),
    outputs: outputs.map((p) => p.id),
    paramCount: params.length,
    width: nodeWidthFor(inputs, params),
    collapsed: !!node.collapsed,
    preview: node.previewEnabled && !node.collapsed,
  });
  return { node, def, inputs, outputs, params, layout };
}
