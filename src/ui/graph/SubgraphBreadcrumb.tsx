import { ChevronRight, Home } from "lucide-react";
import { Fragment } from "react";
import { activateDoc, findSubgraphDoc, openMainDoc, openSubgraphDoc, useGraphs } from "./graphStore";

/** `Project › Subgraph A › Subgraph B` above the canvas while a subgraph tab is active. */
export function SubgraphBreadcrumb() {
  const doc = useGraphs((s) => s.docs.find((d) => d.id === s.activeId));
  if (!doc?.scope) return null;
  const path = doc.path ?? [doc.scope];
  return (
    <nav className="kk-crumbs" aria-label="Subgraph path" data-testid="breadcrumb">
      <button type="button" className="kk-crumb" data-crumb="root" onClick={openMainDoc}>
        <Home size={12} /> {doc.graph.name || "Graph"}
      </button>
      {path.map((id, i) => (
        <Fragment key={`${id}:${i}`}>
          <ChevronRight size={12} className="kk-crumbs__sep" />
          <button
            type="button"
            className="kk-crumb"
            data-crumb={id}
            data-current={i === path.length - 1 || undefined}
            onClick={() => {
              const open = findSubgraphDoc(doc.rootId!, id, path.slice(0, i + 1));
              if (open) activateDoc(open.id);
              else openSubgraphDoc(id, path.slice(0, i + 1));
            }}
          >
            {doc.graph.subgraphDefs[id]?.name ?? id}
          </button>
        </Fragment>
      ))}
    </nav>
  );
}
