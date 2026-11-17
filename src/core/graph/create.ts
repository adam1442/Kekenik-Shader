import type { Graph, NodeInstance, ParamValue, PortValue, Vec2 } from "./types";

export const CORE_DEBUG_PROFILE_ID = "debug";

export function createGraph(patch: Partial<Graph> = {}): Graph {
  return {
    id: "graph",
    name: "Untitled",
    nodes: {},
    edges: {},
    properties: [],
    keywords: [],
    groups: [],
    comments: [],
    subgraphDefs: {},
    profileId: CORE_DEBUG_PROFILE_ID,
    settings: {},
    ...patch,
  };
}

export interface NodeInit {
  position?: Vec2;
  values?: Record<string, PortValue>;
  params?: Record<string, ParamValue>;
  label?: string;
  color?: string;
  previewEnabled?: boolean;
}

export function createNode(id: string, defId: string, init: NodeInit = {}): NodeInstance {
  const n: NodeInstance = {
    id,
    defId,
    position: init.position ?? { x: 0, y: 0 },
    values: init.values ?? {},
    params: init.params ?? {},
    previewEnabled: init.previewEnabled ?? false,
  };
  if (init.label !== undefined) n.label = init.label;
  if (init.color !== undefined) n.color = init.color;
  return n;
}

/**
 * Id generator. Pass a seed for deterministic ids (tests); without one ids include a random component.
 * Operations never generate ids themselves (they stay pure) — callers do, with this.
 */
export function createIdGenerator(seed?: string): (prefix?: string) => string {
  let n = 0;
  const salt = seed ?? Math.random().toString(36).slice(2, 8);
  return (prefix = "id") => `${prefix}_${salt}${(++n).toString(36)}`;
}
