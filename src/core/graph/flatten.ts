import { type Diagnostic, makeDiagnostic } from "../diagnostics";
import { indexEdges, portKey } from "./query";
import { type GraphBody, type NodeInstance, type PortRef, isStructuralDefId } from "./types";

/** A wire between two REAL nodes after reroutes and portals were resolved. */
export interface FlatEdge {
  from: PortRef;
  to: PortRef;
  /** Structural nodes (reroutes / portal in+out) the value travelled through, in order. */
  via: string[];
  /** Id of the ORIGINAL edge that feeds `to` (use it for quick-fixes such as disconnect). */
  edgeId: string;
}

export interface FlatBody {
  /** Only non-structural nodes. */
  nodes: Record<string, NodeInstance>;
  edges: FlatEdge[];
  /** `node:port` of an input → its flat edge. */
  byTarget: Map<string, FlatEdge>;
}

export const PORTAL_CHANNEL_PARAM = "channel";
const channelOf = (n: NodeInstance): string => String(n.params[PORTAL_CHANNEL_PARAM] ?? "");

/**
 * Flatten pass: resolve `reroute`, `portalIn`, `portalOut` into direct edges. (Comments & groups live in
 * separate graph collections and are simply ignored.) Subgraph instances stay as nodes (they become IR calls).
 */
export function flattenBody(body: GraphBody, scope?: string): { flat: FlatBody; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const idx = indexEdges(body);
  const nodes: Record<string, NodeInstance> = {};
  const portalIns = new Map<string, NodeInstance[]>();
  const sc = scope === undefined ? {} : { scope };

  for (const n of Object.values(body.nodes)) {
    if (!isStructuralDefId(n.defId)) nodes[n.id] = n;
    else if (n.defId === "portalIn") {
      const list = portalIns.get(channelOf(n)) ?? [];
      list.push(n);
      portalIns.set(channelOf(n), list);
    }
  }
  for (const [ch, list] of portalIns) {
    list.slice(1).forEach((n) =>
      diagnostics.push(
        makeDiagnostic("E_PORTAL_DUPLICATE", `Portal channel "${ch}" already has an input portal`, {
          nodeId: n.id,
          ...sc,
        }),
      ),
    );
    if (!idx.byTarget.has(portKey(list[0]!.id, "in")))
      diagnostics.push(
        makeDiagnostic("W_PORTAL_NO_INPUT", `Portal "${ch}" has no input connected`, { nodeId: list[0]!.id, ...sc }),
      );
  }
  for (const n of Object.values(body.nodes)) {
    if (n.defId === "portalOut" && !portalIns.has(channelOf(n)))
      diagnostics.push(
        makeDiagnostic("E_PORTAL_UNRESOLVED", `No input portal for channel "${channelOf(n)}"`, { nodeId: n.id, ...sc }),
      );
  }

  /** Trace the source of a wire back through structural nodes. null = unconnected / unresolved. */
  const trace = (start: PortRef): { from: PortRef; via: string[] } | null => {
    let cur = start;
    const via: string[] = [];
    const seen = new Set<string>();
    for (;;) {
      const n = body.nodes[cur.node];
      if (!n || !isStructuralDefId(n.defId)) return { from: cur, via };
      if (seen.has(n.id)) {
        diagnostics.push(
          makeDiagnostic("E_CYCLE", "Reroute/portal chain loops back onto itself", { nodeId: n.id, ...sc }),
        );
        return null;
      }
      seen.add(n.id);
      via.push(n.id);
      let inNode: NodeInstance | undefined = n;
      if (n.defId === "portalOut") {
        inNode = portalIns.get(channelOf(n))?.[0];
        if (!inNode) return null;
        via.push(inNode.id);
        seen.add(inNode.id);
      }
      const next = idx.byTarget.get(portKey(inNode.id, "in"));
      if (!next) return null;
      cur = next.from;
    }
  };

  const edges: FlatEdge[] = [];
  const byTarget = new Map<string, FlatEdge>();
  for (const e of Object.values(body.edges)) {
    const target = body.nodes[e.to.node];
    if (!target || isStructuralDefId(target.defId)) continue;
    const t = trace(e.from);
    if (!t) continue;
    const fe: FlatEdge = { from: t.from, to: e.to, via: t.via, edgeId: e.id };
    edges.push(fe);
    byTarget.set(portKey(e.to.node, e.to.port), fe);
  }
  return { flat: { nodes, edges, byTarget }, diagnostics };
}
