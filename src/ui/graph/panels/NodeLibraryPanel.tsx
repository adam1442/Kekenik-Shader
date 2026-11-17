import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Star } from "lucide-react";
import { type NodeDef, TARGET_FAMILIES, backendOfFamily, targetFamilyOf } from "@/core";
import { useShader } from "@/app/shaderStore";
import { EmptyState, SearchField, splitHighlight } from "@/ui";
import { addNodeAt, getCanvasApi } from "../actions";
import { categoryColor } from "../categoryColors";
import { useNodePrefs } from "../prefs";
import { useCatalogDefs } from "../subgraphCatalog";
import { isSearchable, searchNodes, signature } from "../searchRanking";

/** Add a library node at the centre of the canvas. */
export function addFromLibrary(defId: string): string | null {
  const api = getCanvasApi();
  const c = api?.centerWorld() ?? { x: 0, y: 0 };
  return addNodeAt(defId, { x: c.x - 80, y: c.y - 40 });
}

function Item({ def, nameIdx = [], showSig }: { def: NodeDef; nameIdx?: number[]; showSig?: boolean }) {
  const fav = useNodePrefs((s) => s.favorites.includes(def.id));
  // Availability for the ACTIVE target (toolbar Target dropdown): a node the target lacks is flagged, not hidden.
  const family = useShader((st) => (st.graph ? targetFamilyOf(st.graph) : "glsl"));
  const backend = backendOfFamily(family);
  const missing = !!def.targets?.backends && !def.targets.backends.includes(backend);
  const familyLabel = TARGET_FAMILIES.find((f) => f.id === family)?.short ?? family;
  return (
    <div
      className="kk-lib-item"
      draggable
      data-lib-item={def.id}
      data-ctx-scope="nodelib.item"
      data-ctx-id={def.id}
      data-unavailable={missing ? "true" : undefined}
      title={`${def.description}\n${signature(def)}${missing ? `\nNot available for the active target (${familyLabel})` : ""}`}
      onDragStart={(e) => {
        e.dataTransfer.setData("application/x-kk-node", def.id);
        e.dataTransfer.setData("text/plain", def.name);
        e.dataTransfer.effectAllowed = "copy";
      }}
      onDoubleClick={() => addFromLibrary(def.id)}
    >
      <span className="kk-lib-item__dot" style={{ background: categoryColor(def.category) }} />
      <span className="kk-lib-item__name">
        {splitHighlight(def.name, nameIdx).map((s, i) =>
          s.hit ? (
            <mark key={i} style={{ background: "transparent", color: "var(--kk-accent-hover)" }}>
              {s.text}
            </mark>
          ) : (
            <span key={i}>{s.text}</span>
          ),
        )}
      </span>
      {showSig && <span className="kk-lib-item__sig">{def.category}</span>}
      {missing && (
        <span className="kk-chip kk-chip--no kk-chip--active" data-testid="lib-unavailable">
          {familyLabel}
        </span>
      )}
      {fav && <Star size={11} className="kk-lib-item__fav" />}
    </div>
  );
}

/** Node Library: categories (collapsible) or fuzzy search; drag a node onto the canvas (or double-click to add at the centre). */
export function NodeLibraryPanel() {
  const [query, setQuery] = useState("");
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const favorites = useNodePrefs((s) => s.favorites);
  const favoritesOnly = useNodePrefs((s) => s.favoritesOnly);
  const recents = useNodePrefs((s) => s.recents);
  const tick = useNodePrefs((s) => s.collapseTick);
  const catalog = useCatalogDefs();
  const all = useMemo(() => catalog.filter(isSearchable), [catalog]);
  const groups = useMemo(() => {
    const m = new Map<string, NodeDef[]>();
    for (const d of all) {
      if (favoritesOnly && !favorites.includes(d.id)) continue;
      (m.get(d.category) ?? m.set(d.category, []).get(d.category)!).push(d);
    }
    return [...m.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([cat, list]) => [cat, list.sort((a, b) => a.name.localeCompare(b.name))] as const);
  }, [all, favoritesOnly, favorites]);
  useEffect(() => {
    if (tick > 0) setClosed(new Set(groups.map(([c]) => c)));
  }, [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const results = useMemo(
    () =>
      query.trim()
        ? searchNodes(all, { query, recents, favorites }).filter((r) => !favoritesOnly || favorites.includes(r.def.id))
        : null,
    [all, query, recents, favorites, favoritesOnly],
  );

  return (
    <div className="kk-gp" data-testid="node-library">
      <div className="kk-gp__bar">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search nodes…"
          size="sm"
          aria-label="Search node library"
        />
      </div>
      <div className="kk-gp__scroll">
        {results ? (
          results.length ? (
            results.map((r) => <Item key={r.def.id} def={r.def} nameIdx={r.nameIdx} showSig />)
          ) : (
            <EmptyState title="No matching nodes" description="Try a synonym, e.g. “mix”, “dot”, “uv”." />
          )
        ) : groups.length ? (
          groups.map(([cat, list]) => {
            const open = !closed.has(cat);
            return (
              <div key={cat} data-lib-cat={cat}>
                <button
                  type="button"
                  className="kk-lib-cat"
                  aria-expanded={open}
                  onClick={() =>
                    setClosed((s) => {
                      const n = new Set(s);
                      if (n.has(cat)) n.delete(cat);
                      else n.add(cat);
                      return n;
                    })
                  }
                >
                  {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  {cat.replace(/\//g, " / ")}
                  <span>{list.length}</span>
                </button>
                {open && list.map((d) => <Item key={d.id} def={d} />)}
              </div>
            );
          })
        ) : (
          <EmptyState title="No favorites yet" description="Right-click a node and choose “Add to Favorites”." />
        )}
      </div>
    </div>
  );
}
