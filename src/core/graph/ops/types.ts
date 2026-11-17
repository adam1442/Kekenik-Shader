import type { Keyword, Property } from "../../properties/model";
import type { Comment, Edge, Group, NodeInstance, ParamValue, PortRef, PortValue, SubgraphDef, Vec2 } from "../types";

/**
 * Pure graph mutations. `applyOperation(graph, op)` → `{graph, inverse}`; applying `inverse` to the result
 * restores the original graph exactly. Operations carry every id they need (they never generate ids).
 *
 * `scope` selects a subgraph body (undefined = the main graph).
 */
interface CollTypes {
  properties: Property;
  keywords: Keyword;
  groups: Group;
  comments: Comment;
}
export type CollName = keyof CollTypes;
export const COLL_NAMES: readonly CollName[] = ["properties", "keywords", "groups", "comments"];

/** `scope` (a subgraph id) is honoured for the `groups` / `comments` collections only; properties and keywords are project-wide. */
type CollAdd = {
  [K in CollName]: { type: "collAdd"; coll: K; item: CollTypes[K]; index?: number; scope?: string };
}[CollName];
type CollUpdate = {
  [K in CollName]: { type: "collUpdate"; coll: K; id: string; patch: Partial<CollTypes[K]>; scope?: string };
}[CollName];

export interface NodeMetaPatch {
  /** `null` clears. */
  label?: string | null;
  color?: string | null;
  previewEnabled?: boolean;
  collapsed?: boolean;
}

/** Low-level "set these keys" operation; every other operation compiles to one and the inverse of any op is one. */
export interface PatchOp {
  type: "patch";
  scope?: string;
  /** id → new node, or null to delete. */
  nodes?: Record<string, NodeInstance | null>;
  edges?: Record<string, Edge | null>;
  coll?: Partial<{ [K in CollName]: CollTypes[K][] }>;
  subgraphDefs?: Record<string, SubgraphDef | null>;
  settings?: Record<string, ParamValue>;
  profileId?: string;
  name?: string;
}

/** Scoped collections live inside the subgraph definition. */
export const SCOPED_COLLS: readonly CollName[] = ["groups", "comments"];

export type GraphOp =
  | { type: "addNode"; scope?: string; node: NodeInstance }
  | { type: "removeNode"; scope?: string; id: string }
  | { type: "moveNodes"; scope?: string; moves: Array<{ id: string; position: Vec2 }> }
  | { type: "connect"; scope?: string; from: PortRef; to: PortRef }
  | { type: "disconnect"; scope?: string; edgeId: string }
  | { type: "setParam"; scope?: string; node: string; param: string; value: ParamValue }
  /** `null` clears the inline value (the port falls back to its default). */
  | { type: "setPortValue"; scope?: string; node: string; port: string; value: PortValue | null }
  | { type: "setNodeMeta"; scope?: string; node: string; patch: NodeMetaPatch }
  | CollAdd
  | CollUpdate
  | { type: "collRemove"; coll: CollName; id: string; scope?: string }
  | { type: "collMove"; coll: CollName; id: string; toIndex: number; scope?: string }
  | { type: "addSubgraphDef"; def: SubgraphDef }
  | { type: "updateSubgraphDef"; id: string; patch: Partial<Pick<SubgraphDef, "name" | "inputs" | "outputs">> }
  | { type: "removeSubgraphDef"; id: string }
  /** `null` values delete a setting. */
  | { type: "setSettings"; patch: Record<string, ParamValue | null> }
  | { type: "setProfile"; profileId: string }
  | { type: "setGraphName"; name: string }
  | { type: "transaction"; ops: GraphOp[] }
  | PatchOp;

export class GraphOpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GraphOpError";
  }
}
