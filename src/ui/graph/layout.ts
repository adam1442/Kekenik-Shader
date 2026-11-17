/**
 * Node geometry. Every row has a fixed height so port positions are COMPUTED (never measured from the DOM):
 * wires, hit-testing, culling and the minimap work for nodes that are not even mounted.
 * Order inside a node: header · outputs · inputs · parameters · optional preview slot.
 */
export const HEADER_H = 32;
export const ROW_H = 24;
const PAD_Y = 6;
const PREVIEW_H = 96;
/** Height of a port-group header row (Master Output: "Vertex" / "Fragment"). */
export const SECTION_H = 22;
export const PORT_SIZE = 10;
export const NODE_W_BASE = 176;
export const NODE_W_GENERIC = 204;
export const NODE_W_WIDE = 236;

interface PortSlot {
  id: string;
  /** Node-local centre. */
  x: number;
  y: number;
}

export interface LayoutInput {
  inputs: readonly string[];
  outputs: readonly string[];
  paramCount: number;
  width: number;
  collapsed: boolean;
  preview: boolean;
  /** Input id → header label drawn (SECTION_H high) directly above that input. */
  sectionBefore?: Readonly<Record<string, string>>;
}

export interface NodeLayout {
  width: number;
  height: number;
  collapsed: boolean;
  outputs: PortSlot[];
  inputs: PortSlot[];
  /** Node-local y of the first parameter row (rows are ROW_H high). */
  paramsY: number;
  previewY: number;
  previewH: number;
  /** Port-group header rows (node-local top y). */
  sections: Array<{ y: number; label: string }>;
}

export function computeLayout(i: LayoutInput): NodeLayout {
  const { width } = i;
  if (i.collapsed) {
    const y = HEADER_H / 2;
    return {
      width,
      height: HEADER_H,
      collapsed: true,
      outputs: i.outputs.map((id) => ({ id, x: width, y })),
      inputs: i.inputs.map((id) => ({ id, x: 0, y })),
      paramsY: HEADER_H,
      previewY: HEADER_H,
      previewH: 0,
      sections: [],
    };
  }
  let y = HEADER_H + PAD_Y;
  const outputs = i.outputs.map((id, k) => ({ id, x: width, y: y + k * ROW_H + ROW_H / 2 }));
  y += i.outputs.length * ROW_H;
  const sections: NodeLayout["sections"] = [];
  const inputs = i.inputs.map((id) => {
    const label = i.sectionBefore?.[id];
    if (label !== undefined) {
      sections.push({ y, label });
      y += SECTION_H;
    }
    const slot = { id, x: 0, y: y + ROW_H / 2 };
    y += ROW_H;
    return slot;
  });
  const paramsY = y;
  y += i.paramCount * ROW_H;
  const previewH = i.preview ? PREVIEW_H : 0;
  const previewY = y + (i.preview ? 4 : 0);
  y = previewY + previewH + (i.preview ? 4 : 0);
  return { width, height: y + PAD_Y, collapsed: false, outputs, inputs, paramsY, previewY, previewH, sections };
}

/** Reroute knot: a small round node; its ports sit on the left / right edge. */
const REROUTE_SIZE = 14;
const PORTAL_H = 28;
const PORTAL_MIN_W = 104;

/** Width of a portal capsule from its channel name (fixed glyph widths so the layout never measures the DOM). */
const portalWidth = (channel: string): number => Math.max(PORTAL_MIN_W, Math.min(240, 62 + channel.length * 7));

/** Reroutes and portals have their own compact geometry (no header, no rows, no editors). */
export function structuralLayout(
  node: { defId: string; params: Record<string, unknown> },
  inputs: ReadonlyArray<{ id: string }>,
  outputs: ReadonlyArray<{ id: string }>,
): NodeLayout {
  const portal = node.defId !== "reroute";
  const width = portal ? portalWidth(String(node.params.channel ?? "")) : REROUTE_SIZE;
  const height = portal ? PORTAL_H : REROUTE_SIZE;
  return {
    width,
    height,
    collapsed: false,
    outputs: outputs.map((p) => ({ id: p.id, x: width, y: height / 2 })),
    inputs: inputs.map((p) => ({ id: p.id, x: 0, y: height / 2 })),
    paramsY: height,
    previewY: height,
    previewH: 0,
    sections: [],
  };
}
