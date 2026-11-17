import { useEffect, useMemo, useRef, useState } from "react";
import { FilePlus2, FolderOpen } from "lucide-react";
import { Button, EmptyState } from "@/ui";
import { type CanvasApi, frameNodes, setCanvasApi } from "./actions";
import { AddNodeSearch } from "./AddNodeSearch";
import { GraphTabs, Minimap, ZoomControls } from "./CanvasChrome";
import { CanvasController, type SearchRequest } from "./controller/CanvasController";
import { setActiveController } from "./controller/registry";
import { clearFit, newShaderGraph, openDoc, sceneFor, useGraphs } from "./graphStore";
import { NodeView } from "./NodeView";
import { FramesLayer } from "./FramesLayer";
import { SubgraphBreadcrumb } from "./SubgraphBreadcrumb";
import { PortalIndicators, PortalLinkLayer } from "./PortalLinks";
import { insertRerouteOnWire } from "./structuralActions";
import { structuralType } from "./connect";
import { isOrphanOut } from "@/core";
import { usePreview } from "@/preview/previewStore";
import { openGraphFile } from "./fileIo";

type Conn = { ins: string[]; outs: string[] };
const EMPTY_SEL: string[] = [];

/** The Graph panel: tabs + the node canvas (DOM nodes in one transformed layer, wires on one canvas). */
export function GraphCanvas() {
  const hasDoc = useGraphs((s) => s.docs.length > 0);
  return (
    <div className="kk-graph" data-testid="graph-panel">
      <GraphTabs />
      <SubgraphBreadcrumb />
      {hasDoc ? <CanvasSurface /> : <NoGraph />}
    </div>
  );
}

function NoGraph() {
  return (
    <EmptyState
      icon={FilePlus2}
      title="No graph open"
      description="Create a new graph or open a .kshader file."
      actions={
        <>
          <Button onClick={() => openDoc(newShaderGraph())}>New graph</Button>
          <Button variant="ghost" icon={FolderOpen} onClick={() => openGraphFile()}>
            Open…
          </Button>
        </>
      }
    />
  );
}

function CanvasSurface() {
  const rootRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const ctl = useMemo(() => new CanvasController(), []);
  const [visible, setVisible] = useState<string[]>([]);
  const [search, setSearch] = useState<SearchRequest | null>(null);
  const [bounds, setBounds] = useState({ w: 800, h: 600 });

  const activeId = useGraphs((s) => s.activeId);
  const graph = useGraphs((s) => s.docs.find((d) => d.id === s.activeId)?.graph);
  const selection = useGraphs((s) => s.docs.find((d) => d.id === s.activeId)?.selection) ?? EMPTY_SEL;
  const analysis = useGraphs((s) => s.analysis);
  const gpuDiagnostics = usePreview((s) => s.gpuDiagnostics);

  useEffect(() => {
    ctl.attach({
      root: rootRef.current!,
      world: worldRef.current!,
      canvas: canvasRef.current!,
      box: boxRef.current!,
      tip: tipRef.current!,
    });
    ctl.onVisible = setVisible;
    ctl.onWireDoubleClick = (edge, world) => void insertRerouteOnWire(edge.id, world);
    ctl.onSearch = (r) => {
      setBounds({ w: ctl.size.w, h: ctl.size.h });
      setSearch(r);
    };
    const api: CanvasApi = {
      size: () => ctl.size,
      getView: () => ctl.view,
      setView: (v, a) => ctl.setView(v, a),
      cursorWorld: () => ctl.cursorWorld(),
      centerWorld: () => ctl.centerWorld(),
      frameRect: (r, a) => ctl.frameRect(r, a),
      openSearch: (o) => ctl.openSearch({ ...o }),
      focus: () => ctl.root.focus({ preventScroll: true }),
    };
    setCanvasApi(api);
    setActiveController(ctl);
    return () => {
      setCanvasApi(null);
      setActiveController(null);
      ctl.detach();
    };
  }, [ctl]);

  useEffect(() => {
    const d = useGraphs.getState().docs.find((x) => x.id === activeId);
    if (d) ctl.bind(d.id, d.view);
    if (d?.fit) {
      clearFit(d.id);
      requestAnimationFrame(() => (ctl.measure(), frameNodes(null, false)));
    }
    setSearch(null);
  }, [ctl, activeId]);

  const closeSearch = () => {
    setSearch(null);
    ctl.root.focus({ preventScroll: true });
  };

  const scene = useMemo(() => (graph ? sceneFor(graph) : null), [graph]);
  const conn = useMemo(() => {
    const m = new Map<string, Conn>();
    const at = (id: string) => m.get(id) ?? (m.set(id, { ins: [], outs: [] }), m.get(id)!);
    for (const e of Object.values(graph?.edges ?? {})) {
      at(e.to.node).ins.push(e.to.port);
      at(e.from.node).outs.push(e.from.port);
    }
    return m;
  }, [graph]);
  const diag = useMemo(() => {
    const m = new Map<string, { e: number; w: number; text: string[] }>();
    for (const d of [...(analysis?.diagnostics ?? []), ...gpuDiagnostics]) {
      if (!d.nodeId || d.scope || d.severity === "info") continue;
      const x = m.get(d.nodeId) ?? { e: 0, w: 0, text: [] };
      if (d.severity === "error") x.e++;
      else x.w++;
      x.text.push(d.message);
      m.set(d.nodeId, x);
    }
    return m;
  }, [analysis, gpuDiagnostics]);

  const selSet = useMemo(() => new Set(selection), [selection]);
  const reachable = analysis?.main.rootId ? analysis.main.reachable : null;
  const nodes = scene
    ? visible
        .filter((id) => !scene.isHidden(id))
        .map((id) => scene.get(id))
        .filter((s) => !!s)
    : [];

  return (
    <div className="kk-graph__body">
      <div
        ref={rootRef}
        className="kk-canvas"
        tabIndex={0}
        data-ctx-scope="graph.canvas"
        data-testid="graph-canvas"
        data-doc={activeId}
        aria-label="Node graph canvas"
      >
        <canvas ref={canvasRef} className="kk-canvas__wires" />
        <div ref={worldRef} className="kk-canvas__world" data-testid="graph-world">
          <FramesLayer />
          {nodes.map((sn) => {
            const id = sn.node.id;
            const c = conn.get(id);
            const dg = diag.get(id);
            const info = analysis?.main.info.get(id);
            const typesKey = sn.def?.structural
              ? `${structuralType({ graph: graph!, scene: scene!, analysis }, id) ?? ""}|${isOrphanOut(graph!, id) ? 1 : 0}|${String(sn.node.params.channel ?? "")}`
              : info
                ? `${sn.inputs.map((p) => info.inputs[p.id]?.target ?? "").join(",")}|${sn.outputs.map((p) => info.outputs[p.id] ?? "").join(",")}`
                : "";
            return (
              <NodeView
                key={id}
                sn={sn}
                ctl={ctl}
                selected={selSet.has(id)}
                multi={selection.length > 1}
                inactive={!!reachable && !reachable.has(id)}
                connIn={c?.ins.join(",") ?? ""}
                connOut={c?.outs.join(",") ?? ""}
                typesKey={typesKey}
                errors={dg?.e ?? 0}
                warnings={dg?.w ?? 0}
                diagText={dg?.text.join("\n") ?? ""}
              />
            );
          })}
          <PortalLinkLayer />
        </div>
        <PortalIndicators ctl={ctl} />
        <div ref={boxRef} className="kk-canvas__box" />
        <div ref={tipRef} className="kk-canvas__tip" data-testid="wire-tooltip" role="status" />
        <ZoomControls ctl={ctl} />
        <Minimap ctl={ctl} />
        {search && <AddNodeSearch request={search} bounds={bounds} onClose={closeSearch} />}
      </div>
    </div>
  );
}
