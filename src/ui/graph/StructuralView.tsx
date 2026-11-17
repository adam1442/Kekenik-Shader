import { memo, useCallback, useEffect, useState } from "react";
import { LogIn, LogOut, ChevronDown } from "lucide-react";
import { channelNames, isOrphanOut } from "@/core";
import { Combobox, InlineEditableLabel, toast } from "@/ui";
import { PortDot, dotStyle } from "./PortDot";
import { getGraph, useGraphs } from "./graphStore";
import { renameChannel, setPortalChannel, structuralTypeOf } from "./structuralActions";
import { channelColor, usePortalUi } from "./portalUi";
import { portColor } from "./portStyles";
import type { NodeViewProps } from "./NodeView";

/** Compact cards for Reroute (a knot) and Portal In / Out (a capsule with a directional glyph and the channel name). */
export const StructuralNode = memo(function StructuralNode(p: NodeViewProps) {
  const { sn, ctl, selected } = p;
  const { node, layout } = sn;
  const ref = useCallback((el: HTMLDivElement | null) => ctl.registerNode(node.id, el), [ctl, node.id]);
  const type = structuralTypeOf(node.id);
  const connIn = p.connIn.length > 0,
    connOut = p.connOut.length > 0;
  const common = {
    ref,
    "data-node-id": node.id,
    "data-def": node.defId,
    "data-selected": selected || undefined,
    "data-ctx-id": node.id,
    "data-type": type ?? "none",
    style: {
      width: layout.width,
      height: layout.height,
      transform: `translate(${node.position.x}px, ${node.position.y}px)`,
      "--kk-st-color": portColor(type),
    } as React.CSSProperties,
  };
  const inKey = type ?? "generic",
    dotIn = sn.inputs[0] && layout.inputs[0],
    dotOut = sn.outputs[0] && layout.outputs[0];
  const dots = (
    <>
      {dotIn && (
        <PortDot
          nodeId={node.id}
          id="in"
          dir="in"
          keyType={inKey}
          connected={connIn}
          name="In"
          style={dotStyle(inKey, layout.inputs[0]!.x, layout.inputs[0]!.y)}
        />
      )}
      {dotOut && (
        <PortDot
          nodeId={node.id}
          id="out"
          dir="out"
          keyType={inKey}
          connected={connOut}
          name="Out"
          style={dotStyle(inKey, layout.outputs[0]!.x, layout.outputs[0]!.y)}
        />
      )}
    </>
  );

  if (node.defId === "reroute") {
    return (
      <div {...common} className="kk-node kk-reroute" data-ctx-scope="graph.reroute" title={node.label || "Reroute"}>
        <span className="kk-reroute__knot" />
        {node.label && <span className="kk-reroute__label">{node.label}</span>}
        {dots}
      </div>
    );
  }
  return <Portal {...p} common={common} dots={dots} type={type} />;
});

function Portal(
  p: NodeViewProps & { common: Record<string, unknown>; dots: React.ReactNode; type: string | undefined },
) {
  const { node } = p.sn;
  const isIn = node.defId === "portalIn";
  const channel = String(node.params.channel ?? "");
  const [editing, setEditing] = useState(false);
  const graph = useGraphs((s) => s.docs.find((d) => d.id === s.activeId)?.graph) ?? getGraph();
  const orphan = !isIn && isOrphanOut(graph, node.id);
  const color = orphan ? "#f87171" : channelColor(channel);
  const Glyph = isIn ? LogIn : LogOut;
  const done = () => setEditing(false);
  useEffect(() => {
    const on = (e: Event) => (e as CustomEvent<string>).detail === node.id && setEditing(true);
    window.addEventListener("kk-node-rename", on);
    return () => window.removeEventListener("kk-node-rename", on);
  }, [node.id]);
  const style = { ...(p.common.style as React.CSSProperties), "--kk-portal-color": color } as React.CSSProperties;
  return (
    <div
      {...p.common}
      style={style}
      className="kk-node kk-portal"
      data-portal={isIn ? "in" : "out"}
      data-channel={channel}
      data-orphan={orphan || undefined}
      data-ctx-scope="graph.portal"
      title={
        orphan
          ? `No Portal In named "${channel}" — this output is disconnected`
          : `${isIn ? "Portal In" : "Portal Out"} · channel "${channel}"`
      }
      onPointerEnter={() => usePortalUi.getState().setHover(node.id)}
      onPointerLeave={() => usePortalUi.getState().setHover(null)}
    >
      {!isIn && <Glyph size={13} className="kk-portal__glyph" />}
      <div className="kk-portal__name" data-no-drag="" onDoubleClick={(e) => (e.stopPropagation(), setEditing(true))}>
        {editing && isIn && (
          <InlineEditableLabel
            editing
            value={channel}
            className="kk-portal__edit"
            aria-label="Channel name"
            onCommit={(v) => {
              done();
              if (v !== channel && !renameChannel(channel, v))
                toast.show({ kind: "warning", title: `Channel name "${v.trim()}" is empty or already used` });
            }}
            onCancel={done}
          />
        )}
        {editing && !isIn && (
          <Combobox
            value={channel}
            suggestions={channelNames(graph)}
            density="compact"
            aria-label="Portal channel"
            validate={(v) => (channelNames(graph).includes(v) ? null : "No Portal In with this name")}
            onCommit={(v) => {
              done();
              if (v !== channel && channelNames(graph).includes(v)) setPortalChannel(node.id, v);
            }}
            onCancel={done}
          />
        )}
        {!editing && <span className="kk-portal__text">{channel || "(unnamed)"}</span>}
      </div>
      {!isIn && !editing && (
        <button
          type="button"
          className="kk-portal__pick"
          data-no-drag=""
          aria-label="Choose channel"
          title="Choose channel"
          onClick={() => setEditing(true)}
        >
          <ChevronDown size={12} />
        </button>
      )}
      {isIn && <Glyph size={13} className="kk-portal__glyph" />}
      {p.dots}
    </div>
  );
}
