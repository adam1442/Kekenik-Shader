import {
  type GraphOp,
  type PortValue,
  type ShaderType,
  type SubgraphDef,
  type SubgraphPort,
  DEF_SUBGRAPH,
  DEF_SUBGRAPH_INPUTS,
  DEF_SUBGRAPH_OUTPUTS,
  SUBGRAPH_PARAM,
  createNode,
  createSubgraphDef,
  createSubgraphFromSelection,
  deleteSubgraphOps,
  duplicateSubgraphOps,
  exportSubgraph,
  importSubgraph,
  inlineSubgraphOps,
  ops,
  subgraphInstances,
  uniqueSubgraphName,
  updateSubgraphIoOps,
  wouldRecurse,
  zeroValue,
} from "@/core";
import { toast } from "@/ui";
import { copyText, pasteText } from "@/ui/controls/clipboard";
import { downloadText } from "@/app/lib/download";
import { outputType } from "./connect";
import {
  commit,
  getActiveScope,
  getAnalysis,
  getGraph,
  getRealGraph,
  getScene,
  getSelection,
  newNodeId,
  openSubgraphDoc,
} from "./graphStore";

/** Subgraph workflow (the only place it lives). Core functions get the REAL graph + the active scope; `commit` applies / scopes the result. */
const SUBGRAPH_EXT = ".kshadersub";

const fail = (reason: string): { ok: false; reason: string } => {
  toast.show({ title: reason, kind: "warning" });
  return { ok: false, reason };
};

/** Selected nodes → new subgraph + instance in their place. Opens nothing (the user keeps working); returns ids. */
export function convertSelectionToSubgraph(
  name?: string,
): { ok: true; defId: string; instanceId: string } | { ok: false; reason: string } {
  const real = getRealGraph();
  const scope = getActiveScope();
  const scene = getScene();
  const ctx = { graph: getGraph(), scene, analysis: getAnalysis() };
  const defId = newNodeId("sg");
  const instanceId = newNodeId("n");
  const r = createSubgraphFromSelection({
    graph: real,
    selection: getSelection(),
    defId,
    instanceId,
    ...(scope === undefined ? {} : { scope }),
    name: name ?? uniqueSubgraphName(real, "Subgraph"),
    typeOf: (ref) => outputType(ctx, ref),
    nameOf: (ref, kind, i) => {
      if (kind !== "input" && kind !== "output") return undefined;
      const n = real.nodes[ref.node] ?? getGraph().nodes[ref.node];
      const sn = scene.get(ref.node);
      const port = sn?.outputs.find((p) => p.id === ref.port);
      const base = n?.label ?? sn?.def?.name;
      return base && port
        ? sn!.outputs.length > 1
          ? `${base} ${port.name}`
          : base
        : `${kind === "input" ? "Input" : "Output"} ${i + 1}`;
    },
  });
  if (!r.ok) return fail(r.reason);
  return commit("Convert to subgraph", r.ops, { select: [r.instanceId] })
    ? { ok: true, defId, instanceId }
    : fail("Could not create the subgraph");
}

/** A new empty subgraph (one float in, one float out), opened in its own tab. */
export function createEmptySubgraph(name?: string): string {
  const real = getRealGraph();
  const id = newNodeId("sg");
  const def: SubgraphDef = createSubgraphDef(
    id,
    name ?? uniqueSubgraphName(real, "Subgraph"),
    [{ id: "in1", name: "In", type: "float", default: 0 }],
    [{ id: "out1", name: "Out", type: "float" }],
  );
  def.nodes = {
    inputs: createNode("inputs", DEF_SUBGRAPH_INPUTS, { position: { x: 0, y: 80 } }),
    outputs: createNode("outputs", DEF_SUBGRAPH_OUTPUTS, { position: { x: 520, y: 80 } }),
  };
  if (!commit("Create subgraph", ops.addSubgraphDef(def))) return "";
  return openSubgraphDoc(id, [id]);
}

/** Open the inside of a subgraph in a tab (breadcrumb path = current path + id). */
export const openSubgraph = (defId: string): string => openSubgraphDoc(defId);

/** Put an instance of `defId` on the canvas; refuses when it would make the current subgraph instantiate itself. */
export function addSubgraphInstance(
  defId: string,
  at: { x: number; y: number },
): { ok: true; nodeId: string } | { ok: false; reason: string } {
  const real = getRealGraph();
  const def = real.subgraphDefs[defId];
  if (!def) return fail("This subgraph no longer exists");
  if (wouldRecurse(real, getActiveScope(), defId))
    return fail(`"${def.name}" cannot be placed here: it would instantiate itself (recursion is not allowed)`);
  const id = newNodeId("n");
  const node = createNode(id, DEF_SUBGRAPH, {
    position: { x: Math.round(at.x), y: Math.round(at.y) },
    params: { [SUBGRAPH_PARAM]: defId },
  });
  return commit(`Add ${def.name}`, ops.addNode(node), { select: [id] })
    ? { ok: true, nodeId: id }
    : fail("Could not add the subgraph");
}

export const renameSubgraph = (defId: string, name: string): boolean =>
  !!name.trim() && commit("Rename subgraph", ops.updateSubgraphDef(defId, { name: name.trim() }));

export function duplicateSubgraph(defId: string): string | null {
  const real = getRealGraph();
  const def = real.subgraphDefs[defId];
  const id = newNodeId("sg");
  const list = def ? duplicateSubgraphOps(real, defId, id, uniqueSubgraphName(real, `${def.name} copy`)) : null;
  return list && commit("Duplicate subgraph", list) ? id : null;
}

export const usageOf = (defId: string) => subgraphInstances(getRealGraph(), defId);

/** Delete a definition AND its instances (callers confirm first, showing `usageOf`). */
export function deleteSubgraph(defId: string): boolean {
  const list = deleteSubgraphOps(getRealGraph(), defId);
  return !!list && commit("Delete subgraph", list);
}

/** Replace an instance by a copy of the nodes inside it ("unlink"). */
export function inlineInstance(nodeId: string): boolean {
  const list = inlineSubgraphOps(getRealGraph(), getActiveScope(), nodeId);
  if (!list) return fail("This node is not an instance of an existing subgraph").ok;
  return commit("Inline subgraph", list);
}

/* ── I/O ──────────────────────────────────────────────────────────────────────────────────────── */
interface IoDraft {
  inputs: SubgraphPort[];
  outputs: SubgraphPort[];
}

/** Replace the signature; every instance keeps its compatible connections. One undo step. */
function setSubgraphIo(defId: string, next: IoDraft): boolean {
  const list: GraphOp[] | null = updateSubgraphIoOps(getRealGraph(), defId, next.inputs, next.outputs);
  return !!list && commit("Edit subgraph I/O", list);
}

const freshPortId = (list: readonly SubgraphPort[], prefix: string): string => {
  let n = list.length + 1;
  while (list.some((p) => p.id === `${prefix}${n}`)) n++;
  return `${prefix}${n}`;
};

export function addSubgraphPort(defId: string, kind: "input" | "output", type: ShaderType = "float"): string | null {
  const def = getRealGraph().subgraphDefs[defId];
  if (!def) return null;
  const list = kind === "input" ? def.inputs : def.outputs;
  const id = freshPortId(list, kind === "input" ? "in" : "out");
  const name = (kind === "input" ? "Input " : "Output ") + (list.length + 1);
  const dv = zeroValue(type);
  const port: SubgraphPort = { id, name, type, ...(kind === "input" && dv !== undefined ? { default: dv } : {}) };
  return setSubgraphIo(
    defId,
    kind === "input"
      ? { inputs: [...def.inputs, port], outputs: def.outputs }
      : { inputs: def.inputs, outputs: [...def.outputs, port] },
  )
    ? id
    : null;
}

/** Patch one port (rename, type, default, tooltip, optional). A type change resets the default to the new type's neutral value. */
export function patchSubgraphPort(
  defId: string,
  kind: "input" | "output",
  portId: string,
  patch: Partial<Omit<SubgraphPort, "id">> & { default?: PortValue | null },
): boolean {
  const def = getRealGraph().subgraphDefs[defId];
  if (!def) return false;
  const edit = (list: SubgraphPort[]) =>
    list.map((p) => {
      if (p.id !== portId) return p;
      const { default: d, ...rest } = patch;
      const next: SubgraphPort = { ...p, ...rest };
      if (patch.type && patch.type !== p.type) delete next.default;
      if (patch.type && patch.type !== p.type && kind === "input") {
        const z = zeroValue(patch.type);
        if (z !== undefined) next.default = z;
      }
      if (d === null) delete next.default;
      else if (d !== undefined) next.default = d;
      if (patch.tooltip === "") delete next.tooltip;
      if (patch.optional === false) delete next.optional;
      return next;
    });
  return setSubgraphIo(
    defId,
    kind === "input"
      ? { inputs: edit(def.inputs), outputs: def.outputs }
      : { inputs: def.inputs, outputs: edit(def.outputs) },
  );
}

export function removeSubgraphPort(defId: string, kind: "input" | "output", portId: string): boolean {
  const def = getRealGraph().subgraphDefs[defId];
  if (!def) return false;
  return setSubgraphIo(
    defId,
    kind === "input"
      ? { inputs: def.inputs.filter((p) => p.id !== portId), outputs: def.outputs }
      : { inputs: def.inputs, outputs: def.outputs.filter((p) => p.id !== portId) },
  );
}

export function moveSubgraphPort(defId: string, kind: "input" | "output", portId: string, toIndex: number): boolean {
  const def = getRealGraph().subgraphDefs[defId];
  if (!def) return false;
  const list = [...(kind === "input" ? def.inputs : def.outputs)];
  const from = list.findIndex((p) => p.id === portId);
  if (from < 0) return false;
  const [p] = list.splice(from, 1);
  list.splice(Math.max(0, Math.min(list.length, toIndex)), 0, p!);
  return setSubgraphIo(
    defId,
    kind === "input" ? { inputs: list, outputs: def.outputs } : { inputs: def.inputs, outputs: list },
  );
}

/* ── import / export / clipboard ──────────────────────────────────────────────────────────────── */
export function exportSubgraphFile(defId: string): boolean {
  const real = getRealGraph();
  const text = exportSubgraph(real, defId);
  if (!text) return false;
  downloadText(`${real.subgraphDefs[defId]!.name.replace(/[^\w\- ]+/g, "_")}${SUBGRAPH_EXT}`, text);
  return true;
}

export async function copySubgraph(defId: string): Promise<boolean> {
  const text = exportSubgraph(getRealGraph(), defId);
  if (!text) return false;
  await copyText(text);
  toast.show({
    title: "Subgraph copied",
    description: "Paste it into any project with Paste in the Subgraphs panel",
    kind: "success",
  });
  return true;
}

/** Import a `.kshadersub` text (file or clipboard). Returns the id of the imported root subgraph. */
export function importSubgraphText(text: string): { ok: true; rootId: string } | { ok: false; error: string } {
  const real = getRealGraph();
  const taken = new Set(Object.keys(real.subgraphDefs));
  const r = importSubgraph(real, text, (base) => {
    let id = newNodeId("sg");
    while (taken.has(id)) id = newNodeId("sg");
    taken.add(id);
    return `${base.replace(/^sg_?/, "sg_")}_${id}`.slice(0, 48);
  });
  if (!r.ok) return r;
  if (!commit("Import subgraph", r.ops)) return { ok: false, error: "Could not apply the import" };
  return { ok: true, rootId: r.rootId };
}

export async function pasteSubgraph(): Promise<boolean> {
  const r = importSubgraphText(await pasteText());
  toast.show(
    r.ok
      ? { title: "Subgraph pasted", kind: "success" }
      : { title: "Nothing to paste", description: r.error, kind: "warning" },
  );
  return r.ok;
}

export function importSubgraphFile(): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = `${SUBGRAPH_EXT},application/json`;
  input.onchange = async () => {
    const f = input.files?.[0];
    if (!f) return;
    const r = importSubgraphText(await f.text());
    toast.show(
      r.ok
        ? { title: "Subgraph imported", description: f.name, kind: "success" }
        : { title: "Could not import", description: r.error, kind: "danger" },
    );
  };
  input.click();
}
