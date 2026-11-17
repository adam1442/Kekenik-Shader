import type { Graph } from "../graph/types";
import { type ParameterManifestEntry, buildParameterManifest } from "./manifest";
import { type RefTarget, REF_TARGETS, targetReferenceName } from "./names";
import { keywordTargetName } from "./refNames";
import type { Keyword, KeywordDefinition, KeywordKind } from "./model";

const MANIFEST_FORMAT = "kekenik-shader-manifest";

interface ManifestParameter extends Omit<ParameterManifestEntry, "referenceName"> {
  /** Canonical (Unity-style) reference name as the user sees it. */
  referenceName: string;
  /** Spelling of the parameter in every export target. */
  referenceNames: Record<RefTarget, string>;
  /** 0-based position in the inspector (graph order). */
  order: number;
}

interface ManifestKeyword {
  id: string;
  displayName: string;
  referenceName: string;
  referenceNames: Record<RefTarget, string>;
  kind: KeywordKind;
  definition: KeywordDefinition;
  scope: Keyword["scope"];
  entries?: string[];
  default: number;
  category?: string;
  tooltip?: string;
  order: number;
}

export interface MaterialManifest {
  format: typeof MANIFEST_FORMAT;
  version: 1;
  shader: string;
  profileId: string;
  parameters: ManifestParameter[];
  /** Header names in first-use order (inspector grouping). */
  headers: string[];
  keywords: ManifestKeyword[];
  /** Properties that exist but are not exposed (internal constants), by id. */
  internal: string[];
}

const namesFor = (canonical: string, f: (c: string, t: RefTarget) => string): Record<RefTarget, string> =>
  Object.fromEntries(REF_TARGETS.map((t) => [t, f(canonical, t)])) as Record<RefTarget, string>;

/**
 * The stable, engine-independent parameter manifest of a graph: everything an exporter or a material
 * inspector needs. Deterministic (same graph ⇒ identical object / JSON). Consumed by exporters.
 */
export function buildMaterialManifest(graph: Graph): MaterialManifest {
  const base = buildParameterManifest(graph.properties, "unity");
  const byId = new Map(graph.properties.map((p) => [p.id, p]));
  const parameters: ManifestParameter[] = base.map((e, order) => {
    const canonical = byId.get(e.id)!.referenceName;
    return { ...e, referenceName: canonical, referenceNames: namesFor(canonical, targetReferenceName), order };
  });
  const headers: string[] = [];
  for (const p of parameters) if (p.category && !headers.includes(p.category)) headers.push(p.category);
  for (const k of graph.keywords) if (k.category && !headers.includes(k.category)) headers.push(k.category);
  const keywords: ManifestKeyword[] = graph.keywords.map((k, order) => ({
    id: k.id,
    displayName: k.displayName,
    referenceName: k.referenceName,
    referenceNames: namesFor(k.referenceName, keywordTargetName),
    kind: k.kind,
    definition: k.definition,
    scope: k.scope,
    ...(k.entries ? { entries: [...k.entries] } : {}),
    default: k.default,
    ...(k.category ? { category: k.category } : {}),
    ...(k.tooltip ? { tooltip: k.tooltip } : {}),
    order,
  }));
  return {
    format: MANIFEST_FORMAT,
    version: 1,
    shader: graph.name,
    profileId: graph.profileId,
    parameters,
    headers,
    keywords,
    internal: graph.properties.filter((p) => !p.exposed).map((p) => p.id),
  };
}

/** Pretty JSON text of the manifest (key order is the construction order above → deterministic). */
export const manifestToJson = (m: MaterialManifest): string => JSON.stringify(m, null, 2);
