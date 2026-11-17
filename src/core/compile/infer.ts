import type { SceneTarget } from "../engine/targets";
import { type Diagnostic, type DiagnosticCode, type DiagnosticExtra, makeDiagnostic } from "../diagnostics";
import { topoSort } from "../graph/cycles";
import { type FlatBody, type FlatEdge, flattenBody } from "../graph/flatten";
import { ops } from "../graph/ops/make";
import { portKey } from "../graph/query";
import { createNode } from "../graph/create";
import { DEF_MASTER, DEF_SUBGRAPH_OUTPUTS, type Graph, type GraphBody, isStructuralDefId } from "../graph/types";
import { type Conversion, getConversion } from "../types/conversion";
import { joinTypes, type GenericSet } from "../types/generics";
import { tagCompat } from "../types/semantics";
import type { ShaderType } from "../types/shaderType";
import { type NodeDef, type PortDef, type ResolvedPorts, getNodePorts } from "../registry/nodeDef";
import type { ProfileDef } from "../registry/profile";
import type { NodeRegistry } from "../registry/registry";
import { coerceValue } from "./values";

export interface AnalyzeEnv {
  graph: Graph;
  /** Subgraph id (undefined = main graph). */
  scope?: string;
  registry: NodeRegistry;
  profile?: ProfileDef;
  /** Compile-time target (drives `NodeDef.liveInputs`). Default: glsl. */
  target?: SceneTarget;
}

interface InputResolution {
  port: PortDef;
  /** Resolved type the port receives (after generic inference). */
  target: ShaderType;
  /** Type of the wire feeding it (connected only). */
  source?: ShaderType;
  edge?: FlatEdge;
  conversion?: Conversion;
}

interface NodeInfo {
  def: NodeDef;
  ports: ResolvedPorts;
  inputs: Record<string, InputResolution>;
  /** Resolved output types. */
  outputs: Record<string, ShaderType>;
}

export interface BodyAnalysis {
  flat: FlatBody;
  /** Dependency order of the nodes that could be analysed. */
  order: string[];
  info: Map<string, NodeInfo>;
  diagnostics: Diagnostic[];
  /** Master node (main) / subgraphOutputs node (subgraph). */
  rootId?: string;
  /** Nodes the root depends on (root included). */
  reachable: Set<string>;
}

/** Issues on nodes that cannot influence the output are only warnings. */
const DOWNGRADABLE: ReadonlySet<DiagnosticCode> = new Set<DiagnosticCode>([
  "E_MISSING_INPUT",
  "E_ILLEGAL_CONVERSION",
  "E_INVALID_VALUE",
  "E_UNKNOWN_PROPERTY",
  "E_UNKNOWN_KEYWORD",
  "E_UNKNOWN_SUBGRAPH",
  "E_MISSING_REQUIRED_OUTPUT",
]);

/** Flatten → topo-sort → infer types for one body (main graph or subgraph definition). Pure. */
export function analyzeBody(body: GraphBody, env: AnalyzeEnv): BodyAnalysis {
  const { scope, registry } = env;
  const sc: DiagnosticExtra = scope === undefined ? {} : { scope };
  const diags: Diagnostic[] = [];
  const D = (code: DiagnosticCode, msg: string, extra: DiagnosticExtra = {}) =>
    diags.push(makeDiagnostic(code, msg, { ...sc, ...extra }));
  const pctx = { graph: env.graph, scope, profile: env.profile };

  const { flat, diagnostics: flatDiags } = flattenBody(body, scope);
  diags.push(...flatDiags);

  // ---- defs & ports ---------------------------------------------------------------------------------
  const meta = new Map<string, { def: NodeDef; ports: ResolvedPorts }>();
  for (const n of Object.values(flat.nodes)) {
    const def = registry.get(n.defId);
    if (!def) {
      D("E_UNKNOWN_NODE_DEF", `Unknown node type "${n.defId}"`, {
        nodeId: n.id,
        quickFix: { label: "Remove node", operation: ops.removeNode(n.id, scope) },
      });
      continue;
    }
    meta.set(n.id, { def, ports: getNodePorts(def, n, pctx) });
  }

  // ---- original-edge validation ----------------------------------------------------------------------
  for (const e of Object.values(body.edges)) {
    const check = (nodeId: string, portId: string, dir: "in" | "out"): string | null => {
      const n = body.nodes[nodeId];
      if (!n) return `edge refers to missing node "${nodeId}"`;
      if (isStructuralDefId(n.defId)) {
        const ok =
          dir === "in" ? portId === "in" && n.defId !== "portalOut" : portId === "out" && n.defId !== "portalIn";
        return ok ? null : `structural node "${n.defId}" has no ${dir === "in" ? "input" : "output"} "${portId}"`;
      }
      const m = meta.get(nodeId);
      if (!m) return null; // unknown def already reported
      const list = dir === "in" ? m.ports.inputs : m.ports.outputs;
      return list.some((p) => p.id === portId)
        ? null
        : `node "${n.defId}" has no ${dir === "in" ? "input" : "output"} port "${portId}"`;
    };
    const problem = check(e.from.node, e.from.port, "out") ?? check(e.to.node, e.to.port, "in");
    if (problem)
      D("E_UNKNOWN_PORT", `Invalid wire: ${problem}`, {
        nodeId: e.to.node,
        portId: e.to.port,
        edgeId: e.id,
        quickFix: { label: "Remove wire", operation: ops.disconnect(e.id, scope) },
      });
  }

  // ---- cycles -----------------------------------------------------------------------------------------
  const { order, cyclic } = topoSort(flat);
  for (const id of cyclic) D("E_CYCLE", "Node is part of a dependency cycle", { nodeId: id });

  // ---- root --------------------------------------------------------------------------------------------
  const rootDef = scope === undefined ? DEF_MASTER : DEF_SUBGRAPH_OUTPUTS;
  const roots = Object.values(flat.nodes).filter((n) => n.defId === rootDef);
  const rootLabel = scope === undefined ? "Master Output" : "Subgraph Outputs";
  if (roots.length === 0) {
    const id = "master" in flat.nodes ? "master_2" : scope === undefined ? "master" : "outputs";
    D("E_NO_MASTER", `The graph has no ${rootLabel} node`, {
      quickFix: { label: `Add ${rootLabel} node`, operation: ops.addNode(createNode(id, rootDef), scope) },
    });
  }
  roots.slice(1).forEach((n) =>
    D("E_MULTIPLE_MASTER", `Only one ${rootLabel} node is allowed`, {
      nodeId: n.id,
      quickFix: { label: "Remove node", operation: ops.removeNode(n.id, scope) },
    }),
  );
  const rootId = roots[0]?.id;

  // ---- reachability ------------------------------------------------------------------------------------
  const into = new Map<string, FlatEdge[]>();
  for (const e of flat.edges) (into.get(e.to.node) ?? into.set(e.to.node, []).get(e.to.node)!).push(e);
  const reachable = new Set<string>();
  const liveInputsOf = (nodeId: string): string[] | undefined => {
    const m = meta.get(nodeId);
    return m?.def.liveInputs ? m.def.liveInputs(flat.nodes[nodeId]!, env.target ?? "glsl") : undefined;
  };
  if (rootId) {
    const stack = [rootId];
    reachable.add(rootId);
    while (stack.length) {
      const cur = stack.pop()!;
      const live = liveInputsOf(cur);
      for (const e of into.get(cur) ?? []) {
        if (live && !live.includes(e.to.port)) continue;
        if (!reachable.has(e.from.node) && e.from.node in flat.nodes) {
          reachable.add(e.from.node);
          stack.push(e.from.node);
        }
      }
    }
  }

  // ---- inference ---------------------------------------------------------------------------------------
  const nodeDiagStart = diags.length;
  const info = new Map<string, NodeInfo>();
  const outTypes = new Map<string, ShaderType>();
  const analysed: string[] = [];

  for (const id of order) {
    const node = flat.nodes[id]!;
    const m = meta.get(id);
    if (!m) continue;
    const { def, ports } = m;
    for (const issue of def.validate?.(node, pctx) ?? [])
      D(issue.code, issue.message, { nodeId: id, ...(issue.portId ? { portId: issue.portId } : {}) });

    // 1) gather wire types
    const wires = new Map<string, { edge: FlatEdge; type: ShaderType } | "broken">();
    const groups = new Map<string, { set: GenericSet; types: ShaderType[] }>();
    for (const p of ports.inputs) {
      const edge = flat.byTarget.get(portKey(id, p.id));
      if (!edge) continue;
      const type = outTypes.get(portKey(edge.from.node, edge.from.port));
      if (type === undefined) {
        wires.set(p.id, "broken");
        continue;
      }
      wires.set(p.id, { edge, type });
      if (p.type.k === "generic") {
        const g = groups.get(p.type.group) ?? { set: p.type.set, types: [] };
        g.types.push(type);
        groups.set(p.type.group, g);
      }
    }
    const groupType = (set: GenericSet, group: string): ShaderType =>
      joinTypes(groups.get(group)?.set ?? set, groups.get(group)?.types ?? []);

    // 2) resolve every input
    const inputs: Record<string, InputResolution> = {};
    for (const p of ports.inputs) {
      const target: ShaderType =
        p.type.k === "type" ? p.type.type : p.type.k === "generic" ? groupType(p.type.set, p.type.group) : "float";
      const res: InputResolution = { port: p, target };
      inputs[p.id] = res;
      const wire = wires.get(p.id);
      if (wire === "broken") continue;
      if (wire) {
        res.edge = wire.edge;
        res.source = wire.type;
        res.conversion = getConversion(wire.type, target);
        const where = { nodeId: id, portId: p.id, edgeId: wire.edge.edgeId };
        if (res.conversion.kind === "forbidden") {
          D("E_ILLEGAL_CONVERSION", `Cannot connect ${wire.type} to ${target}`, {
            ...where,
            quickFix: { label: "Remove wire", operation: ops.disconnect(wire.edge.edgeId, scope) },
          });
        } else {
          if (res.conversion.lossy)
            D("W_LOSSY_CONVERSION", res.conversion.warning ?? `Lossy conversion ${wire.type} → ${target}`, where);
          const srcTag = info.get(wire.edge.from.node)?.ports.outputs.find((o) => o.id === wire.edge.from.port)?.tag;
          const tc = tagCompat(srcTag, p.tag);
          if (!tc.ok) D("W_SPACE_MISMATCH", tc.warning!, where);
        }
        continue;
      }
      const inline = node.values[p.id] ?? p.default;
      if (inline !== undefined) {
        if (coerceValue(target, inline) === null)
          D("E_INVALID_VALUE", `Inline value for "${p.name}" is not valid for type ${target}`, {
            nodeId: id,
            portId: p.id,
            quickFix: { label: "Reset to default", operation: ops.setPortValue(id, p.id, null, scope) },
          });
      } else if (!p.optional && !p.defaultInput) {
        if (id === rootId && scope === undefined)
          D("E_MISSING_REQUIRED_OUTPUT", `Required master block "${p.name}" is not connected`, {
            nodeId: id,
            portId: p.id,
          });
        else
          D("E_MISSING_INPUT", `Input "${p.name}" is not connected and has no default`, { nodeId: id, portId: p.id });
      }
    }

    // 3) resolve outputs
    const outputs: Record<string, ShaderType> = {};
    for (const o of ports.outputs) {
      const t: ShaderType =
        o.type.k === "type"
          ? o.type.type
          : o.type.k === "generic"
            ? groupType(o.type.set, o.type.group)
            : (inputs[o.type.port]?.target ?? "float");
      outputs[o.id] = t;
      outTypes.set(portKey(id, o.id), t);
    }
    info.set(id, { def, ports, inputs, outputs });
    analysed.push(id);
  }

  // Issues on nodes the output does not depend on are not blocking.
  for (let i = nodeDiagStart; i < diags.length; i++) {
    const d = diags[i]!;
    if (d.severity === "error" && d.nodeId && DOWNGRADABLE.has(d.code) && rootId && !reachable.has(d.nodeId)) {
      diags[i] = { ...d, severity: "warning", message: `${d.message} (node is not connected to the output)` };
    }
  }

  return { flat, order: analysed, info, diagnostics: diags, rootId, reachable };
}
