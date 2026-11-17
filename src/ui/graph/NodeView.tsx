import { memo, useCallback, useEffect, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, ExternalLink, Plus, XCircle } from "lucide-react";
import type { ShaderType } from "@/core";
import { InlineEditableLabel } from "@/ui";
import { renameNode, toggleCollapse } from "./actions";
import { SUBGRAPH_PARAM } from "@/core";
import { addSubgraphPort, openSubgraph, patchSubgraphPort } from "./subgraphActions";
import { getActiveScope } from "./graphStore";
import { useGraphs } from "./graphStore";
import type { CanvasController } from "./controller/CanvasController";
import { categoryColor } from "./categoryColors";
import { HEADER_H, ROW_H, SECTION_H } from "./layout";
import { isHdrColor } from "./hdr";
import { ParamEditor, PortValueEditor, isInlineEditable } from "./NodeEditors";
import { type PortTypeKey } from "./portStyles";
import { PortDot, dotStyle } from "./PortDot";
import { StructuralNode } from "./StructuralView";
import type { SceneNode } from "./sceneIndex";

export interface NodeViewProps {
  sn: SceneNode;
  ctl: CanvasController;
  selected: boolean;
  multi: boolean;
  /** Not contributing to the Master output → dimmed. */
  inactive: boolean;
  /** Comma-joined ids of connected inputs / outputs (also the memo key for wiring changes). */
  connIn: string;
  connOut: string;
  /** Resolved port types (memo key + render data) — `in:out` joined strings. */
  typesKey: string;
  errors: number;
  warnings: number;
  diagText: string;
}

/** Resolved type of a port for display. Generic ports stay gray (`generic`) until something is connected to the node. */
function portKey(
  spec: { k: string; type?: ShaderType },
  resolved: ShaderType | undefined,
  anyConnected: boolean,
): PortTypeKey {
  if (spec.k === "type" && spec.type) return spec.type;
  return anyConnected && resolved ? resolved : "generic";
}

/** One node card. Memoised: only nodes whose own data changed re-render; drags move it imperatively via transform. */
export const NodeView = memo(function NodeView(p: NodeViewProps) {
  const { sn, ctl, selected, multi, inactive, errors, warnings } = p;
  const { node, def, layout } = sn;
  const [renaming, setRenaming] = useState(false);
  useEffect(() => {
    const on = (e: Event) => (e as CustomEvent<string>).detail === node.id && setRenaming(true);
    window.addEventListener("kk-node-rename", on);
    return () => window.removeEventListener("kk-node-rename", on);
  }, [node.id]);
  const ref = useCallback((el: HTMLDivElement | null) => ctl.registerNode(node.id, el), [ctl, node.id]);
  const info = useGraphs.getState().analysis?.main.info.get(node.id);
  const connIn = new Set(p.connIn ? p.connIn.split(",") : []);
  const connOut = new Set(p.connOut ? p.connOut.split(",") : []);
  const anyIn = connIn.size > 0;
  const title = node.label || def?.name || `Unknown (${node.defId})`;
  const subtitle = node.label && def ? def.name : "";
  const accent = node.color || categoryColor(def?.category);
  const collapsed = layout.collapsed;
  const status = errors ? "error" : warnings ? "warning" : undefined;
  if (def?.structural) return <StructuralNode {...p} />;
  const isInstance = node.defId === "subgraph";
  const ioKind = node.defId === "subgraphInputs" ? "input" : node.defId === "subgraphOutputs" ? "output" : null;
  const ioDef = ioKind ? getActiveScope() : undefined;
  const instanceDef = isInstance ? String(node.params[SUBGRAPH_PARAM] ?? "") : "";

  return (
    <div
      ref={ref}
      className="kk-node"
      data-node-id={node.id}
      data-def={node.defId}
      data-selected={selected || undefined}
      data-collapsed={collapsed || undefined}
      data-inactive={inactive || undefined}
      data-status={status}
      data-ctx-scope={
        selected && multi ? "graph.selection" : node.defId === "masterOutput" ? "graph.master" : "graph.node"
      }
      data-ctx-id={node.id}
      onDoubleClick={
        isInstance
          ? (e) => !(e.target as HTMLElement).closest(".kk-node__header") && openSubgraph(instanceDef)
          : undefined
      }
      style={
        {
          width: layout.width,
          height: layout.height,
          transform: `translate(${node.position.x}px, ${node.position.y}px)`,
          "--kk-accent-node": accent,
        } as React.CSSProperties
      }
    >
      <div className="kk-node__header" style={{ height: HEADER_H }} title={def?.description || undefined}>
        <span className="kk-node__accent" />
        {renaming ? (
          <InlineEditableLabel
            editing
            value={title}
            className="kk-node__rename"
            aria-label="Node name"
            onCommit={(v) => {
              setRenaming(false);
              renameNode(node.id, v === def?.name ? null : v);
            }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <span className="kk-node__title" onDoubleClick={(e) => (e.stopPropagation(), setRenaming(true))}>
            {title}
          </span>
        )}
        {subtitle && !renaming && <span className="kk-node__sub">{subtitle}</span>}
        {status && (
          <span className="kk-node__badge" data-kind={status} title={p.diagText}>
            {status === "error" ? <XCircle size={13} /> : <AlertTriangle size={13} />}
            {errors + warnings > 1 && <b>{errors + warnings}</b>}
          </span>
        )}
        {isInstance && (
          <button
            type="button"
            className="kk-node__collapse"
            data-no-drag=""
            data-testid="open-subgraph"
            aria-label="Open subgraph"
            title="Open subgraph (double-click the node)"
            onClick={() => openSubgraph(instanceDef)}
          >
            <ExternalLink size={12} />
          </button>
        )}
        {ioKind && ioDef && (
          <button
            type="button"
            className="kk-node__collapse"
            data-no-drag=""
            data-testid="add-subgraph-port"
            aria-label={`Add ${ioKind}`}
            title={`Add ${ioKind}`}
            onClick={() => addSubgraphPort(ioDef, ioKind)}
          >
            <Plus size={13} />
          </button>
        )}
        <button
          type="button"
          className="kk-node__collapse"
          data-no-drag=""
          aria-label={collapsed ? "Expand node" : "Collapse node"}
          title={collapsed ? "Expand" : "Collapse"}
          onClick={() => toggleCollapse([node.id])}
        >
          {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        </button>
      </div>

      {!collapsed && (
        <>
          {layout.sections.map((sec) => (
            <div
              key={`s:${sec.label}`}
              className="kk-node__section"
              style={{ top: sec.y, height: SECTION_H }}
              data-ctx-scope="graph.master"
              data-ctx-id={`ctx:${sec.label}`}
              data-section={sec.label}
              title={`${sec.label} context — right-click to add or remove blocks`}
            >
              <span>{sec.label}</span>
            </div>
          ))}
          {sn.outputs.map((port, i) => {
            const slot = layout.outputs[i]!;
            return (
              <div
                key={`o:${port.id}`}
                className="kk-row kk-row--out"
                style={{ top: slot.y - ROW_H / 2, height: ROW_H }}
                data-row-port={port.id}
              >
                {ioKind === "input" && ioDef ? (
                  <IoLabel def={ioDef} kind="input" id={port.id} name={port.name} />
                ) : (
                  <span className="kk-row__label" title={port.tooltip}>
                    {port.name}
                  </span>
                )}
              </div>
            );
          })}
          {sn.inputs.map((port, i) => {
            const slot = layout.inputs[i]!;
            const resolved = info?.inputs[port.id]?.target;
            const key = portKey(port.type, resolved, anyIn);
            const type = (key === "generic" ? (resolved ?? "float") : key) as ShaderType;
            const connected = connIn.has(port.id);
            const showEditor = !connected && isInlineEditable(type);
            return (
              <div
                key={`i:${port.id}`}
                className="kk-row kk-row--in"
                style={{ top: slot.y - ROW_H / 2, height: ROW_H }}
                data-row-port={port.id}
                data-port-inactive={port.inactive || undefined}
              >
                {ioKind === "output" && ioDef ? (
                  <IoLabel def={ioDef} kind="output" id={port.id} name={port.name} />
                ) : (
                  <span className="kk-row__label" title={port.tooltip ?? port.name}>
                    {port.name}
                  </span>
                )}
                {showEditor && (
                  <div className="kk-row__editor">
                    <PortValueEditor nodeId={node.id} port={port} type={type} value={node.values[port.id]} />
                  </div>
                )}
              </div>
            );
          })}
          {sn.params.map((schema, i) => (
            <div
              key={`p:${schema.id}`}
              className="kk-row kk-row--param"
              style={{ top: layout.paramsY + i * ROW_H, height: ROW_H }}
            >
              <span className="kk-row__label">{schema.label}</span>
              <div className="kk-row__editor">
                <ParamEditor
                  nodeId={node.id}
                  schema={schema}
                  value={node.params[schema.id]}
                  hdr={isHdrColor(node.defId, schema.id, node.params)}
                />
              </div>
            </div>
          ))}
          {layout.previewH > 0 && (
            <div
              className="kk-node__preview"
              data-preview-slot={node.id}
              style={{ top: layout.previewY, height: layout.previewH }}
              title="Node preview (rendered by the shared thumbnail renderer)"
            >
              <span>Preview</span>
            </div>
          )}
          {sn.outputs.map((port, i) => {
            const slot = layout.outputs[i]!;
            const key = portKey(port.type, info?.outputs[port.id], anyIn);
            return (
              <PortDot
                key={`po:${port.id}`}
                nodeId={node.id}
                id={port.id}
                dir="out"
                keyType={key}
                connected={connOut.has(port.id)}
                name={port.name}
                style={dotStyle(key, slot.x, slot.y)}
              />
            );
          })}
          {sn.inputs.map((port, i) => {
            const slot = layout.inputs[i]!;
            const key = portKey(port.type, info?.inputs[port.id]?.target, anyIn);
            return (
              <PortDot
                key={`pi:${port.id}`}
                nodeId={node.id}
                id={port.id}
                dir="in"
                keyType={key}
                connected={connIn.has(port.id)}
                name={port.name}
                style={
                  port.inactive ? { ...dotStyle(key, slot.x, slot.y), opacity: 0.4 } : dotStyle(key, slot.x, slot.y)
                }
              />
            );
          })}
        </>
      )}
      {collapsed && (
        <>
          {sn.inputs.length > 0 && (
            <span
              className="kk-port kk-port--ring is-connected is-static"
              style={dotStyle("generic", 0, HEADER_H / 2)}
            />
          )}
          {sn.outputs.length > 0 && (
            <span
              className="kk-port kk-port--ring is-connected is-static"
              style={dotStyle("generic", layout.width, HEADER_H / 2)}
            />
          )}
        </>
      )}
    </div>
  );
});

/** Port name on a subgraph Input / Output node: double-click to rename (the signature is edited in place). */
function IoLabel({ def, kind, id, name }: { def: string; kind: "input" | "output"; id: string; name: string }) {
  const [editing, setEditing] = useState(false);
  if (editing)
    return (
      <InlineEditableLabel
        editing
        value={name}
        className="kk-row__label"
        aria-label="Port name"
        onCommit={(v) => (
          setEditing(false),
          v.trim() && v !== name && patchSubgraphPort(def, kind, id, { name: v.trim() })
        )}
        onCancel={() => setEditing(false)}
      />
    );
  return (
    <span
      className="kk-row__label"
      data-no-drag=""
      title="Double-click to rename"
      onDoubleClick={() => setEditing(true)}
    >
      {name}
    </span>
  );
}
