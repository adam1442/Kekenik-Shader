import type { Keyword, Property } from "../../properties/model";
import type { Comment, Group, NodeInstance, ParamValue, PortRef, PortValue, SubgraphDef, Vec2 } from "../types";
import type { GraphOp, NodeMetaPatch } from "./types";

/** Convenience constructors for operations (all return plain data). */
export const ops = {
  addNode: (node: NodeInstance, scope?: string): GraphOp =>
    scope === undefined ? { type: "addNode", node } : { type: "addNode", node, scope },
  removeNode: (id: string, scope?: string): GraphOp =>
    scope === undefined ? { type: "removeNode", id } : { type: "removeNode", id, scope },
  moveNodes: (moves: Array<{ id: string; position: Vec2 }>, scope?: string): GraphOp =>
    scope === undefined ? { type: "moveNodes", moves } : { type: "moveNodes", moves, scope },
  connect: (from: PortRef, to: PortRef, scope?: string): GraphOp =>
    scope === undefined ? { type: "connect", from, to } : { type: "connect", from, to, scope },
  disconnect: (edgeId: string, scope?: string): GraphOp =>
    scope === undefined ? { type: "disconnect", edgeId } : { type: "disconnect", edgeId, scope },
  setParam: (node: string, param: string, value: ParamValue, scope?: string): GraphOp =>
    scope === undefined ? { type: "setParam", node, param, value } : { type: "setParam", node, param, value, scope },
  setPortValue: (node: string, port: string, value: PortValue | null, scope?: string): GraphOp =>
    scope === undefined
      ? { type: "setPortValue", node, port, value }
      : { type: "setPortValue", node, port, value, scope },
  setNodeMeta: (node: string, patch: NodeMetaPatch, scope?: string): GraphOp =>
    scope === undefined ? { type: "setNodeMeta", node, patch } : { type: "setNodeMeta", node, patch, scope },
  addProperty: (item: Property, index?: number): GraphOp => ({
    type: "collAdd",
    coll: "properties",
    item,
    ...(index === undefined ? {} : { index }),
  }),
  updateProperty: (id: string, patch: Partial<Property>): GraphOp => ({
    type: "collUpdate",
    coll: "properties",
    id,
    patch,
  }),
  removeProperty: (id: string): GraphOp => ({ type: "collRemove", coll: "properties", id }),
  moveProperty: (id: string, toIndex: number): GraphOp => ({ type: "collMove", coll: "properties", id, toIndex }),
  addKeyword: (item: Keyword): GraphOp => ({ type: "collAdd", coll: "keywords", item }),
  removeKeyword: (id: string): GraphOp => ({ type: "collRemove", coll: "keywords", id }),
  addGroup: (item: Group, scope?: string): GraphOp => ({
    type: "collAdd",
    coll: "groups",
    item,
    ...(scope === undefined ? {} : { scope }),
  }),
  updateGroup: (id: string, patch: Partial<Group>, scope?: string): GraphOp => ({
    type: "collUpdate",
    coll: "groups",
    id,
    patch,
    ...(scope === undefined ? {} : { scope }),
  }),
  removeGroup: (id: string, scope?: string): GraphOp => ({
    type: "collRemove",
    coll: "groups",
    id,
    ...(scope === undefined ? {} : { scope }),
  }),
  addComment: (item: Comment, scope?: string): GraphOp => ({
    type: "collAdd",
    coll: "comments",
    item,
    ...(scope === undefined ? {} : { scope }),
  }),
  updateComment: (id: string, patch: Partial<Comment>, scope?: string): GraphOp => ({
    type: "collUpdate",
    coll: "comments",
    id,
    patch,
    ...(scope === undefined ? {} : { scope }),
  }),
  removeComment: (id: string, scope?: string): GraphOp => ({
    type: "collRemove",
    coll: "comments",
    id,
    ...(scope === undefined ? {} : { scope }),
  }),
  addSubgraphDef: (def: SubgraphDef): GraphOp => ({ type: "addSubgraphDef", def }),
  updateSubgraphDef: (id: string, patch: Partial<Pick<SubgraphDef, "name" | "inputs" | "outputs">>): GraphOp => ({
    type: "updateSubgraphDef",
    id,
    patch,
  }),
  removeSubgraphDef: (id: string): GraphOp => ({ type: "removeSubgraphDef", id }),
  setSettings: (patch: Record<string, ParamValue | null>): GraphOp => ({ type: "setSettings", patch }),
  setProfile: (profileId: string): GraphOp => ({ type: "setProfile", profileId }),
  setGraphName: (name: string): GraphOp => ({ type: "setGraphName", name }),
  transaction: (list: GraphOp[]): GraphOp => ({ type: "transaction", ops: list }),
};
