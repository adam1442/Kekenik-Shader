/** Pure viewport-aware menu placement (unit-tested by the tests page). */

export interface Size {
  width: number;
  height: number;
}

interface RectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type Placement =
  { kind: "point"; x: number; y: number } | { kind: "submenu"; rect: RectLike } | { kind: "dropdown"; rect: RectLike };

export interface PlacementResult {
  left: number;
  top: number;
  maxHeight: number;
  flippedX: boolean;
  flippedY: boolean;
}

const MENU_MARGIN = 8;

/** Compute the final top-left corner of a menu so it stays fully inside the viewport. */
export function placeMenu(placement: Placement, size: Size, viewport: Size, margin = MENU_MARGIN): PlacementResult {
  const maxHeight = Math.max(80, viewport.height - margin * 2);
  const h = Math.min(size.height, maxHeight);
  const w = size.width;
  let left = 0;
  let top = 0;
  let flippedX = false;
  let flippedY = false;

  if (placement.kind === "point") {
    left = placement.x;
    top = placement.y;
    if (left + w > viewport.width - margin) {
      left = placement.x - w;
      flippedX = true;
    }
    if (top + h > viewport.height - margin) {
      top = placement.y - h;
      flippedY = true;
    }
  } else if (placement.kind === "submenu") {
    const r = placement.rect;
    left = r.right - 2;
    top = r.top - 5;
    if (left + w > viewport.width - margin) {
      left = r.left - w + 2;
      flippedX = true;
    }
    if (top + h > viewport.height - margin) {
      top = r.bottom + 5 - h;
      flippedY = true;
    }
  } else {
    const r = placement.rect;
    left = r.left;
    top = r.bottom + 2;
    if (left + w > viewport.width - margin) {
      left = r.right - w;
      flippedX = true;
    }
    if (top + h > viewport.height - margin && r.top - 2 - h >= margin) {
      top = r.top - 2 - h;
      flippedY = true;
    }
  }

  left = Math.max(margin, Math.min(left, viewport.width - margin - w));
  top = Math.max(margin, Math.min(top, viewport.height - margin - h));
  return { left, top, maxHeight, flippedX, flippedY };
}
