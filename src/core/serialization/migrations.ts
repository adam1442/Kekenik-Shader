import { CORE_DEBUG_PROFILE_ID } from "../graph/create";
import { edgeId } from "../graph/types";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type JsonObject = { [k: string]: Json };

/** Current `.kshader` schema version. Bump together with a new entry in KSHADER_MIGRATIONS. */
export const CURRENT_SCHEMA_VERSION = 1;

export interface Migration {
  from: number;
  to: number;
  description: string;
  up(doc: JsonObject): JsonObject;
}

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationError";
  }
}

/** Run migrations until `doc.schemaVersion === target`. Each step must advance the version by exactly its declared range. */
export function migrateDocument(
  doc: JsonObject,
  migrations: readonly Migration[],
  target: number,
): { doc: JsonObject; applied: string[] } {
  let cur = doc;
  const applied: string[] = [];
  const version = cur.schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 0)
    throw new MigrationError(`Missing or invalid "schemaVersion" (got ${JSON.stringify(version)})`);
  if (version > target)
    throw new MigrationError(
      `File schema version ${version} is newer than this app supports (${target}). Update Kekenik Shader to open it.`,
    );
  let v = version;
  while (v < target) {
    const step = migrations.find((m) => m.from === v);
    if (!step) throw new MigrationError(`No migration available from schema version ${v}`);
    cur = { ...step.up(cur), schemaVersion: step.to };
    applied.push(`${step.from}→${step.to}: ${step.description}`);
    v = step.to;
  }
  return { doc: cur, applied };
}

const asArray = (v: Json | undefined): Json[] => (Array.isArray(v) ? v : []);
const asObj = (v: Json | undefined): JsonObject => (v && typeof v === "object" && !Array.isArray(v) ? v : {});

/**
 * v0 → v1. v0 was the pre-release prototype layout (fake, kept to exercise the migration framework):
 * flat `nodes[]` with `type` / `x` / `y`, and `connections[]` with `"node.port"` strings.
 */
const v0ToV1: Migration = {
  from: 0,
  to: 1,
  description: "prototype layout (nodes[]/connections[]) → graph object",
  up(doc) {
    const nodes: JsonObject = {};
    for (const n of asArray(doc.nodes)) {
      const o = asObj(n);
      const id = String(o.id);
      nodes[id] = {
        id,
        defId: String(o.type),
        position: { x: Number(o.x ?? 0), y: Number(o.y ?? 0) },
        values: asObj(o.values),
        params: asObj(o.params),
        previewEnabled: false,
      };
    }
    const edges: JsonObject = {};
    const split = (s: string) => {
      const i = s.indexOf(".");
      return { node: s.slice(0, i), port: s.slice(i + 1) };
    };
    for (const c of asArray(doc.connections)) {
      const o = asObj(c);
      const from = split(String(o.from));
      const to = split(String(o.to));
      const id = edgeId(from, to);
      edges[id] = { id, from, to };
    }
    return {
      format: "kshader",
      schemaVersion: 1,
      generator: "Kekenik Shader (migrated from v0)",
      graph: {
        id: "graph",
        name: String(doc.name ?? "Untitled"),
        nodes,
        edges,
        properties: asArray(doc.properties),
        keywords: [],
        groups: [],
        comments: [],
        subgraphDefs: {},
        profileId: CORE_DEBUG_PROFILE_ID,
        settings: {},
      },
    };
  },
};

export const KSHADER_MIGRATIONS: readonly Migration[] = [v0ToV1];
