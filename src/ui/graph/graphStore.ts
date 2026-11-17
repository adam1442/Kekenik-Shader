import { create } from "zustand";
import {
  type Graph,
  type GraphAnalysis,
  type GraphOp,
  analyzeGraph,
  applyOperation,
  createGraph,
  createIdGenerator,
  createNode,
} from "@/core";
import { useShader } from "@/app/shaderStore";
import { type SceneIndex, buildScene } from "./sceneIndex";
import { originOf, projectScope, scopeOp, scopedAnalysis } from "./scopes";
import { buildSubgraphPreviewGraph } from "@/core";
import { DEFAULT_VIEW, type View } from "./viewport";

/** One undo step: `forward` re-applies, `inverse` reverts (D9: inverses come from the core, never hand-written). */
export interface HistEntry {
  label: string;
  forward: GraphOp;
  inverse: GraphOp;
  time: number;
}

export interface GraphDoc {
  id: string;
  graph: Graph;
  undo: HistEntry[];
  redo: HistEntry[];
  selection: string[];
  view: View;
  dirty: boolean;
  fileName: string;
  emitOptions: { interpolate?: string[] };
  /** Frame all nodes the first time the canvas shows this document. */
  fit: boolean;
  /** Subgraph view: id of the document that owns the project graph (its undo stack is shared), the subgraph shown, and the breadcrumb path. */
  rootId?: string;
  scope?: string;
  path?: string[];
  /** Subgraph tabs: id of the subgraph output the Preview / Code panels show (U13); absent = the first output. */
  outputId?: string;
}

interface GraphsState {
  docs: GraphDoc[];
  activeId: string;
  /** Debounced live analysis of the active graph (diagnostics, resolved types, reachability). */
  analysis: GraphAnalysis | null;
  analysisGraph: Graph | null;
}

const HISTORY_LIMIT = 500;
const newDocId = createIdGenerator("doc");
export const newNodeId = createIdGenerator();

export const useGraphs = create<GraphsState>(() => ({ docs: [], activeId: "", analysis: null, analysisGraph: null }));

const st = () => useGraphs.getState();
export const getActiveDoc = (): GraphDoc | undefined => st().docs.find((d) => d.id === st().activeId);
export const getGraph = (): Graph => getActiveDoc()?.graph ?? EMPTY;
const EMPTY = createGraph();
export const getSelection = (): string[] => getActiveDoc()?.selection ?? [];
/** The document that owns the project (the active one, or the owner of the active subgraph view). */
export const rootDocOf = (d: GraphDoc | undefined): GraphDoc | undefined =>
  d?.rootId ? st().docs.find((x) => x.id === d.rootId) : d;
export const getRootDoc = (): GraphDoc | undefined => rootDocOf(getActiveDoc());
/** The whole project graph even while a subgraph tab is active. */
export const getRealGraph = (): Graph => getRootDoc()?.graph ?? EMPTY;
/** Subgraph shown by the active tab (undefined = main graph). */
export const getActiveScope = (): string | undefined => getActiveDoc()?.scope;

function patchActive(fn: (d: GraphDoc) => GraphDoc): void {
  useGraphs.setState((s) => ({ docs: s.docs.map((d) => (d.id === s.activeId ? fn(d) : d)) }));
}

/** U13: choose which output of the active subgraph tab the Preview / Code panels show. */
export function setSubgraphOutput(outputId: string): void {
  patchActive((d) => (d.scope ? { ...d, outputId } : d));
  flushSync();
}

/** A fresh graph for the Generic profile with its Master Output node. */
export function newShaderGraph(name = "Untitled"): Graph {
  const g = createGraph({ name, profileId: "generic" });
  const m = createNode("master", "masterOutput", { position: { x: 360, y: 80 } });
  return { ...g, nodes: { [m.id]: m } };
}

/* ── scene + analysis caches ───────────────────────────────────────────────────────────────────── */
let lastScene: SceneIndex | null = null;
/** Scene (node ports + geometry) of a graph; reuses unchanged node entries from the previous scene. */
export function sceneFor(graph: Graph): SceneIndex {
  if (lastScene && lastScene.graph === graph) return lastScene;
  lastScene = buildScene(graph, lastScene, undefined, undefined, originOf(graph)?.scope);
  return lastScene;
}
export const getScene = (): SceneIndex => sceneFor(getGraph());

const analysisCache = new WeakMap<Graph, GraphAnalysis>();
/** Fresh analysis of the active graph (computed on demand, cached per immutable graph). */
export function analysisFor(graph: Graph): GraphAnalysis {
  let a = analysisCache.get(graph);
  if (!a) {
    const o = originOf(graph);
    a = o ? scopedAnalysis(analysisFor(o.real), o.scope) : analyzeGraph(graph);
    analysisCache.set(graph, a);
  }
  return a;
}
export const getAnalysis = (): GraphAnalysis => analysisFor(getGraph());

let syncTimer: ReturnType<typeof setTimeout> | undefined;
/** Publish analysis + compile (Code Output) after the graph settled. `immediate` is used for tab switches and tests. */
function flushSync(): void {
  clearTimeout(syncTimer);
  const d = getActiveDoc();
  if (!d) {
    useGraphs.setState({ analysis: null, analysisGraph: null });
    return;
  }
  useGraphs.setState({ analysis: analysisFor(d.graph), analysisGraph: d.graph });
  const root = rootDocOf(d)!;
  // inside a subgraph the Preview / Code Output show the selected output (default: the first), with every input at its default
  const shown = d.scope ? (buildSubgraphPreviewGraph(root.graph, d.scope, d.outputId) ?? root.graph) : root.graph;
  useShader.getState().setGraph(shown, root.graph.name, root.emitOptions);
}
function scheduleSync(): void {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(flushSync, 140);
}

/* ── documents (tabs) ──────────────────────────────────────────────────────────────────────────── */
export function openDoc(
  graph: Graph,
  opts: { fileName?: string; emitOptions?: GraphDoc["emitOptions"]; view?: View; fit?: boolean } = {},
): string {
  const doc: GraphDoc = {
    id: newDocId("g"),
    graph,
    undo: [],
    redo: [],
    selection: [],
    view: opts.view ?? { ...DEFAULT_VIEW },
    dirty: false,
    fileName: opts.fileName ?? "",
    emitOptions: opts.emitOptions ?? {},
    fit: opts.fit ?? false,
  };
  useGraphs.setState((s) => ({ docs: [...s.docs, doc], activeId: doc.id }));
  flushSync();
  return doc.id;
}

export function activateDoc(id: string): void {
  if (st().activeId === id || !st().docs.some((d) => d.id === id)) return;
  useGraphs.setState({ activeId: id });
  flushSync();
}

/** Close a tab; returns the id that became active (or "" when none are left). */
export function closeDoc(id: string): string {
  const { docs, activeId } = st();
  const i = docs.findIndex((d) => d.id === id);
  if (i < 0) return activeId;
  const rest = docs.filter((d) => d.id !== id && d.rootId !== id);
  const next = rest.some((d) => d.id === activeId) ? activeId : (rest[Math.min(i, rest.length - 1)]?.id ?? "");
  useGraphs.setState({ docs: rest, activeId: next });
  flushSync();
  return next;
}

/** Clear the one-shot `fit` flag of a document. */
export const clearFit = (id: string): void =>
  useGraphs.setState((s) => ({ docs: s.docs.map((d) => (d.id === id && d.fit ? { ...d, fit: false } : d)) }));

export const setView = (view: View): void =>
  patchActive((d) => (d.view.x === view.x && d.view.y === view.y && d.view.zoom === view.zoom ? d : { ...d, view }));

/** After a successful save: remember the file name and clear the dirty flag. */
export const markSaved = (fileName: string): void => {
  const id = getRootDoc()?.id;
  useGraphs.setState((s) => ({ docs: s.docs.map((d) => (d.id === id ? { ...d, fileName, dirty: false } : d)) }));
};

const samePath = (a: readonly string[] | undefined, b: readonly string[]): boolean =>
  !!a && a.length === b.length && a.every((x, i) => x === b[i]);
/** The open tab of subgraph `defId` of project `rootId` that was opened along `path`. */
export const findSubgraphDoc = (rootId: string, defId: string, path: readonly string[]): GraphDoc | undefined =>
  st().docs.find((d) => d.rootId === rootId && d.scope === defId && samePath(d.path ?? [defId], path));

/**
 * Open (or focus) a tab showing the inside of subgraph `defId` of the active project. `path` is the breadcrumb (subgraph ids from
 * the outermost); it defaults to the path of the active tab plus `defId`. Returns the tab id ("" when the subgraph does not exist).
 */
export function openSubgraphDoc(defId: string, path?: string[]): string {
  const active = getActiveDoc();
  const root = rootDocOf(active);
  if (!root || !root.graph.subgraphDefs[defId]) return "";
  // U12: a tab is identified by (project, subgraph, path) — the same subgraph opened from two parents gets two tabs, each with the breadcrumb it was opened with.
  const route = path ?? [...(active?.path ?? []), defId];
  const existing = findSubgraphDoc(root.id, defId, route);
  if (existing) {
    activateDoc(existing.id);
    return existing.id;
  }
  const g = projectScope(root.graph, defId)!;
  const id = newDocId("g");
  const doc: GraphDoc = {
    id,
    graph: g,
    undo: [],
    redo: [],
    selection: [],
    view: { ...DEFAULT_VIEW },
    dirty: false,
    fileName: "",
    emitOptions: root.emitOptions,
    fit: true,
    rootId: root.id,
    scope: defId,
    path: route,
  };
  useGraphs.setState((s) => ({ docs: [...s.docs, doc], activeId: id }));
  flushSync();
  return id;
}

/** Activate the project's main-graph tab (from a subgraph view). */
export function openMainDoc(): void {
  const root = getRootDoc();
  if (root) activateDoc(root.id);
}

/* ── selection ─────────────────────────────────────────────────────────────────────────────────── */
export function setSelection(ids: readonly string[]): void {
  const cur = getSelection();
  if (cur.length === ids.length && cur.every((x, i) => x === ids[i])) return;
  patchActive((d) => ({ ...d, selection: [...ids] }));
}
export function toggleSelection(id: string): void {
  const cur = getSelection();
  setSelection(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
}
export const selectAll = (): void => setSelection(Object.keys(getGraph().nodes));

/* ── edits (every change goes through applyOperation) ──────────────────────────────────────────── */
export interface CommitOptions {
  /** Replace the selection with these ids after the change. */
  select?: readonly string[];
}

/** Write a new project graph into its owning document and refresh every subgraph view of it (closing views whose subgraph vanished). */
function setRootGraph(
  rootId: string,
  graph: Graph,
  hist: (d: GraphDoc) => Pick<GraphDoc, "undo" | "redo">,
  select?: readonly string[],
): void {
  useGraphs.setState((s) => {
    let activeId = s.activeId;
    const pick = (d: GraphDoc, g: Graph): string[] =>
      d.id === s.activeId && select ? [...select] : d.selection.filter((id) => id in g.nodes);
    const docs: GraphDoc[] = [];
    for (const d of s.docs) {
      if (d.id === rootId) docs.push({ ...d, graph, ...hist(d), dirty: true, selection: pick(d, graph) });
      else if (d.rootId === rootId) {
        const g = d.scope ? projectScope(graph, d.scope) : undefined;
        if (!g) {
          if (activeId === d.id) activeId = rootId;
          continue;
        }
        docs.push({ ...d, graph: g, selection: pick(d, g) });
      } else docs.push(d);
    }
    return { docs, activeId };
  });
}

/** Apply `op` to the active graph as ONE undo step (subgraph tabs: the op is scoped and applied to the project; the undo stack is the project's). Returns false when the op was invalid or changed nothing. */
export function commit(label: string, op: GraphOp | GraphOp[], opts: CommitOptions = {}): boolean {
  const doc = getActiveDoc();
  const root = rootDocOf(doc);
  if (!doc || !root) return false;
  let forward: GraphOp = Array.isArray(op) ? (op.length === 1 ? op[0]! : { type: "transaction", ops: op }) : op;
  if (doc.scope) forward = scopeOp(forward, doc.scope);
  let r;
  try {
    r = applyOperation(root.graph, forward);
  } catch (e) {
    console.warn("[Kekenik Shader] graph operation rejected:", (e as Error).message);
    return false;
  }
  if (r.graph === root.graph) return false;
  const entry: HistEntry = { label, forward, inverse: r.inverse, time: Date.now() };
  setRootGraph(root.id, r.graph, (d) => ({ undo: [...d.undo, entry].slice(-HISTORY_LIMIT), redo: [] }), opts.select);
  scheduleSync();
  return true;
}

function step(from: "undo" | "redo"): HistEntry | null {
  const doc = rootDocOf(getActiveDoc());
  const entry = doc?.[from][doc[from].length - 1];
  if (!doc || !entry) return null;
  let r;
  try {
    r = applyOperation(doc.graph, from === "undo" ? entry.inverse : entry.forward);
  } catch (e) {
    console.warn("[Kekenik Shader] history step failed:", (e as Error).message);
    return null;
  }
  setRootGraph(doc.id, r.graph, (d) => ({
    undo: from === "undo" ? d.undo.slice(0, -1) : [...d.undo, entry],
    redo: from === "undo" ? [...d.redo, entry] : d.redo.slice(0, -1),
  }));
  scheduleSync();
  return entry;
}
export const undo = (): HistEntry | null => step("undo");
export const redo = (): HistEntry | null => step("redo");

/** Jump so that exactly `index` entries are applied (History list). */
export function jumpToHistory(index: number): void {
  const doc = getRootDoc();
  if (!doc) return;
  let guard = doc.undo.length + doc.redo.length + 2;
  while (getRootDoc()!.undo.length > index && guard-- > 0) if (!undo()) break;
  while (getRootDoc()!.undo.length < index && guard-- > 0) if (!redo()) break;
}

export const canUndo = (): boolean => (getRootDoc()?.undo.length ?? 0) > 0;
export const canRedo = (): boolean => (getRootDoc()?.redo.length ?? 0) > 0;

/** Test / tooling helper: drop every document. */
export function resetGraphs(): void {
  useGraphs.setState({ docs: [], activeId: "", analysis: null, analysisGraph: null });
  lastScene = null;
}
