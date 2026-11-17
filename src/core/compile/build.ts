import type { SceneTarget } from "../engine/targets";
import { type Diagnostic, type DiagnosticExtra, makeDiagnostic } from "../diagnostics";
import { portKey } from "../graph/query";
import { SUBGRAPH_PARAM } from "../graph/subgraph";
import { DEF_SUBGRAPH, DEF_SUBGRAPH_INPUTS, type Graph } from "../graph/types";
import { IRBuilder, createBuilderEnv } from "../ir/builder";
import { emitConversion } from "../ir/convert";
import { builtinInputType } from "../ir/inputs";
import { type ExprId, type IRFunction, type IRModule, type IRUniform, MAIN_BODY } from "../ir/types";
import { storageOf } from "../types/shaderType";
import { type BuildContext, paramOf } from "../registry/nodeDef";
import type { ProfileDef } from "../registry/profile";
import type { BodyAnalysis } from "./infer";
import { coerceValue } from "./values";
import { type KeywordValues, keywordUniformId, resolveKeywordValues } from "../properties/keywords";
import { makeProperty } from "../properties/model";

/** Thrown when an upstream node failed to build; the dependent is skipped silently (the root cause is already reported). */
class CascadeSkip extends Error {}

export interface BuildInput {
  graph: Graph;
  profile: ProfileDef;
  main: BodyAnalysis;
  subgraph: (id: string) => BodyAnalysis;
  /** Variant being built: keyword id → value (missing ids use the keyword default). */
  keywordValues?: KeywordValues;
  /** Keep non-`static` keywords as runtime selectors (real shader variants) instead of baking the branch. Default: false. */
  runtimeKeywords?: boolean;
  /** Compile-time target exposed to nodes as `BuildContext.target`. Default: glsl. */
  target?: SceneTarget;
  isPreview?: boolean;
}

/** Build the IR module from analysed bodies. Only nodes the master output depends on are built. */
export function buildModule(input: BuildInput): { module: IRModule; diagnostics: Diagnostic[] } {
  const { graph, profile } = input;
  const env = createBuilderEnv();
  const functions: IRFunction[] = [];
  const uniforms = new Map<string, IRUniform>();
  const diagnostics: Diagnostic[] = [];
  const building = new Set<string>();
  const done = new Set<string>();
  const keywordValues = resolveKeywordValues(graph.keywords, input.keywordValues);

  function inputExpr(
    b: IRBuilder,
    a: BodyAnalysis,
    values: Map<string, ExprId>,
    nodeId: string,
    portId: string,
    scope?: string,
  ): ExprId | undefined {
    const res = a.info.get(nodeId)!.inputs[portId]!;
    b.setSource({ nodeId, portId, ...(scope === undefined ? {} : { scope }) });
    if (res.edge) {
      const src = values.get(portKey(res.edge.from.node, res.edge.from.port));
      if (src === undefined) throw new CascadeSkip();
      return emitConversion(b, src, res.source!, res.target);
    }
    const v = a.flat.nodes[nodeId]!.values[portId] ?? res.port.default;
    if (v !== undefined) {
      const c = coerceValue(res.target, v);
      if (!c) throw new Error(`Invalid inline value for input "${portId}"`);
      return b.constOf(storageOf(res.target), c);
    }
    if (res.port.defaultInput) {
      const { input: inp, space } = res.port.defaultInput;
      const x = b.input(inp, space);
      return emitConversion(b, x, builtinInputType(inp, space), res.target);
    }
    return undefined;
  }

  function makeContext(
    b: IRBuilder,
    a: BodyAnalysis,
    values: Map<string, ExprId>,
    nodeId: string,
    scope?: string,
  ): BuildContext {
    const node = a.flat.nodes[nodeId]!;
    const info = a.info.get(nodeId)!;
    const fail = (message: string): never => {
      throw new Error(message);
    };
    return {
      b,
      node,
      graph,
      scope,
      in: (port) => {
        if (!info.inputs[port]) return fail(`Node has no input "${port}"`);
        const e = inputExpr(b, a, values, nodeId, port, scope);
        if (e === undefined) return fail(`Input "${port}" is not connected and has no default`);
        return e;
      },
      connected: (port) => !!info.inputs[port]?.edge,
      inType: (port) => info.inputs[port]?.target ?? fail(`Node has no input "${port}"`),
      outType: (port) => info.outputs[port] ?? fail(`Node has no output "${port}"`),
      param: <T>(id: string) => paramOf(info.def, node, id) as T,
      uniform: (propId) => {
        const p = graph.properties.find((x) => x.id === propId);
        if (!p) return fail(`Unknown property "${propId}"`);
        const ty = storageOf(p.type);
        if (!uniforms.has(p.id)) uniforms.set(p.id, { prop: p.id, ty, property: p });
        return b.uniform(p.id, ty);
      },
      property: (id) => graph.properties.find((x) => x.id === id),
      keyword: (id) => keywordValues[id] ?? 0,
      keywordSelector: (id) => {
        const k = graph.keywords.find((x) => x.id === id);
        if (!input.runtimeKeywords || !k || k.definition === "static") return undefined;
        const prop = keywordUniformId(id);
        if (!uniforms.has(prop))
          uniforms.set(prop, {
            prop,
            ty: "int",
            property: makeProperty(prop, k.displayName, "int", {
              referenceName: k.referenceName,
              exposed: false,
              default: k.default,
            }),
          });
        return b.uniform(prop, "int");
      },
      subgraph: (id) => graph.subgraphDefs[id],
      fail,
      warn: (code, message) =>
        void diagnostics.push(makeDiagnostic(code, message, { nodeId, ...(scope === undefined ? {} : { scope }) })),
      target: input.target ?? "glsl",
      isPreview: input.isPreview === true,
    } as BuildContext;
  }

  /** Build all reachable non-root nodes of a body in dependency order. Returns `node:port` → expr. */
  function buildNodes(b: IRBuilder, a: BodyAnalysis, scope?: string): Map<string, ExprId> {
    const values = new Map<string, ExprId>();
    const extra = (nodeId: string): DiagnosticExtra => ({ nodeId, ...(scope === undefined ? {} : { scope }) });
    for (const id of a.order) {
      if (id === a.rootId || !a.reachable.has(id)) continue;
      const info = a.info.get(id)!;
      const node = a.flat.nodes[id]!;
      b.setSource({ nodeId: id, ...(scope === undefined ? {} : { scope }) });
      try {
        if (info.def.id === DEF_SUBGRAPH_INPUTS) {
          const sg = scope === undefined ? undefined : graph.subgraphDefs[scope];
          (sg?.inputs ?? []).forEach((p, i) => values.set(portKey(id, p.id), b.param(i, storageOf(p.type))));
          continue;
        }
        if (info.def.id === DEF_SUBGRAPH) {
          const target = node.params[SUBGRAPH_PARAM];
          if (typeof target === "string" && graph.subgraphDefs[target]) ensureFunction(target);
        }
        if (!info.def.build) continue;
        const out = info.def.build(makeContext(b, a, values, id, scope));
        for (const p of info.ports.outputs) {
          const e = out[p.id];
          if (e === undefined) throw new Error(`Node did not produce output "${p.id}"`);
          const want = storageOf(info.outputs[p.id]!);
          if (b.typeOf(e) !== want)
            throw new Error(`Output "${p.id}" must be ${want} but the node produced ${b.typeOf(e)}`);
          values.set(portKey(id, p.id), e);
        }
      } catch (err) {
        if (err instanceof CascadeSkip) continue;
        diagnostics.push(
          makeDiagnostic(
            "E_BUILD_FAILED",
            `Node "${info.def.name}" failed to build: ${(err as Error).message}`,
            extra(id),
          ),
        );
      }
    }
    return values;
  }

  function ensureFunction(id: string): void {
    if (done.has(id) || building.has(id)) return;
    building.add(id);
    const def = graph.subgraphDefs[id]!;
    const a = input.subgraph(id);
    const b = new IRBuilder(id, env);
    const values = buildNodes(b, a, id);
    const ret: ExprId[] = [];
    const returns = def.outputs.map((p) => ({ name: p.name, ty: storageOf(p.type) }));
    if (a.rootId) {
      for (const p of def.outputs) {
        try {
          const e = inputExpr(b, a, values, a.rootId, p.id, id);
          if (e === undefined) throw new Error(`Output "${p.name}" has no value`);
          ret.push(e);
        } catch (err) {
          if (!(err instanceof CascadeSkip))
            diagnostics.push(
              makeDiagnostic("E_BUILD_FAILED", `Subgraph "${def.name}": ${(err as Error).message}`, {
                nodeId: a.rootId,
                scope: id,
              }),
            );
        }
      }
    }
    const params = def.inputs.map((p) => ({ name: p.name, ty: storageOf(p.type) }));
    env.functions.set(id, { params, returns });
    functions.push({ id, name: def.name, params, returns, body: b.body, ret });
    building.delete(id);
    done.add(id);
  }

  // ---- main body ---------------------------------------------------------------------------------------
  const main = input.main;
  const b = new IRBuilder(MAIN_BODY, env);
  const values = buildNodes(b, main);
  const outputs: IRModule["outputs"] = [];
  if (main.rootId) {
    const masterInputs = main.info.get(main.rootId)!.inputs;
    for (const block of profile.masterBlocks) {
      if (!masterInputs[block.id]) continue; // optional block removed from the Master Stack: the backend uses the block default
      const sw = block.shownWhen;
      if (sw && (input.graph.settings[sw.setting] ?? sw.default) !== sw.equals) continue; // inactive block: wire kept, value ignored
      try {
        const e = inputExpr(b, main, values, main.rootId, block.id);
        if (e !== undefined) outputs.push({ slot: block.id, value: e, stage: block.stage });
      } catch (err) {
        if (!(err instanceof CascadeSkip))
          diagnostics.push(
            makeDiagnostic("E_BUILD_FAILED", `Master block "${block.label}": ${(err as Error).message}`, {
              nodeId: main.rootId,
              portId: block.id,
            }),
          );
      }
    }
  }

  const module: IRModule = {
    irVersion: 1,
    profileId: profile.id,
    // Declaration order = the order of the graph's property list (stable under node re-ordering / save & load).
    uniforms: [...uniforms.values()].sort((a, b) => propertyIndex(graph, a.prop) - propertyIndex(graph, b.prop)),
    customBlocks: [...env.customBlocks.values()],
    functions,
    main: b.body,
    outputs,
    sourceMap: env.sourceMap,
  };
  return { module, diagnostics };
}

const propertyIndex = (graph: Graph, id: string): number => graph.properties.findIndex((p) => p.id === id);
