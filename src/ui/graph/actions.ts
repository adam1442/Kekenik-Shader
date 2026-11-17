import {
  SUBGRAPH_PARAM,
  type Edge,
  type GraphOp,
  type NodeInstance,
  type ParamValue,
  type PortRef,
  type PortValue,
  type Vec2,
  createNode,
  newParamDefaults,
  ops,
  wouldRecurse,
} from "@/core";
import { copyToClipboard, lastCopied, pasteText } from "@/ui/controls/clipboard";
import { type ConnectResult, type EndPoint, checkConnection, inputType, outputType } from "./connect";
import { buildPaste, clipToText, copyPayload, parseClip } from "./graphClipboard";
import { resolveCatalogDef } from "./subgraphCatalog";
import {
  commit,
  getActiveScope,
  getAnalysis,
  getGraph,
  getScene,
  getSelection,
  newNodeId,
  setSelection,
} from "./graphStore";
import { toast } from "@/ui/Overlays";
import { clampColorLdr } from "./hdr";
import { useNodePrefs } from "./prefs";
import { removeFrame, useFrameSel } from "./frameActions";
import { type SceneNode, makeSceneNode } from "./sceneIndex";
import { type PortFilter, compatiblePort } from "./searchRanking";
import { type Pt, type Rect, type Size, type View, boundsOf } from "./viewport";

/** What the active canvas offers to commands that need geometry (frame, cursor position). Set by `GraphCanvas`. */
export interface CanvasApi {
  size(): Size;
  getView(): View;
  setView(v: View, animate?: boolean): void;
  cursorWorld(): Pt;
  centerWorld(): Pt;
  frameRect(r: Rect, animate?: boolean): void;
  openSearch(opts?: { world?: Pt; filter?: PortFilter; anchor?: EndPoint; insertEdge?: string }): void;
  focus(): void;
}
let api: CanvasApi | null = null;
export const setCanvasApi = (a: CanvasApi | null): void => {
  api = a;
};
export const getCanvasApi = (): CanvasApi | null => api;

const ctx = () => ({ graph: getGraph(), scene: getScene(), analysis: getAnalysis() });

/* ── node creation ─────────────────────────────────────────────────────────────────────────────── */
export interface AddLink {
  anchor: EndPoint;
  filter: PortFilter;
}

/** Create a node of `defId` with its top-left at `pos` (world). With `link`, the node is placed so its compatible port sits at `pos` and gets wired. */
export function addNodeAt(defId: string, pos: Vec2, link?: AddLink): string | null {
  const graph = getGraph();
  const found = resolveCatalogDef(defId, graph);
  if (!found) return null;
  const { def } = found;
  if (found.params && wouldRecurse(graph, getActiveScope(), found.params[SUBGRAPH_PARAM]!)) return null;
  const id = newNodeId("n");
  let node: NodeInstance = createNode(id, found.nodeDefId, {
    position: { x: Math.round(pos.x), y: Math.round(pos.y) },
    previewEnabled: def.previewByDefault === true,
    params: { ...newParamDefaults(def), ...(found.params ?? {}) },
  });
  const list: GraphOp[] = [];
  let port;
  if (link) {
    port = compatiblePort(def, link.filter);
    if (port) {
      const sn: SceneNode = makeSceneNode(graph, node);
      const slot = (link.anchor.dir === "out" ? sn.layout.inputs : sn.layout.outputs).find((s) => s.id === port!.id);
      const dx = link.anchor.dir === "out" ? 28 : -sn.layout.width - 28;
      node = { ...node, position: { x: Math.round(pos.x + dx), y: Math.round(pos.y - (slot?.y ?? 16)) } };
    }
  }
  list.push(ops.addNode(node));
  if (link && port) {
    const mine: PortRef = { node: id, port: port.id };
    const [from, to] =
      link.anchor.dir === "out"
        ? [{ node: link.anchor.node, port: link.anchor.port }, mine]
        : [mine, { node: link.anchor.node, port: link.anchor.port }];
    list.push(ops.connect(from, to));
  }
  if (!commit(`Add ${def.name}`, list, { select: [id] })) return null;
  useNodePrefs.getState().addRecent(def.id);
  return id;
}

/* ── connections ───────────────────────────────────────────────────────────────────────────────── */
export function connectPorts(a: EndPoint, b: EndPoint): ConnectResult {
  const r = checkConnection(ctx(), a, b);
  if (r.ok) commit("Connect", ops.connect(r.from, r.to));
  return r;
}

export const disconnectEdge = (edgeId: string): boolean => commit("Disconnect", ops.disconnect(edgeId));

/** Remove every wire attached to a port. */
export function disconnectPort(node: string, port: string, dir: "in" | "out"): boolean {
  const list = Object.values(getGraph().edges).filter((e) =>
    dir === "in" ? e.to.node === node && e.to.port === port : e.from.node === node && e.from.port === port,
  );
  return (
    list.length > 0 &&
    commit(
      "Disconnect",
      list.map((e) => ops.disconnect(e.id)),
    )
  );
}

/** Plan ops that splice `nodeId` into `edge` (first compatible input / output). Null when impossible. */
export function planInsertOnEdge(nodeId: string, edge: Edge): GraphOp[] | null {
  const c = ctx();
  const sn = c.scene.get(nodeId);
  if (!sn || sn.layout.collapsed || nodeId === edge.from.node || nodeId === edge.to.node) return null;
  const src = outputType(c, edge.from),
    dst = inputType(c, edge.to);
  const dstSpec = c.scene.get(edge.to.node)?.inputs.find((p) => p.id === edge.to.port)?.type;
  if (!src || !dst) return null;
  const inPort = compatiblePort(sn.def!, { dir: "out", type: src });
  const outPort = compatiblePort(sn.def!, { dir: "in", type: dst, ...(dstSpec ? { spec: dstSpec } : {}) });
  if (!inPort || !outPort) return null;
  const a: PortRef = { node: nodeId, port: inPort.id },
    b: PortRef = { node: nodeId, port: outPort.id };
  if (!checkConnection(c, { ...edge.from, dir: "out" }, { ...a, dir: "in" }).ok) return null;
  if (!checkConnection(c, { ...b, dir: "out" }, { ...edge.to, dir: "in" }).ok) return null;
  return [ops.disconnect(edge.id), ops.connect(edge.from, a), ops.connect(b, edge.to)];
}

export function insertNodeOnEdge(nodeId: string, edgeId: string): boolean {
  const edge = getGraph().edges[edgeId];
  const plan = edge ? planInsertOnEdge(nodeId, edge) : null;
  return !!plan && commit("Insert node on wire", plan, { select: [nodeId] });
}

/* ── editing ───────────────────────────────────────────────────────────────────────────────────── */
export function moveNodes(moves: Array<{ id: string; position: Vec2 }>): boolean {
  const g = getGraph();
  const real = moves.filter((m) => {
    const n = g.nodes[m.id];
    return n && (n.position.x !== m.position.x || n.position.y !== m.position.y);
  });
  return real.length > 0 && commit(real.length > 1 ? `Move ${real.length} nodes` : "Move node", ops.moveNodes(real));
}

function deleteNodes(ids: readonly string[]): boolean {
  const g = getGraph();
  const list = ids.filter((id) => g.nodes[id] && g.nodes[id]!.defId !== "masterOutput");
  if (!list.length) return false;
  return commit(
    list.length > 1 ? `Delete ${list.length} nodes` : "Delete node",
    list.map((id) => ops.removeNode(id)),
    { select: [] },
  );
}
export const deleteSelection = (): boolean => {
  const sel = getSelection();
  const frame = useFrameSel.getState().sel;
  if (sel.length === 0 && frame) return removeFrame(frame);
  return deleteNodes(sel);
};

export const setPortValue = (node: string, port: string, value: PortValue | null): boolean =>
  commit("Edit value", ops.setPortValue(node, port, value));
export function setParam(node: string, param: string, value: ParamValue): boolean {
  // U5: turning HDR OFF clamps the Color node's value to [0,1] — ONE undo step (the toggle and the clamp), with a toast.
  const n = getGraph().nodes[node];
  if (n?.defId === "color" && param === "hdr" && value === false && n.params.hdr === true) {
    const v = n.params.value;
    const clamped = clampColorLdr(v);
    if (clamped && clamped.some((x, i) => x !== (v as number[])[i])) {
      toast.show({ kind: "info", title: "HDR off", description: "Color values above 1 were clamped to [0, 1]." });
      return commit("Disable HDR", [ops.setParam(node, "hdr", false), ops.setParam(node, "value", clamped)]);
    }
  }
  return commit("Edit parameter", ops.setParam(node, param, value));
}

export function toggleCollapse(ids: readonly string[] = getSelection()): boolean {
  const g = getGraph();
  const list = ids.filter((id) => g.nodes[id]);
  if (!list.length) return false;
  const to = !list.every((id) => g.nodes[id]!.collapsed);
  return commit(
    to ? "Collapse" : "Expand",
    list.map((id) => ops.setNodeMeta(id, { collapsed: to })),
  );
}
export function togglePreview(ids: readonly string[] = getSelection()): boolean {
  const g = getGraph();
  const list = ids.filter((id) => g.nodes[id]);
  if (!list.length) return false;
  const to = !list.every((id) => g.nodes[id]!.previewEnabled);
  return commit(
    to ? "Show preview" : "Hide preview",
    list.map((id) => ops.setNodeMeta(id, { previewEnabled: to })),
  );
}
export const setNodeColor = (ids: readonly string[], color: string | null): boolean =>
  commit(
    "Node color",
    ids.map((id) => ops.setNodeMeta(id, { color })),
  );
/** Graph-level edits (Inspector → Graph tab, Preview material settings): the single place that commits them. */
export const renameGraph = (name: string): boolean =>
  !!name.trim() && commit("Rename graph", ops.setGraphName(name.trim()));
export const setGraphSetting = (key: string, value: ParamValue | null, label = "Edit graph setting"): boolean =>
  commit(label, ops.setSettings({ [key]: value }));

export const renameNode = (id: string, label: string | null): boolean =>
  commit("Rename node", ops.setNodeMeta(id, { label: label && label.trim() ? label.trim() : null }));

/* ── clipboard ─────────────────────────────────────────────────────────────────────────────────── */
export async function copySelection(): Promise<boolean> {
  const p = copyPayload(getGraph(), getSelection());
  if (!p) return false;
  await copyToClipboard(clipToText(p));
  return true;
}
export async function cutSelection(): Promise<boolean> {
  if (!(await copySelection())) return false;
  return deleteSelection();
}

/** Paste nodes centred on `anchor` (default: cursor if over the canvas, else the view centre). */
export async function pasteClipboard(anchor?: Vec2): Promise<boolean> {
  let payload = parseClip(await pasteText());
  if (!payload) payload = parseClip(lastCopied());
  if (!payload) return false;
  return pastePayload(payload, anchor ?? api?.cursorWorld());
}
function pastePayload(payload: NonNullable<ReturnType<typeof parseClip>>, anchor?: Vec2): boolean {
  const r = buildPaste(getGraph(), payload, { ...(anchor ? { anchor } : {}), newId: newNodeId });
  return !!r.op && commit(r.ids.length > 1 ? `Paste ${r.ids.length} nodes` : "Paste node", r.op, { select: r.ids });
}

/** Ctrl+D: copy + paste with an offset, no clipboard involved. */
export function duplicateSelection(): string[] {
  const p = copyPayload(getGraph(), getSelection());
  if (!p) return [];
  const r = buildPaste(getGraph(), p, { offset: { x: 36, y: 36 }, newId: newNodeId });
  if (
    !r.op ||
    !commit(r.ids.length > 1 ? `Duplicate ${r.ids.length} nodes` : "Duplicate node", r.op, { select: r.ids })
  )
    return [];
  return r.ids;
}

/* ── view helpers ──────────────────────────────────────────────────────────────────────────────── */
export function frameNodes(ids: readonly string[] | null, animate = true): boolean {
  const scene = getScene();
  const rects: Rect[] = [];
  for (const id of ids ?? scene.nodes.keys()) {
    const r = scene.rect(id);
    if (r) rects.push(r);
  }
  const bounds = boundsOf(rects);
  if (!bounds || !api) return false;
  api.frameRect(bounds, animate);
  return true;
}
export const frameAll = (): boolean => frameNodes(null);
export const frameSelected = (): boolean => (getSelection().length ? frameNodes(getSelection()) : frameAll());

/** Select a node and bring it into view (Problems panel, search results). */
export function focusNode(id: string): boolean {
  if (!getGraph().nodes[id]) return false;
  setSelection([id]);
  return frameNodes([id]);
}
