import { type Graph, type IRBody, type ShaderType, compileGraph, reachableMask } from "@/core";
import { buildThumbGraph, primaryOutput } from "../logic/thumbGraph";

/** Result of the Bake-to-Texture legality check . Pure — no DOM / GPU. */
export interface BakeAnalysis {
  ok: boolean;
  /** Why the node cannot be baked (empty when `ok`). Shown verbatim in the dialog. */
  reasons: string[];
  port?: string;
  type?: ShaderType;
  /** 1 = float (grey), 3 = vec3 / colour. */
  channels?: 1 | 3;
}

const BAKEABLE: Partial<Record<ShaderType, 1 | 3>> = { float: 1, vec3: 3, color: 3 };

/**
 * A cone may be baked only when its value is a pure function of UV0: every leaf of the compiled IR must be a constant or `uv0`.
 * Anything else (exposed properties, time, textures, vertex data, derivatives, engine data, hand-written code) makes the result
 * depend on something a still image cannot capture, so the bake is refused with the exact reason.
 */
export function analyzeBake(graph: Graph, nodeId: string): BakeAnalysis {
  const node = graph.nodes[nodeId];
  if (!node) return { ok: false, reasons: ["The node no longer exists."] };
  const out = primaryOutput(graph, nodeId);
  if (!out) return { ok: false, reasons: ["This node has no output to bake."] };
  const channels = BAKEABLE[out.type];
  if (!channels)
    return {
      ok: false,
      reasons: [
        `Output type ${out.type} cannot be baked — bake a Float, Vector 3 or Color output (use Split / Combine to pick the part you need).`,
      ],
      port: out.port,
      type: out.type,
    };
  const tg = buildThumbGraph(graph, nodeId);
  if (!tg)
    return {
      ok: false,
      reasons: ["This node cannot be evaluated on its own (master output, texture or matrix value)."],
      port: out.port,
      type: out.type,
    };
  const r = compileGraph(tg.graph, { skipEmit: true, optimize: 0 });
  if (!r.module)
    return {
      ok: false,
      reasons: [r.diagnostics.find((d) => d.severity === "error")?.message ?? "The node does not compile."],
      port: out.port,
      type: out.type,
    };

  const m = r.module;
  const reasons = new Set<string>();
  const propName = (id: string): string => graph.properties.find((p) => p.id === id)?.displayName ?? id;
  const scan = (body: IRBody, mask: Uint8Array | null): void => {
    body.exprs.forEach((e, i) => {
      if (mask && !mask[i]) return;
      switch (e.op) {
        case "sample":
          reasons.add("it reads a texture (a bake can only capture UV and constants)");
          break;
        case "uniform":
          reasons.add(
            e.prop.startsWith("__thumb")
              ? "it reads a texture (a bake can only capture UV and constants)"
              : `it depends on the exposed property “${propName(e.prop)}” (a baked image would freeze its value)`,
          );
          break;
        case "input":
          if (e.input !== "uv0") reasons.add(`it reads ${e.input} (only UV0 and constants are allowed)`);
          break;
        case "deriv":
          reasons.add("it uses screen-space derivatives (ddx / ddy / fwidth), which depend on the pixel grid");
          break;
        case "engine":
          reasons.add(`it reads engine data (${e.name}) such as time, camera or lights`);
          break;
        case "custom":
          reasons.add("it contains a Custom Function (cannot prove it only reads UV)");
          break;
        default:
          break;
      }
    });
  };
  const mask = reachableMask(
    m.main,
    m.outputs.map((o) => o.value),
  );
  scan(m.main, mask);
  if (m.main.exprs.some((e, i) => mask[i] && e.op === "call")) for (const f of m.functions) scan(f.body, null);
  if (reasons.size > 0)
    return { ok: false, reasons: [...reasons].map((x) => `Not bakeable: ${x}.`), port: out.port, type: out.type };
  return { ok: true, reasons: [], port: out.port, type: out.type, channels };
}
