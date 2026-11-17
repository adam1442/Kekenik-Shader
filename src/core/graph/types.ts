import type { Keyword, Property } from "../properties/model";
import type { ShaderType } from "../types/shaderType";

/** Immutable graph data. All of it is plain JSON-compatible (no classes, no undefined-valued keys needed). */
export type PortValue = number | boolean | number[];
export type ParamValue = string | number | boolean | number[];

export interface Vec2 {
  x: number;
  y: number;
}

export interface NodeInstance {
  id: string;
  /** Registry id of the NodeDef (stable forever). */
  defId: string;
  position: Vec2;
  /** Inline values of unconnected input ports, keyed by port id. */
  values: Record<string, PortValue>;
  /** Node parameters (UI control values), keyed by param id. */
  params: Record<string, ParamValue>;
  label?: string;
  color?: string;
  previewEnabled: boolean;
  /** UI: node is shown as a header-only pill (added by ; absent = expanded). */
  collapsed?: boolean;
}

export interface PortRef {
  node: string;
  port: string;
}

export interface Edge {
  /** Deterministic: `fromNode:fromPort>toNode:toPort`. */
  id: string;
  from: PortRef;
  to: PortRef;
}

export const edgeId = (from: PortRef, to: PortRef): string => `${from.node}:${from.port}>${to.node}:${to.port}`;

/** Nodes + edges: shared by the main graph and subgraph definitions. */
export interface GraphBody {
  nodes: Record<string, NodeInstance>;
  edges: Record<string, Edge>;
}

export interface Rect4 {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A frame around nodes. `nodeIds` are the nodes adopted by the group (innermost group wins); `rect` is the frame (absent = fit to members). */
export interface Group {
  id: string;
  title: string;
  color?: string;
  nodeIds: string[];
  rect?: Rect4;
  /** U11: folded to its title bar (members hidden, wires attach to the border). Absent = expanded; persisted only when true. */
  collapsed?: boolean;
}

export interface Comment {
  id: string;
  text: string;
  position: Vec2;
  size: { w: number; h: number };
  color?: string;
}

export interface SubgraphPort {
  id: string;
  name: string;
  type: ShaderType;
  /** Default inline value of the corresponding input on instances. */
  default?: PortValue;
  tooltip?: string;
  /** Optional input: an instance may leave it unconnected (it then uses `default`, or the type's zero value). */
  optional?: boolean;
}

export interface SubgraphDef extends GraphBody {
  id: string;
  name: string;
  /** Sticky notes / frames of the subgraph canvas (same shape as on the main graph). */
  groups?: Group[];
  comments?: Comment[];
  /** Ordered. */
  inputs: SubgraphPort[];
  outputs: SubgraphPort[];
}

export interface Graph extends GraphBody {
  id: string;
  name: string;
  properties: Property[];
  keywords: Keyword[];
  groups: Group[];
  comments: Comment[];
  subgraphDefs: Record<string, SubgraphDef>;
  profileId: string;
  settings: Record<string, ParamValue>;
}

/** Structural nodes carry no shader semantics and are removed by the flatten pass. */
const STRUCTURAL_DEFS = ["reroute", "portalIn", "portalOut"] as const;
export const isStructuralDefId = (defId: string): boolean => (STRUCTURAL_DEFS as readonly string[]).includes(defId);

/** Well-known def ids used by the compile pipeline. */
export const DEF_MASTER = "masterOutput";
export const DEF_SUBGRAPH = "subgraph";
export const DEF_SUBGRAPH_INPUTS = "subgraphInputs";
export const DEF_SUBGRAPH_OUTPUTS = "subgraphOutputs";
