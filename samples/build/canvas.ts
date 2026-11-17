/**
 * Canvas = the shared body builder of the Builder DSL (a sample's main graph AND every subgraph body).
 * Deterministic: ids are author-chosen (or derived from them), iteration order is insertion order, layout is a pure function.
 */
import { type Edge, type Group, type Comment, type NodeInstance, type ParamValue, type PortValue, createNode, edgeId } from "@/core";
import { type BlockSpec, type LayoutEnv, layoutBlocks, portsOf } from "./layout";

export interface NodeOpts {
  values?: Record<string, PortValue>;
  params?: Record<string, ParamValue>;
  label?: string;
  color?: string;
  /** Show the node thumbnail (per-node Preview toggle). */
  preview?: boolean;
}

/** Palette of the frames (Kekenik frame palette). */
export const COLORS = { blue: "#60a5fa", violet: "#a78bfa", green: "#4ade80", orange: "#fb923c", yellow: "#fbbf24", red: "#f87171", cyan: "#22d3ee", pink: "#f472b6" } as const;

export interface BlockOpts { col: number; row?: number; color?: string }

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

export class Block {
  constructor(readonly canvas: Canvas, readonly spec: BlockSpec) {}
  get id(): string { return this.spec.id; }
  /** Add a node to this block; returns its id. */
  n(id: string, defId: string, o: NodeOpts = {}): string { return this.canvas.addNode(this.spec.id, id, defId, o); }
  /** A Property node reading project property `propId` (one per block). */
  p(propId: string): string { return this.canvas.addNode(this.spec.id, `p_${propId}_${this.spec.id}`, "property", { params: { property: propId } }, true); }
  /** Output reference ("node.out") of this block's Property node for `propId` (creates it on first use). */
  po(propId: string): string { return `${this.p(propId)}.out`; }
  /** An instance of subgraph `subId`. */
  sub(id: string, subId: string, o: NodeOpts = {}): string { return this.canvas.addNode(this.spec.id, id, "subgraph", { ...o, params: { ...o.params, subgraph: subId } }); }
  /** Reroute knot. */
  r(id: string): string { return this.canvas.addNode(this.spec.id, id, "reroute", {}); }
}

export class Canvas {
  readonly nodes: Record<string, NodeInstance> = {};
  readonly edgeList: Edge[] = [];
  readonly blockSpecs: BlockSpec[] = [];
  private readonly owner = new Map<string, string>();
  private readonly portalIns = new Map<string, { id: string; block: string; from: string }>();
  private readonly portalOuts = new Set<string>();
  private readonly connected = new Set<string>();
  /** Loose boundary nodes (subgraph inputs / outputs). */
  protected readonly loose: string[] = [];

  constructor(protected env: LayoutEnv) {}

  block(id: string, title: string, note: string, o: BlockOpts): Block {
    if (this.blockSpecs.some((b) => b.id === id)) throw new Error(`Duplicate block "${id}"`);
    const spec: BlockSpec = { id, title, note, col: o.col, row: o.row ?? 0, ...(o.color ? { color: o.color } : {}), members: [] };
    this.blockSpecs.push(spec);
    return new Block(this, spec);
  }

  addNode(blockId: string | null, id: string, defId: string, o: NodeOpts, idempotent = false): string {
    if (this.nodes[id]) {
      if (idempotent) return id;
      throw new Error(`Duplicate node id "${id}"`);
    }
    const node = createNode(id, defId, { values: o.values ?? {}, params: o.params ?? {}, ...(o.label ? { label: o.label } : {}), ...(o.color ? { color: o.color } : {}), previewEnabled: o.preview ?? false });
    this.nodes[id] = node;
    if (blockId) {
      this.owner.set(id, blockId);
      this.blockSpecs.find((b) => b.id === blockId)!.members.push(id);
    } else this.loose.push(id);
    return id;
  }

  private split(ref: string, kind: "from" | "to"): [string, string] {
    const [n, p] = ref.split(".") as [string, string];
    const node = this.nodes[n];
    if (!node) throw new Error(`Wire ${kind} "${ref}": no node "${n}"`);
    const ports = portsOf(node, this.env);
    if (!(kind === "from" ? ports.outputs : ports.inputs).includes(p)) throw new Error(`Wire ${kind} "${ref}": node "${n}" (${node.defId}) has no ${kind === "from" ? "output" : "input"} "${p}" — has ${(kind === "from" ? ports.outputs : ports.inputs).join(", ")}`);
    return [n, p];
  }

  private edge(from: [string, string], to: [string, string]): void {
    const f = { node: from[0], port: from[1] }, t = { node: to[0], port: to[1] };
    const key = `${t.node}:${t.port}`;
    if (this.connected.has(key)) throw new Error(`Input ${t.node}.${t.port} is already connected`);
    this.connected.add(key);
    this.edgeList.push({ id: edgeId(f, t), from: f, to: t });
  }

  /**
   * Connect "node.port" → "node.port". With `via`, the wire is replaced by a Portal pair (channel = `via`): the Portal In sits in the
   * source's block, a Portal Out in the destination's block — the way long wires stay clean (docs/SAMPLES.md).
   */
  w(from: string, to: string, via?: string): this {
    const f = this.split(from, "from"), t = this.split(to, "to");
    if (!via) { this.edge(f, t); return this; }
    const ch = slug(via);
    let pin = this.portalIns.get(ch);
    if (!pin) {
      const block = this.owner.get(f[0]) ?? null;
      const id = this.addNode(block, `pi_${ch}`, "portalIn", { params: { channel: via } });
      pin = { id, block: block ?? "", from: from };
      this.portalIns.set(ch, pin);
      this.edge(f, [id, "in"]);
    } else if (pin.from !== from) throw new Error(`Portal channel "${via}" is already fed by ${pin.from}`);
    const key = `po_${ch}_${t[0]}_${t[1]}`;
    if (!this.portalOuts.has(key)) {
      this.portalOuts.add(key);
      this.addNode(this.owner.get(t[0]) ?? null, key, "portalOut", { params: { channel: via } });
    }
    this.edge([key, "out"], t);
    return this;
  }

  /** Wire several destinations from one source. */
  fan(from: string, tos: string[], via?: string): this { for (const t of tos) this.w(from, t, via); return this; }

  /** Lay everything out. Returns frames + positions (mutates node positions). */
  protected arrange(origin = { x: 0, y: 0 }): { groups: Group[]; comments: Comment[]; width: number; height: number } {
    const edges = this.edgeList.map((e) => ({ from: e.from.node, to: e.to.node }));
    const r = layoutBlocks(this.blockSpecs, this.nodes, edges, this.env, origin);
    for (const [id, p] of r.positions) this.nodes[id] = { ...this.nodes[id]!, position: p };
    return r;
  }

  edgesRecord(): Record<string, Edge> { return Object.fromEntries(this.edgeList.map((e) => [e.id, e])); }
}
