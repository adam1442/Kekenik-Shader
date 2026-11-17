import { PORT_SIZE } from "./layout";
import { type PortTypeKey, portStyle } from "./portStyles";

export function dotStyle(key: PortTypeKey, left: number, top: number): React.CSSProperties {
  const s = portStyle(key);
  const style: Record<string, string | number> = {
    left: left - PORT_SIZE / 2,
    top: top - PORT_SIZE / 2,
    "--kk-port-color": s.color,
  };
  if (s.fill) style["--kk-port-fill"] = s.fill;
  return style as React.CSSProperties;
}

export function PortDot(p: {
  nodeId: string;
  id: string;
  dir: "in" | "out";
  keyType: PortTypeKey;
  connected: boolean;
  name: string;
  style: React.CSSProperties;
}) {
  const s = portStyle(p.keyType);
  // The "+" chip is a SIBLING (not a pseudo-element) because several port shapes use clip-path, which would clip it.
  const chip = p.dir === "out" || !p.connected;
  return (
    <>
      <span
        className={`kk-port kk-port--${s.shape}${p.connected ? " is-connected" : ""}`}
        data-port-node={p.nodeId}
        data-port-id={p.id}
        data-port-dir={p.dir}
        data-port-type={p.keyType}
        data-ctx-scope="graph.port"
        data-ctx-id={`${p.dir}:${p.nodeId}:${p.id}`}
        title={`${p.name} · ${s.label}`}
        style={p.style}
      />
      {chip && (
        <span className={`kk-port-plus kk-port-plus--${p.dir}`} style={p.style} aria-hidden="true">
          +
        </span>
      )}
    </>
  );
}
