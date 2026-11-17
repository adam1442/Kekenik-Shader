import type { NodeDef } from "../../registry/nodeDef";
import { T } from "../../types/generics";
import { baseNode, enumParam } from "../kit";
import { M, type V } from "../procedural/irm";
import { outPort } from "../procedural/ports";
import { PORTABLE } from "./common";

/** One colour stop: position in [0, 1] and an RGBA colour (components 0…1, used as written: no colour-space conversion). */
interface GradientStop {
  pos: number;
  color: [number, number, number, number];
}
const MAX_GRADIENT_STOPS = 16;
const DEFAULT_STOPS = "0:#000000, 0.5:#ff0000, 1:#ffff00";

type StopParse = { ok: true; stops: GradientStop[] } | { ok: false; error: string };

const hex = (s: string): [number, number, number, number] | null => {
  const m = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(s.trim());
  if (!m) return null;
  let h = m[1]!;
  if (h.length <= 4)
    h = h
      .split("")
      .map((ch) => ch + ch)
      .join("");
  const v = [0, 2, 4, 6].map((i) => (i < h.length ? parseInt(h.slice(i, i + 2), 16) / 255 : 1));
  return [v[0]!, v[1]!, v[2]!, v[3]!];
};

/**
 * Parses `pos:#rrggbb[aa], pos:#rgb, …` (comma / semicolon / newline separated). Positions must be finite and inside [0, 1]; 2…16 stops.
 * Stops are SORTED by position with a STABLE sort (equal positions keep authoring order, so duplicates make a hard edge whose later stop wins).
 */
function parseGradientStops(text: string): StopParse {
  const parts = text
    .split(/[,;\n]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const stops: GradientStop[] = [];
  for (const p of parts) {
    const i = p.indexOf(":");
    if (i < 0) return { ok: false, error: `Stop "${p}" must look like "0.5:#ff8800".` };
    const pos = Number(p.slice(0, i));
    const color = hex(p.slice(i + 1));
    if (!Number.isFinite(pos) || pos < 0 || pos > 1)
      return { ok: false, error: `Stop position "${p.slice(0, i)}" must be a number in 0…1.` };
    if (!color)
      return { ok: false, error: `Stop colour "${p.slice(i + 1).trim()}" must be #rgb, #rgba, #rrggbb or #rrggbbaa.` };
    stops.push({ pos, color });
  }
  if (stops.length < 2) return { ok: false, error: "A gradient needs at least 2 stops." };
  if (stops.length > MAX_GRADIENT_STOPS)
    return { ok: false, error: `At most ${MAX_GRADIENT_STOPS} stops are supported (got ${stops.length}).` };
  return {
    ok: true,
    stops: stops
      .map((s, idx) => ({ s, idx }))
      .sort((a, b) => a.s.pos - b.s.pos || a.idx - b.idx)
      .map((x) => x.s),
  };
}

const multiStopGradientNode: NodeDef = baseNode({
  id: "textureGradient",
  category: "Texture/Gradient",
  name: "Gradient (Multi-stop)",
  synonyms: ["color ramp", "gradient map", "color gradient", "colour ramp", "multi stop gradient"],
  description:
    'Maps T to a colour through up to 16 sorted stops written as "position:#rrggbb[aa]" (e.g. "0:#000000, 0.5:#ff0000, 1:#ffff00"; positions 0…1, hex components used as written — no sRGB/linear conversion). Linear, Smooth (smoothstep) or Step (hold the left stop\'s colour) interpolation. Boundaries are deterministic: T ≤ first stop → first colour, T ≥ last stop → last colour (T is NOT wrapped; use fract / ping-pong first). Duplicate positions make a hard edge (the later stop wins). Invalid stop text is a compile error, never a silent fallback. Outputs RGBA, RGB and alpha in the range of the stop colours.',
  inputs: [{ id: "t", name: "T", type: T("float"), default: 0.5, tooltip: "Position along the gradient (0…1)." }],
  outputs: [
    { id: "out", name: "RGBA", type: T("color4") },
    { id: "rgb", name: "RGB", type: T("color") },
    outPort("alpha", "Alpha", "float"),
  ],
  params: [
    {
      id: "stops",
      label: "Stops",
      control: "string",
      default: DEFAULT_STOPS,
      tooltip: "position:#rrggbb[aa], comma separated, 2–16 stops.",
    },
    enumParam(
      "interp",
      "Interpolation",
      [
        ["linear", "Linear"],
        ["smooth", "Smooth"],
        ["step", "Step"],
      ],
      "linear",
    ),
  ],
  targetNotes: { all: PORTABLE.all + " Unrolled into compare/mix chains (no arrays / LUT textures)." },
  build: (c) => {
    const m = new M(c.b);
    const parsed = parseGradientStops(String(c.param("stops")));
    if (!parsed.ok) return c.fail(parsed.error);
    const stops = parsed.stops,
      mode = c.param<"linear" | "smooth" | "step">("interp");
    const t = m.w(c.in("t"));
    const col = (s: GradientStop): V => m.k("vec4", ...s.color);
    let res = col(stops[stops.length - 1]!);
    for (let i = stops.length - 2; i >= 0; i--) {
      const a = stops[i]!,
        b = stops[i + 1]!,
        w = b.pos - a.pos;
      let seg: V;
      if (mode === "step") seg = col(a);
      else {
        let f = w > 0 ? t.sub(a.pos).div(w).clamp(0, 1) : m.f(1);
        if (mode === "smooth") f = f.mul(f).mul(m.f(3).sub(f.mul(2)));
        seg = col(a).mix(col(b), f);
      }
      res = m.sel(t.lt(b.pos), seg, res);
    }
    return { out: res.id, rgb: res.sw("xyz").id, alpha: res.w.id };
  },
});
export const GRADIENT_DEFS: NodeDef[] = [multiStopGradientNode];
