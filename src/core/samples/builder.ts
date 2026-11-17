import { createGraph, createNode, type NodeInit } from "../graph/create";
import { applyOperation } from "../graph/ops/apply";
import { ops } from "../graph/ops/make";
import type { GraphOp } from "../graph/ops/types";
import type { Graph } from "../graph/types";

/** Tiny fluent builder used by the sample graphs and by tests (every step is a real graph operation). */
export class SampleBuilder {
  g: Graph;
  private x = 0;
  private scope: string | undefined;
  constructor(patch: Partial<Graph> = {}) {
    this.g = createGraph(patch);
  }
  /** Direct following `n`/`w` calls into a subgraph body (`undefined` = main graph again). */
  inScope(scope?: string): this {
    this.scope = scope;
    return this;
  }
  apply(op: GraphOp): this {
    this.g = applyOperation(this.g, op).graph;
    return this;
  }
  /** Add a node; positions advance left→right in columns unless given. */
  n(id: string, defId: string, init: NodeInit = {}, col?: number, row = 0): this {
    if (col !== undefined) this.x = col;
    const position = init.position ?? { x: this.x * 220, y: row * 150 };
    return this.apply(ops.addNode(createNode(id, defId, { ...init, position }), this.scope));
  }
  /** Connect "node.port" → "node.port". */
  w(from: string, to: string): this {
    const [fn, fp] = from.split(".") as [string, string];
    const [tn, tp] = to.split(".") as [string, string];
    return this.apply(ops.connect({ node: fn, port: fp }, { node: tn, port: tp }, this.scope));
  }
  build(): Graph {
    return this.g;
  }
}
