import { useEffect, useMemo, useRef, useState } from "react";
import { Star } from "lucide-react";
import { type NodeDef, backendOfFamily, targetFamilyOf } from "@/core";
import { useShader } from "@/app/shaderStore";
import { SearchField, splitHighlight, useOverlayLayer } from "@/ui";
import { addNodeAt, insertNodeOnEdge } from "./actions";
import { categoryColor } from "./categoryColors";
import type { SearchRequest } from "./controller/CanvasController";
import { useNodePrefs } from "./prefs";
import { useCatalogDefs } from "./subgraphCatalog";
import { portStyle } from "./portStyles";
import { type SearchResult, searchNodes, signature, targetAvailability } from "./searchRanking";

const W = 380;
const H = 420;

/** Create the chosen node: auto-connected (drag from a port), inserted on a wire, or plain. */
function placeSearchResult(def: NodeDef, req: SearchRequest): string | null {
  if (req.filter && req.anchor) return addNodeAt(def.id, req.world, { anchor: req.anchor, filter: req.filter });
  const id = addNodeAt(def.id, { x: req.world.x - 24, y: req.world.y - 16 });
  if (id && req.insertEdge) insertNodeOnEdge(id, req.insertEdge);
  return id;
}

interface Props {
  request: SearchRequest;
  bounds: { w: number; h: number };
  onClose: () => void;
}

/** Add-node popup: fuzzy + synonyms + categories + recents + favorites; fully keyboard driven (↑↓ Enter Esc). */
export function AddNodeSearch({ request, bounds, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const recents = useNodePrefs((s) => s.recents);
  const favorites = useNodePrefs((s) => s.favorites);
  const list = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  // U1/U3: Esc (top-most only), press outside (swallowed on the canvas), window blur and canvas zoom/pan all close the popup.
  useOverlayLayer(pop, { onClose, consumeOutside: (t) => !!t.closest(".kk-canvas"), closeOnWheelOutside: true });
  const defs = useCatalogDefs();
  const results = useMemo(
    () => searchNodes(defs, { query, recents, favorites, filter: request.filter ?? null, limit: 80 }),
    [defs, query, recents, favorites, request.filter],
  );
  const left = Math.max(8, Math.min(request.screen.x, bounds.w - W - 8));
  const top = Math.max(8, Math.min(request.screen.y, bounds.h - H - 8));

  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const choose = (r: SearchResult | undefined) => {
    if (!r) return;
    placeSearchResult(r.def, request);
    onClose();
  };

  return (
    <div
      ref={pop}
      className="kk-search-pop"
      data-search-popup=""
      data-no-pan=""
      data-no-zoom=""
      data-testid="add-node-search"
      role="dialog"
      aria-label="Add node"
      style={{ left, top, width: W, maxHeight: H }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <SearchField
        autoFocus
        value={query}
        onChange={setQuery}
        placeholder={
          request.filter
            ? `Nodes with a compatible ${request.filter.dir === "out" ? "input" : "output"}…`
            : "Add node — type a name, synonym or category…"
        }
        aria-label="Search nodes"
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") (e.preventDefault(), setIndex((i) => Math.min(results.length - 1, i + 1)));
          else if (e.key === "ArrowUp") (e.preventDefault(), setIndex((i) => Math.max(0, i - 1)));
          else if (e.key === "PageDown") (e.preventDefault(), setIndex((i) => Math.min(results.length - 1, i + 6)));
          else if (e.key === "PageUp") (e.preventDefault(), setIndex((i) => Math.max(0, i - 6)));
          else if (e.key === "Enter") (e.preventDefault(), choose(results[index]));
          else if (e.key === "Escape") (e.preventDefault(), e.stopPropagation(), onClose());
        }}
      />
      <div className="kk-search-pop__list" ref={list} role="listbox">
        {results.length === 0 && <div className="kk-search-pop__empty">No matching nodes</div>}
        {results.map((r, i) => (
          <div
            key={r.def.id}
            role="option"
            aria-selected={i === index}
            data-index={i}
            data-def-id={r.def.id}
            data-ctx-scope="search.result"
            data-ctx-id={r.def.id}
            className={`kk-search-row${i === index ? " is-active" : ""}`}
            onMouseMove={() => i !== index && setIndex(i)}
            onClick={() => choose(r)}
          >
            <span className="kk-search-row__dot" style={{ background: categoryColor(r.def.category) }} />
            <div className="kk-search-row__main">
              <div className="kk-search-row__name">
                {splitHighlight(r.def.name, r.nameIdx).map((s, k) =>
                  s.hit ? <mark key={k}>{s.text}</mark> : <span key={k}>{s.text}</span>,
                )}
                {r.via === "synonym" && <em> · {r.viaText}</em>}
                {r.favorite && <Star size={11} className="kk-search-row__fav" />}
              </div>
              <div className="kk-search-row__sig">
                {r.port && request.filter ? (
                  <span>
                    →{" "}
                    <b style={{ color: portStyle(r.port.type.k === "type" ? r.port.type.type : "generic").color }}>
                      {r.port.name}
                    </b>{" "}
                    ·{" "}
                  </span>
                ) : null}
                {signature(r.def)}
              </div>
            </div>
            <div className="kk-search-row__meta">
              <span className="kk-search-row__cat">{r.def.category}</span>
              <AvailabilityChips def={r.def} />
            </div>
          </div>
        ))}
      </div>
      <div className="kk-search-pop__foot">
        <span>
          <kbd>↑↓</kbd> navigate
        </span>
        <span>
          <kbd>Enter</kbd> add
        </span>
        <span>
          <kbd>Esc</kbd> close
        </span>
      </div>
    </div>
  );
}

/**
 * Availability of a node per target. The ACTIVE target (toolbar Target dropdown, ) is ringed, so the user sees at a glance
 * whether the node exports to the engine / API they are authoring for. Fully portable nodes collapse to "All targets".
 */
export function AvailabilityChips({ def }: { def: NodeDef }) {
  const active = useShader((st) => (st.graph ? backendOfFamily(targetFamilyOf(st.graph)) : "glsl"));
  const t = targetAvailability(def);
  const missing = t.filter((x) => !x.ok);
  if (missing.length === 0)
    return (
      <span className="kk-chip kk-chip--ok" title="Available for GLSL, HLSL, WGSL, Godot and Unity URP">
        All targets
      </span>
    );
  return (
    <>
      {t.map((x) => (
        <span
          key={x.id}
          className={`kk-chip ${x.ok ? "kk-chip--ok" : "kk-chip--no"}${x.id === active ? " kk-chip--active" : ""}`}
          data-active={x.id === active ? "true" : undefined}
          title={`${x.ok ? `Available for ${x.label}` : `Not available for ${x.label}`}${x.id === active ? " — the active target" : ""}`}
        >
          {x.label}
        </span>
      ))}
    </>
  );
}
