import type { NodeDef } from "../registry/nodeDef";

/** Fill in the boring defaults of a NodeDef. Authoring a node = `defineNode({...})` (see docs/NODE_AUTHORING.md). */
export function defineNode(def: Partial<NodeDef> & Pick<NodeDef, "id" | "category" | "name">): NodeDef {
  return { synonyms: [], description: "", inputs: [], outputs: [], params: [], ...def };
}
