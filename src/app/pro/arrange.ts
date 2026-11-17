import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceAround,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceAround,
} from "lucide-react";
import type { AlignMode, DistributeAxis } from "@/core";

/** Align / distribute command table (mode, title, icon) — the ONE list used by command registration and the Edit → Arrange menu. */
export const ALIGN: Array<[AlignMode, string, typeof AlignStartHorizontal]> = [
  ["left", "Align Left", AlignStartHorizontal],
  ["hcenter", "Align Horizontal Centers", AlignCenterHorizontal],
  ["right", "Align Right", AlignEndHorizontal],
  ["top", "Align Top", AlignStartVertical],
  ["vcenter", "Align Vertical Centers", AlignCenterVertical],
  ["bottom", "Align Bottom", AlignEndVertical],
];
export const DIST: Array<[DistributeAxis, string, typeof AlignStartHorizontal]> = [
  ["horizontal", "Distribute Horizontally", AlignHorizontalSpaceAround],
  ["vertical", "Distribute Vertically", AlignVerticalSpaceAround],
];
