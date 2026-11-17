import type { NodeDef } from "../../registry/nodeDef";
import { T } from "../../types/generics";
import { baseNode, enumParam } from "../kit";
import { M } from "./irm";
import { floatPort, outPort } from "./ports";

/** R2 (Roberts) and interleaved-gradient (Jimenez) ordered dither thresholds. Both are deterministic functions of the integer pixel. */
const R2 = [0.7548776662466927, 0.5698402909980532] as const;
const IGN = { a: 0.06711056, b: 0.00583715, c: 52.9829189 } as const;

export const ditherNode: NodeDef = baseNode({
  id: "noiseDither",
  category: "Procedural/Noise",
  name: "Blue-noise-like Dither",
  synonyms: ["dither", "ordered dither", "interleaved gradient noise", "r2 dither", "blue noise"],
  description:
    "Per-pixel dither threshold in [0, 1): Threshold = fract(dot(floor(P·Scale), (0.7549, 0.5698))) (R2 low-discrepancy sequence) or interleaved gradient noise. These are blue-noise-LIKE patterns (high-frequency, low clumping), not a measured blue-noise texture. Out = 1 where In > Threshold else 0, so its average over many pixels equals In (for In in 0…1). Pure function of the integer pixel coordinate: repeatable, no time dependence. P is in pixels: multiply UV by the render resolution, or set Scale.",
  inputs: [
    {
      id: "p",
      name: "Pixel",
      type: T("vec2"),
      defaultInput: { input: "uv0" },
      tooltip: "Coordinate in pixels (floor() is applied after Scale).",
    },
    floatPort("scale", "Scale", 256, "Multiplier applied to P before floor() (e.g. render resolution when P is a UV)."),
    floatPort("in", "In", 0.5, "Value to dither (0…1)."),
  ],
  outputs: [outPort("threshold", "Threshold", "float"), outPort("out", "Out", "float")],
  params: [
    enumParam(
      "method",
      "Method",
      [
        ["r2", "R2 sequence"],
        ["ign", "Interleaved gradient"],
      ],
      "r2",
    ),
  ],
  targetNotes: {
    all: "Float-only; exact integer pixel coordinates are required for repeatability (fragment coordinates with half-pixel offsets are fine after floor()).",
  },
  build: (c) => {
    const m = new M(c.b);
    const px = m
      .w(c.in("p"))
      .mul(m.w(c.in("scale")))
      .floor();
    const th =
      c.param("method") === "ign"
        ? px
            .dot(m.k("vec2", IGN.a, IGN.b))
            .fract()
            .mul(IGN.c)
            .fract()
        : px.dot(m.k("vec2", R2[0], R2[1])).fract();
    return { threshold: th.id, out: m.f(1).sub(m.step(m.w(c.in("in")), th)).id };
  },
});
