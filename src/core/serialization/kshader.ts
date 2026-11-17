import { createGraph } from "../graph/create";
import type { Graph } from "../graph/types";
import {
  CURRENT_SCHEMA_VERSION,
  KSHADER_MIGRATIONS,
  type JsonObject,
  type Migration,
  MigrationError,
  migrateDocument,
} from "./migrations";
import { validateDocument } from "./schema";
import { stableStringify } from "./stable";

const KSHADER_FORMAT = "kshader";
export const KSHADER_EXTENSION = ".kshader";
const GENERATOR = "Kekenik Shader";

class KShaderParseError extends Error {
  constructor(
    message: string,
    readonly errors: string[] = [],
  ) {
    super(message);
    this.name = "KShaderParseError";
  }
}

/** U14: a subgraph definition never carries empty scoped `groups` / `comments` arrays (undo of a creation must be byte-identical to the original file). */
function normalizeDef(
  d: Graph["subgraphDefs"][string],
  node: (n: Graph["nodes"][string]) => Graph["nodes"][string],
): Graph["subgraphDefs"][string] {
  const { groups, comments, ...rest } = d;
  return {
    ...rest,
    nodes: Object.fromEntries(Object.entries(d.nodes).map(([nk, n]) => [nk, node(n)])),
    ...(groups?.length ? { groups } : {}),
    ...(comments?.length ? { comments } : {}),
  };
}

/** Fill defaults and drop unknown keys so that equal graphs always serialise identically. */
function normalizeGraph(g: Graph): Graph {
  const base = createGraph();
  const node = (n: Graph["nodes"][string]) => ({
    ...n,
    values: n.values ?? {},
    params: n.params ?? {},
    previewEnabled: n.previewEnabled ?? false,
  });
  return {
    id: g.id,
    name: g.name,
    profileId: g.profileId,
    nodes: Object.fromEntries(Object.entries(g.nodes).map(([k, n]) => [k, node(n)])),
    edges: g.edges,
    properties: g.properties ?? base.properties,
    keywords: g.keywords ?? base.keywords,
    groups: g.groups ?? base.groups,
    comments: g.comments ?? base.comments,
    subgraphDefs: Object.fromEntries(Object.entries(g.subgraphDefs ?? {}).map(([k, d]) => [k, normalizeDef(d, node)])),
    settings: g.settings ?? base.settings,
  };
}

/** Serialise to `.kshader` text. Deterministic: same graph → byte-identical output. */
export function serializeGraph(graph: Graph, generator: string = GENERATOR): string {
  const doc = {
    format: KSHADER_FORMAT,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    generator,
    graph: normalizeGraph(graph),
  };
  return stableStringify(doc, 2) + "\n";
}

export interface ParseResult {
  graph: Graph;
  /** Human-readable list of migrations that were applied. */
  migrated: string[];
}

/** Parse `.kshader` text: JSON → migrate → validate → Graph. Throws KShaderParseError with readable messages. */
export function parseKShader(
  text: string,
  migrations: readonly Migration[] = KSHADER_MIGRATIONS,
  target: number = CURRENT_SCHEMA_VERSION,
): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new KShaderParseError(`Not valid JSON: ${(e as Error).message}`);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    throw new KShaderParseError("The file does not contain a .kshader document (expected a JSON object)");
  let migrated: { doc: JsonObject; applied: string[] };
  try {
    migrated = migrateDocument(raw as JsonObject, migrations, target);
  } catch (e) {
    if (e instanceof MigrationError) throw new KShaderParseError(e.message);
    throw e;
  }
  const errors = validateDocument(migrated.doc);
  if (errors.length) throw new KShaderParseError(`Invalid .kshader document:\n - ${errors.join("\n - ")}`, errors);
  const graph = normalizeGraph((migrated.doc as unknown as { graph: Graph }).graph);
  return { graph, migrated: migrated.applied };
}
