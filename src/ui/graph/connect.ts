import {
  type Graph,
  type GraphAnalysis,
  type PortDef,
  type PortRef,
  type ShaderType,
  type TypeSpec,
  canConvert,
  isMathCandidate,
  isStructuralDefId,
  traceSource,
  wouldCreateCycleThroughPortals,
} from "@/core";
import type { PortDir, SceneIndex } from "./sceneIndex";

/** Inputs of the connection checks (all pure; `analysis` supplies resolved generic types when available). */
export interface ConnectCtx {
  graph: Graph;
  scene: SceneIndex;
  analysis?: GraphAnalysis | null;
}

export interface EndPoint extends PortRef {
  dir: PortDir;
}

export type ConnectResult =
  | {
      ok: true;
      from: PortRef;
      to: PortRef;
      /** Existing wire that will be replaced (an input has one wire). */ replaces?: string;
    }
  | { ok: false; reason: string };

const findPort = (ctx: ConnectCtx, ref: PortRef, dir: PortDir): PortDef | undefined => {
  const s = ctx.scene.get(ref.node);
  return (dir === "out" ? s?.outputs : s?.inputs)?.find((p) => p.id === ref.port);
};

/** Resolved (post-inference) type of an output port; generic outputs fall back to `float` before the first analysis. */
export function outputType(ctx: ConnectCtx, ref: PortRef): ShaderType | undefined {
  const sn = ctx.graph.nodes[ref.node];
  if (sn && isStructuralDefId(sn.defId)) return structuralType(ctx, ref.node);
  const resolved = ctx.analysis?.main.info.get(ref.node)?.outputs[ref.port];
  if (resolved) return resolved;
  const p = findPort(ctx, ref, "out");
  if (!p) return undefined;
  return p.type.k === "type" ? p.type.type : "float";
}

/** Type a reroute / portal currently carries = type of the real output feeding it (undefined while unconnected). */
export function structuralType(ctx: ConnectCtx, nodeId: string): ShaderType | undefined {
  const src =
    traceSource(ctx.graph, { node: nodeId, port: "out" }) ?? traceSource(ctx.graph, { node: nodeId, port: "in" });
  if (!src || src.via.length === 0) return undefined;
  const first = src.from;
  return outputType(ctx, first);
}

/** Resolved type of an input port (what it currently receives). */
export function inputType(ctx: ConnectCtx, ref: PortRef): ShaderType | undefined {
  const sn = ctx.graph.nodes[ref.node];
  if (sn && isStructuralDefId(sn.defId)) return structuralType(ctx, ref.node);
  const resolved = ctx.analysis?.main.info.get(ref.node)?.inputs[ref.port]?.target;
  if (resolved) return resolved;
  const p = findPort(ctx, ref, "in");
  if (!p) return undefined;
  return p.type.k === "type" ? p.type.type : "float";
}

/** Can a source of type `src` feed an input declared as `spec`? */
export function acceptsSource(spec: TypeSpec, src: ShaderType): boolean {
  if (spec.k === "type") return canConvert(src, spec.type);
  if (spec.k === "generic") return isMathCandidate(src);
  return true;
}

/** Can an output declared as `spec` feed an input of resolved type `dst`? (generic / sameAs outputs: assume yes, the pipeline diagnoses the rest.) */
export function outputFeeds(spec: TypeSpec, dst: ShaderType, dstSpec?: TypeSpec): boolean {
  if (spec.k !== "type") return dstSpec ? dstSpec.k !== "type" || canConvert("float", dstSpec.type) : true;
  return dstSpec ? acceptsSource(dstSpec, spec.type) : canConvert(spec.type, dst);
}

/** Validate a connection between two endpoints in either drag direction. */
export function checkConnection(ctx: ConnectCtx, a: EndPoint, b: EndPoint): ConnectResult {
  if (a.dir === b.dir)
    return { ok: false, reason: a.dir === "out" ? "Connect an output to an input" : "Connect an input to an output" };
  const [from, to] = a.dir === "out" ? [a, b] : [b, a];
  if (from.node === to.node) return { ok: false, reason: "A node cannot be connected to itself" };
  const fromPort = findPort(ctx, from, "out");
  const toPort = findPort(ctx, to, "in");
  if (!fromPort || !toPort) return { ok: false, reason: "Unknown port" };
  const src = outputType(ctx, from);
  const toStructural = isStructuralDefId(ctx.graph.nodes[to.node]?.defId ?? "");
  if (src && !toStructural && !acceptsSource(toPort.type, src)) {
    const dst = toPort.type.k === "type" ? toPort.type.type : "numeric types";
    return { ok: false, reason: `Cannot convert ${src} to ${dst}` };
  }
  if (wouldCreateCycleThroughPortals(ctx.graph, from.node, to.node))
    return { ok: false, reason: "This connection would create a cycle" };
  const existing = Object.values(ctx.graph.edges).find((e) => e.to.node === to.node && e.to.port === to.port);
  return {
    ok: true,
    from: { node: from.node, port: from.port },
    to: { node: to.node, port: to.port },
    ...(existing ? { replaces: existing.id } : {}),
  };
}

export const isCompatible = (ctx: ConnectCtx, anchor: EndPoint, candidate: EndPoint): boolean =>
  checkConnection(ctx, anchor, candidate).ok;
