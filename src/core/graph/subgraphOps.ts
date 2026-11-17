import type { ShaderType } from "../types/shaderType";
import { analyzeGraph } from "../compile/pipeline";
import { createNode } from "./create";
import { applyOperation } from "./ops/apply";
import { ops } from "./ops/make";
import type { GraphOp } from "./ops/types";
import { getBody } from "./query";
import { SUBGRAPH_PARAM } from "./subgraph";
import { listChannels } from "./portals";
import {
  DEF_MASTER,
  DEF_SUBGRAPH,
  DEF_SUBGRAPH_INPUTS,
  DEF_SUBGRAPH_OUTPUTS,
  type Edge,
  type Graph,
  type GraphBody,
  type NodeInstance,
  type PortRef,
  type PortValue,
  type SubgraphDef,
  type SubgraphPort,
  type Vec2,
  edgeId,
} from "./types";
import { zeroValue } from "./zero";

/** Pure subgraph editing: create from selection, I/O edits that fix up every instance, inline an instance, usage, duplicate. */

const SUBGRAPH_INPUTS_ID = "inputs";
const SUBGRAPH_OUTPUTS_ID = "outputs";

const isIO = (n: NodeInstance): boolean => n.defId === DEF_SUBGRAPH_INPUTS || n.defId === DEF_SUBGRAPH_OUTPUTS;
const freeId = (body: GraphBody, base: string): string => {
  if (!body.nodes[base]) return base;
  for (let i = 2; ; i++) if (!body.nodes[`${base}_${i}`]) return `${base}_${i}`;
};

/* ── usage ─────────────────────────────────────────────────────────────────────────────────────── */
export interface SubgraphUse {
  /** Body that contains the instance (undefined = main graph). */
  scope?: string;
  nodeId: string;
}

/** Every instance node of subgraph `defId` (main graph + other subgraph bodies). */
export function subgraphInstances(graph: Graph, defId: string): SubgraphUse[] {
  const out: SubgraphUse[] = [];
  const scan = (body: GraphBody, scope?: string) => {
    for (const n of Object.values(body.nodes))
      if (n.defId === DEF_SUBGRAPH && n.params[SUBGRAPH_PARAM] === defId)
        out.push({ ...(scope === undefined ? {} : { scope }), nodeId: n.id });
  };
  scan(graph);
  for (const d of Object.values(graph.subgraphDefs)) scan(d, d.id);
  return out;
}

/* ── create from selection ─────────────────────────────────────────────────────────────────────── */
export interface CreateSubgraphArgs {
  graph: Graph;
  scope?: string;
  selection: readonly string[];
  defId: string;
  instanceId: string;
  name: string;
  /** Resolved type of an OUTPUT port (the analysis result). */
  typeOf: (ref: PortRef) => ShaderType | undefined;
  /** Friendly port name for a boundary connection. */
  nameOf?: (ref: PortRef, kind: "input" | "output", index: number) => string | undefined;
}
export type CreateSubgraphResult =
  { ok: true; ops: GraphOp[]; def: SubgraphDef; instanceId: string } | { ok: false; reason: string };

/**
 * Move the selected nodes into a new subgraph definition and replace them by one instance. Boundary wires become
 * the subgraph's inputs / outputs (one port per distinct source) so the flattened semantics are unchanged.
 */
export function createSubgraphFromSelection(a: CreateSubgraphArgs): CreateSubgraphResult {
  const body = getBody(a.graph, a.scope);
  const sel = new Set(a.selection.filter((id) => body.nodes[id]));
  if (sel.size === 0) return { ok: false, reason: "Select at least one node" };
  for (const id of sel) {
    const n = body.nodes[id]!;
    if (n.defId === DEF_MASTER) return { ok: false, reason: "The Master Output cannot be moved into a subgraph" };
    if (isIO(n)) return { ok: false, reason: "Subgraph Input / Output nodes cannot be moved into another subgraph" };
  }
  for (const c of listChannels(body)) {
    const members = [...(c.inId ? [c.inId] : []), ...c.duplicateIns, ...c.outIds];
    const inside = members.filter((m) => sel.has(m)).length;
    if (inside > 0 && inside < members.length)
      return {
        ok: false,
        reason: `The selection splits the portal channel "${c.name}"; select all of its portals or none`,
      };
  }
  const edges = Object.values(body.edges);
  const inKeys = new Map<string, PortRef>();
  const outKeys = new Map<string, PortRef>();
  for (const e of edges) {
    const fi = sel.has(e.from.node),
      ti = sel.has(e.to.node);
    if (ti && !fi) inKeys.set(`${e.from.node}:${e.from.port}`, e.from);
    if (fi && !ti) outKeys.set(`${e.from.node}:${e.from.port}`, e.from);
  }
  const inputs: SubgraphPort[] = [...inKeys.values()].map((ref, i) => ({
    id: `in${i + 1}`,
    name: a.nameOf?.(ref, "input", i) ?? `Input ${i + 1}`,
    type: a.typeOf(ref) ?? "float",
  }));
  const outputs: SubgraphPort[] = [...outKeys.values()].map((ref, i) => ({
    id: `out${i + 1}`,
    name: a.nameOf?.(ref, "output", i) ?? `Output ${i + 1}`,
    type: a.typeOf(ref) ?? "float",
  }));
  const inId = (ref: PortRef) => inputs[[...inKeys.keys()].indexOf(`${ref.node}:${ref.port}`)]!.id;
  const outId = (ref: PortRef) => outputs[[...outKeys.keys()].indexOf(`${ref.node}:${ref.port}`)]!.id;

  const picked = [...sel].map((id) => body.nodes[id]!);
  const minX = Math.min(...picked.map((n) => n.position.x)),
    minY = Math.min(...picked.map((n) => n.position.y));
  const maxX = Math.max(...picked.map((n) => n.position.x));
  const shift = { x: 320 - minX, y: 80 - minY };
  const nodes: Record<string, NodeInstance> = {};
  for (const n of picked) nodes[n.id] = { ...n, position: { x: n.position.x + shift.x, y: n.position.y + shift.y } };
  const inputsNode = createNode(freeId({ nodes, edges: {} }, SUBGRAPH_INPUTS_ID), DEF_SUBGRAPH_INPUTS, {
    position: { x: 20, y: 80 },
  });
  nodes[inputsNode.id] = inputsNode;
  const outputsNode = createNode(freeId({ nodes, edges: {} }, SUBGRAPH_OUTPUTS_ID), DEF_SUBGRAPH_OUTPUTS, {
    position: { x: maxX + shift.x + 300, y: 80 },
  });
  nodes[outputsNode.id] = outputsNode;
  const defEdges: Record<string, Edge> = {};
  const add = (from: PortRef, to: PortRef) => (defEdges[edgeId(from, to)] = { id: edgeId(from, to), from, to });
  for (const e of edges) {
    const fi = sel.has(e.from.node),
      ti = sel.has(e.to.node);
    if (fi && ti) add(e.from, e.to);
    else if (ti) add({ node: inputsNode.id, port: inId(e.from) }, e.to);
    else if (fi) add(e.from, { node: outputsNode.id, port: outId(e.from) });
  }
  const def: SubgraphDef = { id: a.defId, name: a.name, inputs, outputs, nodes, edges: defEdges };

  const centroid: Vec2 = {
    x: Math.round(picked.reduce((s, n) => s + n.position.x, 0) / picked.length),
    y: Math.round(picked.reduce((s, n) => s + n.position.y, 0) / picked.length),
  };
  const list: GraphOp[] = [ops.addSubgraphDef(def)];
  for (const id of sel) list.push(ops.removeNode(id, a.scope));
  list.push(
    ops.addNode(
      createNode(a.instanceId, DEF_SUBGRAPH, { position: centroid, params: { [SUBGRAPH_PARAM]: a.defId } }),
      a.scope,
    ),
  );
  for (const e of edges) {
    const fi = sel.has(e.from.node),
      ti = sel.has(e.to.node);
    if (ti && !fi) list.push(ops.connect(e.from, { node: a.instanceId, port: inId(e.from) }, a.scope));
    else if (fi && !ti) list.push(ops.connect({ node: a.instanceId, port: outId(e.from) }, e.to, a.scope));
  }
  return { ok: true, ops: list, def, instanceId: a.instanceId };
}

/* ── I/O edits ─────────────────────────────────────────────────────────────────────────────────── */
/**
 * Replace the inputs / outputs of a definition. Ports are matched by id (rename / reorder / retype keep their id).
 * Wires of removed ports are dropped on the Input/Output nodes and on EVERY instance; wires whose conversion became
 * illegal after a type change are dropped too; everything else stays connected.
 */
export function updateSubgraphIoOps(
  graph: Graph,
  defId: string,
  inputs: SubgraphPort[],
  outputs: SubgraphPort[],
): GraphOp[] | null {
  const def = graph.subgraphDefs[defId];
  if (!def) return null;
  const goneIn = new Set(def.inputs.filter((p) => !inputs.some((q) => q.id === p.id)).map((p) => p.id));
  const goneOut = new Set(def.outputs.filter((p) => !outputs.some((q) => q.id === p.id)).map((p) => p.id));
  const list: GraphOp[] = [ops.updateSubgraphDef(defId, { inputs, outputs })];
  for (const e of Object.values(def.edges)) {
    if (def.nodes[e.from.node]?.defId === DEF_SUBGRAPH_INPUTS && goneIn.has(e.from.port))
      list.push(ops.disconnect(e.id, defId));
    else if (def.nodes[e.to.node]?.defId === DEF_SUBGRAPH_OUTPUTS && goneOut.has(e.to.port))
      list.push(ops.disconnect(e.id, defId));
  }
  for (const use of subgraphInstances(graph, defId)) {
    const body = getBody(graph, use.scope);
    for (const e of Object.values(body.edges)) {
      if (e.to.node === use.nodeId && goneIn.has(e.to.port)) list.push(ops.disconnect(e.id, use.scope));
      else if (e.from.node === use.nodeId && goneOut.has(e.from.port)) list.push(ops.disconnect(e.id, use.scope));
    }
  }
  // wires that became illegal because a type changed (compare diagnostics before / after)
  let next = graph;
  for (const op of list) next = applyOperation(next, op).graph;
  const illegal = (g: Graph): Map<string, GraphOp> => {
    const m = new Map<string, GraphOp>();
    const an = analyzeGraph(g);
    const all = [...an.diagnostics, ...Object.values(an.subgraphs).flatMap((b) => b.diagnostics)];
    for (const d of all)
      if (d.code === "E_ILLEGAL_CONVERSION" && d.edgeId && d.quickFix)
        m.set(`${d.scope ?? ""}|${d.edgeId}`, d.quickFix.operation);
    return m;
  };
  const before = illegal(graph);
  for (const [k, op] of illegal(next)) if (!before.has(k)) list.push(op);
  return list;
}

/* ── inline (unlink) ───────────────────────────────────────────────────────────────────────────── */
function constNode(id: string, type: ShaderType, v: PortValue, position: Vec2): NodeInstance | null {
  const arr = Array.isArray(v) ? v : [Number(v)];
  switch (type) {
    case "float":
    case "int":
    case "bool":
      return createNode(id, "float", { position, values: { x: Number(arr[0]) } });
    case "vec2":
      return createNode(id, "vector2", { position, values: { x: arr[0] ?? 0, y: arr[1] ?? 0 } });
    case "vec3":
    case "color":
      return createNode(id, "vector3", { position, values: { x: arr[0] ?? 0, y: arr[1] ?? 0, z: arr[2] ?? 0 } });
    case "vec4":
      return createNode(id, "vector4", {
        position,
        values: { x: arr[0] ?? 0, y: arr[1] ?? 0, z: arr[2] ?? 0, w: arr[3] ?? 0 },
      });
    case "color4":
      return createNode(id, "color", {
        position,
        params: { value: [arr[0] ?? 0, arr[1] ?? 0, arr[2] ?? 0, arr[3] ?? 1] },
      });
    default:
      return null;
  }
}

/** Replace the instance by a copy of the subgraph body (nodes get ids `<instance>__<node>`); unconnected inputs become constants of their value. */
export function inlineSubgraphOps(graph: Graph, scope: string | undefined, instanceId: string): GraphOp[] | null {
  const body = getBody(graph, scope);
  const inst = body.nodes[instanceId];
  const def = inst && inst.defId === DEF_SUBGRAPH ? graph.subgraphDefs[String(inst.params[SUBGRAPH_PARAM])] : undefined;
  if (!inst || !def) return null;
  const inNode = Object.values(def.nodes).find((n) => n.defId === DEF_SUBGRAPH_INPUTS);
  const outNode = Object.values(def.nodes).find((n) => n.defId === DEF_SUBGRAPH_OUTPUTS);
  const real = Object.values(def.nodes).filter((n) => !isIO(n));
  const taken = new Set(Object.keys(body.nodes));
  const rename = new Map<string, string>();
  for (const n of real) {
    let id = `${instanceId}__${n.id}`;
    while (taken.has(id)) id += "_";
    taken.add(id);
    rename.set(n.id, id);
  }
  const ox = Math.min(...real.map((n) => n.position.x), 0),
    oy = Math.min(...real.map((n) => n.position.y), 0);
  const list: GraphOp[] = [];
  const instIn = (port: string) =>
    Object.values(body.edges).find((e) => e.to.node === instanceId && e.to.port === port);
  const instOut = (port: string) =>
    Object.values(body.edges).filter((e) => e.from.node === instanceId && e.from.port === port);
  list.push(ops.removeNode(instanceId, scope));
  for (const n of real)
    list.push(
      ops.addNode(
        {
          ...n,
          id: rename.get(n.id)!,
          position: { x: inst.position.x + n.position.x - ox, y: inst.position.y + n.position.y - oy },
        },
        scope,
      ),
    );
  const mapRef = (r: PortRef): PortRef => ({ node: rename.get(r.node) ?? r.node, port: r.port });
  for (const e of Object.values(def.edges))
    if (rename.has(e.from.node) && rename.has(e.to.node)) list.push(ops.connect(mapRef(e.from), mapRef(e.to), scope));

  // what each subgraph input port is replaced by
  const feed = new Map<string, PortRef>();
  def.inputs.forEach((p, i) => {
    const wire = instIn(p.id);
    if (wire) return void feed.set(p.id, wire.from);
    const v = inst.values[p.id] ?? p.default ?? zeroValue(p.type);
    if (v === undefined) return;
    const id = (() => {
      let x = `${instanceId}__in_${p.id}`;
      while (taken.has(x)) x += "_";
      taken.add(x);
      return x;
    })();
    const c = constNode(id, p.type, v, { x: inst.position.x - 160, y: inst.position.y + i * 70 });
    if (c) {
      list.push(ops.addNode(c, scope));
      feed.set(p.id, { node: id, port: "out" });
    }
  });
  if (inNode)
    for (const e of Object.values(def.edges))
      if (e.from.node === inNode.id && rename.has(e.to.node) && feed.has(e.from.port))
        list.push(ops.connect(feed.get(e.from.port)!, mapRef(e.to), scope));
  if (outNode) {
    for (const o of def.outputs) {
      const src = Object.values(def.edges).find((e) => e.to.node === outNode.id && e.to.port === o.id)?.from;
      if (!src) continue;
      const resolved =
        inNode && src.node === inNode.id ? feed.get(src.port) : rename.has(src.node) ? mapRef(src) : undefined;
      if (resolved) for (const t of instOut(o.id)) list.push(ops.connect(resolved, t.to, scope));
    }
  }
  return list;
}

/* ── library helpers ───────────────────────────────────────────────────────────────────────────── */
export function duplicateSubgraphOps(graph: Graph, defId: string, newId: string, name: string): GraphOp[] | null {
  const def = graph.subgraphDefs[defId];
  return def ? [ops.addSubgraphDef({ ...def, id: newId, name })] : null;
}

/** Delete a definition together with all of its instances (the UI asks first, showing `subgraphInstances`). */
export function deleteSubgraphOps(graph: Graph, defId: string): GraphOp[] | null {
  if (!graph.subgraphDefs[defId]) return null;
  const list: GraphOp[] = subgraphInstances(graph, defId)
    .filter((u) => u.scope !== defId)
    .map((u) => ops.removeNode(u.nodeId, u.scope));
  list.push(ops.removeSubgraphDef(defId));
  return list;
}

/** A subgraph name nobody uses yet. */
export function uniqueSubgraphName(graph: Graph, base: string): string {
  const used = new Set(Object.values(graph.subgraphDefs).map((d) => d.name));
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base} ${i}`)) return `${base} ${i}`;
}
