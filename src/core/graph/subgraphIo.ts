import type { Property } from "../properties/model";
import { KEYWORD_PARAM } from "../nodes/keyword";
import { PROPERTY_PARAM } from "../nodes/propertyTexture";
import { stableStringify } from "../serialization/stable";
import { ops } from "./ops/make";
import type { GraphOp } from "./ops/types";
import { SUBGRAPH_PARAM, subgraphRefs } from "./subgraph";
import { DEF_SUBGRAPH, type Graph, type GraphBody, type SubgraphDef } from "./types";
import type { Keyword } from "../properties/model";

/** `.kshadersub`: one subgraph + every subgraph it (transitively) instantiates + the properties / keywords its nodes read. */
const KSHADERSUB_FORMAT = "kshadersub";
const KSHADERSUB_VERSION = 1;

interface SubgraphBundle {
  format: typeof KSHADERSUB_FORMAT;
  version: number;
  generator: string;
  root: string;
  defs: Record<string, SubgraphDef>;
  properties: Property[];
  keywords: Keyword[];
}

/** Subgraph ids needed by `defId` (itself first, then dependencies). */
function subgraphClosure(graph: Graph, defId: string): string[] {
  const out: string[] = [];
  const visit = (id: string) => {
    if (out.includes(id) || !graph.subgraphDefs[id]) return;
    out.push(id);
    subgraphRefs(graph.subgraphDefs[id]!).forEach(visit);
  };
  visit(defId);
  return out;
}

const readsParam = (body: GraphBody, param: string): string[] =>
  Object.values(body.nodes)
    .map((n) => n.params[param])
    .filter((v): v is string => typeof v === "string");

function buildSubgraphBundle(graph: Graph, defId: string): SubgraphBundle | null {
  const ids = subgraphClosure(graph, defId);
  if (!ids.length) return null;
  const defs = Object.fromEntries(ids.map((i) => [i, graph.subgraphDefs[i]!]));
  const props = new Set(ids.flatMap((i) => readsParam(defs[i]!, PROPERTY_PARAM)));
  const kws = new Set(ids.flatMap((i) => readsParam(defs[i]!, KEYWORD_PARAM)));
  return {
    format: KSHADERSUB_FORMAT,
    version: KSHADERSUB_VERSION,
    generator: "Kekenik Shader",
    root: defId,
    defs,
    properties: graph.properties.filter((p) => props.has(p.id)),
    keywords: graph.keywords.filter((k) => kws.has(k.id)),
  };
}

/** Deterministic text of a `.kshadersub` file (also the clipboard payload for copy/paste across projects). */
export const exportSubgraph = (graph: Graph, defId: string): string | null => {
  const b = buildSubgraphBundle(graph, defId);
  return b ? stableStringify(b) : null;
};

export type ImportResult = { ok: true; ops: GraphOp[]; rootId: string; names: string[] } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * Validate a `.kshadersub` text and turn it into operations on `graph`. Ids that already exist get fresh ids
 * (`makeId(base)` must return an unused one); instances inside the imported defs are re-pointed. Properties /
 * keywords with an id that already exists are assumed to be the same and are not added twice.
 */
export function importSubgraph(graph: Graph, text: string, makeId: (base: string) => string): ImportResult {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { ok: false, error: "Not valid JSON" };
  }
  if (!isObj(doc) || doc.format !== KSHADERSUB_FORMAT)
    return { ok: false, error: "Not a Kekenik Shader subgraph (.kshadersub)" };
  if (typeof doc.version !== "number" || doc.version > KSHADERSUB_VERSION)
    return { ok: false, error: "Unsupported .kshadersub version" };
  if (typeof doc.root !== "string" || !isObj(doc.defs) || !isObj(doc.defs[doc.root]))
    return { ok: false, error: "The file has no root subgraph" };
  const defs = doc.defs as Record<string, SubgraphDef>;
  for (const [k, d] of Object.entries(defs)) {
    if (
      !isObj(d) ||
      d.id !== k ||
      typeof d.name !== "string" ||
      !Array.isArray(d.inputs) ||
      !Array.isArray(d.outputs) ||
      !isObj(d.nodes) ||
      !isObj(d.edges)
    )
      return { ok: false, error: `Subgraph "${k}" is malformed` };
  }
  const remap = new Map<string, string>();
  for (const id of Object.keys(defs)) remap.set(id, graph.subgraphDefs[id] ? makeId(id) : id);
  const taken = new Set(Object.values(graph.subgraphDefs).map((d) => d.name));
  const list: GraphOp[] = [];
  const names: string[] = [];
  for (const [id, d] of Object.entries(defs)) {
    const nodes = Object.fromEntries(
      Object.entries(d.nodes).map(([nid, n]) => [
        nid,
        n.defId === DEF_SUBGRAPH && remap.has(String(n.params?.[SUBGRAPH_PARAM]))
          ? { ...n, params: { ...n.params, [SUBGRAPH_PARAM]: remap.get(String(n.params[SUBGRAPH_PARAM]))! } }
          : n,
      ]),
    );
    let name = d.name;
    for (let i = 2; taken.has(name); i++) name = `${d.name} ${i}`;
    taken.add(name);
    names.push(name);
    list.push(ops.addSubgraphDef({ ...d, id: remap.get(id)!, name, nodes }));
  }
  const have = new Set(graph.properties.map((p) => p.id));
  for (const p of (Array.isArray(doc.properties) ? doc.properties : []) as Property[])
    if (isObj(p) && typeof p.id === "string" && !have.has(p.id)) list.push(ops.addProperty(p));
  const haveK = new Set(graph.keywords.map((k) => k.id));
  for (const k of (Array.isArray(doc.keywords) ? doc.keywords : []) as Keyword[])
    if (isObj(k) && typeof k.id === "string" && !haveK.has(k.id)) list.push(ops.addKeyword(k));
  return { ok: true, ops: list, rootId: remap.get(doc.root)!, names };
}
