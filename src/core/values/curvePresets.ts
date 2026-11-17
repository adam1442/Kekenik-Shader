/** Curve presets on the unit box (time 0..1, value 0..1). */
import { makeCurve, makeKey, type Curve, type Key, type WrapMode } from "./curve";

export interface CurvePreset {
  id: string;
  name: string;
  build: () => Curve;
}

const k = (t: number, v: number, mode: Key["mode"], inTan = 0, outTan = 0): Key => makeKey(t, v, mode, inTan, outTan);

/** Hermite-exact ease-out bounce (each bounce is a parabola; keys carry the exact end slopes). */
function bounceKeys(): Key[] {
  const broken = (t: number, v: number, inTan: number, outTan: number): Key => ({
    ...k(t, v, "broken", inTan, outTan),
    inSide: "free",
    outSide: "free",
  });
  return [
    broken(0, 0, 0, 0),
    broken(1 / 2.75, 1, 5.5, -2.75),
    broken(1.5 / 2.75, 0.75, 0, 0),
    broken(2 / 2.75, 1, 2.75, -1.375),
    broken(2.25 / 2.75, 0.9375, 0, 0),
    broken(2.5 / 2.75, 1, 1.375, -0.6875),
    broken(2.625 / 2.75, 0.984375, 0, 0),
    broken(1, 1, 0.6875, 0),
  ];
}

export const CURVE_PRESETS: readonly CurvePreset[] = [
  { id: "linear", name: "Linear", build: () => makeCurve([k(0, 0, "linear"), k(1, 1, "linear")]) },
  {
    id: "ease-in",
    name: "Ease in",
    build: () =>
      makeCurve(
        [k(0, 0, "broken", 0, 0), { ...k(1, 1, "broken", 2, 0), inSide: "free", outSide: "free" }].map((x) => ({
          ...x,
          inSide: "free" as const,
          outSide: "free" as const,
        })),
      ),
  },
  {
    id: "ease-out",
    name: "Ease out",
    build: () =>
      makeCurve([
        { ...k(0, 0, "broken", 0, 2), inSide: "free", outSide: "free" },
        { ...k(1, 1, "broken", 0, 0), inSide: "free", outSide: "free" },
      ]),
  },
  { id: "ease-in-out", name: "Ease in-out", build: () => makeCurve([k(0, 0, "flat"), k(1, 1, "flat")]) },
  {
    id: "s-curve",
    name: "S-curve",
    build: () => makeCurve([k(0, 0, "flat"), k(0.5, 0.5, "free", 2, 2), k(1, 1, "flat")]),
  },
  { id: "bounce", name: "Bounce", build: () => makeCurve(bounceKeys()) },
  {
    id: "hold",
    name: "Hold (stepped)",
    build: () => makeCurve([k(0, 0, "constant"), k(0.5, 1, "constant"), k(1, 1, "constant")]),
  },
  {
    id: "ramp",
    name: "Ramp (loop)",
    build: () =>
      makeCurve([k(0, 0, "linear"), k(1, 1, "linear")], { preWrap: "loop" as WrapMode, postWrap: "loop" as WrapMode }),
  },
  { id: "pulse", name: "Pulse", build: () => makeCurve([k(0, 0, "auto"), k(0.5, 1, "auto"), k(1, 0, "auto")]) },
  { id: "one", name: "Constant 1", build: () => makeCurve([k(0, 1, "flat"), k(1, 1, "flat")]) },
  { id: "zero", name: "Constant 0", build: () => makeCurve([k(0, 0, "flat"), k(1, 0, "flat")]) },
];
