/** Pure anchored-popover placement (flip + shift). Unit-tested by the tests page. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export interface PopoverPlacement {
  left: number;
  top: number;
  maxHeight: number;
  side: "bottom" | "top";
  flipped: boolean;
  shifted: boolean;
}

/**
 * Place a popover of `size` below (or above when it does not fit) the anchor, shifted horizontally to stay inside the viewport.
 * `align`: "start" aligns left edges, "end" aligns right edges.
 */
export function placePopover(
  anchor: Box,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  opts: { margin?: number; gap?: number; align?: "start" | "end"; prefer?: "bottom" | "top" } = {},
): PopoverPlacement {
  const margin = opts.margin ?? 8;
  const gap = opts.gap ?? 4;
  const prefer = opts.prefer ?? "bottom";
  const spaceBelow = viewport.height - anchor.bottom - gap - margin;
  const spaceAbove = anchor.top - gap - margin;
  let side: "bottom" | "top" = prefer;
  if (prefer === "bottom" && size.height > spaceBelow && spaceAbove > spaceBelow) side = "top";
  else if (prefer === "top" && size.height > spaceAbove && spaceBelow > spaceAbove) side = "bottom";
  const room = side === "bottom" ? spaceBelow : spaceAbove;
  const maxHeight = Math.max(120, Math.min(viewport.height - margin * 2, room));
  const h = Math.min(size.height, maxHeight);
  let top = side === "bottom" ? anchor.bottom + gap : anchor.top - gap - h;
  top = Math.max(margin, Math.min(top, viewport.height - margin - h));
  let left = opts.align === "end" ? anchor.right - size.width : anchor.left;
  const unshifted = left;
  left = Math.max(margin, Math.min(left, viewport.width - margin - size.width));
  return { left, top, maxHeight, side, flipped: side !== prefer, shifted: left !== unshifted };
}
