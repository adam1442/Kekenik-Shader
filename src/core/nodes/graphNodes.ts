import { SUBGRAPH_PARAM } from "../graph/subgraph";
import { zeroValue } from "../graph/zero";
import { DEF_MASTER, DEF_SUBGRAPH, DEF_SUBGRAPH_INPUTS, DEF_SUBGRAPH_OUTPUTS, type SubgraphPort } from "../graph/types";
import type { PortDef } from "../registry/nodeDef";
import { visibleMasterEntries } from "../profiles/masterStack";
import { T } from "../types/generics";
import { defineNode } from "./define";

/** Master Output: its input ports are the master blocks of the active profile. */
export const masterOutputNode = defineNode({
  id: DEF_MASTER,
  category: "Master",
  name: "Master Output",
  description: "Final shader outputs; the available slots depend on the profile.",
  dynamicPorts: (_node, ctx) => ({
    // Vertex context first, then Fragment; removed optional blocks are skipped (a block with a live wire is always shown).
    inputs: (ctx.profile ? visibleMasterEntries(ctx.graph, ctx.profile) : []).map(
      ({ block: b, context, active }): PortDef => ({
        id: b.id,
        name: b.label,
        type: T(b.type),
        default: b.default,
        tag: b.tag,
        optional: !b.required,
        section: context,
        ...(active ? {} : { inactive: true }),
        ...(b.shownWhen
          ? {
              tooltip: `Only used while "${b.shownWhen.setting}" is ${String(b.shownWhen.equals)} in Graph Settings${active ? "" : " (currently off — the connection is kept but ignored)"}.`,
            }
          : {}),
      }),
    ),
    outputs: [],
  }),
});

/** Port of a subgraph I/O entry. Optional inputs fall back to their default (or the type's zero value). */
export function portOf(p: SubgraphPort, input: boolean): PortDef {
  const def = p.default ?? (input && p.optional ? zeroValue(p.type) : undefined);
  return {
    id: p.id,
    name: p.name,
    type: T(p.type),
    ...(def === undefined ? {} : { default: def }),
    ...(input && p.optional ? { optional: true } : {}),
    ...(p.tooltip ? { tooltip: p.tooltip } : {}),
  };
}

/** Instance of a subgraph definition; ports mirror the definition's signature and become an IR function call. */
export const subgraphNode = defineNode({
  id: DEF_SUBGRAPH,
  category: "Subgraph",
  name: "Subgraph",
  description: "Instance of a reusable subgraph.",
  params: [{ id: SUBGRAPH_PARAM, label: "Subgraph", control: "string", default: "" }],
  dynamicPorts: (node, ctx) => {
    const sg = ctx.graph.subgraphDefs[String(node.params[SUBGRAPH_PARAM] ?? "")];
    if (!sg) return { inputs: [], outputs: [] };
    return {
      inputs: sg.inputs.map((p): PortDef => portOf(p, true)),
      outputs: sg.outputs.map((p): PortDef => portOf(p, false)),
    };
  },
  validate: (node, ctx) => {
    const id = String(node.params[SUBGRAPH_PARAM] ?? "");
    return ctx.graph.subgraphDefs[id]
      ? []
      : [{ code: "E_UNKNOWN_SUBGRAPH", message: `Subgraph "${id}" does not exist` }];
  },
  build: (ctx) => {
    const sg = ctx.subgraph(String(ctx.node.params[SUBGRAPH_PARAM]))!;
    const args = sg.inputs.map((p) => ctx.in(p.id));
    return Object.fromEntries(sg.outputs.map((o, i) => [o.id, ctx.b.call(sg.id, args, i)]));
  },
});

/** Inside a subgraph: the function parameters. (Compiled specially: outputs become IR `param`s.) */
export const subgraphInputsNode = defineNode({
  id: DEF_SUBGRAPH_INPUTS,
  category: "Subgraph",
  name: "Subgraph Inputs",
  description: "The inputs of this subgraph.",
  dynamicPorts: (_n, ctx) => {
    const sg = ctx.scope ? ctx.graph.subgraphDefs[ctx.scope] : undefined;
    return {
      inputs: [],
      outputs: (sg?.inputs ?? []).map((p): PortDef => ({
        id: p.id,
        name: p.name,
        type: T(p.type),
        ...(p.tooltip ? { tooltip: p.tooltip } : {}),
      })),
    };
  },
});

/** Inside a subgraph: the return values. (Compiled specially: inputs become the function's `ret` list.) */
export const subgraphOutputsNode = defineNode({
  id: DEF_SUBGRAPH_OUTPUTS,
  category: "Subgraph",
  name: "Subgraph Outputs",
  description: "The outputs of this subgraph.",
  dynamicPorts: (_n, ctx) => {
    const sg = ctx.scope ? ctx.graph.subgraphDefs[ctx.scope] : undefined;
    return {
      inputs: (sg?.outputs ?? []).map((p): PortDef => ({
        id: p.id,
        name: p.name,
        type: T(p.type),
        default: p.default,
      })),
      outputs: [],
    };
  },
});
